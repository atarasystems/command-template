/* Pass 2B: conservative email attention classification. */
(function (root) {
  'use strict';

  var TIME_ZONE = (globalThis.CMD_TZ || 'America/New_York');
  var BUCKETS = ['ACTION_REQUIRED', 'IMPORTANT_INFORMATION', 'USEFUL_LATER', 'WEEKLY_REVIEW', 'NOISE'];
  var AUTOMATED = /(?:noreply|no-reply|donotreply|do-not-reply|notifications?|mailer|bounce|postmaster|info|support|help|contact|team|admin|billing|newsletter|updates|alerts|news|unsubscribe)[^@\s]*@/i;
  var PROTECTED = /funder|program officer|grant officer|active partner|investor/i;

  function parsed(value) { if (!value) return null; var result = new Date(value); return isNaN(result.getTime()) ? null : result; }
  function easternDate(value) { var result = parsed(value || new Date()); return result ? new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(result) : ''; }
  function easternMidnight(key) {
    var match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!match) return null;
    var guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hourCycle: 'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }).formatToParts(new Date(guess));
    var values = {}; parts.forEach(function (part) { values[part.type] = Number(part.value); });
    var rendered = Date.UTC(values.year, values.month - 1, values.day, values.hour === 24 ? 0 : values.hour, values.minute, values.second);
    return new Date(guess - (rendered - guess));
  }
  function addDays(value, amount) { var result = new Date(value); result.setUTCDate(result.getUTCDate() + amount); return result; }
  function content(row) { return [row && row.subject, row && row.snippet, row && row.proposed_action].filter(Boolean).join(' '); }
  function sender(row) { return [row && row.sender_name, row && row.sender_email].filter(Boolean).join(' '); }
  function context(row) { return [sender(row), row && row.contact_name, row && row.account_name, row && row.program_title, row && row.program_organization, row && row.classification, row && row.program_opportunity_id].filter(Boolean).join(' '); }
  function isProtected(row) { return PROTECTED.test(context(row)) || Boolean(row && (row.contact_id || row.account_id || row.program_opportunity_id)); }

  function absoluteDate(value) {
    var months = {jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, sept:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12};
    var named = value.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
    var numeric = value.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
    if (named && named[3]) return easternMidnight(named[3] + '-' + String(months[named[1].toLowerCase()]).padStart(2, '0') + '-' + String(named[2]).padStart(2, '0'));
    if (numeric) return easternMidnight(numeric[3] + '-' + String(numeric[1]).padStart(2, '0') + '-' + String(numeric[2]).padStart(2, '0'));
    return null;
  }
  function relativeDate(value, receivedAt) {
    var received = easternMidnight(easternDate(receivedAt)); if (!received) return null;
    if (/\b(tomorrow|tonight)\b/i.test(value)) return addDays(received, 1);
    if (/\b(today|this afternoon|this evening)\b/i.test(value)) return received;
    if (/\bnext week\b/i.test(value)) return addDays(received, 7);
    if (/\bthis week\b/i.test(value)) return received;
    var weekdays = {sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6};
    var match = value.match(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i); if (!match) return null;
    var delta = weekdays[match[1].toLowerCase()] - received.getUTCDay(); if (delta < 0) delta += 7;
    return addDays(received, delta);
  }
  function dateContext(row) {
    var value = content(row), structured = row && (row.deadline_at || row.event_at || row.event_start || row.event_end || row.next_action_at);
    if (structured && parsed(structured)) return { kind:'structured', date:parsed(structured) };
    var absolute = absoluteDate(value); if (absolute) return { kind:'absolute', date:absolute };
    var relative = relativeDate(value, row && row.received_at); if (relative) return { kind:'relative', date:relative };
    return { kind:'none', date:null };
  }
  function currentDateSupport(row, now) {
    var context = dateContext(row); if (!context.date) return { context:context, current:false, past:false };
    var today = easternMidnight(easternDate(now)); return { context:context, current:context.date >= today, past:context.date < today };
  }
  function actionableText(row) { return /please\s+(?:reply|respond|review|send|confirm|approve|decide)|can you|could you|question|\breply\b|\brespond\b|requested|need(?:s)?\s+(?:you|your|a response|a reply|action)|next step|schedule|rsvp|approval (?:required|needed)|decision (?:required|needed)|payment (?:failed|problem|issue)|security (?:alert|issue)|legal (?:notice|issue)/i.test(content(row)); }
  function materialText(row) { return /approved|declined|rejected|award(?:ed)?|application (?:update|received|approved)|program update|funder|client|customer|partner|nih|nsf|sbir|security alert|legal notice|payment (?:failed|problem|issue)/i.test(content(row)); }
  function lowValueText(row) { return /unsubscribe|newsletter|announcement|introducing|connection request|connect with|product|event|grant|accelerator|marketing|welcome|promotion|survey|apply now|book a demo|waiting to connect|new notification|professional debate|op-ed/i.test(content(row)); }
  function relevantText(row) { return /research|autistic|neurodivergent|ai|accessibility|adaptive|wellbeing|well-being|resource|funding|grant|program|industry|partner|training|education/i.test(content(row)); }
  function recent(row, now) { var received = parsed(row && row.received_at); return !received || (parsed(now || new Date()).getTime() - received.getTime()) <= 3 * 24 * 60 * 60 * 1000; }
  function personalRelevant(row) { return !AUTOMATED.test(String(row && row.sender_email || '')) && /thought of you|check requirements|might qualify|fwd?:/i.test(content(row)); }
  function currentAction(row, now, dateInfo) {
    var protectedContext = isProtected(row), strong = actionableText(row);
    if (/completed|mission accomplished|successfully registered|thank you for an incredible/i.test(content(row))) return false;
    if (dateInfo.past && !/payment (?:failed|problem|issue)|security (?:alert|issue)|legal (?:notice|issue)/i.test(content(row))) return false;
    if (protectedContext && strong) return true;
    if (['client', 'sales'].includes(String(row && row.classification || '').toLowerCase()) && strong && !AUTOMATED.test(String(row && row.sender_email || ''))) return true;
    if (/payment (?:failed|problem|issue)|security (?:alert|issue)|legal (?:notice|issue)/i.test(content(row))) return true;
    if (dateInfo.current && /deadline|respond by|application requirement|meeting change|rsvp/i.test(content(row)) && (strong || protectedContext)) return true;
    return false;
  }
  function classify(row, options) {
    options = options || {}; var now = parsed(options.now) || new Date();
    if (!row) return { bucket:'NOISE', confidence:1, why:'No email record was supplied.' };
    var value = content(row), protectedContext = isProtected(row), dateInfo = currentDateSupport(row, now), action = currentAction(row, now, dateInfo);
    if (action) return { bucket:'ACTION_REQUIRED', confidence:protectedContext ? 0.91 : 0.84, why:'A current request, decision, deadline, or consequential issue is documented.' };
    if (protectedContext && materialText(row) && !dateInfo.past) return { bucket:'IMPORTANT_INFORMATION', confidence:0.88, why:'A consequential funder, program, client, partner, or active-relationship update is documented.' };
    if (materialText(row) && !dateInfo.past && recent(row, now) && (dateInfo.current || !/deadline|tomorrow|today|this week|next week|\bevent\b/i.test(value))) return { bucket:'IMPORTANT_INFORMATION', confidence:0.8, why:'Material information is recent and relevant to Atara operations.' };
    if (!protectedContext && /spam|irrelevant|unsubscribe|groupon|coupon|daily deal/i.test(value + ' ' + sender(row))) return { bucket:'NOISE', confidence:0.86, why:'The message has no meaningful relevance to your work.' };
    if ((relevantText(row) && !lowValueText(row)) || personalRelevant(row)) return { bucket:'USEFUL_LATER', confidence:0.72, why:'Relevant information may be useful later but does not require founder attention now.' };
    if (!protectedContext && lowValueText(row) && (AUTOMATED.test(String(row.sender_email || '')) || ['grant_program_opportunity', 'networking', 'sales'].includes(String(row.classification || '').toLowerCase()))) return { bucket:'WEEKLY_REVIEW', confidence:0.9, why:'High-confidence promotional, generic notification, or mass-distribution content.' };
    return { bucket:'USEFUL_LATER', confidence:0.55, why:'No current action is supported; retain the message for detail/history.' };
  }

  root.AtaraEmailAttention = { BUCKETS: BUCKETS, classify: classify, dateContext: dateContext, easternDate: easternDate, easternMidnight: easternMidnight, isProtectedContext: isProtected };
})(typeof window !== 'undefined' ? window : globalThis);


