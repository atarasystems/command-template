/* Email: what your inbox needs from you. Replies are drafted and wait for you. Nothing sends until you press Send. */
(function () {
  'use strict';

  var TABS = [['reply', 'Reply to'], ['todo', 'To do'], ['fyi', 'Good to know'], ['handled', 'Done lately']];
  var state = { data: null, tab: 'reply', busy: false, current: null, loading: false };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  async function api(body) {
    var r = await fetch('/api/email', body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
    var p = await r.json().catch(function () { return {}; });
    if (!r.ok || p.ok === false) throw new Error((p.error && p.error.message) || 'That did not work. Try again.');
    return p.data;
  }

  function gmailLink(row) { return row.gmail_thread_id ? 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(row.gmail_thread_id) : 'https://mail.google.com/'; }
  function who(row) { return row.sender_name || row.sender_email || 'Someone'; }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days < 1) return 'Today';
    if (days === 1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function dueLabel(date) {
    if (!date) return '';
    var today = new Date().toLocaleDateString('en-CA', { timeZone: (globalThis.CMD_TZ || 'America/New_York') });
    if (date < today) return 'Was due ' + new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (date === today) return 'Due today';
    return 'Due ' + new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function priorityChip(row) {
    if (row.priority === 'now') return '<span class="cmd-pill cmx-warn">Soon</span>';
    return '';
  }

  function root() {
    var el = $('cmd-emailpage-body'); if (!el) return null;
    if (!el.dataset.ready) { el.dataset.ready = '1'; el.addEventListener('click', onClick); }
    return el;
  }

  function count(id) { var d = state.data || {}; return id === 'handled' ? 0 : (d[id] || []).length; }

  function nextStep(d) {
    if (!d.gmail) return { text: 'Gmail is not connected to Command.', sub: 'Once it is, your inbox gets checked every 30 minutes.' };
    if (!d.ai) return { text: 'The email assistant starts once Gemini is connected.', sub: 'Add GEMINI_API_KEY to Command in Vercel. Then your inbox gets read every 30 minutes.' };
    var r = (d.reply || []).length, t = (d.todo || []).length;
    if (!r && !t) return { text: 'Nothing in your inbox needs you right now.', sub: 'Command checks your email every 30 minutes and lists anything that does.' };
    var parts = [];
    if (r) parts.push(r + (r === 1 ? ' email needs' : ' emails need') + ' a reply');
    if (t) parts.push(t + (t === 1 ? ' thing' : ' things') + ' to do');
    return { text: parts.join(' and ') + '.', sub: r ? 'Each reply is already written for you. Read it, change anything, then press Send. Nothing sends until you do.' : 'Each one is also on your Today list with its due date.' };
  }

  var ITEM_LABEL = { reply: 'Reply', todo: 'To do', event: 'Go to', prepare: 'Prepare', optional: 'If you want', missed: 'Missed', info: 'Note' };
  function itemWhen(i) {
    if (!i.date) return '';
    var d = new Date(i.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (!i.time) return d;
    var t = new Date('2000-01-01T' + i.time + ':00').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return d + ', ' + t;
  }
  function itemsHtml(row) {
    var items = Array.isArray(row.items) ? row.items : [];
    if (!items.length) return '';
    var order = { event: 0, prepare: 1, todo: 2, reply: 3, optional: 4, info: 5, missed: 6 };
    var list = items.map(function (i, n) { return { i: i, n: n }; }).sort(function (a, b) { return (order[a.i.type] - order[b.i.type]) || String(a.i.date || '9').localeCompare(String(b.i.date || '9')); });
    return '<ul class="cme-items">' + list.map(function (x) {
      var i = x.i, done = i.status === 'done';
      var buttons = '';
      if (!done && (i.type === 'todo' || i.type === 'event' || i.type === 'prepare')) buttons += '<button type="button" class="cmx-btn" data-cme="item_done" data-id="' + row.id + '" data-index="' + x.n + '">Done</button>';
      if (!done && (i.type === 'event' || i.type === 'optional') && i.date && !i.calendar_event_id) buttons += '<button type="button" class="cmx-btn" data-cme="add_to_calendar" data-id="' + row.id + '" data-index="' + x.n + '">Add to calendar</button>';
      if (i.calendar_link) buttons += '<a class="cmx-btn" href="' + esc(i.calendar_link) + '" target="_blank" rel="noopener">On your calendar</a>';
      return '<li class="cme-item cme-' + esc(i.type) + (done ? ' cme-done' : '') + '"><div><span class="cme-tag">' + esc(done ? 'Done' : ITEM_LABEL[i.type] || 'Note') + '</span> <strong>' + esc(i.title) + '</strong>' + (itemWhen(i) ? ' <span class="cme-when">' + esc(itemWhen(i)) + '</span>' : '') +
        (i.place ? '<div class="cme-detail">' + esc(i.place) + '</div>' : '') + (i.details ? '<div class="cme-detail">' + esc(i.details) + '</div>' : '') + '</div>' + (buttons ? '<div class="cme-item-actions">' + buttons + '</div>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function card(row, kind) {
    var chips = '<span class="cmx-chip">' + esc(who(row)) + '</span><span class="cmx-chip">' + esc(when(row.received_at)) + '</span>' + (row.due_date ? '<span class="cmd-pill ' + (row.priority === 'now' ? 'cmx-warn' : 'cmx-soft') + '">' + esc(dueLabel(row.due_date)) + '</span>' : priorityChip(row));
    var title = kind === 'todo' ? (row.ask || row.subject) : (row.subject || '(no subject)');
    var sub = kind === 'todo' ? row.summary : (row.ask ? row.ask : row.summary);
    var actions = '';
    if (kind === 'reply') actions = '<button type="button" class="cmx-btn cmx-btn-main" data-cme="open" data-id="' + row.id + '">Read and reply</button><button type="button" class="cmx-btn" data-cme="done" data-id="' + row.id + '" title="You already handled it">Done</button>';
    if (kind === 'todo') actions = '<a class="cmx-btn" href="' + esc(gmailLink(row)) + '" target="_blank" rel="noopener">Open email</a><button type="button" class="cmx-btn cmx-btn-main" data-cme="done" data-id="' + row.id + '">All done</button>';
    if (kind === 'fyi') actions = '<a class="cmx-btn" href="' + esc(gmailLink(row)) + '" target="_blank" rel="noopener">Open email</a><button type="button" class="cmx-btn" data-cme="make_reply" data-id="' + row.id + '">Needs a reply</button><button type="button" class="cmx-btn" data-cme="make_todo" data-id="' + row.id + '">Make it a to-do</button><button type="button" class="cmx-btn cmx-btn-main" data-cme="dismiss" data-id="' + row.id + '">Got it</button>';
    if (kind !== 'fyi') actions += '<button type="button" class="cmx-icon-btn" data-cme="dismiss" data-id="' + row.id + '" aria-label="Not needed" title="Not needed">&times;</button>';
    var err = row.error ? '<div class="cmx-card-sub cmx-error">' + esc(row.error) + '</div>' : '';
    var items = itemsHtml(row);
    if (items) { title = row.subject || title; sub = row.summary; }
    return '<div class="cmx-card cme-card"><div class="cmx-card-main"><div class="cmx-card-title">' + esc(title) + '</div>' + (sub ? '<div class="cmx-card-sub">' + esc(sub) + '</div>' : '') + err + '<div class="cmx-chips">' + chips + '</div>' + items + '</div><div class="cmx-card-actions">' + actions + '</div></div>';
  }

  function handledRow(row) {
    var what = row.status === 'sent' ? 'Reply sent' : row.status === 'dismissed' ? 'Marked not needed' : row.handled_by === 'gmail' ? 'You replied in Gmail' : 'Done';
    return '<div class="cmx-card"><div class="cmx-card-main"><div class="cmx-card-title">' + esc(row.subject || '(no subject)') + '</div><div class="cmx-chips"><span class="cmx-chip">' + esc(row.sender_name || '') + '</span><span class="cmd-pill cmx-soft">' + esc(what) + '</span></div></div>' +
      (row.status !== 'sent' ? '<div class="cmx-card-actions"><button type="button" class="cmx-btn" data-cme="restore" data-id="' + row.id + '">Bring back</button></div>' : '') + '</div>';
  }

  function render() {
    var el = root(); if (!el) return;
    var d = state.data;
    if (!d) { el.innerHTML = '<div class="cmd-empty">' + (state.loading ? 'Loading your email...' : '') + '</div>'; return; }
    var step = nextStep(d);
    var tabs = TABS.map(function (t) { var n = count(t[0]); return '<button type="button" class="cmx-tab" data-cme="tab" data-tab="' + t[0] + '" aria-pressed="' + (t[0] === state.tab) + '">' + esc(t[1]) + (n ? '<span class="cmx-tab-n">' + n + '</span>' : '') + '</button>'; }).join('');
    var list = state.tab === 'handled' ? (d.handled || []).map(handledRow) : (d[state.tab] || []).map(function (r) { return card(r, state.tab); });
    var empty = { reply: 'No replies waiting.', todo: 'Nothing to do from email.', fyi: 'Nothing new to know.', handled: 'Nothing handled in the last two weeks.' }[state.tab];
    el.innerHTML = '<div class="cmx-next"><div><div class="cmx-next-label">Next step</div><div class="cmx-next-text">' + esc(step.text) + '</div><div class="cmx-next-sub">' + esc(step.sub) + '</div></div><div class="cmx-next-actions"><button type="button" class="cmd-chip-btn" data-cme="check">Check email now</button></div></div>' +
      '<div class="cmx-tabs" role="group" aria-label="Email lists">' + tabs + '</div>' +
      '<div class="cmx-list">' + (list.length ? list.join('') : '<div class="cmd-empty">' + esc(empty) + '</div>') + '</div>' +
      '<div class="cmx-foot">Command reads your inbox every 30 minutes. Newsletters and promotions are left out. Replies you send from Gmail are noticed and cleared here.</div>';
  }

  /* ---------- Reply window ---------- */
  function modal(title, body, foot) {
    var m = $('cme-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'cme-modal'; m.className = 'cmx-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      document.body.appendChild(m);
      m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-cme="close"]')) closeModal(); else onClick(e); });
    }
    m.innerHTML = '<div class="cmx-modal-card"><div class="cmx-modal-head"><h2 class="cmd-h2">' + esc(title) + '</h2><button type="button" class="cmx-icon-btn" data-cme="close" aria-label="Close">&times;</button></div><div class="cmx-modal-body">' + body + '</div><div class="cmx-modal-foot">' + (foot || '') + '</div></div>';
    m.classList.add('cmx-open');
  }
  function closeModal() { var m = $('cme-modal'); if (m) m.classList.remove('cmx-open'); state.current = null; }
  function working(message) {
    var m = $('cme-modal'); if (!m) return;
    var body = m.querySelector('.cmx-modal-body');
    if (body && !m.querySelector('.cmx-working')) body.insertAdjacentHTML('afterbegin', '<div class="cmx-working" role="status"><span class="cmx-working-dot"></span>' + esc(message) + '</div>');
    m.querySelectorAll('.cmx-modal-card textarea, .cmx-modal-card input, .cmx-modal-card button:not([data-cme="close"])').forEach(function (b) { b.disabled = true; });
  }

  function openReply(row) {
    state.current = row;
    var body = '<div class="cmx-help" style="margin-bottom:12px"><strong>' + esc(who(row)) + '</strong> · ' + esc(when(row.received_at)) + ' · <a href="' + esc(gmailLink(row)) + '" target="_blank" rel="noopener">Open in Gmail</a></div>' +
      '<div class="cmx-card-sub" style="margin-bottom:16px"><strong>' + esc(row.subject || '') + '</strong><br>' + esc(row.summary || row.snippet || '') + (row.ask ? '<br><strong>What they need:</strong> ' + esc(row.ask) : '') + '</div>' +
      '<label class="cmx-field"><span>Subject</span><input id="cme-subject" value="' + esc(row.reply_subject || ('Re: ' + (row.subject || ''))) + '"></label>' +
      '<label class="cmx-field"><span>Your reply</span><div class="cmx-help">Anything in [square brackets] is for you to fill in.</div><textarea id="cme-body" rows="12">' + esc(row.reply_body || '') + '</textarea></label>' +
      (window.ATARA_CAFE_CONVO ? '<button type="button" class="cmx-btn" data-cme="cafe" style="margin:-4px 0 12px">Add my ' + esc(window.ATARA_CAFE_CONVO.name) + ' link</button>' : '') +
      (row.gmail_draft_id ? '<div class="cmx-help">This reply is also in your Gmail Drafts, so you can send it from your phone.</div>' : '');
    var foot = '<button type="button" class="cmx-btn" data-cme="dismiss" data-id="' + row.id + '">Not needed</button><span class="cmx-spacer"></span>' +
      '<button type="button" class="cmx-btn" data-cme="redraft">Write it again</button><button type="button" class="cmx-btn" data-cme="save">Save</button><button type="button" class="cmd-primary-btn" data-cme="send">Send</button>';
    modal('Reply to ' + who(row), body, foot);
    state.original = JSON.stringify(form());
    var t = $('cme-body'); if (t) setTimeout(function () { t.focus(); }, 30);
  }
  function form() { return { subject: ($('cme-subject') || {}).value || '', body: ($('cme-body') || {}).value || '' }; }

  function toast(message, bad) {
    var t = $('cmx-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cmx-toast'; t.className = 'cmx-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = '<span>' + esc(message) + '</span>';
    t.className = 'cmx-toast cmx-show' + (bad ? ' cmx-bad' : '');
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'cmx-toast'; }, 4500);
  }

  function find(id) { var d = state.data || {}; return [].concat(d.reply || [], d.todo || [], d.fyi || [], d.handled || []).filter(function (r) { return r.id === id; })[0]; }

  async function act(body, done, opts) {
    if (state.busy) return;
    state.busy = true;
    try { var r = await api(body); state.busy = false; if (done) toast(typeof done === 'function' ? done(r) : done); await load(); return r; }
    catch (e) { state.busy = false; toast(e.message, true); if (opts && opts.reopen) { var row = find(opts.reopen); if (row) openReply(row); } return null; }
  }

  async function onClick(e) {
    var el = e.target.closest('[data-cme]'); if (!el) return;
    var what = el.dataset.cme, id = el.dataset.id;
    if (what === 'tab') { state.tab = el.dataset.tab; render(); return; }
    if (what === 'open') { var row = find(id); if (row) openReply(row); return; }
    if (what === 'check') {
      el.disabled = true; el.textContent = 'Reading your email and calendar...';
      await act({ action: 'check_now' }, function (r) {
        var hu = r.heads_up && r.heads_up.found ? ' ' + r.heads_up.found + ' heads up for upcoming events. See Today.' : '';
        return (r.read ? 'Read ' + r.read + ' new ' + (r.read === 1 ? 'email' : 'emails') + '. ' + (r.reply + r.todo ? (r.reply + r.todo) + ' need you.' : 'None need you.') : 'No new email to read.') + hu;
      });
      if (window.CommandHeadsUp) window.CommandHeadsUp.load();
      el.disabled = false; el.textContent = 'Check email now';
      return;
    }
    if (what === 'done' || what === 'dismiss') { closeModal(); return act({ action: what, id: id }, what === 'done' ? 'Done. It is cleared from your lists.' : 'Cleared. Nothing was sent.'); }
    if (what === 'item_done' || what === 'add_to_calendar') return act({ action: what, id: id, index: Number(el.dataset.index) }, what === 'item_done' ? 'Done.' : 'Added to your calendar.');
    if (what === 'restore' || what === 'make_todo') return act({ action: what, id: id }, what === 'restore' ? 'Brought back.' : 'Moved to To do.');
    if (what === 'make_reply') {
      state.tab = 'reply';
      toast('Writing a reply. This takes a few seconds.');
      await act({ action: 'make_reply', id: id });
      var r2 = await act({ action: 'redraft', id: id }, 'Your reply is ready in Reply to.');
      return r2;
    }
    var cur = state.current; if (!cur) return;
    if (what === 'cafe') {
      var t = $('cme-body'), link = window.ATARA_CAFE_CONVO && window.ATARA_CAFE_CONVO.url;
      if (!t || !link) return;
      if (t.value.indexOf(link) !== -1) { toast('Your booking link is already in this reply.'); return; }
      var line = 'Here is my ' + window.ATARA_CAFE_CONVO.name + ' link if you would like to find a time: ' + link;
      var sign = (window.CommandSettings && CommandSettings.get() && CommandSettings.get().founder && (CommandSettings.get().founder.signoff || CommandSettings.get().founder.first_name)) || '';
      var signEnd = sign ? new RegExp('\\n\\s*' + sign.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$') : null;
      t.value = signEnd && signEnd.test(t.value) ? t.value.replace(signEnd, '\n\n' + line + '\n\n' + sign) : (t.value.replace(/\s+$/, '') + '\n\n' + line);
      t.focus();
      return;
    }
    if (what === 'save') { var f = form(); closeModal(); return act({ action: 'save_reply', id: cur.id, subject: f.subject, body: f.body }, 'Saved. Your Gmail draft matches.'); }
    if (what === 'send') {
      var s = form();
      if (/\[[^\]]+\]/.test(s.body)) { toast('Fill in the parts in [square brackets] first.', true); return; }
      if (!s.body.trim()) { toast('Write your reply first.', true); return; }
      working('Sending...');
      var sent = await act({ action: 'send', id: cur.id, subject: s.subject, body: s.body }, 'Sent to ' + who(cur) + '.', { reopen: cur.id });
      if (sent) closeModal();
      return;
    }
    if (what === 'redraft') {
      var note = window.prompt('What should be different? Leave it blank for a fresh version.');
      if (note === null) return;
      var keep = cur.id;
      working('Writing a new version...');
      var fresh = await act({ action: 'redraft', id: keep, instruction: note }, 'Here is the new version.', { reopen: keep });
      if (fresh) { var row2 = find(keep); if (row2) openReply(row2); }
    }
  }

  async function load() {
    state.loading = true; if (!state.data) render();
    try { state.data = await api(); } catch (e) { toast(e.message, true); }
    state.loading = false; render();
    var badge = $('cmd-badge-email');
    var n = state.data ? (state.data.reply || []).length + (state.data.todo || []).length : 0;
    if (badge) badge.textContent = n ? String(n) : '';
  }

  window.CommandEmail = { open: load, check: function () { var b = document.querySelector('[data-cme="check"]'); if (b) b.click(); } };
})();
