/* Email Desk: one founder queue for outbound communication, with cold-sequence and warm-conversation context. */
(function () {
  'use strict';

  var installed = false;
  var currentView = 'to_send';
  var rowsCache = [];
  var ACTIVE = ['draft', 'needs_review', 'needs_update', 'approved', 'ready_to_send'];

  function safe(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function parsed(value) { var date = value ? new Date(value) : null; return date && !isNaN(date.getTime()) ? date : null; }
  function shortDate(value) {
    var date = parsed(value);
    return date ? date.toLocaleDateString('en-US', { timeZone: (globalThis.CMD_TZ || 'America/New_York'), month: 'short', day: 'numeric' }) : '';
  }
  function conversationKind(draft) {
    var def = draft && draft.audience_definition && typeof draft.audience_definition === 'object' ? draft.audience_definition : {};
    var by = String(draft && draft.drafted_by || '').toLowerCase();
    if (def.artifact_type === 'personalized_visibility_preview' || def.personalized_visibility_preview === true || /personalized visibility preview delivery/.test(by)) return 'preview_delivery';
    if (def.conversation_type === 'warm_reply') return 'warm_reply';
    return null;
  }
  function purposeOf(draft) {
    var kind = conversationKind(draft);
    var by = String(draft.drafted_by || '').toLowerCase();
    if (kind === 'warm_reply') return 'Reply to someone who wrote back';
    if (draft.draft_type === 'customer_update') return 'Customer update';
    if (draft.draft_type === 'networking') return 'Relationship · Networking';
    if (draft.draft_type === 'client') return 'Client';
    if (draft.draft_type === 'grant') return 'Grant / Funder';
    if (draft.draft_type === 'program') return 'Program';
    if (draft.draft_type === 'sales') return 'Sales · Prospecting';
    return 'General';
  }
  function statusLabel(status) {
    var labels = { draft: 'Draft', needs_review: 'Needs review', needs_update: 'Needs update', approved: 'Ready to send', ready_to_send: 'Ready to send', waiting_for_reply: 'Waiting', sent: 'Sent', cancelled: 'Cancelled' };
    return labels[status] || String(status || '').replace(/_/g, ' ');
  }
  function statusStyle(status) {
    if (status === 'approved' || status === 'ready_to_send') return 'background:#EEF7F3;color:#2F6654;border:1px solid #B7D1C7;';
    if (status === 'sent') return 'background:#F1F5F9;color:#475569;border:1px solid #DCE3EA;';
    if (status === 'cancelled') return 'background:#F8FAFC;color:#94A3B8;border:1px solid #E2E8F0;';
    if (status === 'needs_update') return 'background:#FFF8E7;color:#8A6515;border:1px solid #E8C777;';
    return 'background:#F7F9FB;color:#243247;border:1px solid #DCE3EA;';
  }
  function isThreaded(draft) { return Boolean(draft && draft.gmail_thread_id); }
  function opportunityRows(draft) {
    if (!draft || !draft.opportunity_id) return [];
    return rowsCache.filter(function (row) { return row.opportunity_id === draft.opportunity_id && row.status !== 'cancelled'; })
      .sort(function (a, b) { return (parsed(a.sent_at || a.created_at) || new Date(0)).getTime() - (parsed(b.sent_at || b.created_at) || new Date(0)).getTime(); });
  }
  function coldSequenceRows(draft) {
    return opportunityRows(draft).filter(function (row) {
      return !conversationKind(row) && ['audit_partner', 'sales', 'follow_up'].indexOf(row.draft_type) !== -1;
    });
  }
  function previousMessage(draft) {
    var rows = opportunityRows(draft);
    var when = (parsed(draft.sent_at || draft.created_at) || new Date()).getTime();
    var earlier = rows.filter(function (row) { return row.id !== draft.id && (parsed(row.sent_at || row.created_at) || new Date(0)).getTime() < when; });
    return earlier.length ? earlier[earlier.length - 1] : null;
  }
  function followupStep(draft) {
    if (!draft || draft.draft_type !== 'follow_up' || conversationKind(draft)) return 0;
    var by = String(draft.drafted_by || '');
    var match = by.match(/\bstep:(\d+)\b/i);
    if (match) return Number(match[1]);
    var followups = coldSequenceRows(draft).filter(function (row) { return row.draft_type === 'follow_up'; });
    var index = followups.findIndex(function (row) { return row.id === draft.id; });
    return index >= 0 ? index + 1 : 1;
  }
  function sequenceInfo(draft) {
    if (!draft || !draft.opportunity_id) return null;
    var kind = conversationKind(draft);
    if (kind === 'preview_delivery') return { number: null, label: 'Conversation · Preview delivery', cadence: 'Warm reply', previous: previousMessage(draft), warm: true };
    if (kind === 'warm_reply') return { number: null, label: 'Conversation · Reply', cadence: 'Warm reply', previous: previousMessage(draft), warm: true };
    if (['audit_partner', 'sales', 'follow_up'].indexOf(draft.draft_type) === -1) return null;
    var step = followupStep(draft);
    var number = draft.draft_type === 'follow_up' ? step + 1 : 1;
    var label = number === 1 ? 'Email 1 · Initial' : 'Email ' + number + ' · Follow-up ' + (number - 1);
    var cadence = number === 2 ? '3 days after Email 1' : number === 3 ? '5 days after Follow-up 1' : 'Day 0';
    return { number: number, label: label, cadence: cadence, previous: previousMessage(draft), warm: false };
  }
  function sequenceBadge(draft) {
    var info = sequenceInfo(draft);
    if (!info) return '<span style="font-size:11px;color:#94A3B8;">—</span>';
    var bg = info.warm ? '#EEF7F3' : info.number === 1 ? '#F1F5F9' : '#EEF7F3';
    var color = info.warm ? '#2F6654' : info.number === 1 ? '#475569' : '#2F6654';
    return '<span style="display:inline-block;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:700;background:' + bg + ';color:' + color + ';white-space:nowrap;">' + safe(info.label) + '</span>';
  }
  function viewRows(view) {
    if (view === 'ready') return rowsCache.filter(function (d) { return d.status === 'approved' || d.status === 'ready_to_send'; });
    if (view === 'sent') return rowsCache.filter(function (d) { return d.status === 'sent'; }).slice(0, 30);
    if (view === 'history') return rowsCache.filter(function (d) { return d.status === 'sent' || d.status === 'cancelled'; });
    return rowsCache.filter(function (d) { return ACTIVE.indexOf(d.status) !== -1; });
  }
  function counts() {
    return {
      to_send: rowsCache.filter(function (d) { return ACTIVE.indexOf(d.status) !== -1; }).length,
      ready: rowsCache.filter(function (d) { return d.status === 'approved' || d.status === 'ready_to_send'; }).length,
      sent: rowsCache.filter(function (d) { return d.status === 'sent'; }).length,
      history: rowsCache.filter(function (d) { return d.status === 'sent' || d.status === 'cancelled'; }).length
    };
  }
  function viewButton(key, label, count) {
    var active = currentView === key;
    return '<button type="button" data-email-view="' + key + '" style="border:1px solid ' + (active ? '#243247' : '#DCE3EA') + ';background:' + (active ? '#243247' : '#fff') + ';color:' + (active ? '#fff' : '#526277') + ';border-radius:999px;padding:7px 12px;font:600 12px DM Sans,sans-serif;cursor:pointer;">' + safe(label) + ' <span style="opacity:.75;">' + count + '</span></button>';
  }
  function renderControls() {
    var panel = document.getElementById('panel-email-desk');
    if (!panel) return;
    var header = panel.querySelector('.section-title');
    if (header) {
      header.innerHTML = '<span>Email Desk</span><button class="btn btn-outline btn-sm" type="button" id="email-desk-refresh">Refresh</button>';
      var refresh = document.getElementById('email-desk-refresh');
      if (refresh) refresh.onclick = function () { window.loadEmailDesk(); };
    }
    var controls = document.getElementById('email-desk-organized-controls');
    if (!controls) {
      controls = document.createElement('div'); controls.id = 'email-desk-organized-controls';
      if (header && header.parentNode) header.parentNode.insertBefore(controls, header.nextSibling);
    }
    var c = counts();
    controls.innerHTML = '<div style="font-size:13px;color:#64748B;margin:-2px 0 12px;line-height:1.45;">Every unsent email Command has prepared stays here until you send or cancel it.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">' + viewButton('to_send', 'To Send', c.to_send) + viewButton('ready', 'Ready to Send', c.ready) + viewButton('sent', 'Recently Sent', c.sent) + viewButton('history', 'History', c.history) + '</div>';
    Array.from(controls.querySelectorAll('[data-email-view]')).forEach(function (button) { button.onclick = function () { currentView = button.getAttribute('data-email-view'); render(); }; });
  }
  function render() {
    var el = document.getElementById('email-desk-list');
    if (!el) return;
    renderControls();
    var rows = viewRows(currentView);
    if (!rows.length) {
      var empty = currentView === 'to_send' ? 'Nothing needs your review right now.' : currentView === 'ready' ? 'No approved emails waiting to send.' : currentView === 'sent' ? 'No recently sent Command emails.' : 'No email history yet.';
      el.innerHTML = '<div class="revenue-empty" style="padding:18px 4px;">' + safe(empty) + '</div>'; return;
    }
    el.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr>' +
      '<th style="text-align:left;">What it\'s for</th><th style="text-align:left;">Sequence</th><th style="text-align:left;">Recipient</th><th style="text-align:left;">Subject</th><th style="text-align:left;">Status</th><th style="text-align:left;">Conversation</th><th style="text-align:left;">Action</th></tr></thead><tbody>' + rows.map(function (d) {
        var threaded = isThreaded(d); var action = d.status === 'sent' || d.status === 'cancelled' ? 'View' : 'Review';
        return '<tr><td><div style="font-weight:700;color:#243247;">' + safe(purposeOf(d)) + '</div></td><td>' + sequenceBadge(d) + '</td>' +
          '<td><div style="font-weight:600;color:#243247;word-break:break-word;">' + safe(d.to_email || 'Audience') + '</div></td>' +
          '<td><div style="color:#3E4C5F;max-width:310px;">' + safe(d.subject || '(no subject)') + '</div></td>' +
          '<td><span style="display:inline-block;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:700;' + statusStyle(d.status) + '">' + safe(statusLabel(d.status)) + '</span></td>' +
          '<td>' + (threaded ? '<span style="font-size:11px;font-weight:700;color:#2F6654;">↩ Existing thread</span>' : '<span style="font-size:11px;color:#94A3B8;">New email</span>') + '</td>' +
          '<td><button type="button" data-open-email-draft="' + safe(d.id) + '" style="border:0;background:transparent;color:#2F6654;font-weight:700;font-size:12px;cursor:pointer;padding:4px 0;">' + action + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    Array.from(el.querySelectorAll('[data-open-email-draft]')).forEach(function (button) {
      button.onclick = function () { var id = button.getAttribute('data-open-email-draft'); if (typeof window.openEmailDraft === 'function') window.openEmailDraft(id); };
    });
  }
  async function api(path, options) {
    var response = await fetch('/api/crm/email-drafts' + path, options || {});
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || !payload.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : 'Email Desk request failed');
    return payload.data;
  }
  async function organizedLoad() {
    var el = document.getElementById('email-desk-list'); if (!el) return;
    el.innerHTML = '<div class="loading">Loading email desk<span class="loading-dot">...</span></div>';
    try { rowsCache = await api('?email_desk=1') || []; try { emailDeskRows = rowsCache; } catch (_) {} window.emailDeskRows = rowsCache; render(); try { window.dispatchEvent(new Event('atara:email-desk-loaded')); } catch (_) {} }
    catch (error) { el.innerHTML = '<div class="revenue-empty">' + safe(error.message || 'Could not load Email Desk') + '</div>'; }
  }
  async function repairMissingReplyMessage(draft) {
    if (!draft || !draft.id || !draft.contact_id || !draft.gmail_thread_id || draft.gmail_message_id) return draft;
    try {
      var response = await fetch('/api/crm/activities?contact_id=' + encodeURIComponent(draft.contact_id) + '&limit=250');
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok || !payload.ok || !Array.isArray(payload.data)) return draft;
      var matches = payload.data.filter(function (row) {
        var meta = row && row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
        return row.activity_type === 'email_received' && meta.gmail_thread_id === draft.gmail_thread_id && meta.gmail_message_id;
      }).sort(function (a, b) { return new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0); });
      if (!matches.length) return draft;
      var healed = await api('?id=' + encodeURIComponent(draft.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gmail_message_id: matches[0].metadata.gmail_message_id }) });
      try { activeEmailDraft = healed; } catch (_) { window.activeEmailDraft = healed; }
      return healed;
    } catch (_) { return draft; }
  }
  function removeReviewContext() {
    ['email-draft-sequence-context', 'email-draft-thread-note', 'email-draft-attachment-note', 'email-draft-free-scope'].forEach(function (id) { var node = document.getElementById(id); if (node && node.parentNode) node.parentNode.removeChild(node); });
  }
  function injectSequenceContext(draft) {
    var info = sequenceInfo(draft); if (!info) return;
    var subject = document.getElementById('email-draft-subject'); var group = subject && (subject.closest ? subject.closest('.form-group') : subject.parentNode);
    if (!group || !group.parentNode) return;
    var card = document.createElement('div'); card.id = 'email-draft-sequence-context';
    card.style.cssText = 'margin:0 0 16px;padding:13px 14px;border:1px solid #DCE3EA;border-radius:12px;background:#F7F9FB;color:#243247;';
    var previousHtml = '';
    if (info.previous) {
      var previousWhen = shortDate(info.previous.sent_at || info.previous.created_at);
      previousHtml = '<div style="margin-top:9px;font-size:11px;color:#64748B;">Previous: <strong style="color:#3E4C5F;">' + safe(info.previous.subject || '(no subject)') + '</strong>' + (previousWhen ? ' · ' + safe(info.previous.status === 'sent' ? 'Sent ' + previousWhen : previousWhen) : '') + '</div>' +
        '<details style="margin-top:7px;"><summary style="cursor:pointer;font-size:11px;font-weight:700;color:#2F6654;">View previous email</summary><div style="margin-top:8px;padding:10px;border-radius:8px;background:#fff;border:1px solid #E2E8F0;font-size:11px;line-height:1.5;color:#475569;white-space:pre-wrap;">' + safe(info.previous.body || 'No previous body saved.') + '</div></details>';
    }
    card.innerHTML = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-size:13px;font-weight:800;">' + safe(info.label) + '</span><span style="font-size:10px;font-weight:700;border-radius:999px;padding:3px 8px;background:#EEF7F3;color:#2F6654;">' + safe(info.cadence) + '</span></div>' + previousHtml;
    group.parentNode.insertBefore(card, group);
    var meta = document.getElementById('email-draft-meta'); if (meta && meta.textContent.indexOf(info.label) === -1) meta.textContent += ' · ' + info.label;
  }
  function injectThreadNote(draft) {
    if (!draft || !draft.gmail_thread_id) return;
    var subject = document.getElementById('email-draft-subject'); var group = subject && (subject.closest ? subject.closest('.form-group') : subject.parentNode);
    if (!group || !group.parentNode) return;
    var note = document.createElement('div'); note.id = 'email-draft-thread-note';
    note.style.cssText = 'margin:0 0 14px;padding:10px 12px;border:1px solid #B7D1C7;border-radius:10px;background:#EEF7F3;color:#2F6654;font-size:12px;font-weight:700;';
    note.textContent = '↩ This continues the existing Gmail conversation, not a brand-new email.'; group.parentNode.insertBefore(note, group);
    var meta = document.getElementById('email-draft-meta'); if (meta && !/Existing Gmail thread/i.test(meta.textContent)) meta.textContent += ' · ↩ Existing Gmail thread';
  }
  function injectAttachmentNote(draft) {
    var rows = draft && draft.audience_definition && Array.isArray(draft.audience_definition.attachments) ? draft.audience_definition.attachments.filter(function (row) { return row && row.name && row.data; }) : [];
    if (!rows.length) return;
    var body = document.getElementById('email-draft-body'); var group = body && (body.closest ? body.closest('.form-group') : body.parentNode);
    if (!group || !group.parentNode) return;
    var note = document.createElement('div'); note.id = 'email-draft-attachment-note';
    note.style.cssText = 'margin:12px 0 14px;padding:12px 14px;border:1px solid #B7D1C7;border-radius:10px;background:#EEF7F3;color:#243247;font-size:12px;line-height:1.45;';
    note.innerHTML = '<div style="font-weight:800;color:#2F6654;margin-bottom:6px;">📎 Attachment ready to send</div>' + rows.map(function (row) { return '<div style="display:flex;align-items:center;gap:8px;word-break:break-word;"><span style="font-weight:700;">' + safe(row.name) + '</span><span style="font-size:10px;color:#64748B;">PDF</span></div>'; }).join('');
    if (group.nextSibling) group.parentNode.insertBefore(note, group.nextSibling); else group.parentNode.appendChild(note);
  }
  function installOpenGuard() {
    if (typeof window.openEmailDraft !== 'function' || window.openEmailDraft.__organizedDeskThreadGuard) return;
    var original = window.openEmailDraft;
    var wrapped = async function (id) {
      removeReviewContext(); var result = await original.apply(this, arguments); var draft = null;
      try { draft = activeEmailDraft; } catch (_) { draft = window.activeEmailDraft || null; }
      var healed = await repairMissingReplyMessage(draft); if (healed && healed.id) draft = healed;
      injectSequenceContext(draft); injectThreadNote(draft); injectAttachmentNote(draft); return result;
    };
    wrapped.__organizedDeskThreadGuard = true; window.openEmailDraft = wrapped; try { openEmailDraft = wrapped; } catch (_) {}
  }
  function install() {
    if (installed) return;
    if (typeof window.loadEmailDesk !== 'function' || typeof window.openEmailDraft !== 'function') { setTimeout(install, 150); return; }
    installed = true; window.loadEmailDesk = organizedLoad; try { loadEmailDesk = organizedLoad; } catch (_) {} installOpenGuard(); organizedLoad();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(install, 250); }); else setTimeout(install, 250);
})();
