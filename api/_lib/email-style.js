const LONG_DASH_PATTERN = /[\u2013\u2014]/;
const LONG_DASH_GLOBAL = /[\u2013\u2014]/g;

export const FOUNDER_EMAIL_CANNED_PHRASES = Object.freeze([
  'i hope this email finds you well',
  'hope this email finds you well',
  'hope you are doing well',
  "hope you're doing well",
  'i came across',
  'i wanted to reach out',
  'i am reaching out',
  "i'm reaching out",
  'just reaching out',
  'touch base',
  'circle back',
  'second set of eyes',
  'low-risk pilot',
  'low risk pilot',
  'would it be useful if',
  'would you be open to',
  'just checking in',
  'wanted to follow up',
  'following up on my previous email',
  'quick chat',
  'quick question',
  'a quick question',
  'caught my eye',
  'i figured',
  'might be a fit',
  'fresh add-on',
  'fresh add on',
  'without disrupting',
  'unlock',
  'leverage',
  'seamless',
  'game changer',
  'game-changer',
  'synergy',
  'ever-evolving',
  'ever evolving',
  'innovative solution',
  'innovative solutions',
  'tailored solution',
  'tailored solutions',
  'in today\'s digital landscape',
  'in the digital landscape',
  'add value',
  'adds value',
  'without extra work',
  'without extra guesswork',
  'without extra hassle',
  'slot into',
  'slot right into',
  'fits your existing workflow',
  'fit your existing workflow',
  'fits right into',
  'standardized deliverable',
]);

function normalizeFounderGreeting(value) {
  const lines = String(value || '').split(/\r?\n/);
  if (!lines.length) return String(value || '');
  const match = lines[0].trim().match(/^Hi(?:\s+([^,!?;:.]+))?[,!?;:.]*$/i);
  if (!match) return lines.join('\n');
  const name = String(match[1] || '').trim();
  lines[0] = name ? `Hi ${name},` : 'Hi,';
  return lines.join('\n');
}

// The founder chooses in setup whether long dashes are allowed. Settings call this when they load.
let noDashes = true;
export function noDashesOn() { return noDashes; }
export function configureEmailStyle(options = {}) { if (typeof options.noDashes === 'boolean') noDashes = options.noDashes; }

export function normalizeNoLongDashes(value) {
  if (!noDashes) return normalizeFounderGreeting(String(value || ''));
  const normalized = String(value || '')
    .replace(LONG_DASH_GLOBAL, ', ')
    .replace(/[ \t]+,[ \t]+/g, ', ')
    .replace(/[ \t]+,/g, ',')
    .replace(/,[ \t]{2,}/g, ', ');

  if (!normalized.includes('\n')) return normalized;
  return normalizeFounderGreeting(normalized);
}

export function founderEmailStyleIssues({ subject = '', body = '' } = {}) {
  const combined = `${subject}\n${body}`;
  const issues = [];
  if (noDashes && LONG_DASH_PATTERN.test(combined)) issues.push('Long dash characters are not allowed. Use commas, periods, colons, parentheses, or a standard hyphen instead.');
  const firstLine = String(body || '').trimStart().split(/\r?\n/, 1)[0].trim();
  // Only a greeting line on its own ("Hi Dana") needs the comma; a one-line note that starts with Hi is fine.
  if (/^Hi(?:\s+[^,!?;:.]+)?[!?;:.]?$/i.test(firstLine) && !firstLine.endsWith(',')) issues.push('The opening greeting must end with a comma.');
  const lower = combined.toLowerCase();
  const canned = FOUNDER_EMAIL_CANNED_PHRASES.filter((phrase) => lower.includes(phrase));
  if (canned.length) issues.push(`Canned outreach language is not allowed: ${canned.join(', ')}`);
  return issues;
}

export function assertFounderEmailStyle(draft = {}) {
  const issues = founderEmailStyleIssues(draft);
  if (!issues.length) return true;
  const error = new Error(`Email style check failed. ${issues.join(' ')}`);
  error.code = 'VALIDATION_ERROR';
  throw error;
}
