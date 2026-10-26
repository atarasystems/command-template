import { withCommandAuth } from '../_lib/auth.js';
import { getSupabase } from '../_lib/supabase.js';
import { insertRow } from '../_lib/records.js';
import { generateCommunicationDraft, buildCommunicationContext } from '../_lib/communications.js';
import { founderSettings, firstName } from '../_lib/founder-settings.js';

import { aiJson } from '../_lib/ai.js';
import { brandList } from '../_lib/founder-settings.js';

// Areas are the founder's brands from setup. Interests are a short general list plus those brands.
export const BASE_INTERESTS = ['client', 'partnership', 'networking', 'funding', 'vendor', 'other'];
function areasFor(settings) { return brandList(settings).map((b) => b.name).filter(Boolean); }
function interestsFor(settings) { return [...BASE_INTERESTS, ...areasFor(settings)]; }
const RELATIONSHIP_ROLES = {
  prospect: 'prospect',
  client: 'client',
  partner: 'strategic_partner',
  network: 'ecosystem_partner',
  institution: 'program_contact',
  funder: 'investor_funder',
  subcontractor: 'vendor',
  other: 'other',
};

function clean(value, max = 5000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function parseJson(text) {
  return JSON.parse(String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
}

async function interpretRelationshipRequest(instruction, messages = [], settings) {
  const name = firstName(settings);
  const areas = areasFor(settings);
  const interests = interestsFor(settings);
  const history = (Array.isArray(messages) ? messages : []).slice(-8).map(message => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: clean(message?.content, 3000) || '',
  }));
  const prompt = `Extract a relationship/contact intake for Command from ${name}'s request and recent River context.

Rules:
- Use only facts explicitly supplied. Never invent a name, email, company, role, referrer, or reason for connecting.
- If ${name} says "her", "him", or "them", use recent context only when it clearly identifies the person.
- areas may contain only: ${areas.length ? areas.join(', ') : '(none, leave empty)'}.
- interest may be only: ${interests.join(', ')}, or null.
- relationship_type may be only: prospect, client, partner, network, institution, funder, subcontractor, other.
- For a warm professional introduction with no sales intent, default relationship_type to network and interest to networking.
- If the person works at a clinic, university, nonprofit, accelerator, funder, or similar organization and the relationship is organizational, relationship_type may be institution.
- email_goal should describe what ${name} wants the email to accomplish in one sentence.
- source should preserve the referrer's name and date/source wording when supplied.
- notes should preserve useful relationship context, not marketing copy.
- Do not add a follow-up date unless ${name} explicitly supplied one.

Latest request: ${clean(instruction, 5000)}

Recent River context:
${JSON.stringify(history)}

Return JSON only with these keys: full_name, email, company, title, source, notes, areas (array), interest, relationship_type (one of ${Object.keys(RELATIONSHIP_ROLES).join(', ')}), email_goal, followup_due_date. Use null for anything not supplied.`;

  const parsed = await aiJson({ prompt, temperature: 0, maxTokens: 1200 });
  parsed.areas = (Array.isArray(parsed.areas) ? parsed.areas : []).filter((a) => areas.includes(a));
  if (!interests.includes(parsed.interest)) parsed.interest = parsed.interest ? 'other' : null;
  if (!Object.hasOwn(RELATIONSHIP_ROLES, parsed.relationship_type)) parsed.relationship_type = 'other';
  return parsed;
}

async function getOrCreateAccount(db, name) {
  const accountName = clean(name, 300);
  if (!accountName) return null;
  const existing = await db.from('crm_accounts').select('id,name').ilike('name', accountName).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const created = await db.from('crm_accounts').insert({ name: accountName, account_type: 'business' }).select('id,name').single();
  if (created.error) throw created.error;
  return created.data;
}

async function findExistingContact(db, intake) {
  if (intake.email) {
    const byEmail = await db.from('crm_contacts').select('*, account:crm_accounts(id,name)').ilike('email', intake.email).is('archived_at', null).limit(1).maybeSingle();
    if (byEmail.error) throw byEmail.error;
    if (byEmail.data) return byEmail.data;
  }
  if (intake.full_name) {
    const byName = await db.from('crm_contacts').select('*, account:crm_accounts(id,name)').ilike('full_name', intake.full_name).is('archived_at', null).limit(1).maybeSingle();
    if (byName.error) throw byName.error;
    if (byName.data) return byName.data;
  }
  return null;
}

