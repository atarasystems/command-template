/* Founder Home controls: working View All plus explicit removal for every item surfaced in Today. */
(function () {
  'use strict';

  var expanded = Object.create(null);
  var itemStore = Object.create(null);
  var installAttempts = 0;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function safeKeyPart(value) { return encodeURIComponent(clean(value)).replace(/%/g, '_'); }
  function itemKey(item) {
    return [item && item.kind || 'item', item && item.id || item && item.index || item && item.title || 'unknown', item && item.source_table || ''].map(safeKeyPart).join('__');
  }
  function escapeHtml(value) {
    if (typeof esc === 'function') return esc(clean(value));
    return clean(value).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
  }
  function shortDate(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:(globalThis.CMD_TZ || 'America/New_York') });
  }

  function registerItem(item) {
    var key = itemKey(item);
    itemStore[key] = item;
    return key;
  }

  function renderItem(item) {
    var key = registerItem(item);
    var meta = escapeHtml(item && item.meta || '');
    if (item && item.when) meta += (meta ? ' · ' : '') + escapeHtml(shortDate(item.when));
    return '<div class="founder-today-item-shell">' +
      '<button type="button" class="founder-today-item founder-today-item-open" onclick="commandFounderTodayOpen(\'' + key + '\')">' +
        '<div class="founder-today-item-title">' + escapeHtml(item && item.title || '') + '</div>' +
        '<div class="founder-today-item-why">' + escapeHtml(item && item.reason || '') + '</div>' +
        '<div class="founder-today-item-meta">' + meta + (meta ? ' · ' : '') + 'Open →</div>' +
      '</button>' +
      '<button type="button" class="founder-today-delete" onclick="commandFounderTodayDelete(\'' + key + '\')" aria-label="Delete ' + escapeHtml(item && item.title || 'item') + '">Delete</button>' +
    '</div>';
  }

  window.commandFounderTodayOpen = function (key) {
    var item = itemStore[key];
    if (!item) return;
    if (typeof founderHomeOpen === 'function') founderHomeOpen(item);
  };

  window.commandFounderTodayToggle = function (listId) {
    expanded[listId] = !expanded[listId];
    if (typeof founderHomeRender === 'function') founderHomeRender();
  };

  function confirmAction(title, body, action) {
    if (typeof openCommandDeleteConfirm === 'function') {
      openCommandDeleteConfirm(title, body, action);
      return;
    }
    if (window.confirm(title + '\n\n' + body)) action();
  }

  async function readJson(response) {
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload && payload.ok === false) {
      var message = payload && payload.error && payload.error.message || payload && payload.error || 'Request failed';
      throw new Error(message);
    }
    return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
  }

  async function deleteWork(item) {
    await readJson(await fetch('/api/work/items?id=' + encodeURIComponent(item.id), { method:'DELETE' }));
    if (typeof loadWorkSurface === 'function') await loadWorkSurface();
  }

  async function deleteProgram(item) {
    var url = '/api/opportunities/programs?id=' + encodeURIComponent(item.id);
    var response = await fetch(url, { method:'DELETE' });
    if (!response.ok) {
      await readJson(await fetch('/api/opportunities/programs', {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ id:item.id, status:'archived' })
      }));
      if (typeof showToast === 'function') showToast('Removed from active Command and archived for history');
    } else {
      await readJson(response);
    }
    if (typeof loadProgramOpportunities === 'function') await loadProgramOpportunities();
    if (typeof loadOpportunityHub === 'function') await loadOpportunityHub();
  }

  async function deleteRevenueOpportunityItem(item) {
    await readJson(await fetch('/api/crm/opportunities?id=' + encodeURIComponent(item.id), { method:'DELETE' }));
    if (typeof loadRevenueCRM === 'function') await loadRevenueCRM();
    if (typeof loadOpportunityHub === 'function') await loadOpportunityHub();
  }

  async function deleteInsight(item) {
    await readJson(await fetch('/api/gmail/intelligence', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ id:item.id, review_status:'dismissed' })
    }));
    if (typeof loadEmailIntelligence === 'function') await loadEmailIntelligence();
  }

  async function deleteCalendarItem(item) {
    if (!item.id) throw new Error('This calendar event does not have a deletable event ID');
    await readJson(await fetch('/api/calendar/delete-event', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ eventId:item.id })
    }));
    if (typeof loadCalendarWeek === 'function') await loadCalendarWeek();
  }

  async function refreshFounderHome() {
    if (typeof founderHomeRender === 'function') founderHomeRender();
  }

  window.commandFounderTodayDelete = function (key) {
    var item = itemStore[key];
    if (!item) return;

    var title = clean(item.title) || 'this item';
    var confirmTitle = 'Delete this item?';
    var confirmBody = 'This removes it from Command. This cannot be undone.';
    if (item.kind === 'insight') confirmBody = 'This removes the Command email item. The original Gmail message will stay in Gmail.';
    if (item.kind === 'calendar') confirmBody = 'This deletes the event from Google Calendar.';
    if (item.kind === 'program') confirmBody = 'This removes the program opportunity from active Command. If it has linked Work, Command will archive it instead of destroying the history.';

    confirmAction(confirmTitle, title + '\n\n' + confirmBody, async function () {
      try {
        if (item.kind === 'work') await deleteWork(item);
        else if (item.kind === 'program') await deleteProgram(item);
        else if (item.kind === 'opportunity') await deleteRevenueOpportunityItem(item);
        else if (item.kind === 'insight') await deleteInsight(item);
        else if (item.kind === 'calendar') await deleteCalendarItem(item);
        else throw new Error('This item type cannot be deleted yet');

        delete itemStore[key];
        if (typeof showToast === 'function') showToast('Deleted from Command');
        await refreshFounderHome();
      } catch (error) {
        if (typeof showToast === 'function') showToast(error.message || 'Could not delete item', true);
        else window.alert(error.message || 'Could not delete item');
      }
    });
  };

  function installStyles() {
    if (document.getElementById('founder-home-controls-style')) return;
    var style = document.createElement('style');
    style.id = 'founder-home-controls-style';
    style.textContent = [
      '.founder-today-item-shell{position:relative;border-bottom:1px solid var(--color-gray-light);padding:0;}',
      '.founder-today-item-shell:last-of-type{border-bottom:0;}',
      '.founder-today-item-shell .founder-today-item{width:100%;padding-right:72px;border-bottom:0;}',
      '.founder-today-delete{position:absolute;right:8px;top:10px;border:0;background:transparent;color:var(--color-red);font:600 11px var(--font-primary);padding:5px 6px;cursor:pointer;border-radius:6px;}',
      '.founder-today-delete:hover{background:#FDECEA;}',
      '.founder-today-view-all{margin-top:12px;}',
      '.founder-content-community-link{display:inline-flex;align-items:center;justify-content:center;padding:8px 14px;border:1px solid var(--color-gray-mid);border-radius:100px;background:var(--color-white);color:var(--color-navy);font:600 12px var(--font-primary);text-decoration:none;}',
      '.founder-content-community-link:hover{background:var(--color-gray-light);}',
      '@media(max-width:720px){.founder-today-item-shell .founder-today-item{padding-right:64px}.founder-today-delete{right:4px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function installContentDeskLink() {
    if (document.getElementById('command-content-community-link')) return;
    var ops = document.querySelector('.founder-ops-links');
    if (!ops) return;
    var link = document.createElement('a');
    link.id = 'command-content-community-link';
    link.className = 'founder-content-community-link';
    link.href = '/content-community.html';
    link.textContent = 'Content & Community';
    link.setAttribute('aria-label', 'Open Content and Community Desk');
    ops.insertBefore(link, ops.firstChild);
  }

  function install() {
    installAttempts += 1;
    installStyles();
    installContentDeskLink();
    if (typeof founderHomeRenderList !== 'function' || typeof founderHomeRender !== 'function') {
      if (installAttempts < 60) setTimeout(install, 200);
      return;
    }
    if (founderHomeRenderList.__commandFounderControls) return;

    var enhanced = function (id, countId, rows, empty) {
      var el = document.getElementById(id);
      var count = document.getElementById(countId);
      if (!el) return;
      var list = Array.isArray(rows) ? rows : [];
      if (count) count.textContent = list.length ? String(list.length) : '';
      var isExpanded = Boolean(expanded[id]);
      var visible = isExpanded ? list : list.slice(0, 5);
      var html = visible.length ? visible.map(renderItem).join('') : '<div class="founder-home-empty">' + escapeHtml(empty) + '</div>';
      if (list.length > 5) {
        html += '<button type="button" class="founder-today-view-all" onclick="commandFounderTodayToggle(\'' + id + '\')">' + (isExpanded ? 'Show less' : 'View all (' + list.length + ')') + '</button>';
      }
      el.innerHTML = html;
    };
    enhanced.__commandFounderControls = true;
    founderHomeRenderList = enhanced;
    setTimeout(function () { try { founderHomeRender(); installContentDeskLink(); } catch (_) {} }, 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(install, 150); });
  else setTimeout(install, 150);
})();
