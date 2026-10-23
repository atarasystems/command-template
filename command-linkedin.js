/* LinkedIn on the Work page: this week's three posts for the founder's personal profile.
   Command writes the drafts. The founder reads, edits, approves, copies and posts them. Nothing posts from here. */
(function () {
  'use strict';
  var state = { data: null, busy: '' };
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(k) { return new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
  var STATUS = { draft: 'Draft', approved: 'Approved', posted: 'Posted', skipped: 'Skipped' };

  function call(body) {
    return fetch('/api/linkedin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(function (p) { if (!p || p.ok === false) throw new Error((p && p.error && p.error.message) || 'That did not work.'); return p.data; });
  }
  function load() {
    return fetch('/api/linkedin', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (p) { if (p && p.ok) { state.data = p.data; render(); } }).catch(function () {});
  }

  function card(p) {
    var done = p.status === 'posted' || p.status === 'skipped';
    return '<article class="li-post s-' + esc(p.status) + '" data-id="' + esc(p.id) + '">' +
      '<div class="li-head"><b>' + esc(day(p.post_date)) + '</b><span class="li-chip">' + esc(p.type_label) + '</span><span class="li-chip soft">' + esc(p.topic_label || p.topic) + '</span><span class="li-status">' + esc(STATUS[p.status] || p.status) + '</span></div>' +
      '<textarea class="li-body" rows="' + Math.min(18, Math.max(8, String(p.body || '').split('\n').length + 1)) + '"' + (done ? ' readonly' : '') + '>' + esc(p.body) + '</textarea>' +
      (p.filter_note ? '<div class="li-note">Why it is worth reading: ' + esc(p.filter_note) + '</div>' : '') +
      '<div class="li-actions">' +
        (done ? '' : '<button type="button" class="cmd-primary-btn" data-li="copy">Copy</button>') +
        (p.status === 'draft' ? '<button type="button" class="cmd-chip-btn" data-li="approve">Approve</button>' : '') +
        (done ? '' : '<button type="button" class="cmd-chip-btn" data-li="posted">I posted it</button>') +
        (done ? '' : '<button type="button" class="cmd-chip-btn" data-li="save">Save my edits</button>') +
        (done ? '' : '<button type="button" class="cmd-chip-btn" data-li="rewrite">Rewrite</button>') +
        (done ? '' : '<button type="button" class="cmd-chip-btn" data-li="skip">Skip this one</button>') +
      '</div></article>';
  }

  function render() {
    var el = $('cmd-linkedin'); if (!el) return;
    var d = state.data;
    if (!d) { el.innerHTML = '<div class="cmd-card"><div class="cmd-empty">Loading LinkedIn...</div></div>'; return; }
    var upcoming = d.posts.filter(function (p) { return p.post_date >= d.today || p.status === 'draft' || p.status === 'approved'; });
    var past = d.posts.filter(function (p) { return upcoming.indexOf(p) === -1; }).slice(-3).reverse();
    el.innerHTML = '<div class="cmd-card li-card"><div class="cmd-card-head"><h2 class="cmd-h2">LinkedIn</h2><span class="cmd-count">Your profile · Mon, Wed, Fri</span>' +
      '<span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="cmd-chip-btn" data-li="week-this">Write this week</button><button type="button" class="cmd-chip-btn" data-li="week-next">Write next week</button></span></div>' +
      '<div class="li-help">Monday is a contrarian take. Wednesday is a framework or a real lesson from your updates. Friday is news or a post that invites DMs. Next week\'s drafts are ready Friday evening. Copy a post, paste it on LinkedIn, then press I posted it.</div>' +
      (state.busy ? '<div class="li-help"><b>' + esc(state.busy) + '</b></div>' : '') +
      (upcoming.length ? upcoming.map(card).join('') : '<div class="cmd-empty">No drafts yet. Press Write this week.</div>') +
      (past.length ? '<details class="li-past"><summary>Recent posts</summary>' + past.map(card).join('') + '</details>' : '') +
      '<details class="li-brain"><summary>LinkedIn brain (what Command knows when it writes)</summary><div class="li-help">Who you want to reach, your frameworks, what you believe that others do not, and your offers. Edit anything. Real stories come from Add an update.</div><textarea id="li-brain" rows="18">' + esc(d.brain) + '</textarea><div class="li-actions"><button type="button" class="cmd-primary-btn" data-li="save-brain">Save</button></div></details>' +
      '</div>';
  }

  function onClick(e) {
    var btn = e.target.closest('[data-li]'); if (!btn) return;
    var act = btn.dataset.li, art = btn.closest('.li-post'), id = art && art.dataset.id, text = art && art.querySelector('.li-body') ? art.querySelector('.li-body').value : '';
    var run = function (label, body) { state.busy = label; render(); return call(body).then(function () { state.busy = ''; return load(); }).catch(function (err) { state.busy = err.message; render(); }); };
    if (act === 'copy') { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); }).catch(function () { art.querySelector('.li-body').select(); }); return; }
    if (act === 'approve') return run('Saving...', { action: 'save', id: id, body: text }).then(function () { return call({ action: 'status', id: id, status: 'approved' }); }).then(load);
    if (act === 'posted') return run('Saving...', { action: 'status', id: id, status: 'posted' });
    if (act === 'skip') return run('Saving...', { action: 'status', id: id, status: 'skipped' });
    if (act === 'save') return run('Saving...', { action: 'save', id: id, body: text });
    if (act === 'rewrite') { var note = window.prompt('What should change? (optional)', ''); if (note === null) return; return run('Writing a new version...', { action: 'rewrite', id: id, note: note }); }
    if (act === 'week-this') return run('Writing this week\'s posts. This takes about a minute...', { action: 'write_week', week: 'this' });
    if (act === 'week-next') return run('Writing next week\'s posts. This takes about a minute...', { action: 'write_week', week: 'next' });
    if (act === 'save-brain') return run('Saving...', { action: 'save_brain', brain: $('li-brain').value });
  }

  function mount() {
    var host = $('cmd-linkedin-posts'); if (!host || $('cmd-linkedin')) return;
    var el = document.createElement('div'); el.id = 'cmd-linkedin'; el.style.marginTop = '22px';
    host.parentNode.insertBefore(el, host.nextSibling);
    el.addEventListener('click', onClick);
    var st = document.createElement('style');
    st.textContent = '.li-help{font-size:13px;color:var(--cmd-muted,#666);margin:-4px 0 12px}.li-post{border:1px solid var(--cmd-line,#ddd);border-radius:14px;padding:12px;margin-top:12px}.li-post.s-posted,.li-post.s-skipped{opacity:.7}.li-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}.li-chip{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:999px;background:var(--cmd-primary-soft,#eee)}.li-chip.soft{background:transparent;border:1px solid var(--cmd-line,#ddd)}.li-status{margin-left:auto;font-size:12px;font-weight:700;color:var(--cmd-muted,#666)}.li-body,#li-brain{width:100%;box-sizing:border-box;font:inherit;font-size:14px;line-height:1.5;border:1px solid var(--cmd-line,#ddd);border-radius:10px;padding:10px;background:var(--cmd-card,#fff);color:inherit}.li-note{font-size:12px;color:var(--cmd-muted,#666);margin-top:6px}.li-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.li-past,.li-brain{margin-top:14px}.li-past summary,.li-brain summary{cursor:pointer;font-weight:700}';
    document.head.appendChild(st);
    render(); load();
  }
  window.CommandLinkedIn = { open: function () { mount(); load(); } };
})();
