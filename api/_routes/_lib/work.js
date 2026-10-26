import { getSupabase } from './supabase.js';
import { validateAiAssignment } from './ai-team.js';
import { envTimeZone } from './founder-settings.js';

export const PROJECT_STATUSES = ['active', 'waiting', 'on_hold', 'completed', 'archived'];
export const PROJECT_PRIORITIES = ['now', 'next', 'normal', 'later'];
export const PHASE_STATUSES = ['open', 'in_progress', 'completed', 'skipped'];
export const ITEM_STATUSES = ['open', 'in_progress', 'waiting', 'done', 'cancelled'];
export const ITEM_PRIORITIES = ['now', 'next', 'normal', 'later'];
export const ITEM_CATEGORIES = ['general', 'sales', 'networking', 'client', 'grant', 'content', 'audit', 'product', 'admin'];
export const OWNER_TYPES = ['founder', 'ai', 'human'];

const PROJECT_FIELDS = ['name', 'outcome', 'area', 'status', 'priority', 'start_date', 'due_date', 'notes'];
const PHASE_FIELDS = ['project_id', 'name', 'description', 'status', 'target_date', 'sort_order'];
const ITEM_FIELDS = ['title', 'project_id', 'phase_id', 'category', 'status', 'priority', 'due_at', 'defer_until', 'cannot_wait', 'owner_type', 'owner_name', 'assigned_agent', 'source_type', 'source_id', 'notes', 'completed_at'];

export function pick(body, fields) {
  return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(body || {}, field)).map((field) => [field, body[field]]));
}

export function validateProject(input, partial = false) {
  if (!partial && (!input.name || typeof input.name !== 'string' || !input.name.trim())) return 'name is required';
  if (input.status && !PROJECT_STATUSES.includes(input.status)) return 'invalid project status';
  if (input.priority && !PROJECT_PRIORITIES.includes(input.priority)) return 'invalid project priority';
  return null;
}

export function validatePhase(input, partial = false) {
  if (!partial && (!input.name || typeof input.name !== 'string' || !input.name.trim())) return 'name is required';
  if (input.status && !PHASE_STATUSES.includes(input.status)) return 'invalid phase status';
  return null;
}

export function validateItem(input, partial = false) {
  if (!partial && (!input.title || typeof input.title !== 'string' || !input.title.trim())) return 'title is required';
  if (input.status && !ITEM_STATUSES.includes(input.status)) return 'invalid work item status';
  if (input.priority && !ITEM_PRIORITIES.includes(input.priority)) return 'invalid work item priority';
  if (input.category && !ITEM_CATEGORIES.includes(input.category)) return 'invalid work item category';
  if (input.owner_type && !OWNER_TYPES.includes(input.owner_type)) return 'invalid owner type';
  return validateAiAssignment(input);
}

export function errorResponse(res, status, message) {
  return res.status(status).json({ ok: false, error: { code: 'WORK_REQUEST_INVALID', message } });
}

export function supabaseError(res, error) {
  console.error('[Work]', error);
  return res.status(500).json({ ok: false, error: { code: 'WORK_DATABASE_ERROR', message: 'Work data could not be loaded.' } });
}

export function client() { return getSupabase(); }

export function todayRank(item, now = new Date()) {
  const due = item.due_at ? new Date(item.due_at) : null;
  const defer = item.defer_until ? new Date(item.defer_until) : null;
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const overdue = due && due < now;
  const dueToday = due && due <= todayEnd;
  const deferArrived = defer && defer <= now;
  let bucket = overdue ? 0 : item.cannot_wait ? 1 : dueToday ? 2 : item.priority === 'now' ? 3 : deferArrived ? 4 : item.priority === 'next' ? 5 : 6;
  return [bucket, due ? due.getTime() : Number.MAX_SAFE_INTEGER, item.created_at ? new Date(item.created_at).getTime() : 0];
}

export function isActionable(item, now = new Date()) {
  return !['done', 'cancelled'].includes(item.status) && (!item.defer_until || new Date(item.defer_until) <= now);
}

const BUSINESS_TIME_ZONE = process.env.COMMAND_TIME_ZONE || envTimeZone();

function localParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function offsetAt(instant, timeZone) {
  const parts = localParts(instant, timeZone);
  const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second), Number(parts.fractionalSecond || 0));
  return localAsUtc - instant.getTime();
}

// HTML date inputs represent a whole business-timezone calendar day. Resolve
// the true end of that day, including DST, without hard-coding an offset.
export function dueDateValue(value) {
  if (!value) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const localEnd = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
    let utcEnd = new Date(localEnd - offsetAt(new Date(localEnd), BUSINESS_TIME_ZONE));
    utcEnd = new Date(localEnd - offsetAt(utcEnd, BUSINESS_TIME_ZONE));
    return utcEnd.toISOString();
  }
  return value;
}

export function normalizeItemInput(input) {
  const next = { ...input };
  if (next.status === 'done' && !next.completed_at) next.completed_at = new Date().toISOString();
  if (next.status && next.status !== 'done') next.completed_at = null;
  if (Object.prototype.hasOwnProperty.call(next, 'due_at')) next.due_at = dueDateValue(next.due_at);
  if (next.owner_type && next.owner_type !== 'ai') next.assigned_agent = null;
  if (typeof next.assigned_agent === 'string') next.assigned_agent = next.assigned_agent.trim();
  return next;
}

export function applicationWorkValues(opportunity) {
  return { title: `Complete ${opportunity.title}`, due_at: opportunity.deadline_at || null };
}

export function itemSignal(item, now = new Date()) {
  if (item.due_at && new Date(item.due_at) < now) return 'PROBLEM';
  if (item.status === 'waiting') return 'WAITING';
  if (item.owner_type === 'human' || item.category === 'audit') return 'REVIEW';
  if (item.priority === 'now' || item.cannot_wait || item.status === 'open' || item.status === 'in_progress') return 'DO THIS';
  return 'FYI';
}

export const fields = { projects: PROJECT_FIELDS, phases: PHASE_FIELDS, items: ITEM_FIELDS };
