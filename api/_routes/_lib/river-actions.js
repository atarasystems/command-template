import { cachedFirstName } from './founder-settings.js';
// Translates River's <RIVER_ACTION> payloads into Supabase writes.
// River's prompt still uses the original tool/action names (growth, money, connect,
// command, projects); this module is the single place that decides where each lands.
import { buildTransactionValues } from './finance.js';
import { normalizeItemInput } from './work.js';

const PROGRAM_TYPES = { grant: 'grant', accelerator: 'accelerator', fellowship: 'fellowship', competition: 'pitch_competition', 'pitch competition': 'pitch_competition', investor: 'funding', incubator: 'program', award: 'program', 'scaling program': 'program' };
const PIPELINE_STATUS = { researching: 'reviewing', 'in progress': 'in_progress', 'ready to submit': 'apply', submitted: 'submitted', interview: 'interview', accepted: 'awarded', 'not selected': 'not_selected', withdrawn: 'archived' };
const OUTCOME_STATUS = { pending: 'awaiting_response', accepted: 'awarded', awarded: 'awarded', won: 'awarded', 'not selected': 'not_selected', withdrawn: 'archived', interview: 'interview' };
const WORK_CATEGORY = { funding: 'grant', marketing: 'content', product: 'product', beta: 'product', operations: 'admin', immediate: 'general' };
const WORK_STATUS = { 'not started': 'open', 'in progress': 'in_progress', done: 'done', blocked: 'waiting', waiting: 'waiting' };

export const SUPPORTED_ACTIONS = Object.freeze({
  command: ['addActionItem', 'addTicklerItem', 'addMilestone'],
  projects: ['addTask'],
  money: ['addTransaction'],
  growth: ['addPipeline', 'addApplied'],
  connect: ['addContact', 'addTouchpoint'],
});

function text(value) {
  const out = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  return out || null;
}

function isoDate(value) {
  const out = text(value);
  return out && /^\d{4}-\d{2}-\d{2}/.test(out) ? out.slice(0, 10) : null;
}

function lower(value) {
  return (text(value) || '').toLowerCase();
}

function fail(message) {
  return Object.assign(new Error(message), { code: 'VALIDATION_ERROR' });
}

function ownerFields(owner) {
  const name = text(owner);
  if (!name || /^(me|founder|myself)$/i.test(name) || (cachedFirstName() && name.toLowerCase() === cachedFirstName().toLowerCase())) return { owner_type: 'founder', owner_name: null };
  return { owner_type: 'human', owner_name: name };
}

// Pure mapping, no database access. Returns { table, values } or { kind: 'contact' | 'touchpoint', values }.
export function mapRiverAction(tool, payload, now = new Date()) {
  const action = payload?.action;
  if (!SUPPORTED_ACTIONS[tool]?.includes(action)) throw fail(`River action ${tool}/${action || 'unknown'} is not supported`);

  if (tool === 'command' && action === 'addActionItem') {
    const title = text(payload.actionItem || payload.title);
    if (!title) throw fail('actionItem is required');
    return { table: 'work_items', values: normalizeItemInput({
      title,
      category: WORK_CATEGORY[lower(payload.category)] || 'general',
      status: WORK_STATUS[lower(payload.status)] || 'open',
      priority: lower(payload.category) === 'immediate' ? 'now' : 'normal',
      due_at: isoDate(payload.dueDate),
      ...ownerFields(payload.owner),
      source_type: 'river',
      notes: text(payload.notes),
    }) };
  }

  if (tool === 'command' && action === 'addTicklerItem') {
    const title = text(payload.text || payload.title);
    const date = isoDate(payload.date);
    if (!title || !date) throw fail('text and date are required');
    return { table: 'work_items', values: { title, category: 'general', status: 'waiting', priority: 'normal', defer_until: date, owner_type: 'founder', source_type: 'river_tickler', notes: text(payload.notes) } };
  }

  if (tool === 'command' && action === 'addMilestone') {
    const title = text(payload.milestone || payload.title);
    const date = isoDate(payload.date || payload.dueDate);
    if (!title || !date) throw fail('milestone and date are required');
    return { table: 'command_milestones', values: { title, due_date: date, category: text(payload.category), notes: text(payload.notes), status: 'upcoming' } };
  }

  if (tool === 'projects' && action === 'addTask') {
    const title = text(payload.task || payload.title);
    if (!title) throw fail('task is required');
    return { table: 'work_items', values: normalizeItemInput({
      title,
      category: 'general',
      status: WORK_STATUS[lower(payload.status)] || 'open',
      priority: payload.cantWait ? 'now' : 'normal',
      cannot_wait: payload.cantWait === true,
      due_at: isoDate(payload.dueDate),
      ...ownerFields(payload.owner),
      source_type: 'river',
      notes: [text(payload.notes), text(payload.projectName) ? `Project: ${text(payload.projectName)}` : null].filter(Boolean).join('\n') || null,
    }) };
  }

  if (tool === 'money' && action === 'addTransaction') {
    const kind = lower(payload.type);
    if (!['income', 'expense'].includes(kind)) throw fail('type must be Income or Expense');
    const who = text(payload.who);
    return { table: 'command_finance_transactions', values: buildTransactionValues({
      txn_date: isoDate(payload.date) || now.toISOString().slice(0, 10),
      description: who || text(payload.notes) || 'River entry',
      vendor: who,
      amount: Number(payload.amount),
      txn_type: kind,
      category: kind === 'income' ? 'Business income' : 'Needs review',
      source: 'river',
      notes: [text(payload.category) ? `River category: ${text(payload.category)}` : null, text(payload.notes)].filter(Boolean).join('\n') || null,
    }, now) };
  }

  if (tool === 'growth') {
    const title = text(payload.name);
    if (!title) throw fail('name is required');
    const amount = Number(payload.amount);
    const base = {
      title,
      organization: text(payload.org),
      opportunity_type: PROGRAM_TYPES[lower(payload.type)] || 'other',
      amount_value: Number.isFinite(amount) && amount > 0 ? amount : null,
      source_type: 'river',
      notes: text(payload.notes),
    };
    if (action === 'addPipeline') {
      return { table: 'crm_program_opportunities', values: { ...base, status: PIPELINE_STATUS[lower(payload.status)] || 'reviewing', deadline_at: isoDate(payload.deadline), fit_notes: text(payload.nextAction) } };
    }
    return { table: 'crm_program_opportunities', values: { ...base, status: OUTCOME_STATUS[lower(payload.outcome)] || 'submitted', submitted_at: isoDate(payload.dateApplied) || now.toISOString().slice(0, 10) } };
  }

  if (tool === 'connect' && action === 'addContact') {
    const name = text(payload.name);
    if (!name) throw fail('name is required');
    const followUp = isoDate(payload.followupDueDate);
    const notes = [
      text(payload.notes),
      text(payload.eventSource) ? `Met at: ${text(payload.eventSource)}` : null,
      text(payload.contactType) ? `Type: ${text(payload.contactType)}` : null,
      text(payload.business) ? `Business: ${text(payload.business)}` : null,
    ].filter(Boolean).join('\n') || null;
    return { kind: 'contact', values: {
      full_name: name,
      email: lower(payload.email) || null,
      phone: text(payload.phone),
      job_title: text(payload.title),
      company: text(payload.company),
      notes,
      next_action: text(payload.followupIntent),
      next_action_at: followUp,
      contact_status: followUp ? 'follow_up_needed' : 'new',
    } };
  }

  // connect/addTouchpoint
  const contactName = text(payload.contactName);
  if (!contactName) throw fail('contactName is required');
  return { kind: 'touchpoint', values: {
    contact_name: contactName,
    occurred_at: isoDate(payload.date) || now.toISOString().slice(0, 10),
    type: text(payload.type) || 'Touchpoint',
    notes: text(payload.notes),
    outcome: text(payload.outcome),
    next_step: text(payload.nextStep),
    follow_up: isoDate(payload.followupDueDate),
  } };
}

