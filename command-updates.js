/* Updates: a quick daily log, follow-ups into tasks, and week or month in review you can share by clearance. */
(function () {
  'use strict';

  // Brands come from setup: [code, name] pairs.
  function brandPairs() { return window.CommandSettings ? CommandSettings.brands().map(function (b) { return [String(b.code || b.name).toUpperCase().slice(0, 12), b.name || b.code]; }) : []; }
  var LEVELS = [['private', 'Just me'], ['team', 'Team'], ['investor', 'Team and investors']];
  var AUDIENCE = { me: 'Just for you', team: 'For the team', investor: 'For investors and advisors' };
  var TO_KEY = 'atara-command.review-to.';
  var state = { data: null, brand: null, share: 'private', busy: false, current: null };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; } return null; }
  function brandName(code) { var b = brandPairs().filter(function (x) { return x[0] === code; })[0]; return b ? b[1] : ''; }
  function levelName(code) { var l = LEVELS.filter(function (x) { return x[0] === code; })[0]; return l ? l[1] : 'Just me'; }

  async function api(body) {
    var r = await fetch('/api/updates', body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
    var p = await r.json().catch(function () { return {}; });
    if (!r.ok || p.ok === false) throw new Error((p.error && p.error.message) || 'That did not save. Try again.');
    return p.data;
  }

  function dayLabel(iso, today) {
    if (iso === today) return 'Today';
    var y = new Date(today + 'T12:00:00Z'); y.setUTCDate(y.getUTCDate() - 1);
    if (iso === y.toISOString().slice(0, 10)) return 'Yesterday';
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function shortDate(iso) { return iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''; }

  function root() {
    var el = $('cmd-updates-body'); if (!el) return null;
    if (!el.dataset.ready) { el.dataset.ready = '1'; el.addEventListener('click', onClick); el.addEventListener('change', onChange); }
    return el;
  }

  function render() {
    var el = root(); if (!el) return;
    var d = state.data;
    var brandChips = brandPairs().map(function (b) { return '<button type="button" class="cmx-brand cmu-small" data-cmu="brand" data-code="' + b[0] + '" aria-pressed="' + (state.brand === b[0]) + '">' + esc(b[1]) + '</button>'; }).join('');
    var shareChips = LEVELS.map(function (l) { return '<button type="button" class="cmx-brand cmu-small" data-cmu="share" data-level="' + l[0] + '" aria-pressed="' + (state.share === l[0]) + '">' + esc(l[1]) + '</button>'; }).join('');
    var html = '<div class="cmd-card cmu-add">' +
      '<label class="cmx-field"><span>What happened?</span><textarea id="cmu-text" rows="3" placeholder="Wins, decisions, calls, things you sent, things you learned. A sentence is plenty."></textarea></label>' +
      '<div class="cmu-row"><span class="cmu-row-label">Brand</span><div class="cmx-brands">' + brandChips + '</div></div>' +
      '<div class="cmu-row"><span class="cmu-row-label">Who can know</span><div class="cmx-brands">' + shareChips + '</div></div>' +
      '<div class="cmx-help">Just me stays private. Team is the people you work with. Team and investors can go in investor and advisor updates too.</div>' +
      '<div class="cmu-actions"><button type="button" class="cmd-primary-btn" data-cmu="save"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Saving...' : 'Save update') + '</button></div></div>';
    if (!d) { el.innerHTML = html + '<div class="cmd-empty">Loading your updates...</div>'; return; }

    var open = [];
    d.updates.forEach(function (u) { (u.followups || []).forEach(function (f, i) { if (f.status === 'suggested') open.push({ u: u, f: f, i: i, kind: 'update' }); }); });
    d.reviews.forEach(function (r) { (r.followups || []).forEach(function (f, i) { if (f.status === 'suggested') open.push({ u: r, f: f, i: i, kind: 'review' }); }); });
    if (open.length) {
      html += '<h2 class="cmd-section-title">Follow-ups to add</h2><div class="cmx-list">' + open.map(followupRow).join('') + '</div>';
    }

    html += '<h2 class="cmd-section-title">Reviews</h2>';
    html += d.reviews.length ? '<div class="cmx-list">' + d.reviews.map(reviewRow).join('') + '</div>' : '<div class="cmd-empty">Your week in review is drafted every Friday afternoon. You can make one any time with the buttons above.</div>';

    html += '<h2 class="cmd-section-title">Your updates</h2>';
    if (!d.updates.length) html += '<div class="cmd-empty">No updates yet. Add your first one above.</div>';
    else {
      var byDay = {};
      d.updates.forEach(function (u) { (byDay[u.entry_date] = byDay[u.entry_date] || []).push(u); });
      Object.keys(byDay).sort().reverse().forEach(function (day) {
        html += '<div class="cmu-day">' + esc(dayLabel(day, d.today)) + '</div><div class="cmx-list">' + byDay[day].map(updateRow).join('') + '</div>';
      });
    }
    el.innerHTML = html;
  }

  function levelSelect(u) {
    return '<select class="cmu-level" data-cmu="level" data-id="' + u.id + '" aria-label="Who can know">' + LEVELS.map(function (l) { return '<option value="' + l[0] + '"' + (u.share_level === l[0] ? ' selected' : '') + '>' + esc(l[1]) + '</option>'; }).join('') + '</select>';
  }

  function updateRow(u) {
    return '<article class="cmx-card"><div class="cmx-card-main"><div class="cmu-body">' + esc(u.body) + '</div>' +
      '<div class="cmx-chips">' + (u.brand ? '<span class="cmx-chip">' + esc(brandName(u.brand)) + '</span>' : '') + levelSelect(u) + '</div></div>' +
      '<div class="cmx-card-actions">' + trash('update', u.id) + '</div></article>';
  }

  function followupRow(o) {
    var key = o.kind + ':' + o.u.id + ':' + o.i;
    return '<article class="cmx-card"><div class="cmx-card-main"><div class="cmx-card-title">' + esc(o.f.title) + '</div>' +
      '<div class="cmx-help">From ' + (o.kind === 'review' ? 'your review' : 'your update on ' + esc(shortDate(o.u.entry_date))) + '</div>' +
      '<div class="cmu-follow-form"><label class="cmu-inline">Due <input type="date" id="cmu-due-' + esc(key) + '" value="' + esc(o.f.due_date || '') + '"></label>' +
      '<label class="cmx-check"><input type="checkbox" id="cmu-cal-' + esc(key) + '"' + (o.f.due_date ? ' checked' : '') + '> Put it on my calendar</label></div></div>' +
      '<div class="cmx-card-actions"><button type="button" class="cmx-btn" data-cmu="skip-follow" data-kind="' + o.kind + '" data-id="' + o.u.id + '" data-index="' + o.i + '">Skip</button>' +
      '<button type="button" class="cmx-btn cmx-btn-main" data-cmu="add-follow" data-kind="' + o.kind + '" data-id="' + o.u.id + '" data-index="' + o.i + '" data-key="' + esc(key) + '">Add to tasks</button></div></article>';
  }

  function reviewRow(r) {
    var status = r.status === 'sent' ? '<span class="cmd-pill cmx-love">Sent to ' + esc(r.sent_to || '') + '</span>' : (r.sent_to ? '<span class="cmd-pill cmx-soft">In Gmail drafts</span>' : '<span class="cmd-pill">Draft</span>');
    return '<article class="cmx-card"><div class="cmx-card-main"><div class="cmx-card-title">' + esc(r.title) + '</div>' +
      '<div class="cmx-chips"><span class="cmx-chip">' + (r.kind === 'month' ? 'Month in review' : 'Week in review') + '</span><span class="cmx-chip">' + esc(AUDIENCE[r.audience]) + '</span>' + status + '</div></div>' +
      '<div class="cmx-card-actions"><button type="button" class="cmx-btn cmx-btn-main" data-cmu="open-review" data-id="' + r.id + '">Open</button>' + trash('review', r.id) + '</div></article>';
  }

  function trash(kind, id) {
    return '<button type="button" class="cmx-icon-btn" data-cmu="delete" data-kind="' + kind + '" data-id="' + id + '" aria-label="Delete" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg></button>';
  }

  /* ---------- Review modal ---------- */
  function modal(title, body, foot) {
    var m = $('cmu-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'cmu-modal'; m.className = 'cmx-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      document.body.appendChild(m);
      m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-cmu="close"]')) closeModal(); else onClick(e); });
    }
    m.innerHTML = '<div class="cmx-modal-card"><div class="cmx-modal-head"><h2 class="cmd-h2">' + esc(title) + '</h2><button type="button" class="cmx-icon-btn" data-cmu="close" aria-label="Close">&times;</button></div><div class="cmx-modal-body">' + body + '</div><div class="cmx-modal-foot">' + (foot || '') + '</div></div>';
    m.classList.add('cmx-open');
  }
  function closeModal() { var m = $('cmu-modal'); if (m) m.classList.remove('cmx-open'); state.current = null; }

  function openReview(r) {
    state.current = r;
    var shared = r.audience !== 'me';
    var body = '<div class="cmx-help" style="margin-bottom:10px">' + esc(AUDIENCE[r.audience]) + ' · ' + (r.kind === 'month' ? 'Month in review' : 'Week in review') + ' · ' + esc(shortDate(r.period_start)) + ' to ' + esc(shortDate(r.period_end)) + '</div>' +
      (shared ? '<div class="cmu-note">Written only from updates you cleared for ' + (r.audience === 'team' ? 'the team' : 'investors') + '. Read it before it goes out.</div>' : '') +
      '<label class="cmx-field"><span>Title</span><input id="cmu-r-title" value="' + esc(r.title) + '"></label>' +
      '<label class="cmx-field"><span>Review</span><textarea id="cmu-r-body" rows="16">' + esc(r.body) + '</textarea></label>' +
      (shared ? '<label class="cmx-field"><span>Send to</span><input id="cmu-r-to" placeholder="name@example.com, another@example.com" value="' + esc(r.sent_to || store(TO_KEY + r.audience) || '') + '"></label>' : '');
    var foot = '<button type="button" class="cmx-btn cmx-btn-danger" data-cmu="delete" data-kind="review" data-id="' + r.id + '">Delete</button><span class="cmx-spacer"></span>';
    if (shared) foot += '<button type="button" class="cmx-btn" data-cmu="save-review">Save</button><button type="button" class="cmx-btn" data-cmu="send-review" data-draft="1">Save to Gmail drafts</button><button type="button" class="cmd-primary-btn" data-cmu="send-review">Send</button>';
    else foot += '<button type="button" class="cmx-btn" data-cmu="save-review">Save</button><button type="button" class="cmx-btn" data-cmu="share" data-audience="team">Make a team version</button><button type="button" class="cmd-primary-btn" data-cmu="share" data-audience="investor">Make an investor version</button>';
    modal(r.title, body, foot);
  }

  /* ---------- Toast ---------- */
  function toast(message, bad, undo) {
    var t = $('cmx-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cmx-toast'; t.className = 'cmx-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = '<span>' + esc(message) + '</span>' + (undo ? '<button type="button" class="cmx-toast-undo" id="cmu-undo">Undo</button>' : '');
    t.className = 'cmx-toast cmx-show' + (bad ? ' cmx-bad' : '');
    if (undo) $('cmu-undo').onclick = undo;
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'cmx-toast'; }, undo ? 8000 : 4500);
  }

  /* ---------- Actions ---------- */
  function findReview(id) { return ((state.data && state.data.reviews) || []).filter(function (r) { return r.id === id; })[0]; }

  async function act(work, message) {
    if (state.busy) return;
    state.busy = true; render();
    try { var out = await work(); state.busy = false; if (message) toast(typeof message === 'function' ? message(out) : message); await load(); return out; }
    catch (e) { state.busy = false; render(); toast(e.message, true); return null; }
  }

  async function makeReview(kind, audience, refDate) {
    toast('Writing your ' + (kind === 'month' ? 'month' : 'week') + ' in review. About 20 seconds.');
    var r = await act(function () { return api({ action: 'review', kind: kind, audience: audience, ref_date: refDate }); });
    if (r) { await load(); openReview(findReview(r.id) || r); }
  }

  async function onClick(e) {
    var el = e.target.closest('[data-cmu]'); if (!el) return;
    var what = el.dataset.cmu;
    if (what === 'brand') { state.brand = state.brand === el.dataset.code ? null : el.dataset.code; keepText(render); return; }
    if (what === 'share' && el.dataset.level) { state.share = el.dataset.level; keepText(render); return; }
    if (what === 'save') {
      var text = ($('cmu-text').value || '').trim();
      if (!text) { $('cmu-text').focus(); return; }
      var saved = await act(function () { return api({ action: 'add', body: text, brand: state.brand, share_level: state.share }); }, function (u) {
        var n = (u.followups || []).length; return n ? 'Saved. I found ' + n + ' follow-up' + (n === 1 ? '' : 's') + ' to add.' : 'Saved.';
      });
      if (saved) { state.brand = null; state.share = 'private'; render(); }
      return;
    }
    if (what === 'open-review') return openReview(findReview(el.dataset.id));
    if (what === 'week' || what === 'month') return makeReview(what, 'me');
    if (what === 'share' && el.dataset.audience) { var base = state.current; closeModal(); return makeReview(base.kind, el.dataset.audience, base.period_start); }
    if (what === 'save-review') {
      var r = state.current;
      return act(function () { return api({ action: 'edit_review', id: r.id, title: $('cmu-r-title').value, body: $('cmu-r-body').value }); }, 'Saved.').then(function (out) { if (out) closeModal(); });
    }
    if (what === 'send-review') {
      var rv = state.current, to = ($('cmu-r-to').value || '').trim(), draft = el.dataset.draft === '1';
      if (!to) { $('cmu-r-to').focus(); toast('Add who it goes to.', true); return; }
      store(TO_KEY + rv.audience, to);
      return act(function () { return api({ action: 'send_review', id: rv.id, to: to, subject: $('cmu-r-title').value, body: $('cmu-r-body').value, draft: draft }); }, draft ? 'Saved to your Gmail drafts.' : 'Sent.').then(function (out) { if (out) closeModal(); });
    }
    if (what === 'add-follow' || what === 'skip-follow') {
      var key = el.dataset.key || '', payload = { action: 'followup', kind: el.dataset.kind, id: el.dataset.id, index: Number(el.dataset.index) };
      if (what === 'skip-follow') payload.skip = true;
      else { payload.due_date = ($('cmu-due-' + key) || {}).value || ''; payload.calendar = !!(($('cmu-cal-' + key) || {}).checked); }
      return act(function () { return api(payload); }, what === 'skip-follow' ? 'Skipped.' : (payload.calendar && payload.due_date ? 'Added to tasks and your calendar.' : 'Added to tasks.'));
    }
    if (what === 'delete') {
      var kind = el.dataset.kind, id = el.dataset.id;
      try {
        await api({ action: 'delete', kind: kind, id: id }); closeModal();
        toast('Deleted.', false, async function () { try { await api({ action: 'restore', kind: kind, id: id }); toast('Brought back.'); await load(); } catch (err) { toast(err.message, true); } });
        await load();
      } catch (err) { toast(err.message, true); }
    }
  }

  async function onChange(e) {
    var el = e.target.closest('[data-cmu="level"]'); if (!el) return;
    try { await api({ action: 'update', id: el.dataset.id, share_level: el.value }); toast('Now: ' + levelName(el.value) + '.'); await load(); } catch (err) { toast(err.message, true); }
  }

  // Re-render without losing what is typed in the box.
  function keepText(fn) { var t = $('cmu-text'), v = t ? t.value : ''; fn(); var n = $('cmu-text'); if (n) { n.value = v; n.focus(); } }

  async function load() {
    try { state.data = await api(); } catch (e) { var el = root(); if (el && !state.data) el.innerHTML = '<div class="cmd-empty">Updates could not load. Try Refresh.</div>'; return; }
    keepText(render);
  }

  window.CommandUpdates = { open: function (focus) { load().then(function () { if (focus) { var t = $('cmu-text'); if (t) t.focus(); } }); render(); }, week: function () { makeReview('week', 'me'); }, month: function () { makeReview('month', 'me'); } };
})();