async function upsertContact(db, intake) {
  const account = await getOrCreateAccount(db, intake.company);
  const existing = await findExistingContact(db, intake);
  const values = {
    full_name: clean(intake.full_name, 300),
    email: clean(intake.email, 320),
    job_title: clean(intake.title, 300),
    account_id: account?.id || existing?.account_id || null,
    notes: clean(intake.notes, 5000) || existing?.notes || null,
    areas: Array.isArray(intake.areas) ? intake.areas : [],
    interest: intake.interest || null,
    next_action: intake.email_goal ? 'Review and send prepared relationship email' : existing?.next_action || null,
    next_action_at: intake.followup_due_date ? new Date(`${intake.followup_due_date}T12:00:00Z`).toISOString() : existing?.next_action_at || null,
    capture_status: 'complete',
    contact_status: intake.email_goal ? 'follow_up_needed' : existing?.contact_status || 'new',
  };
  Object.keys(values).forEach(key => values[key] === null && !['account_id','email','job_title','notes','interest','next_action','next_action_at'].includes(key) && delete values[key]);

  let contact;
  if (existing) {
    const updated = await db.from('crm_contacts').update(values).eq('id', existing.id).select('*, account:crm_accounts(id,name)').single();
    if (updated.error) throw updated.error;
    contact = updated.data;
  } else {
    if (!values.full_name && !values.email) throw Object.assign(new Error('I need at least the person\'s name or email to add the contact.'), { code: 'VALIDATION_ERROR' });
    const created = await db.from('crm_contacts').insert(values).select('*, account:crm_accounts(id,name)').single();
    if (created.error) throw created.error;
    contact = created.data;
  }

  const role = RELATIONSHIP_ROLES[intake.relationship_type] || 'other';
  const active = await db.from('crm_contact_roles').select('id,role').eq('contact_id', contact.id).eq('active', true).limit(1).maybeSingle();
  if (active.error) throw active.error;
  if (!active.data) {
    const createdRole = await db.from('crm_contact_roles').insert({ contact_id: contact.id, role, source_type: 'river', active: true, notes: 'Captured by River relationship workflow' });
    if (createdRole.error) throw createdRole.error;
  } else if (active.data.role !== role) {
    const updatedRole = await db.from('crm_contact_roles').update({ role, notes: 'Updated by River relationship workflow' }).eq('id', active.data.id);
    if (updatedRole.error) throw updatedRole.error;
  }

  if (intake.source || intake.notes) {
    const subject = intake.source ? `Introduced via ${clean(intake.source, 400)}` : 'Relationship context added by River';
    const recent = await db.from('crm_activities').select('id').eq('contact_id', contact.id).eq('subject', subject).limit(1).maybeSingle();
    if (recent.error) throw recent.error;
    if (!recent.data) await insertRow('crm_activities', {
      contact_id: contact.id,
      account_id: contact.account_id || null,
      activity_type: 'relationship_added',
      subject,
      description: clean(intake.notes, 5000),
      metadata: { source: clean(intake.source, 500), areas: values.areas || [], interest: values.interest || null, captured_by: 'river' },
      occurred_at: new Date().toISOString(),
    });
  }
  return contact;
}

async function prepareDraft(db, contact, intake) {
  if (!contact.email || !intake.email_goal) return null;
  const activitiesResult = await db.from('crm_activities').select('activity_type,subject,description,occurred_at').eq('contact_id', contact.id).order('occurred_at', { ascending: false }).limit(6);
  if (activitiesResult.error) throw activitiesResult.error;
  const context = buildCommunicationContext({
    contact,
    account: contact.account || {},
    activities: activitiesResult.data || [],
    purpose: 'relationship',
  });
  const settings = await founderSettings(db);
  context.relationship_notes = [context.relationship_notes, `${firstName(settings)}'s current goal: ${clean(intake.email_goal, 1000)}`].filter(Boolean).join('\n');
  const draft = await generateCommunicationDraft(context, { settings });
  return insertRow('crm_email_drafts', {
    account_id: contact.account_id || null,
    contact_id: contact.id,
    to_email: contact.email,
    subject: draft.subject,
    body: draft.body,
    draft_type: 'networking',
    status: 'needs_review',
    drafted_by: 'River relationship workflow',
    needs_human: true,
    human_reason: 'Founder approval required before sending',
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  try {
    const instruction = clean(req.body?.instruction, 5000);
    if (!instruction) return res.status(400).json({ ok: false, error: { message: 'Tell your assistant who to add and what you want to send.' } });
    const db = getSupabase();
    const intake = await interpretRelationshipRequest(instruction, req.body?.messages || [], await founderSettings(db));
    const contact = await upsertContact(db, intake);
    const draft = await prepareDraft(db, contact, intake);
    return res.status(200).json({ ok: true, data: {
      contact: { id: contact.id, name: contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' '), email: contact.email, company: contact.account?.name || null },
      intake,
      draft: draft ? { id: draft.id, subject: draft.subject, body: draft.body, status: draft.status } : null,
    } });
  } catch (error) {
    const status = error?.code === 'VALIDATION_ERROR' ? 400 : error?.code === 'AI_NOT_CONFIGURED' ? 503 : 500;
    console.error('[River Relationship]', error.message);
    return res.status(status).json({ ok: false, error: { message: error.message || 'River could not prepare this relationship workflow.' } });
  }
}

export default withCommandAuth(handler);
export const config = { maxDuration: 60 };
