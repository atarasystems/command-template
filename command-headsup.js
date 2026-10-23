/* Heads up: the easy-to-miss details of upcoming events, at the top of Today and, when it is close, at the top of every page. */
(function () {
  'use strict';

  var state = { rows: null, busy: false, open: {} };
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  async function api(body) {
    var r = await fetch('/api/heads-up', body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
    var p = await r.json().catch(function () { return {}; });
    if (!r.ok || p.ok === false) throw new Error((p.error && p.error.message) || 'That did not save. Try again.');
    return p.data;
  }

  function hoursUntil(row) { return (new Date(row.starts_at).getTime() - Date.now()) / 3600000; }
  function whenLabel(row) {
    var d = new Date(row.starts_at); if (isNaN(d)) return '';
    var dayKey = function (x) { return x.toLocaleDateString('en-CA', { timeZone: (globalThis.CMD_TZ || 'America/New_York') }); };
    var today = new Date(), tomorrow = new Date(Date.now() + 86400000);
    var day = dayKey(d) === dayKey(today) ? 'Today' : dayKey(d) === dayKey(tomorrow) ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: (globalThis.CMD_TZ || 'America/New_York') });
    return row.all_day ? day : day + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: (globalThis.CMD_TZ || 'America/New_York') });
  }
  function urgent(row) { return hoursUntil(row) <= 48; }
  function prepLeft(row) { return (row.prep || []).filter(function (p) { return !p.done; }).length; }
  function needsLook(row) { return !row.acknowledged_at || (urgent(row) && prepLeft(row) > 0); }

  function removeBtn(row) { return '<button type="button" class="cmx-icon-btn chu-remove" data-chu="remove" data-id="' + row.id + '" aria-label="Remove" title="Remove">&times;</button>'; }

  function cardHtml(row) {
    var prep = row.prep || [];
    var full = !row.acknowledged_at || state.open[row.id];
    var links = (row.join_link ? '<a class="cmx-btn" href="' + esc(row.join_link) + '" target="_blank" rel="noopener">Join link</a>' : '') +
      (row.location && !/^https?:/i.test(row.location) ? '<a class="cmx-btn" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(row.location) + '" target="_blank" rel="noopener">Directions</a>' : '');
    if (!full) {
      return '<div class="chu-card chu-small' + (urgent(row) && prepLeft(row) ? ' chu-urgent' : '') + '"><button type="button" class="chu-line" data-chu="expand" data-id="' + row.id + '"><span class="chu-when">' + esc(whenLabel(row)) + '</span> <strong>' + esc(row.title) + '</strong>' +
        (prep.length ? ' <span class="chu-count">' + (prep.length - prepLeft(row)) + ' of ' + prep.length + ' ready</span>' : '') + '</button>' + removeBtn(row) + '</div>';
    }
    var list = prep.length ? '<ul class="chu-prep">' + prep.map(function (p, n) {
      return '<li><label><input type="checkbox" data-chu="prep" data-id="' + row.id + '" data-index="' + n + '"' + (p.done ? ' checked' : '') + '> <span' + (p.done ? ' class="chu-done"' : '') + '>' + esc(p.text) + '</span></label></li>';
    }).join('') + '</ul>' : '';
    return '<div class="chu-card' + (urgent(row) ? ' chu-urgent' : '') + '">' +
      '<div class="chu-top"><span class="chu-when">' + esc(whenLabel(row)) + '</span><span class="chu-title">' + esc(row.title) + '</span>' + removeBtn(row) + '</div>' +
      (row.heads_up ? '<div class="chu-headline">' + esc(row.heads_up) + '</div>' : '') + list +
      '<div class="chu-actions">' + links + '<span class="cmx-spacer"></span>' +
      (row.acknowledged_at ? '<button type="button" class="cmx-btn" data-chu="collapse" data-id="' + row.id + '">Show less</button>' : '<button type="button" class="cmx-btn" data-chu="not_relevant" data-id="' + row.id + '">Not for me</button><button type="button" class="cmd-primary-btn" data-chu="got_it" data-id="' + row.id + '">Got it</button>') +
      '</div></div>';
  }

  function renderToday() {
    var el = $('cmd-today-headsup'); if (!el) return;
    if (!el.dataset.ready) { el.dataset.ready = '1'; el.addEventListener('click', onClick); el.addEventListener('change', onClick); }
    var rows = state.rows || [];
    if (!rows.length) { el.innerHTML = ''; return; }
    var fresh = rows.filter(function (r) { return !r.acknowledged_at; }).length;
    el.innerHTML = '<section class="chu" aria-label="Heads up"><div class="chu-head"><h2 class="cmd-h2">Heads up</h2><span class="cmx-help">' +
      (fresh ? fresh + ' new. Read each one, then press Got it.' : 'Before your next events.') + '</span></div>' + rows.map(cardHtml).join('') + '</section>';
  }

  // On every page: anything in the next 2 days that still needs a look.
  function renderStrip() {
    var main = document.querySelector('#app-inner main'); if (!main) return;
    var strip = $('chu-strip');
    var hot = (state.rows || []).filter(function (r) { return urgent(r) && needsLook(r); });
    var onToday = document.body.dataset.cmdPage === 'today' || (document.querySelector('.cmd-nav-link[aria-current="page"]') || {}).dataset?.page === 'today';
    if (!hot.length || onToday) { if (strip) strip.remove(); return; }
    if (!strip) { strip = document.createElement('div'); strip.id = 'chu-strip'; strip.className = 'chu-strip'; strip.setAttribute('role', 'status'); main.insertBefore(strip, main.firstChild); strip.addEventListener('click', function (e) { if (e.target.closest('[data-chu-go]')) { var link = document.querySelector('.cmd-nav-link[data-page="today"]'); if (link) link.click(); } }); }
    var first = hot[0];
    strip.innerHTML = '<span class="chu-strip-label">Heads up</span><span><strong>' + esc(whenLabel(first)) + ': ' + esc(first.title) + '.</strong> ' + esc(first.heads_up || (prepLeft(first) + ' things to prepare.')) + '</span>' +
      (hot.length > 1 ? '<span class="chu-strip-more">+' + (hot.length - 1) + ' more</span>' : '') + '<button type="button" class="cmx-btn" data-chu-go="1">Open</button>';
  }

  function render() { renderToday(); renderStrip(); }

  async function onClick(e) {
    var el = e.target.closest('[data-chu]'); if (!el) return;
    if (e.type === 'click' && el.type === 'checkbox') return; // handled on change
    var what = el.dataset.chu, id = el.dataset.id;
    if (what === 'expand') { state.open[id] = true; render(); return; }
    if (what === 'collapse') { delete state.open[id]; render(); return; }
    var row = (state.rows || []).filter(function (r) { return r.id === id; })[0]; if (!row) return;
    try {
      if (what === 'prep') {
        var n = Number(el.dataset.index); row.prep[n].done = el.checked; render();
        await api({ action: 'prep_done', id: id, index: n, done: el.checked });
        return;
      }
      if (what === 'remove') {
        state.rows = (state.rows || []).filter(function (r) { return r.id !== id; }); render();
        await api({ action: 'remove', id: id });
        return;
      }
      if (what === 'got_it' || what === 'not_relevant') {
        var saved = await api({ action: what, id: id });
        state.rows = (state.rows || []).map(function (r) { return r.id === id ? saved : r; }).filter(function (r) { return !r.dismissed_at; });
        render();
      }
    } catch (err) { if (window.console) console.error(err); }
  }

  async function load() {
    try { state.rows = await api(); } catch (e) { state.rows = state.rows || []; }
    render();
  }

  window.CommandHeadsUp = { load: load, render: render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
  setInterval(load, 10 * 60 * 1000);
})();
