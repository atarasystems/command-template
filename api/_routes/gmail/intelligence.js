import { withCommandAuth } from '../_lib/auth.js';
import { getAccessToken, gmailConfigured, gmailMetadata, listInbox } from '../_lib/gmail.js';
import { client, supabaseError } from '../_lib/work.js';
import '../../../email-attention.js';

const emailAttention = globalThis.AtaraEmailAttention;

const CLASSIFICATIONS = ['sales', 'client', 'networking', 'grant_program_opportunity', 'application_update', 'decision_result', 'administrative', 'ignore'];

export function inferDecisionStatus(subject = '', snippet = '') {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (/rejected|not selected|regret to inform|unsuccessful/.test(text)) return 'not_selected';
  if (/awarded|selected for funding|approved for funding|award recipient|accepted into the program/.test(text)) return 'awarded';
  if (/interview|schedule an interview|invite you to interview/.test(text)) return 'interview';
  if (/finalist|semi-finalist|advanced to final round|advanced to next round/.test(text)) return 'final_decision';
  return null;
}

export function classifyEmail({ sender = {}, subject = '', snippet = '' }) {
  const text = `${subject} ${snippet}`.toLowerCase();
  // Classification is about the message; sender role is only used for safe
  // contact creation/matching and must never suppress important notices.
  if (/congratulations|congrats|awarded|award|rejected|regret to inform|not selected|finalist|interview/.test(text)) return { classification: 'decision_result', confidence: 0.91 };
  if (/thank you for applying|application(?: has been)? received|application update|submitted|status of your application/.test(text)) return { classification: 'application_update', confidence: 0.9 };
  if (/applications? (are )?now open|grant|accelerator|pitch competition|fellowship|procurement opportunity|funding program|apply now|request for proposal|\brfp\b/.test(text)) return { classification: 'grant_program_opportunity', confidence: 0.86 };
  if (/client|project|deliverable|requested files|feedback|revision/.test(text)) return { classification: 'client', confidence: 0.78 };
  if (/proposal|pricing|website|audit|services|interested|follow up|follow-up|intro|question|request/.test(text)) return { classification: 'sales', confidence: 0.78 };
  if (/community|founder|partner|network|nice to meet|connect/.test(text)) return { classification: 'networking', confidence: 0.73 };
  if (/unsubscribe|receipt|invoice|password reset|security alert|calendar notification|automated message/.test(text)) return { classification: 'administrative', confidence: 0.96 };
  return { classification: 'ignore', confidence: 0.55 };
}

function opportunityProposal(message, classification) {
  if (classification === 'grant_program_opportunity') return { proposed_action: 'review_opportunity', proposed_changes: { title: message.subject || 'Program opportunity from email', organization: message.sender.name || message.sender.email, opportunity_type: /accelerator/.test(`${message.subject} ${message.snippet}`.toLowerCase()) ? 'accelerator' : /fellowship/.test(`${message.subject} ${message.snippet}`.toLowerCase()) ? 'fellowship' : 'program', status: 'discovered', source_type: 'gmail', source_id: message.message_id } };
  if (classification === 'application_update') return { proposed_action: 'review_application_update', proposed_changes: { status: 'awaiting_response', source_type: 'gmail', source_id: message.message_id } };
  if (classification === 'decision_result') return { proposed_action: 'review_decision', proposed_changes: { suggested_status: inferDecisionStatus(message.subject, message.snippet), source_type: 'gmail', source_id: message.message_id } };
  if (classification === 'sales' || classification === 'client' || classification === 'networking') return { proposed_action: 'create_follow_up', proposed_changes: { title: `Review and respond: ${message.subject || message.sender.name || message.sender.email}` } };
  return { proposed_action: null, proposed_changes: {} };
}