export async function runRiverAction(db, tool, payload, now = new Date()) {
  const mapped = mapRiverAction(tool, payload, now);

  if (mapped.table) {
    const result = await db.from(mapped.table).insert(mapped.values).select().single();
    if (result.error) throw result.error;
    if (mapped.table === 'command_finance_transactions') {
      await db.from('command_finance_month_closes').upsert({ month: mapped.values.txn_date.slice(0, 7) }, { onConflict: 'month', ignoreDuplicates: true });
    }
    return { table: mapped.table, record: result.data };
  }

  if (mapped.kind === 'contact') {
    const { company, ...contact } = mapped.values;
    let accountId = null;
    if (company) {
      const found = await db.from('crm_accounts').select('id').ilike('name', company).limit(1).maybeSingle();
      if (found.error) throw found.error;
      if (found.data) accountId = found.data.id;
      else {
        const created = await db.from('crm_accounts').insert({ name: company, account_type: 'business' }).select('id').single();
        if (created.error) throw created.error;
        accountId = created.data.id;
      }
    }
    if (contact.email) {
      const existing = await db.from('crm_contacts').select('id').eq('email', contact.email).limit(1).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) {
        const updated = await db.from('crm_contacts').update({ ...contact, account_id: accountId || undefined, updated_at: now.toISOString() }).eq('id', existing.data.id).select().single();
        if (updated.error) throw updated.error;
        return { table: 'crm_contacts', record: updated.data, updated: true };
      }
    }
    const created = await db.from('crm_contacts').insert({ ...contact, account_id: accountId }).select().single();
    if (created.error) throw created.error;
    return { table: 'crm_contacts', record: created.data };
  }

  // touchpoint: attach to the best name match, or log unattached so nothing is lost.
  const { contact_name, occurred_at, type, notes, outcome, next_step, follow_up } = mapped.values;
  const match = await db.from('crm_contacts').select('id,account_id').ilike('full_name', contact_name).is('archived_at', null).limit(1).maybeSingle();
  if (match.error) throw match.error;
  const activity = await db.from('crm_activities').insert({
    contact_id: match.data?.id || null,
    account_id: match.data?.account_id || null,
    activity_type: 'touchpoint',
    subject: `${type} with ${contact_name}`,
    description: [notes, outcome ? `Outcome: ${outcome}` : null, next_step ? `Next step: ${next_step}` : null].filter(Boolean).join('\n') || null,
    occurred_at,
    metadata: { source: 'river', contact_name, type, outcome, next_step },
  }).select().single();
  if (activity.error) throw activity.error;
  if (match.data?.id && (follow_up || next_step)) {
    const patch = { updated_at: now.toISOString() };
    if (next_step) patch.next_action = next_step;
    if (follow_up) { patch.next_action_at = follow_up; patch.contact_status = 'follow_up_needed'; }
    const updated = await db.from('crm_contacts').update(patch).eq('id', match.data.id);
    if (updated.error) throw updated.error;
  }
  return { table: 'crm_activities', record: activity.data, matched_contact: Boolean(match.data) };
}
