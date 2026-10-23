// What each application needs, as a checklist with due dates, plus the Ready Kit of pieces reused across applications.
import { prepStartFor } from './funding-scores.js';

const KIT_WORDS = [
  ['sam_gov', /\bsam\b|sam\.gov/i], ['grants_gov', /grants\.gov/i], ['sba_registry', /sba|sbc control/i], ['research_gov', /research\.gov/i],
  ['era_commons', /era commons/i], ['login_gov', /login\.gov/i], ['pitch_deck', /deck/i], ['exec_summary', /executive summary/i],
  ['one_pager', /one.pager/i], ['traction_numbers', /traction|metrics|user numbers/i], ['founder_video', /founder video|pitch video|short pitch video/i],
  ['demo_video', /demo video/i], ['budget_10k_50k_100k_300k', /budget|use of funds|financial model/i], ['team_bios', /bios|biosketch|team/i],
  ['letters_of_support', /letters?/i], ['llc_docs_ein_w9_good_standing', /llc docs|w-9|w9|ein|good standing|business registration/i], ['cap_table', /cap table/i],
];

export function kitKeyFor(text) { return (KIT_WORDS.find(([, re]) => re.test(text)) || [null])[0]; }

export function kindFor(text) {
  const t = String(text || '');
  if (/registration|register|account|login\.gov|\bsam\b|sba|era commons|research\.gov|grants\.gov/i.test(t)) return 'registration';
  if (/letter/i.test(t)) return 'letter';
  if (/video/i.test(t)) return 'video';
  if (/deck|budget|cap table|financial|docs|w-9|bios|biosketch|one.pager|summary|proof|evidence|metrics/i.test(t)) return 'document';
  if (/narrative|pitch|essay|answer|application|plan|aims|strategy|story|description|statement|form/i.test(t)) return 'writing';
  return 'other';
}

function addDays(key, days) { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

// Registrations and letters first (they take the longest); writing 3 days before the deadline.
export function prepItemsFor(opp = {}, today = new Date().toISOString().slice(0, 10)) {
  const list = Array.isArray(opp.application_requirements_json?.checklist) ? opp.application_requirements_json.checklist : [];
  const start = opp.prep_start_at || prepStartFor(opp) || today;
  const first = start < today ? today : start;
  const deadline = opp.deadline_at ? String(opp.deadline_at).slice(0, 10) : null;
  const writingDue = deadline ? addDays(deadline, -3) : null;
  return list.map((text, i) => {
    const kind = kindFor(text);
    const due = kind === 'registration' || kind === 'letter' ? first : kind === 'writing' ? (writingDue && writingDue > first ? writingDue : first) : first;
    return { opportunity_id: opp.id, text: String(text).slice(0, 400), kind, kit_key: kitKeyFor(text), due_at: due, sort: 10 + i };
  });
}

export async function createPrepItems(db, opp) {
  const existing = await db.from('command_funding_prep_items').select('text').eq('opportunity_id', opp.id);
  if (existing.error) throw existing.error;
  const have = new Set((existing.data || []).map((r) => r.text));
  const rows = prepItemsFor(opp).filter((r) => !have.has(r.text));
  if (!rows.length) return 0;
  const saved = await db.from('command_funding_prep_items').insert(rows);
  if (saved.error) throw saved.error;
  return rows.length;
}

export function kitState(row = {}, now = new Date()) {
  if (!row.last_updated_at || row.status === 'not_started') return 'not_started';
  if (row.refresh_days && new Date(row.last_updated_at).getTime() + row.refresh_days * 86400000 < now.getTime()) return 'needs_refresh';
  return row.status === 'needs_refresh' ? 'needs_refresh' : 'ready';
}
