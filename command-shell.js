/* Command shell: side menu, one page per area, Today, Money, Calm mode, themes.
   Existing panels keep their own loaders; the shell only decides which page shows them. */
(function () {
  'use strict';

  var THEME_KEY = 'atara-command.theme';
  var PAGE_KEY = 'atara-command.page';
  var CALM_SKIP_KEY = 'atara-command.calm-skipped';

  var ALL_PAGES = [
    { id: 'today', label: 'Today', icon: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>', panels: ['cmd-today'] },
    { id: 'email', label: 'Email', icon: '<rect x="3" y="5" width="18" height="14" rx="2.5"></rect><path d="m4 7 8 6 8-6"></path>', panels: ['cmd-email'] },
    { id: 'updates', label: 'Updates', icon: '<path d="M6 3h9l3 3v15H6z"></path><path d="M9 10h6M9 14h6M9 18h3"></path>', panels: ['cmd-updates'] },
    { id: 'people', label: 'People', icon: '<circle cx="9" cy="8" r="3.5"></circle><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"></path><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.4 3.5 5.2"></path>', panels: ['cmd-people', 'panel-relationship-desk', 'panel-email-desk', 'panel-contacts-full', 'panel-email-intelligence', 'panel-weekly-review', 'panel-audience'] },
    { id: 'partnerships', label: 'Partnerships', icon: '<path d="M3 21h18M5 21V7l7-4 7 4v14"></path><path d="M9 21v-5h6v5M9 10h.01M15 10h.01"></path>', panels: ['cmd-partnerships', 'panel-opportunity-hub', 'panel-revenue-crm'] },
    { id: 'funding', label: 'Funding', icon: '<path d="M12 2v20M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>', panels: ['cmd-funding'] },
    { id: 'work', label: 'Work', icon: '<path d="M9 6h11M9 12h11M9 18h11"></path><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"></path>', panels: ['cmd-work', 'panel-focus', 'panel-projects', 'panel-actions', 'panel-tickler', 'panel-ai-team'] },
    { id: 'calendar', label: 'Calendar', icon: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"></rect><path d="M3 9.5h18M8 2.5v4M16 2.5v4"></path>', panels: ['panel-calendar'] },
    { id: 'money', label: 'Money', icon: '<rect x="2.5" y="6" width="19" height="13" rx="2.5"></rect><path d="M2.5 10h19M7 15h3"></path>', panels: ['cmd-money'] },
    { id: 'news', label: 'News & Notes', icon: '<path d="M4 5h16v11H8l-4 4z"></path><path d="M8 9h8M8 12h5"></path>', panels: ['cmd-news', 'panel-intelligence', 'panel-knowledge', 'panel-prompt-library', 'panel-morning-brief'] }
  ];
  // Areas the founder switched off in setup stay out of the menu.
  var settings = window.CommandSettings;
  var PAGES = ALL_PAGES.filter(function (p) { return !settings || settings.moduleOn(p.id); });

  var state = { page: 'today', finance: null, financeLoadedAt: 0 };

  function $(id) { return document.getElementById(id); }
  // Some Command data lives in top-level let bindings, which are shared by name across scripts but are not window properties.
  function calendarEvents() { try { return typeof calEvents !== 'undefined' && Array.isArray(calEvents) ? calEvents : []; } catch (e) { return []; } }
  function allContacts() { try { return typeof cmdAllContacts !== 'undefined' && Array.isArray(cmdAllContacts) ? cmdAllContacts : []; } catch (e) { return []; } }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; } return null; }
  function money(value) { var n = Number(value || 0); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
  function money2(value) { var n = Number(value || 0); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function easternDay(date) { return new Date(date).toLocaleDateString('en-CA', { timeZone: (globalThis.CMD_TZ || 'America/New_York') }); }
  function icon(paths) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>'; }
  function monthLabel(month) { var parts = String(month || '').split('-'); var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1); return isNaN(d) ? month : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }

  /* ---------- Theme ---------- */
  function applyTheme(name) {
    var theme = name === 'sea' ? 'sea' : 'rooftop';
    document.documentElement.setAttribute('data-theme', theme);
    store(THEME_KEY, theme);
    document.querySelectorAll('.cmd-swatch').forEach(function (btn) { btn.setAttribute('aria-pressed', btn.dataset.theme === theme ? 'true' : 'false'); });
  }
  applyTheme(store(THEME_KEY) || 'rooftop');

  /* ---------- Sidebar ---------- */
  function buildSidebar() {
    var inner = $('app-inner'); var main = inner && inner.querySelector('main');
    if (!inner || !main || $('cmd-sidebar')) return;
    var nav = document.createElement('nav');
    var paintDate = function () { var d = $('cmd-today-date'); if (d) d.textContent = 'Today is ' + new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: (globalThis.CMD_TZ || 'America/New_York') }); };
    setTimeout(paintDate, 0); setInterval(paintDate, 60000);
    nav.id = 'cmd-sidebar'; nav.className = 'cmd-sidebar'; nav.setAttribute('aria-label', 'Command');
    nav.innerHTML = '<div class="cmd-brand" data-app-name>' + esc(settings ? settings.appName() : 'Command') + '</div>' +
      '<div id="cmd-today-date" style="margin:-4px 0 14px;font-size:13px;font-weight:600;color:var(--color-body,#3b3b3b)"></div>' +
      PAGES.map(function (p) {
        return '<button type="button" class="cmd-nav-link" data-page="' + p.id + '"><span class="cmd-nav-label">' + icon(p.icon) + esc(p.label) + '</span><span class="cmd-badge" id="cmd-badge-' + p.id + '"></span></button>';
      }).join('') +
      '<div class="cmd-side-spacer"></div>' +
      '<button type="button" class="cmd-river" id="cmd-river-btn">' + icon('<path d="M3 12c3-4 6-4 9 0s6 4 9 0"></path><path d="M3 17c3-4 6-4 9 0s6 4 9 0"></path>') + 'Ask River</button>' +
      '<div class="cmd-side-small">' +
        '<button type="button" class="cmd-chip-btn" id="cmd-calm-btn">Calm mode</button>' +
        '<button type="button" class="cmd-chip-btn" id="cmd-refresh-btn">Refresh</button>' +
        '<button type="button" class="cmd-chip-btn" id="cmd-signout-btn">Sign out</button>' +
      '</div>' +
      '<div class="cmd-theme-row"><span>Theme</span>' +
        '<button type="button" class="cmd-swatch rooftop" data-theme="rooftop" aria-label="Rooftop Sunrise theme"></button>' +
        '<button type="button" class="cmd-swatch sea" data-theme="sea" aria-label="Sea Sunrise theme"></button>' +
      '</div>';
    inner.insertBefore(nav, main);
    nav.addEventListener('click', function (event) {
      var link = event.target.closest('.cmd-nav-link'); if (link) { showPage(link.dataset.page); return; }
      var swatch = event.target.closest('.cmd-swatch'); if (swatch) { applyTheme(swatch.dataset.theme); return; }
    });
    $('cmd-river-btn').addEventListener('click', function () { var b = $('talk-to-river-btn'); if (b) b.click(); });
    $('cmd-calm-btn').addEventListener('click', function () { openCalm(); });
    $('cmd-refresh-btn').addEventListener('click', function () { var b = $('command-refresh'); if (b) b.click(); state.financeLoadedAt = 0; renderAll(); });
    $('cmd-signout-btn').addEventListener('click', function () { var b = $('command-sign-out-btn'); if (b) b.click(); });
    applyTheme(store(THEME_KEY) || 'rooftop');
  }

  /* ---------- Page sections the shell owns ---------- */
  function section(id, html) {
    var el = $(id); if (el) return el;
    el = document.createElement('section'); el.id = id; el.className = 'cmd-page-section'; el.innerHTML = html;
    var main = document.querySelector('#app-inner main'); main.insertBefore(el, main.firstChild);
    return el;
  }

  function buildSections() {
    var main = document.querySelector('#app-inner main'); if (!main) return;
    section('cmd-news', '<div class="cmd-page-head"><div><div class="cmd-kicker">What is happening around your businesses</div><h1 class="cmd-h1">News &amp; Notes</h1></div>' +
      '<div class="cmd-head-actions"><button type="button" class="cmd-chip-btn" data-cmd-action="refresh-news">Check news now</button></div></div>' +
      '<div class="cmd-card" style="margin-bottom:22px"><div class="cmd-card-head"><h2 class="cmd-h2">Meeting notes from Granola</h2></div><div class="cmd-area-copy">Your Granola meeting notes land here and on each person in People once the Granola API key is connected. Granola API access comes with its Business plan.</div></div>');
    section('cmd-email', '<div class="cmd-page-head"><div><div class="cmd-kicker">What your inbox needs from you</div><h1 class="cmd-h1">Email</h1></div></div>' +
      '<div id="cmd-emailpage-body"></div>');
    section('cmd-updates', '<div class="cmd-page-head"><div><div class="cmd-kicker">What happened, and who gets to know</div><h1 class="cmd-h1">Updates</h1></div>' +
      '<div class="cmd-head-actions"><button type="button" class="cmd-chip-btn" data-cmd-action="review-month">Month in review</button><button type="button" class="cmd-primary-btn" data-cmd-action="review-week">Week in review</button></div></div>' +
      '<div id="cmd-updates-body"></div>');
    section('cmd-money', '<div class="cmd-page-head"><div><div class="cmd-kicker">Bookkeeping and runway</div><h1 class="cmd-h1">Money</h1></div>' +
      '</div><div id="cmd-money-body"><div class="cmd-empty">Loading your books...</div></div>');
    section('cmd-funding', '<div class="cmd-page-head"><div><div class="cmd-kicker">Grants, programs and applications</div><h1 class="cmd-h1">Funding</h1></div>' +
      '<div class="cmd-head-actions"><button type="button" class="cmd-chip-btn" data-cmd-action="programs">Program Opportunities</button>' +
      '<a class="cmd-primary-btn" style="display:inline-flex;align-items:center;text-decoration:none" href="/applications.html">Open Funding Hub</a></div></div>' +
      '<div class="cmd-stats" id="cmd-funding-stats"></div>' +
      '<div class="cmd-grid-2"><div class="cmd-card"><div class="cmd-card-head"><h2 class="cmd-h2">Coming up</h2><span class="cmd-count">Deadlines and follow-ups</span></div><div id="cmd-funding-upcoming"></div></div>' +
      '<div class="cmd-card"><div class="cmd-card-head"><h2 class="cmd-h2">Waiting to hear back</h2></div><div id="cmd-funding-waiting"></div></div></div>' +
      '<div class="cmd-card" style="margin-top:22px"><div class="cmd-card-head"><h2 class="cmd-h2">What we got</h2><span class="cmd-count">Programs, grants and credits we were accepted into</span></div><div id="cmd-funding-won"></div></div>' +
      '<h2 class="cmd-section-title">Funding Hub</h2><div class="cmd-areas">' +
        contentCard('/applications.html', 'Options', 'Programs worth a look, ranked by fit, value and effort.') +
        contentCard('/applications.html', 'Chosen to apply', 'Applications in progress with questions, facts and documents.') +
        contentCard('/applications.html', 'Submitted and history', 'Everything sent, with outcomes and dates.') +
        contentCard('/applications.html', 'Document vault', 'Budgets, pitch materials and reusable answers.') +
      '</div>');
    section('cmd-partnerships', '<div class="cmd-page-head"><div><div class="cmd-kicker">Organizations, partners and deals</div><h1 class="cmd-h1">Partnerships</h1></div></div>');
    section('cmd-work', '<div class="cmd-page-head"><div><div class="cmd-kicker">Projects, tasks, tickler and calendar</div><h1 class="cmd-h1">Work</h1></div><div id="cmd-work-today" style="font-size:18px;font-weight:700;color:var(--color-navy);align-self:center"></div></div>' +
      '<div class="cmd-card" style="margin-bottom:22px"><div class="cmd-card-head"><h2 class="cmd-h2">LinkedIn</h2><span class="cmd-count" id="cmd-li-count"></span>' +
      '<button type="button" class="cmd-primary-btn" style="margin-left:auto" data-cmd-action="reply-help">Reply help</button></div>' +
      '<div class="cmd-help" style="margin:-4px 0 10px;font-size:13px;color:var(--color-gray-text)">People waiting on a LinkedIn reply. Tap Reply help, add a screenshot of the chat, and copy the reply you like.</div>' +
      '<div id="cmd-li-list"></div></div>' +
      '<div id="cmd-linkedin-posts"></div>');
    section('cmd-people', '<div class="cmd-page-head"><div><div class="cmd-kicker">Relationships, email and pipeline</div><h1 class="cmd-h1">People</h1></div>' +
      '<div class="cmd-head-actions"><button type="button" class="cmd-primary-btn" data-cmd-action="add-person">Add a person</button></div></div>');
    section('cmd-today', '<div class="cmd-page-head"><div><div class="cmd-kicker" id="cmd-today-date"></div><h1 class="cmd-h1" id="cmd-today-greeting">Hello</h1></div>' +
      '<div class="cmd-head-actions"><button type="button" class="cmd-chip-btn" data-cmd-action="add-update">Add an update</button><button type="button" class="cmd-chip-btn" data-cmd-action="calm">Calm mode</button><button type="button" class="cmd-chip-btn" data-cmd-action="add-work">Add something</button><button type="button" class="cmd-chip-btn" data-cmd-action="reply-help">Reply help</button><button type="button" class="cmd-chip-btn" data-cmd-action="go-know">Know it</button><button type="button" class="cmd-chip-btn" data-cmd-action="go-setup">Setup</button><button type="button" class="cmd-chip-btn" data-cmd-action="card-scan">Business card</button><button type="button" class="cmd-chip-btn" data-cmd-action="add-funding">Add funding</button></div></div>' +
      '<div id="cmd-today-headsup"></div>' +
      '<div id="cmd-today-hero"></div>' +
      '<div class="cmd-grid-2"><div class="cmd-card"><div class="cmd-card-head"><h2 class="cmd-h2">Do today</h2><span class="cmd-count" id="cmd-do-count"></span></div><div id="cmd-do-list"></div><button type="button" class="cmd-link" data-cmd-page="work">See all work</button></div>' +
      '<div class="cmd-stack"><div class="cmd-card"><div class="cmd-card-head"><h2 class="cmd-h2">Calendar today</h2></div><div id="cmd-cal-list"></div></div>' +
      '<div class="cmd-card"><div class="cmd-card-head"><h2 class="cmd-h2">Waiting on others</h2></div><div id="cmd-wait-list"></div></div></div></div>' +
      '<h2 class="cmd-section-title">Your areas</h2><div class="cmd-areas" id="cmd-area-cards"></div>');

    main.addEventListener('click', function (event) {
      var go = event.target.closest('[data-cmd-page]'); if (go) { showPage(go.dataset.cmdPage); return; }
      var action = event.target.closest('[data-cmd-action]'); if (!action) return;
      var name = action.dataset.cmdAction;
      if (name === 'calm') openCalm();
      else if (name === 'add-work' && typeof window.openPanel === 'function') window.openPanel('add-action-panel');
      // Opens the phone camera. The card is read and the details fill in for review before anything is saved.
      // A grant or program she heard about: the Funding Hub opens with the quick add box ready.
      else if (name === 'reply-help') { if (window.CommandReplyHelp) window.CommandReplyHelp.open(); }
      else if (name === 'li-done') { if (typeof window.updateWorkItem === 'function') window.updateWorkItem(action.dataset.id, { status: 'done' }); }
      else if (name === 'go-know') { window.location.href = '/know.html'; }
      else if (name === 'go-setup') { window.location.href = '/setup.html'; }
      else if (name === 'add-funding') { window.location.href = '/applications.html?add=1'; }
      else if (name === 'card-scan') { var cardInput = document.getElementById('cmd-card-quick-input'); if (cardInput) cardInput.click(); }
      else if (name === 'add-person') { var b = $('command-add-person-btn'); if (b) b.click(); }
      else if (name === 'programs' && typeof window.openProgramOpportunitiesAdmin === 'function') window.openProgramOpportunitiesAdmin();
      else if (name === 'refresh-news' && typeof window.refreshIntelligence === 'function') window.refreshIntelligence();
      else if (name === 'open-item') openItem(action.dataset.key);
      else if (name === 'open-program' && typeof window.openProgramOpportunityById === 'function') window.openProgramOpportunityById(action.dataset.id);
      else if (name === 'later-item') { skipItem(action.dataset.key); renderToday(); }
      else if (name === 'remove-item') { removeItem(action.dataset.key); }
      else if (name === 'add-update') { showPage('updates'); if (window.CommandUpdates) window.CommandUpdates.open(true); }
      else if (name === 'review-week' && window.CommandUpdates) window.CommandUpdates.week();
      else if (name === 'review-month' && window.CommandUpdates) window.CommandUpdates.month();
    });
  }

  function contentCard(href, title, copy) {
    return '<a class="cmd-area" style="text-decoration:none" href="' + href + '"><div class="cmd-area-top"><span class="cmd-area-name">' + esc(title) + '</span></div><div class="cmd-area-copy">' + esc(copy) + '</div></a>';
  }

  /* ---------- Page switching ---------- */
  // Put each page's panels in the order the page lists them.
  function orderPanels() {
    var main = document.querySelector('#app-inner main'); if (!main) return;
    PAGES.forEach(function (page) {
      page.panels.forEach(function (id) {
        var el = $(id); if (!el) return;
        var top = el; while (top.parentElement && top.parentElement !== main) top = top.parentElement;
        if (top.parentElement === main) main.appendChild(top);
      });
    });
  }

  function pageOf(id) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].panels.indexOf(id) !== -1) return PAGES[i].id;
    return null;
  }

  function markPanels() {
    var main = document.querySelector('#app-inner main'); if (!main) return;
    Array.prototype.forEach.call(main.querySelectorAll('.cmd-on, .cmd-wrap'), function (el) { el.classList.remove('cmd-on', 'cmd-wrap'); });
    var page = PAGES.filter(function (p) { return p.id === state.page; })[0] || PAGES[0];
    page.panels.forEach(function (id) {
      var el = $(id); if (!el) return;
      el.classList.add('cmd-on');
      var top = el; while (top.parentElement && top.parentElement !== main) top = top.parentElement;
      if (top !== el && top.parentElement === main) top.classList.add('cmd-on', 'cmd-wrap');
    });
  }

  function showPage(id, options) {
    if (!PAGES.some(function (p) { return p.id === id; })) id = 'today';
    state.page = id; store(PAGE_KEY, id);
    document.querySelectorAll('.cmd-nav-link').forEach(function (link) { if (link.dataset.page === id) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    markPanels();
    if (!(options && options.keepScroll)) window.scrollTo({ top: 0 });
    if (id === 'today') renderToday();
    if (window.CommandHeadsUp) window.CommandHeadsUp.render();
    if (id === 'money') renderMoney();
    if (id === 'funding') renderFunding();
    if (id === 'work') renderLinkedIn();
    if (id === 'work' && window.CommandLinkedIn && (!settings || settings.moduleOn('linkedin'))) window.CommandLinkedIn.open();
    if (id === 'updates' && window.CommandUpdates) window.CommandUpdates.open();
    if (id === 'email' && window.CommandEmail) window.CommandEmail.open();
    if (id === 'people' && typeof window.loadNewsletterAudience === 'function' && !state.audienceLoaded) { state.audienceLoaded = true; window.loadNewsletterAudience(); }
  }

  function goToPanel(id) {
    var page = pageOf(id);
    if (!page) { var el = $(id); var holder = el; while (holder && !page) { page = pageOf(holder.id); holder = holder.parentElement; } }
    showPage(page || state.page, { keepScroll: true });
    var target = $(id); if (target) setTimeout(function () { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
  }

  /* ---------- Today ---------- */
  // Things removed from Today stay gone on every device.
  var hiddenKeys = [];
  function loadHidden() { return fetch('/api/today/hidden', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (p) { if (p && Array.isArray(p.data)) { hiddenKeys = p.data; renderToday(); } }).catch(function () {}); }
  function removeItem(key) {
    var item = lastItems.filter(function (i) { return i.key === key; })[0];
    if (hiddenKeys.indexOf(key) === -1) hiddenKeys.push(key);
    renderToday();
    fetch('/api/today/hidden', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key, title: item ? item.title : '' }) }).catch(function () {});
  }
  function skipped() { try { var raw = JSON.parse(sessionStorage.getItem(CALM_SKIP_KEY) || '{}'); return raw.day === easternDay(new Date()) ? raw.keys || [] : []; } catch (e) { return []; } }
  function skipItem(key) { var keys = skipped(); if (keys.indexOf(key) === -1) keys.push(key); try { sessionStorage.setItem(CALM_SKIP_KEY, JSON.stringify({ day: easternDay(new Date()), keys: keys })); } catch (e) {} }

  var AREA_BY_KIND = { work: 'Work', program: 'Grants', opportunity: 'Pipeline', email: 'Email', insight: 'Email', calendar: 'Calendar', contact: 'People', draft: 'Email draft' };

  function attentionModel() {
    if (!window.AtaraAttention) return { NEEDS_ME_NOW: [], WAITING_WATCH: [] };
    try {
      return window.AtaraAttention.build({ work: window.workItems || [], programs: window.programOpportunities || [], opportunities: window.opportunityHubRows || [], emails: window.emailInsights || [], calendar: calendarEvents(), now: new Date() });
    } catch (e) { return { NEEDS_ME_NOW: [], WAITING_WATCH: [] }; }
  }

  function draftItems() {
    var rows = Array.isArray(window.emailDeskRows) ? window.emailDeskRows : [];
    return rows.filter(function (d) { return d.status === 'needs_review' || d.status === 'needs_update'; }).map(function (d) {
      var who = d.to_name || d.to_email || 'a contact';
      var subject = d.subject || 'Draft email';
      return { kind: 'draft', id: d.id, key: 'draft:' + d.id, title: 'Review email: ' + subject, meta: 'To ' + who + ' · waits for your approval' };
    });
  }

  function todayItems() {
    var model = attentionModel();
    var seen = {}; var skip = skipped();
    var needs = (model.NEEDS_ME_NOW || []).map(function (item) {
      return { kind: item.kind, id: item.id, key: item.dedupe_key || (item.kind + ':' + item.id), title: item.title || 'Untitled', meta: [AREA_BY_KIND[item.kind] || '', item.reason || item.meta || ''].filter(Boolean).join(' · '), raw: item };
    });
    // The founder's own to-dos come first. Emails waiting for approval are one line, so a big batch never buries them.
    var drafts = draftItems().filter(function (d) { return skip.indexOf(d.key) === -1 && hiddenKeys.indexOf(d.key) === -1; });
    var draftRow = drafts.length > 1 ? [{ kind: 'drafts', id: 'all', key: 'drafts:all', title: drafts.length + ' emails to approve', meta: 'Each one waits for your approval' }] : drafts;
    var mine = needs.filter(function (i) { return i.kind === 'work'; });
    var items = mine.concat(draftRow, needs.filter(function (i) { return i.kind !== 'work'; }));
    return {
      all: items.filter(function (item) { if (seen[item.key]) return false; seen[item.key] = true; return true; }).filter(function (item) { return skip.indexOf(item.key) === -1 && hiddenKeys.indexOf(item.key) === -1; }),
      waiting: (model.WAITING_WATCH || []).slice(0, 4)
    };
  }

  var lastItems = [];
  function openItem(key) {
    var item = lastItems.filter(function (i) { return i.key === key; })[0]; if (!item) return;
    closeCalm();
    if (item.kind === 'draft') { goToPanel('panel-email-desk'); if (typeof window.openEmailDraft === 'function') window.openEmailDraft(item.id); return; }
    if (item.kind === 'drafts') { goToPanel('panel-email-desk'); return; }
    if (item.kind === 'work') showPage('work');
    if (typeof window.founderTodayOpen === 'function' && item.raw) window.founderTodayOpen(item.raw);
  }

  function rowHtml(item, index) {
    return '<div class="cmd-row"><span class="cmd-num">' + (index + 1) + '</span><div class="cmd-row-main"><div class="cmd-row-title">' + esc(item.title) + '</div><div class="cmd-row-meta">' + esc(item.meta) + '</div></div>' +
      '<button type="button" class="cmd-open" data-cmd-action="open-item" data-key="' + esc(item.key) + '">Open</button>' +
      '<button type="button" class="cmx-icon-btn" data-cmd-action="remove-item" data-key="' + esc(item.key) + '" aria-label="Remove" title="Remove">&times;</button></div>';
  }

  function renderToday() {
    var dateEl = $('cmd-today-date'); if (!dateEl) return;
    var now = new Date();
    dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: (globalThis.CMD_TZ || 'America/New_York') });
    var hour = Number(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: (globalThis.CMD_TZ || 'America/New_York') }));
    $('cmd-today-greeting').textContent = (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening') + ', ' + (settings ? settings.firstName() : 'there');

    var model = todayItems(); var items = model.all; lastItems = items;
    var first = items[0];
    $('cmd-today-hero').innerHTML = first
      ? '<section class="cmd-hero" aria-label="Your next step"><div class="cmd-hero-text"><div class="cmd-hero-label">Your next step</div><div class="cmd-hero-title">' + esc(first.title) + '</div><div class="cmd-hero-body">' + esc(first.meta) + '</div></div>' +
        '<div class="cmd-hero-actions"><button type="button" class="cmd-btn-sun" data-cmd-action="open-item" data-key="' + esc(first.key) + '">Open</button><button type="button" class="cmd-btn-light" data-cmd-action="later-item" data-key="' + esc(first.key) + '">Later</button></div></section>'
      : '<section class="cmd-hero" aria-label="Your next step"><div class="cmd-hero-text"><div class="cmd-hero-label">Your next step</div><div class="cmd-hero-title">You are clear right now</div><div class="cmd-hero-body">Nothing needs a decision. Pick a project in Work or take a breath.</div></div></section>';

    var five = items.slice(0, 5);
    $('cmd-do-count').textContent = items.length ? five.length + ' of ' + items.length : '';
    $('cmd-do-list').innerHTML = five.length ? five.map(rowHtml).join('') : '<div class="cmd-empty">Nothing waiting on you today.</div>';

    var today = easternDay(now);
    var events = calendarEvents().map(function (e, i) { return { e: e, i: i, start: e && e.start ? new Date(e.start) : null }; })
      .filter(function (row) { return row.start && !isNaN(row.start) && easternDay(row.start) === today; })
      .sort(function (a, b) { return a.start - b.start; });
    $('cmd-cal-list').innerHTML = events.length ? events.slice(0, 6).map(function (row) {
      var time = row.e.allDay ? 'All day' : row.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: (globalThis.CMD_TZ || 'America/New_York') });
      return '<div class="cmd-row"><span class="cmd-time">' + esc(time) + '</span><div class="cmd-row-main"><div class="cmd-row-title" style="font-weight:500">' + esc(row.e.title || 'Event') + '</div></div></div>';
    }).join('') : '<div class="cmd-empty">Your calendar is open today.</div>';

    $('cmd-wait-list').innerHTML = model.waiting.length ? model.waiting.map(function (item) {
      return '<div class="cmd-row"><div class="cmd-row-main"><div class="cmd-row-title" style="font-weight:500">' + esc(item.title || 'Waiting') + '</div><div class="cmd-row-meta">' + esc(item.reason || item.meta || '') + '</div></div></div>';
    }).join('') : '<div class="cmd-empty">Nothing is waiting on anyone else.</div>';

    renderAreas(items);
    renderBadges(items);
    ensureFinance();
  }

  function renderAreas(items) {
    var el = $('cmd-area-cards'); if (!el) return;
    var drafts = draftItems().length;
    var contacts = allContacts();
    var today = easternDay(new Date());
    var followUps = contacts.filter(function (c) { return c.followupDueDate && String(c.followupDueDate).slice(0, 10) <= today; }).length;
    var work = Array.isArray(window.workItems) ? window.workItems.filter(function (w) { return w.status !== 'done' && w.status !== 'cancelled'; }) : [];
    var overdue = work.filter(function (w) { return w.due_at && easternDay(w.due_at) < today; }).length;
    var s = state.finance && state.finance.summary;
    el.innerHTML =
      areaCard('people', 'People', drafts ? drafts + ' to approve' : followUps ? followUps + ' follow-ups' : contacts.length + ' contacts', drafts > 0 || followUps > 0, 'Relationships, email drafts and follow-ups in one place.') +
      areaCard('partnerships', 'Partnerships', 'Organizations', false, 'Partners, consulting, subcontracting and deals with organizations.') +
      areaCard('funding', 'Funding', fundingPill(), fundingSoon() > 0, 'Grants, programs and applications, with deadlines first.') +
      areaCard('work', 'Work', work.length + ' open', overdue > 0, overdue ? overdue + ' past their date. Pick what still matters.' : 'Projects and tickler.') +
      // Today never shows dollar amounts, so Command is safe to open around other people. Amounts live on the Money page.
      (settings && !settings.moduleOn('money') ? '' : areaCard('money', 'Money', s && s.missing_evidence ? s.missing_evidence + ' receipts' : 'Books', !!(s && s.missing_evidence), 'Cash, runway and receipts live on the Money page.'));
  }

  function fundingSoon() {
    var soon = Date.now() + 14 * 86400000;
    return programs().filter(function (p) { return OPEN_PROGRAM.indexOf(p.status) !== -1 && p.deadline_at && new Date(p.deadline_at).getTime() <= soon && new Date(p.deadline_at).getTime() >= Date.now() - 86400000; }).length;
  }
  function fundingPill() { var n = fundingSoon(); return n ? n + ' due soon' : programs().filter(function (p) { return WAITING_PROGRAM.indexOf(p.status) !== -1; }).length + ' waiting'; }

  function areaCard(page, name, pill, attention, copy) {
    return '<button type="button" class="cmd-area" data-cmd-page="' + page + '"><span class="cmd-area-top"><span class="cmd-area-name">' + esc(name) + '</span><span class="cmd-pill' + (attention ? ' attention' : '') + '">' + esc(pill) + '</span></span><span class="cmd-area-copy">' + esc(copy) + '</span></button>';
  }

  function renderBadges(items) {
    var drafts = draftItems().length;
    var set = function (id, n) { var el = $('cmd-badge-' + id); if (el) el.textContent = n > 0 ? String(n) : ''; };
    set('today', items.length);
    set('people', drafts);
  }

  /* ---------- LinkedIn (on Work) ---------- */
  function linkedInName(title) { return String(title || '').replace(/^Reply (to |on LinkedIn:\s*)/i, '').replace(/\s+on LinkedIn$/i, '').trim(); }
  function renderWorkDate() { var el = $('cmd-work-today'); if (el) el.textContent = 'Today is ' + new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: (globalThis.CMD_TZ || 'America/New_York') }); }
  function renderLinkedIn() {
    renderWorkDate();
    var list = $('cmd-li-list'); if (!list) return;
    // The founder's own work comes first on the Work page; LinkedIn sits under it.
    var liCard = list.closest('.cmd-card'), actions = $('panel-actions');
    if (liCard && actions && !liCard.dataset.moved) { liCard.dataset.moved = '1'; liCard.style.gridColumn = '1 / -1'; liCard.style.marginTop = '22px'; actions.insertAdjacentElement('afterend', liCard); }
    var rows = (Array.isArray(window.workItems) ? window.workItems : []).filter(function (w) { return w.status !== 'done' && w.status !== 'cancelled' && /linkedin/i.test(w.title || ''); })
      .sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
    var count = $('cmd-li-count'); if (count) count.textContent = rows.length ? rows.length + ' waiting' : '';
    list.innerHTML = rows.length ? rows.map(function (w) {
      return '<div class="cmd-row"><div class="cmd-row-main"><div class="cmd-row-title">' + esc(linkedInName(w.title)) + '</div><div class="cmd-row-meta">' + esc(w.created_at ? 'Messaged ' + shortDate(w.created_at) : 'LinkedIn') + '</div></div>' +
        '<button type="button" class="cmd-open" data-cmd-action="reply-help">Reply help</button>' +
        '<button type="button" class="cmd-open" data-cmd-action="li-done" data-id="' + esc(w.id) + '">Replied</button></div>';
    }).join('') : '<div class="cmd-empty">All caught up on LinkedIn.</div>';
  }
  window.commandRenderLinkedIn = renderLinkedIn;

  /* ---------- Funding ---------- */
  var OPEN_PROGRAM = ['discovered', 'reviewing', 'apply', 'in_progress'];
  var WAITING_PROGRAM = ['submitted', 'awaiting_response', 'interview', 'final_decision'];
  function programs() { return Array.isArray(window.programOpportunities) ? window.programOpportunities.filter(function (p) { return !p.dismissed_at; }) : []; }
  function shortDate(value) { var d = new Date(value); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: (globalThis.CMD_TZ || 'America/New_York') }); }
  function programRow(p, when, label) {
    return '<div class="cmd-row">' + (when ? '<span class="cmd-time">' + esc(shortDate(when)) + '</span>' : '') + '<div class="cmd-row-main"><div class="cmd-row-title">' + esc(p.title) + '</div><div class="cmd-row-meta">' + esc([p.organization, label].filter(Boolean).join(' · ')) + '</div></div>' +
      '<button type="button" class="cmd-open" data-cmd-action="open-program" data-id="' + esc(p.id) + '">Open</button></div>';
  }
  function renderFunding() {
    var stats = $('cmd-funding-stats'); if (!stats) return;
    var all = programs();
    var open = all.filter(function (p) { return OPEN_PROGRAM.indexOf(p.status) !== -1; });
    var chosen = all.filter(function (p) { return p.status === 'apply' || p.status === 'in_progress'; });
    var waiting = all.filter(function (p) { return WAITING_PROGRAM.indexOf(p.status) !== -1; });
    var awarded = all.filter(function (p) { return p.status === 'awarded'; });
    stats.innerHTML = stat('Options to review', String(all.filter(function (p) { return p.status === 'discovered' || p.status === 'reviewing'; }).length), 'Programs worth a look') +
      stat('Applying now', String(chosen.length), 'Chosen to apply') +
      stat('Waiting to hear', String(waiting.length), 'Submitted applications') +
      stat('Awarded', String(awarded.length), 'Wins so far');
    var now = Date.now();
    var upcoming = open.map(function (p) { return { p: p, when: p.deadline_at || p.follow_up_at }; })
      .filter(function (row) { return row.when && new Date(row.when).getTime() >= now - 86400000; })
      .sort(function (a, b) { return new Date(a.when) - new Date(b.when); }).slice(0, 6);
    $('cmd-funding-upcoming').innerHTML = upcoming.length ? upcoming.map(function (row) { return programRow(row.p, row.when, row.p.deadline_at ? 'Deadline' : 'Follow up'); }).join('')
      : (open.length ? open.slice(0, 5).map(function (p) { return programRow(p, null, String(p.status || '').replace(/_/g, ' ')); }).join('') : '<div class="cmd-empty">No open deadlines. Funding Hub has new options when you want them.</div>');
    $('cmd-funding-waiting').innerHTML = waiting.length ? waiting.slice(0, 6).map(function (p) { return programRow(p, p.response_expected_at || p.submitted_at, p.response_expected_at ? 'Answer expected' : 'Submitted'); }).join('')
      : '<div class="cmd-empty">Nothing submitted and waiting right now.</div>';
    var won = awarded.slice().sort(function (a, b) { return new Date(b.decision_at || b.updated_at || 0) - new Date(a.decision_at || a.updated_at || 0); });
    $('cmd-funding-won').innerHTML = won.length ? won.map(function (p) { return programRow(p, p.decision_at, p.amount_text || 'Accepted'); }).join('')
      : '<div class="cmd-empty">Wins show here once a program says yes.</div>';
  }

  /* ---------- Money ---------- */
  function ensureFinance() {
    if (state.financeLoading || (state.finance && Date.now() - state.financeLoadedAt < 60000)) return;
    state.financeLoading = true;
    fetch('/api/finance').then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) { state.finance = d.data; state.financeLoadedAt = Date.now(); }
    }).catch(function () {}).then(function () {
      state.financeLoading = false;
      if (state.page === 'money') drawMoney();
      if (state.page === 'today') renderAreas(lastItems);
    });
  }

  function renderMoney() { state.financeLoadedAt = 0; ensureFinance(); drawMoney(); }

  function drawMoney() {
    var body = $('cmd-money-body'); if (!body) return;
    var f = state.finance; if (!f) { body.innerHTML = '<div class="cmd-empty">Loading your books...</div>'; return; }
    var s = f.summary || {};
    var asOf = s.cash_as_of ? new Date(s.cash_as_of + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'n/a';
    var months = (f.months || []).slice().sort(function (a, b) { return b.month.localeCompare(a.month); });
    body.innerHTML =
      '<div class="cmd-stats">' +
        stat('Cash', money(s.cash_position), 'As of ' + asOf) +
        stat('Monthly spending', money(s.monthly_burn), 'Average of ' + (s.burn_months || []).map(monthLabel).join(', ')) +
        stat('Runway', s.runway_months == null ? 'n/a' : s.runway_months + ' mo', 'Cash divided by monthly spending') +
        stat('Recurring bills', money2(s.committed_monthly), 'Active monthly subscriptions') +
        stat('Receipts to match', String(s.missing_evidence || 0), (s.unreviewed || 0) + ' transactions to review') +
      '</div>' +
      '<div class="cmd-card" style="margin-bottom:22px"><div class="cmd-card-head"><h2 class="cmd-h2">Log money in or out</h2></div>' +
        '<form class="cmd-form" id="cmd-money-form">' +
          '<label class="cmd-field">Type<select name="txn_type"><option value="expense">Money out</option><option value="income">Money in</option></select></label>' +
          '<label class="cmd-field">Date<input name="txn_date" type="date" required value="' + easternDay(new Date()) + '"></label>' +
          '<label class="cmd-field">Who<input name="vendor" type="text" required placeholder="Vendor or payer"></label>' +
          '<label class="cmd-field">Amount<input name="amount" type="number" step="0.01" min="0.01" required placeholder="0.00"></label>' +
          '<label class="cmd-field">Category<input name="category" type="text" placeholder="Software & subscriptions"></label>' +
          '<button type="submit" class="cmd-primary-btn">Save</button>' +
        '</form><div class="cmd-row-meta" id="cmd-money-status" style="margin-top:8px"></div></div>' +
      '<div class="cmd-card" style="margin-bottom:22px"><div class="cmd-card-head"><h2 class="cmd-h2">Month by month</h2><span class="cmd-count">Close a month once its statement is in and every row is reviewed</span></div>' +
        '<div class="cmd-table-wrap"><table class="cmd-table"><thead><tr><th>Month</th><th style="text-align:right">Income</th><th style="text-align:right">Spending</th><th style="text-align:right">Receipts to match</th><th style="text-align:right">To review</th><th>Statement</th><th>Status</th></tr></thead><tbody>' +
        months.map(function (m) {
          return '<tr><td>' + esc(monthLabel(m.month)) + '</td><td class="num">' + money2(m.business_income) + '</td><td class="num">' + money2(m.business_opex) + '</td><td class="num">' + esc(m.missing_evidence) + '</td><td class="num">' + esc(m.unreviewed) + '</td>' +
            '<td><button type="button" class="cmd-toggle" aria-pressed="' + (m.statement_imported ? 'true' : 'false') + '" data-month="' + esc(m.month) + '" data-field="statement_imported">' + (m.statement_imported ? 'Imported' : 'Waiting') + '</button></td>' +
            '<td><button type="button" class="cmd-toggle" aria-pressed="' + (m.closed_at ? 'true' : 'false') + '" data-month="' + esc(m.month) + '" data-field="closed">' + (m.closed_at ? 'Closed' : 'Open') + '</button></td></tr>';
        }).join('') + '</tbody></table></div></div>' +
      '<div class="cmd-grid-2"><div class="cmd-card"><div class="cmd-card-head"><h2 class="cmd-h2">Recent transactions</h2></div><div class="cmd-table-wrap"><table class="cmd-table"><thead><tr><th>Date</th><th>Who</th><th style="text-align:right">Amount</th><th>Receipt</th><th>Reviewed</th></tr></thead><tbody>' +
        (f.recent || []).slice(0, 15).map(function (t) {
          return '<tr><td style="white-space:nowrap">' + esc(t.txn_date) + '</td><td>' + esc(t.vendor || t.description) + '<div class="cmd-row-meta">' + esc(t.category) + '</div></td><td class="num">' + money2(t.amount) + '</td>' +
            '<td>' + (t.evidence_status === 'not_needed' ? '<span class="cmd-row-meta">Skip</span>' : '<button type="button" class="cmd-toggle" aria-pressed="' + (t.evidence_status === 'matched' ? 'true' : 'false') + '" data-txn="' + esc(t.id) + '" data-field="evidence_status">' + (t.evidence_status === 'matched' ? 'Matched' : 'Needed') + '</button>') + '</td>' +
            '<td><button type="button" class="cmd-toggle" aria-pressed="' + (t.reviewed ? 'true' : 'false') + '" data-txn="' + esc(t.id) + '" data-field="reviewed">' + (t.reviewed ? 'Reviewed' : 'Review') + '</button></td></tr>';
        }).join('') + '</tbody></table></div></div>' +
      '<div class="cmd-card"><div class="cmd-card-head"><h2 class="cmd-h2">Recurring bills</h2></div><div class="cmd-table-wrap"><table class="cmd-table"><thead><tr><th>Service</th><th style="text-align:right">Amount</th><th>Status</th></tr></thead><tbody>' +
        (f.recurring || []).map(function (b) {
          return '<tr><td>' + esc(b.vendor) + '<div class="cmd-row-meta">' + esc(b.cadence) + '</div></td><td class="num">' + (b.expected_amount == null ? esc(b.amount_note || 'Varies') : money2(b.expected_amount)) + '</td><td>' + esc(String(b.status || '').replace(/_/g, ' ')) + '</td></tr>';
        }).join('') + '</tbody></table></div></div></div>';
  }

  function stat(label, value, sub) { return '<div class="cmd-stat"><div class="cmd-stat-label">' + esc(label) + '</div><div class="cmd-stat-value">' + esc(value) + '</div><div class="cmd-stat-sub">' + esc(sub) + '</div></div>'; }

  function financeRequest(method, body) {
    return fetch('/api/finance', { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }).then(function (d) { if (!d.ok) throw new Error((d.error && d.error.message) || 'Could not save'); return d.data; });
  }

  function bindMoney() {
    var money = $('cmd-money'); if (!money) return;
    money.addEventListener('submit', function (event) {
      if (event.target.id !== 'cmd-money-form') return;
      event.preventDefault();
      var form = event.target; var status = $('cmd-money-status');
      var data = { txn_type: form.txn_type.value, txn_date: form.txn_date.value, vendor: form.vendor.value.trim(), description: form.vendor.value.trim(), amount: Number(form.amount.value), category: form.category.value.trim() || undefined };
      status.textContent = 'Saving...';
      financeRequest('POST', data).then(function () { status.textContent = 'Saved.'; renderMoney(); }).catch(function (e) { status.textContent = e.message; });
    });
    money.addEventListener('click', function (event) {
      var btn = event.target.closest('.cmd-toggle'); if (!btn) return;
      var on = btn.getAttribute('aria-pressed') !== 'true'; var body;
      if (btn.dataset.month) { body = { month: btn.dataset.month }; body[btn.dataset.field] = on; }
      else { body = { id: btn.dataset.txn }; body[btn.dataset.field] = btn.dataset.field === 'evidence_status' ? (on ? 'matched' : 'missing') : on; }
      btn.disabled = true;
      financeRequest('PATCH', body).then(function () { renderMoney(); }).catch(function (e) { btn.disabled = false; if (typeof window.showToast === 'function') window.showToast(e.message, true); });
    });
  }

  /* ---------- Calm mode ---------- */
  function buildCalm() {
    if ($('cmd-calm')) return;
    var el = document.createElement('div');
    el.id = 'cmd-calm'; el.className = 'cmd-calm'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Calm mode');
    el.innerHTML = '<div class="cmd-calm-top"><span class="cmd-kicker">Calm mode · one thing at a time</span><button type="button" class="cmd-chip-btn" id="cmd-calm-exit">Show full Today</button></div>' +
      '<div class="cmd-calm-center" id="cmd-calm-center"></div><div class="cmd-calm-next" id="cmd-calm-next"></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (event) {
      if (event.target.id === 'cmd-calm-exit') { closeCalm(); return; }
      var btn = event.target.closest('[data-calm]'); if (!btn) return;
      var key = btn.dataset.key; var item = lastItems.filter(function (i) { return i.key === key; })[0];
      if (btn.dataset.calm === 'open') { openItem(key); return; }
      if (btn.dataset.calm === 'done' && item && item.kind === 'work' && typeof window.updateWorkItem === 'function') window.updateWorkItem(item.id, { status: 'done' });
      skipItem(key); drawCalm();
    });
  }

  function drawCalm() {
    var model = todayItems(); lastItems = model.all;
    var first = model.all[0];
    $('cmd-calm-center').innerHTML = first
      ? '<div class="cmd-calm-label">Just this, right now</div><h1 class="cmd-calm-title">' + esc(first.title) + '</h1><p class="cmd-calm-body">' + esc(first.meta) + '</p>' +
        '<div class="cmd-calm-actions"><button type="button" class="go" data-calm="open" data-key="' + esc(first.key) + '">Open it</button><button type="button" data-calm="done" data-key="' + esc(first.key) + '">Done</button><button type="button" data-calm="later" data-key="' + esc(first.key) + '">Not today</button></div>'
      : '<div class="cmd-calm-label">All clear</div><h1 class="cmd-calm-title">Nothing needs you right now</h1><p class="cmd-calm-body">Rest is part of the work.</p>';
    var rest = model.all.length - 1;
    $('cmd-calm-next').textContent = model.all[1] ? 'Up next: ' + model.all[1].title + (rest > 1 ? ' · ' + (rest - 1) + ' more today' : '') : '';
  }

  function openCalm() { buildCalm(); drawCalm(); document.body.classList.add('cmd-calm-on'); var exit = $('cmd-calm-exit'); if (exit) exit.focus(); }
  function closeCalm() { document.body.classList.remove('cmd-calm-on'); if (state.page === 'today') renderToday(); }

  /* ---------- Wiring ---------- */
  function renderAll() { if (state.page === 'today') renderToday(); else if (state.page === 'money') drawMoney(); else if (state.page === 'funding') renderFunding(); renderBadges(todayItems().all); }

  function start() {
    if (!$('app-inner') || document.body.classList.contains('cmd-shell')) return;
    document.body.classList.add('cmd-shell');
    document.body.classList.remove('progressive-home-mode', 'progressive-home-detail', 'low-capacity-mode');
    buildSidebar(); buildSections(); bindMoney();
    // Fresh settings: update the name in the menu and the greeting. A first visit with no setup goes to Setup.
    document.addEventListener('command:settings', function () {
      var brand = document.querySelector('[data-app-name]'); if (brand && settings) brand.textContent = settings.appName();
      if (state.page === 'today') renderToday();
      if (settings && settings.get() && !settings.setupDone() && !/[?&]skip-setup/.test(location.search)) window.location.href = '/setup.html';
    });

    window.scrollToPanel = goToPanel;
    var originalNav = window.mobileNavGo;
    window.mobileNavGo = function (id) {
      if (id === 'top') { showPage('today'); return; }
      if (id === 'prompt-library') { goToPanel('panel-knowledge'); if (typeof window.showPromptLibrary === 'function') window.showPromptLibrary(); return; }
      if (id === 'scout-review' || id === 'panel-program-opportunities') { if (typeof originalNav === 'function') originalNav(id); return; }
      goToPanel(id);
    };
    window.openFounderDetail = goToPanel;
    window.toggleLowCapacity = function (enabled) { if (enabled === undefined) openCalm(); else if (enabled === false) closeCalm(); };
    window.closeFounderDetail = function () { showPage('today'); };
    window.showFullCommand = function () { showPage('today'); };
    try { localStorage.removeItem('atara-command.low-capacity'); } catch (e) {}
    var originalToday = window.founderTodayRender;
    window.founderTodayRender = function () { try { if (typeof originalToday === 'function') originalToday(); } catch (e) {} if (state.page === 'today') renderToday(); };

    var main = document.querySelector('#app-inner main');
    new MutationObserver(function () { markPanels(); }).observe(main, { childList: true });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && document.body.classList.contains('cmd-calm-on')) closeCalm(); });

    orderPanels();
    // Always open on Today so money and other details stay out of view until you choose a page.
    showPage('today');
    loadHidden();
    [2500, 8000].forEach(function (ms) { setTimeout(function () { orderPanels(); markPanels(); }, ms); });
    [1500, 4000, 9000, 20000].forEach(function (ms) { setTimeout(renderAll, ms); });
    setInterval(function () { if (document.visibilityState === 'visible') renderAll(); }, 60000);
    // A sent or changed email leaves Today right away, without waiting for the next minute.
    window.addEventListener('atara:email-desk-loaded', function () { renderAll(); });
  }

  window.CommandShell = window.AtaraShell = { showPage: showPage, goToPanel: goToPanel, openCalm: openCalm, applyTheme: applyTheme, PAGES: PAGES };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
