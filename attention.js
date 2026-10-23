/* Pass 1: the single read-only founder-attention projection. */
(function (root) {
  'use strict';

  var TIME_ZONE = (globalThis.CMD_TZ || 'America/New_York');
  var DAY = 86400000;
  var ACTIVE_STATUSES = ['done', 'cancelled', 'completed', 'archived'];
  var PROGRAM_PASSED = ['awarded', 'not_selected', 'archived'];

  function date(value) {
    if (!value) return null;
    var result = new Date(value);
    return isNaN(result.getTime()) ? null : result;
  }

  function easternDate(value) {
    var result = date(value || new Date());
    return result ? new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(result) : '';
  }

  function dateInputValue(value) { return easternDate(value || new Date()); }

  function easternMidnight(dateKey) {
    var match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    var guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0);
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hourCycle: 'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }).formatToParts(new Date(guess));
    var values = {}; parts.forEach(function (part) { values[part.type] = Number(part.value); });
    var rendered = Date.UTC(values.year, values.month - 1, values.day, values.hour === 24 ? 0 : values.hour, values.minute, values.second);
    return new Date(guess - (rendered - guess));
  }

  function addCalendarDays(value, amount) { var result = new Date(value); result.setUTCDate(result.getUTCDate() + amount); return result; }

  function easternWeekBounds(offset) {
    var today = easternMidnight(easternDate(new Date()));
    var sunday = addCalendarDays(today, -today.getUTCDay() + (Number(offset) || 0) * 7);
    var saturday = addCalendarDays(sunday, 6); saturday.setUTCHours(23, 59, 59, 999);
    return { sunday: sunday, saturday: saturday };
  }

  function daysFrom(now, value) {
    var result = date(value);
    return result ? (result.getTime() - now.getTime()) / DAY : null;
  }

  function active(row) { return row && !ACTIVE_STATUSES.includes(String(row.status || '').toLowerCase()); }
  function urgentPriority(row) { return ['urgent', 'immediate', 'high'].includes(String(row.priority || '').toLowerCase()) || row.cannot_wait === true; }
  function hardUrgency(row) { return ['urgent', 'immediate'].includes(String(row && row.priority || '').toLowerCase()) || row && row.cannot_wait === true; }
  // "founder", "me", or the founder's first name from setup (CMD_FIRST_NAME) all mean the founder.
  function founderWords() {
    var name = String((typeof globalThis !== 'undefined' && globalThis.CMD_FIRST_NAME) || '').replace(/[^A-Za-z' -]/g, '').trim();
    return 'founder|me' + (name ? '|' + name : '');
  }
  function explicitFounderReview(row) {
    var text = String(row && row.notes || '') + ' ' + String(row && row.human_reason || '');
    var who = founderWords();
    var pattern = new RegExp('(?:needs?|requires?|awaiting|blocked)[^.!?]{0,40}(?:' + who + ')[^.!?]{0,30}(?:approval|decision|input|review|response)|(?:approval|decision|input|review)\\s+(?:is\\s+)?(?:required|needed)|blocked\\s+(?:until|on)\\s+(?:' + who + ')', 'i');
    return Boolean(row && (row.needs_human === true || row.needs_founder === true || pattern.test(text)));
  }
  function founderReviewReason(row) {
    var text = String(row && row.human_reason || '').trim() || String(row && row.notes || '').split(/[.!?]/).find(function (part) { return /approval|decision|input|review|blocked|awaiting/i.test(part); });
    return text ? text.trim() : 'A documented founder decision or input is required';
  }
  function consequentialText(row) {
    return /client|customer|participant|fulfillment|payment|billing|application|program|grant|funding|funder|nih|nsf|sbir|revenue|contract|security|legal|audit|deadline|deliverable|meeting/i.test(
      String(row && row.title || '') + ' ' + String(row && row.category || '') + ' ' + String(row && row.source_type || '') + ' ' + String(row && row.notes || '')
    );
  }
  function staleOverdue(row, now) {
    var days = daysFrom(now, row && row.due_at);
    return days !== null && days < -14 && !urgentPriority(row) && !explicitFounderReview(row);
  }
  function imminent(value, now, days) {
    var delta = daysFrom(now, value);
    return delta !== null && delta <= days && delta >= -14;
  }
  function text(row) { return [row && row.subject, row && row.snippet, row && row.notes, row && row.title].filter(Boolean).join(' '); }
  function dateKeyDate(key) { return easternMidnight(key); }
  function absoluteEmailDate(content) {
    var months = {jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, sept:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12};
    var named = content.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
    var numeric = content.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
    if (named && named[3]) return dateKeyDate(String(named[3]) + '-' + String(months[named[1].toLowerCase()]).padStart(2, '0') + '-' + String(named[2]).padStart(2, '0'));
    if (numeric) return dateKeyDate(String(numeric[3]) + '-' + String(numeric[1]).padStart(2, '0') + '-' + String(numeric[2]).padStart(2, '0'));
    return null;
  }
  function relativeEmailDate(content, receivedAt) {
    var receivedKey = easternDate(receivedAt);
    if (!receivedKey) return null;
    var received = dateKeyDate(receivedKey); if (!received) return null;
    if (/\b(tomorrow|tonight)\b/i.test(content)) return addCalendarDays(received, 1);
    if (/\b(today|this afternoon|this evening)\b/i.test(content)) return received;
    if (/\bnext week\b/i.test(content)) return addCalendarDays(received, 7);
    if (/\bthis week\b/i.test(content)) return received;
    var weekdays = {sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6};
    var match = content.match(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i);
    if (!match) return null;
    var target = weekdays[match[1].toLowerCase()], delta = target - received.getUTCDay();
    if (delta < 0) delta += 7;
    return addCalendarDays(received, delta);
  }
  function emailDateContext(row, now) {
    var content = text(row), structured = row && (row.deadline_at || row.event_at || row.event_start || row.event_end || row.next_action_at);
    if (structured && date(structured)) return { kind:'structured', date:date(structured) };
    var absolute = absoluteEmailDate(content);
    if (absolute) return { kind:'absolute', date:absolute };
    var relative = relativeEmailDate(content, row && row.received_at);
    if (relative) return { kind:'relative', date:relative, past:relative < easternMidnight(easternDate(now)) };
    return { kind:'none', date:null, past:false };
  }
  function meaningfulEmail(row) {
    return /nih|nsf|sbir|application|approved|award|deadline|payment|billing|security|legal|client|customer|participant|funder|program officer/i.test(text(row));
  }
  function emailBucket(row, now) {
    if (root.AtaraEmailAttention) {
      var classified = root.AtaraEmailAttention.classify(row, { now: now });
      return classified.bucket === 'ACTION_REQUIRED' ? 'NEEDS_ME_NOW' : classified.bucket === 'IMPORTANT_INFORMATION' ? 'IMPORTANT_CHANGE' : null;
    }
    if (!row || row.review_status !== 'pending') return null;
    var content = text(row);
    var context = emailDateContext(row, now), currentDate = context.date && context.date >= easternMidnight(easternDate(now));
    var strongAction = /payment|billing|security|legal|direct question|please\s+(?:reply|respond)|reply\s+needed|respond\s+by|application update|approved|award|next step|tedco/i.test(content);
    var dateAction = /deadline|tomorrow|today|tonight|this afternoon|this week|next week|\bevent\b|\bapplication\b|\bopen\b/i.test(content);
    if (meaningfulEmail(row) && (strongAction || (dateAction && currentDate)) && !(context.kind === 'relative' && context.past && !strongAction)) return 'NEEDS_ME_NOW';
    if (meaningfulEmail(row) && currentDate && /application|award|program|funding|client|participant|fundernt/i.test(content)) return 'IMPORTANT_CHANGE';
    if (/unsubscribe|newsletter|announcement|introducing|connection request|connect|product|event|grant|accelerator|marketing|welcome|promotion|survey/i.test(content)) return 'AVAILABLE_IN_DETAIL';
    return null;
  }
  function bucketRank(bucket) { return { NEEDS_ME_NOW: 0, IMPORTANT_CHANGE: 1, WAITING_WATCH: 2, AVAILABLE_IN_DETAIL: 3, NOISE_ARCHIVE: 4 }[bucket] ?? 9; }
  function itemRank(item) {
    var urgency = item.bucket === 'NEEDS_ME_NOW' ? 0 : item.bucket === 'IMPORTANT_CHANGE' ? 1 : item.bucket === 'WAITING_WATCH' ? 2 : 3;
    var when = date(item.when);
    var explicit = /approval|decision|review.*required|cannot wait/i.test(String(item.reason || '')) ? 0 : 1;
    return [bucketRank(item.bucket), urgency, explicit, when ? Math.abs(when.getTime()) : Number.MAX_SAFE_INTEGER, item.title || ''];
  }
  function compare(a, b) {
    var ar = itemRank(a), br = itemRank(b);
    for (var i = 0; i < ar.length; i += 1) if (ar[i] !== br[i]) return ar[i] < br[i] ? -1 : 1;
    return 0;
  }
  function add(items, item) {
    if (!item || !item.title || !item.bucket) return;
    items.push(item);
  }

  function workItems(rows, now, items) {
    (rows || []).forEach(function (row) {
      if (!active(row)) return;
      var due = date(row.due_at), defer = date(row.defer_until), owner = String(row.owner_type || '').toLowerCase();
      var workKey = row.source_type === 'gmail' && row.source_id ? 'gmail:' + row.source_id : 'work:' + row.id;
      if (defer && defer > now) {
        add(items, { bucket: 'WAITING_WATCH', kind: 'work', id: row.id, title: row.title, reason: 'Deferred until the next review date', meta: row.owner_name || owner || 'Work', when: row.defer_until, dedupe_key: workKey });
        return;
      }
      if (row.status === 'waiting') {
        add(items, { bucket: 'WAITING_WATCH', kind: 'work', id: row.id, title: row.title, reason: 'Waiting for the next input or response', meta: row.notes || row.owner_name || 'Waiting', when: row.due_at, dedupe_key: workKey });
        return;
      }
      if (staleOverdue(row, now)) return;
      if (explicitFounderReview(row)) {
        add(items, { bucket: 'NEEDS_ME_NOW', kind: 'work', id: row.id, title: row.title, reason: founderReviewReason(row), meta: row.owner_name || 'Work', when: row.due_at, dedupe_key: workKey });
        return;
      }
      if (hardUrgency(row) || (String(row.priority || '').toLowerCase() === 'high' && consequentialText(row)) || (due && consequentialText(row) && (due < now || imminent(row.due_at, now, 3)))) {
        var reason = row.cannot_wait ? 'Marked cannot wait' : due < now ? 'Overdue consequential obligation' : 'Consequential obligation due soon';
        add(items, { bucket: 'NEEDS_ME_NOW', kind: 'work', id: row.id, title: row.title, reason: reason, meta: row.owner_name || owner || 'Work', when: row.due_at, dedupe_key: workKey });
      }
    });
  }

  function programs(rows, now, items) {
    (rows || []).forEach(function (row) {
      if (!row || PROGRAM_PASSED.includes(String(row.status || '').toLowerCase())) return;
      var status = String(row.status || '').toLowerCase(), deadline = date(row.deadline_at), follow = date(row.follow_up_at);
      // Applications are finished a week before they are due. Due in under a week: do it now.
      if (deadline && deadline >= now && !row.dismissed_at && ['discovered', 'reviewing', 'apply', 'in_progress', 'drafting'].includes(status)) {
        var left = Math.ceil((deadline - now) / 86400000), finishBy = new Date(deadline.getTime() - 7 * 86400000);
        var start = row.prep_start_at ? date(row.prep_start_at + 'T00:00:00') : null;
        var undecided = status === 'discovered' || status === 'reviewing';
        var short = function (d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
        if (left <= 7) {
          add(items, { bucket: 'NEEDS_ME_NOW', kind: 'program', source_table: 'crm_program_opportunities', id: row.id, title: row.title, reason: (left <= 1 ? 'Due ' + (left <= 0 ? 'today' : 'tomorrow') : 'Due in ' + left + ' days') + '. ' + (undecided ? 'Apply now or pass.' : 'Finish it now.'), meta: row.organization || 'Funding', when: row.deadline_at, dedupe_key: 'program:' + row.id });
          return;
        }
        if ((start && start <= now) || finishBy - now <= 7 * 86400000) {
          add(items, { bucket: 'NEEDS_ME_NOW', kind: 'program', source_table: 'crm_program_opportunities', id: row.id, title: row.title, reason: (undecided ? 'Decide: apply or pass. ' : 'Work on it. ') + 'Finish by ' + short(finishBy) + ' (due ' + short(deadline) + ')', meta: row.organization || 'Funding', when: finishBy.toISOString(), dedupe_key: 'program:' + row.id });
          return;
        }
      }
      if (status === 'awaiting_response' || (follow && follow > now)) {
        add(items, { bucket: 'WAITING_WATCH', kind: 'program', source_table: 'crm_program_opportunities', id: row.id, title: row.title, reason: status === 'awaiting_response' ? 'Waiting for the program response' : 'Waiting until the next follow-up date', meta: row.organization || 'Program opportunity', when: follow || row.response_expected_at, dedupe_key: 'program:' + row.id });
      } else if (deadline && deadline < now && ['discovered', 'reviewing', 'apply', 'in_progress', 'submitted', 'interview', 'final_decision'].includes(status)) {
        if (imminent(row.deadline_at, now, 0)) add(items, { bucket: 'IMPORTANT_CHANGE', kind: 'program', source_table: 'crm_program_opportunities', id: row.id, title: row.title, reason: 'Deadline passed; outcome or status review is needed', meta: row.organization || 'Program opportunity', when: row.deadline_at, dedupe_key: 'program:' + row.id });
      } else if (deadline && imminent(row.deadline_at, now, 7) && ['apply', 'in_progress', 'submitted', 'interview', 'final_decision'].includes(status)) {
        add(items, { bucket: 'NEEDS_ME_NOW', kind: 'program', source_table: 'crm_program_opportunities', id: row.id, title: row.title, reason: 'Program deadline is approaching', meta: row.organization || 'Program opportunity', when: row.deadline_at, dedupe_key: 'program:' + row.id });
      }
    });
  }

  function commercial(rows, now, items) {
    (rows || []).forEach(function (row) {
      if (!row || row.deleted_at || ['won', 'lost', 'do_not_contact'].includes(String(row.stage || '').toLowerCase())) return;
      var next = date(row.next_action_at), stage = String(row.stage || row.underlying_status || '').toLowerCase();
      if (['won', 'lost', 'do_not_contact', 'passed', 'closed'].includes(stage)) return;
      // Automatic follow-up checks run on their own; the drafts they make show up as emails to approve.
      if (row.needs_human !== true && !explicitFounderReview(row) && /automatic follow-up/i.test(row.next_action || '')) return;
      if (explicitFounderReview(row) || row.needs_human === true || (next && imminent(row.next_action_at, now, 3))) add(items, { bucket: 'NEEDS_ME_NOW', kind: 'opportunity', source_table: 'crm_opportunities', id: row.id, title: row.account?.name || row.organization || row.title || 'Commercial opportunity', reason: explicitFounderReview(row) || row.needs_human === true ? founderReviewReason(row) : 'Commercial next action is due soon', meta: row.next_action || stage || 'Revenue', when: row.next_action_at, dedupe_key: 'opportunity:' + row.id });
    });
  }

  function emails(rows, now, items) {
    (rows || []).forEach(function (row) {
      var bucket = emailBucket(row, now); if (!bucket) return;
      var classified = root.AtaraEmailAttention && root.AtaraEmailAttention.classify ? root.AtaraEmailAttention.classify(row, { now: now }) : null;
      var messageKey = row.gmail_message_id ? 'gmail:' + row.gmail_message_id : null, threadKey = row.gmail_thread_id ? 'gmail:thread:' + row.gmail_thread_id : messageKey, fallbackKey = threadKey || 'email:' + row.id;
      add(items, { bucket: bucket, kind: 'insight', id: row.id, title: row.subject || 'Email insight', reason: classified && classified.why ? classified.why : (bucket === 'NEEDS_ME_NOW' ? 'Email contains a consequential request, deadline, or update' : 'Material information is available in Email Intelligence'), meta: row.sender_name || row.sender_email || 'Email Intelligence', when: row.received_at, dedupe_key: fallbackKey, dedupe_keys: [threadKey, messageKey, fallbackKey].filter(Boolean) });
    });
  }

  function calendarReason(row) {
    var text = String(row && row.notes || '') + ' ' + String(row && row.title || '') + ' ' + String(row && row.description || '');
    if (row && (row.needs_human === true || row.requires_preparation === true || row.changed === true || row.rescheduled === true || row.cancelled === true)) return row.cancelled ? 'Calendar event was cancelled; review the change' : row.rescheduled || row.changed ? 'Calendar event changed; review the update' : row.requires_preparation ? 'Preparation is required before this event' : 'A decision or response is required for this event';
    if (/prepare|preparation|rsvp|decision|respond|approval|cancelled|canceled|rescheduled|changed/i.test(text)) return /cancelled|canceled|rescheduled|changed/i.test(text) ? 'Calendar event changed; review the update' : 'Preparation or a decision is required for this event';
    return null;
  }
  function calendar(rows, now, items) {
    (rows || []).forEach(function (row, index) {
      var start = date(row.start), end = date(row.end) || start;
      var reason = calendarReason(row);
      if (!start || !reason || end < now || start.getTime() > now.getTime() + DAY) return;
      add(items, { bucket: 'WAITING_WATCH', kind: 'calendar', id: row.id, index: index, title: row.title || 'Calendar event', reason: reason, meta: row.location || 'Calendar', when: row.start, dedupe_key: 'calendar:' + (row.id || index) });
    });
  }

  function dedupe(items) {
    var byKey = new Map();
    (items || []).forEach(function (item) {
      var keys = item.dedupe_keys || [item.dedupe_key], prior = keys.map(function (key) { return byKey.get(key); }).find(Boolean);
      if (!prior || compare(item, prior) < 0) {
        if (prior) Array.from(byKey.entries()).forEach(function (entry) { if (entry[1] === prior) byKey.delete(entry[0]); });
        keys.forEach(function (key) { byKey.set(key, item); });
      }
    });
    return Array.from(new Set(byKey.values())).sort(compare);
  }

  function build(input) {
    var now = date(input?.now) || new Date(), items = [];
    workItems(input?.work, now, items); programs(input?.programs, now, items); commercial(input?.opportunities, now, items); emails(input?.emails, now, items); calendar(input?.calendar, now, items);
    var result = { NEEDS_ME_NOW: [], WAITING_WATCH: [], IMPORTANT_CHANGE: [], AVAILABLE_IN_DETAIL: [], NOISE_ARCHIVE: [] };
    dedupe(items).forEach(function (item) { result[item.bucket].push(item); });
    return result;
  }

  root.AtaraAttention = { TIME_ZONE: TIME_ZONE, easternDate: easternDate, dateInputValue: dateInputValue, easternMidnight: easternMidnight, easternWeekBounds: easternWeekBounds, build: build, dedupe: dedupe, emailBucket: emailBucket, emailDateContext: emailDateContext, isStaleOverdue: staleOverdue };
})(typeof window !== 'undefined' ? window : globalThis);