function tokens(value) { return new Set((value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((word) => word.length >= 4)); }

export function chooseOpportunityMatch(message, opportunities = []) {
  const text = `${message.subject || ''} ${message.snippet || ''}`.toLowerCase();
  const scored = opportunities.filter((opportunity) => opportunity.status !== 'archived').map((opportunity) => {
    const titleTokens = tokens(opportunity.title); const overlap = [...titleTokens].filter((word) => text.includes(word)).length;
    const organization = (opportunity.organization || '').toLowerCase().trim();
    const organizationMatch = Boolean(organization && text.includes(organization));
    return { id: opportunity.id, score: overlap + (organizationMatch ? 2 : 0), strong: overlap >= 2 || (organizationMatch && overlap >= 1) };
  }).filter((candidate) => candidate.strong).sort((a, b) => b.score - a.score);
  if (!scored.length) return { opportunity_id: null, candidate_ids: [] };
  const top = scored.filter((candidate) => candidate.score === scored[0].score);
  return top.length === 1 ? { opportunity_id: top[0].id, candidate_ids: [top[0].id] } : { opportunity_id: null, candidate_ids: top.map((candidate) => candidate.id) };
}

async function findContext(db, senderEmail) {
  const { data: contacts } = await db.from('crm_contacts').select('id,account_id,full_name,email').ilike('email', senderEmail).limit(1);
  const contact = contacts?.[0] || null;
  let account = contact?.account_id ? (await db.from('crm_accounts').select('id,name').eq('id', contact.account_id).maybeSingle()).data : null;
  if (!account && senderEmail.includes('@')) account = (await db.from('crm_accounts').select('id,name').ilike('domain', senderEmail.split('@')[1]).limit(1)).data?.[0] || null;
  return { contact, account };
}

async function ensureActivity(db, message, classification, context) {
  if (!context.contact && !context.account) return;
  const externalId = `gmail:${message.message_id}`;
  const existing = await db.from('crm_activities').select('id').eq('external_id', externalId).limit(1);
  if (existing.data?.length) return existing.data[0];
  const { data } = await db.from('crm_activities').insert({ contact_id: context.contact?.id || null, account_id: context.account?.id || null, activity_type: 'email_received', subject: message.subject, description: `Incoming ${classification} email from ${message.sender.name || message.sender.email}.`, external_id: externalId, metadata: { gmail_message_id: message.message_id, gmail_thread_id: message.thread_id, classification }, occurred_at: message.received_at || new Date().toISOString() }).select().single();
  return data;
}

export async function ensureWork(db, message, classification, context = {}) {
  if (!['sales', 'client', 'networking', 'application_update', 'decision_result'].includes(classification)) return null;
  const triage = emailAttention.classify({ ...message, classification, contact_id: context.contact?.id || null, account_id: context.account?.id || null, contact_name: context.contact?.full_name || null, account_name: context.account?.name || null }, { now: new Date() });
  if (triage.bucket !== 'ACTION_REQUIRED') return null;
  const actionEvidence = /please|can you|could you|question|reply|respond|follow[- ]?up|schedule|interested|requested|need|next step/.test(`${message.subject} ${message.snippet}`.toLowerCase());
  if (['sales', 'client', 'networking'].includes(classification) && (!context.contact && !context.account || !actionEvidence)) return null;
  const sourceId = message.message_id;
  const existing = await db.from('work_items').select('*').eq('source_type', 'gmail').eq('source_id', sourceId).limit(1);
  if (existing.data?.[0]) return existing.data[0];
  const title = classification === 'application_update' ? `Review application update: ${message.subject}` : classification === 'decision_result' ? `Review program decision: ${message.subject}` : `Review and respond: ${message.subject || message.sender.name || message.sender.email}`;
  const { data } = await db.from('work_items').insert({ title, category: classification === 'application_update' || classification === 'decision_result' ? 'grant' : classification, status: 'open', priority: classification === 'decision_result' ? 'now' : 'next', owner_type: 'founder', owner_name: null, source_type: 'gmail', source_id: sourceId, notes: `From ${message.sender.name || message.sender.email}. ${message.snippet || ''}` }).select().single();
  return data;
}

async function scan(db, days) {
  const token = await getAccessToken(); const ids = await listInbox(token, days); const results = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = await Promise.all(ids.slice(i, i + 20).map(async ({ id }) => { try { return await gmailMetadata(token, id); } catch (_) { return null; } }));
    for (const message of batch.filter(Boolean)) {
      const classification = classifyEmail(message); if (classification.classification === 'ignore') continue;
      const existing = await db.from('crm_email_insights').select('id').eq('gmail_message_id', message.message_id).maybeSingle();
      if (existing.data) { results.push({ id: existing.data.id, duplicate: true }); continue; }
      const context = await findContext(db, message.sender.email); const proposal = opportunityProposal(message, classification.classification);
      let matchedOpportunity = null;
      if (['application_update', 'decision_result'].includes(classification.classification)) {
        const matches = await db.from('crm_program_opportunities').select('id,title,organization,status').not('status', 'eq', 'archived');
        const selected = chooseOpportunityMatch(message, matches.data || []);
        matchedOpportunity = (matches.data || []).find((opportunity) => opportunity.id === selected.opportunity_id) || null;
        proposal.proposed_changes = { ...proposal.proposed_changes, opportunity_id: matchedOpportunity?.id || null, current_status: matchedOpportunity?.status || null, candidate_opportunity_ids: selected.candidate_ids };
      }
      const insightValues = { gmail_message_id: message.message_id, gmail_thread_id: message.thread_id, sender_name: message.sender.name, sender_email: message.sender.email, subject: message.subject, snippet: message.snippet, received_at: message.received_at, classification: classification.classification, confidence: classification.confidence, contact_id: context.contact?.id || null, account_id: context.account?.id || null, program_opportunity_id: matchedOpportunity?.id || null, ...proposal, review_status: 'pending' };
      const { data: insight, error } = await db.from('crm_email_insights').insert(insightValues).select().single(); if (error) throw error;
      await ensureActivity(db, message, classification.classification, context); await ensureWork(db, message, classification.classification, context);
      results.push(insight);
    }
  }
  return results;
}

