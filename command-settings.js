/* Founder settings in the browser. Loads first, so every screen can use the founder's name, time zone, brands,
   assistant name and which areas are switched on. A saved copy paints the page right away; fresh settings follow. */
(function (root) {
  'use strict';
  var KEY = 'command.settings';
  var current = null;

  function read() { try { return JSON.parse(root.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(value) { try { root.localStorage.setItem(KEY, JSON.stringify(value)); } catch (e) { /* private window */ } }

  function apply(settings) {
    current = settings || null;
    var zone = current && current.schedule && current.schedule.time_zone;
    if (zone) { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); root.CMD_TZ = zone; } catch (e) { /* unknown zone */ } }
    var first = current && current.founder && (current.founder.first_name || String(current.founder.name || '').split(/\s+/)[0]);
    if (first) root.CMD_FIRST_NAME = first;
    if (typeof document !== 'undefined') {
      var name = api.appName();
      if (document.title && /Command/.test(document.title)) document.title = document.title.replace(/^.*Command/, name);
      document.querySelectorAll('[data-founder-first-name]').forEach(function (el) { el.textContent = root.founderLabel ? root.founderLabel() : api.firstName(); });
      document.querySelectorAll('[data-assistant-name]').forEach(function (el) { el.textContent = api.assistant(); });
      document.querySelectorAll('[data-company-name]').forEach(function (el) { el.textContent = api.company(); });
      document.querySelectorAll('[data-tz-label]').forEach(function (el) { el.textContent = api.tzLabel(); });
      document.querySelectorAll('[data-app-name]').forEach(function (el) { el.textContent = api.appName(); });
      try { document.dispatchEvent(new CustomEvent('command:settings', { detail: current })); } catch (e) { /* old browser */ }
    }
  }

  var api = {
    get: function () { return current; },
    tz: function () { return root.CMD_TZ || 'America/New_York'; },
    tzLabel: function () {
      try { var p = new Intl.DateTimeFormat('en-US', { timeZone: api.tz(), timeZoneName: 'long' }).formatToParts(new Date()); return p.filter(function (x) { return x.type === 'timeZoneName'; })[0].value; } catch (e) { return api.tz(); }
    },
    firstName: function () { var f = (current && current.founder) || {}; return f.first_name || String(f.name || '').split(/\s+/)[0] || 'there'; },
    assistant: function () { return (current && current.assistant && current.assistant.name) || 'River'; },
    company: function () { var c = (current && current.company) || {}; return c.short_name || c.name || 'your company'; },
    appName: function () { var c = (current && current.company) || {}; return (c.short_name || c.name) ? (c.short_name || c.name) + ' Command' : 'Command'; },
    brands: function () { return ((current && current.brands && current.brands.list) || []).filter(function (b) { return b && (b.name || b.code); }); },
    moduleOn: function (key) { var m = (current && current.modules) || {}; return m[key] !== false; },
    setupDone: function () { return Boolean(current && current.completed && current.completed.indexOf('founder') !== -1 && current.completed.indexOf('company') !== -1); },
    load: function () {
      return fetch('/api/settings', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (p) {
        if (p && p.ok && p.data && p.data.settings) { write(p.data.settings); apply(p.data.settings); }
        return current;
      }).catch(function () { return current; });
    },
  };

  root.CommandSettings = api;
  root.cmdTz = api.tz;

  // Small helpers the main page uses in place of hard-wired names.
  root.founderLabel = function () { return api.firstName() === 'there' ? 'Me' : api.firstName(); };
  root.founderIntro = function () {
    var f = (current && current.founder) || {}; var c = (current && current.company) || {};
    return (f.name || 'the founder') + (f.title ? ', ' + f.title : '') + (c.name ? ' of ' + c.name : '');
  };
  root.founderRules = function () {
    var v = (current && current.voice) || {}; var out = [];
    if (v.no_dashes) out.push('No em dashes.');
    if (v.banned_words && v.banned_words.length) out.push('Never use: ' + v.banned_words.join(', ') + '.');
    return out.length ? ' ' + out.join(' ') : '';
  };
  root.gmailLinkBase = function () {
    var email = current && current.founder && current.founder.email;
    return 'https://mail.google.com/mail/u/' + (email ? '?authuser=' + encodeURIComponent(email) : '0/');
  };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  // Brand pickers on forms: contact areas (checkboxes) and project product (buttons).
  function paintBrandPickers() {
    if (typeof document === 'undefined') return;
    var names = api.brands().map(function (b) { return b.name || b.code; });
    document.querySelectorAll('[data-brand-checkboxes]').forEach(function (box) {
      var id = box.id === 'cmd-ac-areas' ? 'cmd-ac-area' : box.id + '-item';
      var checked = {}; box.querySelectorAll('input:checked').forEach(function (el) { checked[el.value] = true; });
      box.innerHTML = names.length ? names.map(function (name, i) {
        return '<label style="display:flex;align-items:center;gap:8px;min-height:40px;font-size:13px;color:var(--color-navy);"><input type="checkbox" id="' + id + '-' + i + '" value="' + esc(name) + '"' + (checked[name] ? ' checked' : '') + ' style="width:18px;height:18px;accent-color:var(--color-teal);">' + esc(name) + '</label>';
      }).join('') : '<div style="font-size:13px;color:var(--color-gray-text)">Add your brands in Setup to tag people by area.</div>';
    });
    document.querySelectorAll('[data-brand-segments]').forEach(function (box) {
      var input = document.getElementById('prj-proj-product'); var value = input ? input.value : 'General';
      box.innerHTML = names.concat(['General']).map(function (name) {
        return '<button type="button" class="cmd-status-btn' + (name === value ? ' active' : '') + '" data-val="' + esc(name) + '" onclick="setPrjSeg(this,\'prj-proj-product\')">' + esc(name) + '</button>';
      }).join('');
    });
    document.querySelectorAll('[data-setting]').forEach(function (el) {
      if (el.value) return;
      var c = (current && current.company) || {}; var f = (current && current.founder) || {};
      var map = {
        'company.legal_name': c.legal_name || c.name || '',
        'company.mission': c.mission || c.one_liner || '',
        'company.program': api.brands().map(function (b) { return (b.name || '') + (b.one_liner ? ': ' + b.one_liner : ''); }).join(' '),
        'founder.contact': [f.name, f.title].filter(Boolean).join(', '),
      };
      el.value = map[el.getAttribute('data-setting')] || '';
    });
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('command:settings', paintBrandPickers);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintBrandPickers); else paintBrandPickers();
  }
  apply(read());
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { api.load(); });
    else api.load();
  }
})(typeof window !== 'undefined' ? window : globalThis);