(function () {
  if (typeof document === 'undefined' || document.querySelector('script[data-relationship-system-fixes]')) return;
  var script = document.createElement('script');
  script.src = '/relationship-system-fixes.js';
  script.defer = true;
  script.setAttribute('data-relationship-system-fixes', '1');
  document.head.appendChild(script);
})();

(function () {
  if (typeof document === 'undefined' || document.querySelector('script[data-relationship-followup-thread-fix]')) return;
  var script = document.createElement('script');
  script.src = '/relationship-followup-thread-fix.js';
  script.defer = true;
  script.setAttribute('data-relationship-followup-thread-fix', '1');
  document.head.appendChild(script);
})();

(function () {
  if (typeof document === 'undefined' || document.querySelector('script[data-river-screenshot-ui]')) return;
  var script = document.createElement('script');
  script.src = '/river-screenshot-ui.js';
  script.defer = true;
  script.setAttribute('data-river-screenshot-ui', '1');
  document.head.appendChild(script);
})();


(function () {
  if (typeof document === 'undefined' || document.querySelector('script[data-founder-home-controls]')) return;
  var script = document.createElement('script');
  script.src = '/founder-home-controls.js';
  script.defer = true;
  script.setAttribute('data-founder-home-controls', '1');
  document.head.appendChild(script);
})();

(function () {
  if (typeof document === 'undefined' || document.querySelector('script[data-email-desk-formatting]')) return;
  var script = document.createElement('script');
  script.src = '/email-desk-formatting.js';
  script.defer = true;
  script.setAttribute('data-email-desk-formatting', '1');
  document.head.appendChild(script);
})();

(function () {
  if (typeof document === 'undefined' || document.querySelector('script[data-email-desk-organizer]')) return;
  var script = document.createElement('script');
  script.src = '/email-desk-organizer.js';
  script.defer = true;
  script.setAttribute('data-email-desk-organizer', '1');
  document.head.appendChild(script);
})();