async function applyInsight(db, insight, selectedOpportunityId = null, selectedStatus = null) {
  const changes = insight.proposed_changes || {};
  const suggestedStatus = selectedStatus || changes.status || changes.suggested_status;
  let opportunityId = selectedOpportunityId || insight.program_opportunity_id;
  const candidateIds = changes.candidate_opportunity_ids || [];
  if (selectedOpportunityId && candidateIds.length && !candidateIds.includes(selectedOpportunityId)) throw new Error('Selected opportunity is not a proposed candidate');
  if (['application_update', 'decision_result'].includes(insight.classification) && !opportunityId) throw new Error('Choose the opportunity this email belongs to before applying');
  if (insight.classification === 'decision_result' && !suggestedStatus) throw new Error('Choose a decision status before applying');
  if (insight.proposed_action === 'review_opportunity' && !opportunityId) {
    const { data, error } = await db.from('crm_program_opportunities').insert({ opportunity_type: changes.opportunity_type || 'program', title: changes.title || insight.subject || 'Program opportunity', organization: changes.organization, status: changes.status || 'discovered', source_type: 'gmail', source_id: insight.gmail_message_id, contact_id: insight.contact_id, account_id: insight.account_id }).select().single(); if (error) throw error; opportunityId = data.id;
  } else if (opportunityId && suggestedStatus) {
    const { error } = await db.from('crm_program_opportunities').update({ status: suggestedStatus }).eq('id', opportunityId); if (error) throw error;
  }
  if (opportunityId) await db.from('crm_activities').insert({ contact_id: insight.contact_id, account_id: insight.account_id, activity_type: suggestedStatus === 'awaiting_response' ? 'application_update_received' : suggestedStatus === 'awarded' || suggestedStatus === 'not_selected' ? 'decision_received' : 'program_discovered', subject: insight.subject, description: `Applied after human review: ${insight.proposed_action}`, external_id: `gmail-insight:${insight.id}:applied`, metadata: { gmail_message_id: insight.gmail_message_id, gmail_thread_id: insight.gmail_thread_id, classification: insight.classification }, occurred_at: insight.received_at || new Date().toISOString() });
  const { data, error } = await db.from('crm_email_insights').update({ review_status: 'applied', reviewed_at: new Date().toISOString(), program_opportunity_id: opportunityId }).eq('id', insight.id).select().single(); if (error) throw error; return data;
}

async function handler(req, res) {
  if (!gmailConfigured()) return res.status(500).json({ ok: false, error: { code: 'GMAIL_NOT_CONFIGURED', message: 'Gmail is not configured.' } });
  try {
    const db = client();
    if (req.method === 'GET') { let query = db.from('crm_email_insights').select('*, crm_contacts(full_name,email), crm_accounts(name), crm_program_opportunities(title,status)').order('received_at', { ascending: false }); if (req.query?.review_status) query = query.eq('review_status', req.query.review_status); const { data, error } = await query; if (error) return supabaseError(res, error); return res.status(200).json({ ok: true, data: data || [] }); }
    const body = req.body || {};
    if (req.method === 'POST' && body.action === 'scan') return res.status(200).json({ ok: true, data: await scan(db, Math.min(Math.max(Number(body.days) || 30, 1), 90)) });
    if (req.method === 'POST' && body.action === 'prepare_reply') { const { data: insight } = await db.from('crm_email_insights').select('*').eq('id', body.id).maybeSingle(); if (!insight) return res.status(404).json({ ok: false, error: { message: 'Insight not found' } }); const existing = await db.from('crm_email_drafts').select('*').eq('gmail_message_id', insight.gmail_message_id).neq('status', 'cancelled').limit(1); if (existing.data?.[0]) return res.status(200).json({ ok: true, data: existing.data[0] }); const { data, error } = await db.from('crm_email_drafts').insert({ contact_id: insight.contact_id, account_id: insight.account_id, gmail_thread_id: insight.gmail_thread_id, gmail_message_id: insight.gmail_message_id, to_email: insight.sender_email, subject: `Re: ${insight.subject || ''}`, body: '', draft_type: ['sales','client','networking'].includes(insight.classification) ? insight.classification : 'general', status: 'needs_review', needs_human: true, human_reason: 'Created from reviewed Gmail intelligence' }).select().single(); if (error) return supabaseError(res, error); return res.status(201).json({ ok: true, data }); }
    if (req.method === 'PATCH') { const { data: insight } = await db.from('crm_email_insights').select('*').eq('id', body.id).maybeSingle(); if (!insight) return res.status(404).json({ ok: false, error: { message: 'Insight not found' } }); if (body.review_status === 'dismissed') { const { data, error } = await db.from('crm_email_insights').update({ review_status: 'dismissed', reviewed_at: new Date().toISOString() }).eq('id', body.id).select().single(); if (error) return supabaseError(res, error); return res.status(200).json({ ok: true, data }); } if (body.review_status === 'approved') { try { return res.status(200).json({ ok: true, data: await applyInsight(db, insight, body.opportunity_id || null, body.decision_status || null) }); } catch (error) { return res.status(400).json({ ok: false, error: { message: error.message } }); } } return res.status(400).json({ ok: false, error: { message: 'review_status must be approved or dismissed' } }); }
    return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  } catch (error) { return supabaseError(res, error); }
}
export default withCommandAuth(handler);
