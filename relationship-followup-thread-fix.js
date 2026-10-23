/* Ensure Relationship Desk follow-ups reply to the latest Gmail thread and make thread context visible before sending. */
(function () {
  'use strict';

  function safeJson(response) { return response.json().catch(function () { return {}; }); }
  function toast(message, isError) { if (typeof showToast === 'function') showToast(message, Boolean(isError)); }
  function localEsc(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function normalizeReplySubject(subject) {
    var value = String(subject || '').trim();
    return /^re\s*:/i.test(value) ? value : 'Re: ' + value;
  }
  function contactMatchesInsight(contact, insight) {
    if (!contact || !insight) return false;
    if (contact.id && insight.contact_id === contact.id) return true;
    return Boolean(contact.email && insight.sender_email && String(contact.email).toLowerCase() === String(insight.sender_email).toLowerCase());
  }
  async function latestInsight(contact) {
    var local = Array.isArray(window.emailInsights) ? window.emailInsights.filter(function (row) { return contactMatchesInsight(contact, row); }) : [];
    if (local.length) return local.sort(function (a, b) { return new Date(b.received_at || 0) - new Date(a.received_at || 0); })[0];
    var response = await fetch('/api/gmail/intelligence');
    var payload = await safeJson(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : 'Could not load Gmail relationship context');
    var rows = Array.isArray(payload.data) ? payload.data : [];
    return rows.filter(function (row) { return contactMatchesInsight(contact, row); }).sort(function (a, b) { return new Date(b.received_at || 0) - new Date(a.received_at || 0); })[0] || null;
  }
  async function latestInboundActivity(contact) {
    if (!contact || !contact.id) return null;
    var response = await fetch('/api/crm/activities?contact_id=' + encodeURIComponent(contact.id) + '&limit=250');
    var payload = await safeJson(response);
    if (!response.ok || !payload.ok) return null;
    var rows = Array.isArray(payload.data) ? payload.data : [];
    return rows.filter(function (row) {
      var meta = row && row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      return row.activity_type === 'email_received' && (meta.gmail_message_id || meta.gmail_thread_id);
    }).sort(function (a, b) { return new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0); })[0] || null;
  }
  async function existingDraftForMessage(contactId, gmailMessageId) {
    if (!contactId || !gmailMessageId) return null;
    var response = await fetch('/api/crm/email-drafts?contact_id=' + encodeURIComponent(contactId));
    var payload = await safeJson(response);
    if (!response.ok || !payload.ok) return null;
    var rows = Array.isArray(payload.data) ? payload.data : [];
    return rows.find(function (row) { return row.gmail_message_id === gmailMessageId && row.status !== 'cancelled'; }) || null;
  }
  async function draftFromActivity(contact, activity) {
    var meta = activity && activity.metadata && typeof activity.metadata === 'object' ? activity.metadata : {};
    var existing = await existingDraftForMessage(contact.id, meta.gmail_message_id);
    if (existing) return existing;
    var response = await fetch('/api/crm/email-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: contact.id,
        account_id: contact.account_id || null,
        gmail_thread_id: meta.gmail_thread_id || null,
        gmail_message_id: meta.gmail_message_id || null,
        to_email: contact.email,
        subject: normalizeReplySubject(activity.subject || ''),
        body: '',
        draft_type: 'networking',
        status: 'needs_review',
        needs_human: true,
        human_reason: 'Threaded reply prepared from relationship history',
      }),
    });
    var payload = await safeJson(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : 'Could not prepare threaded reply');
    return payload.data;
  }
  async function openDraft(draft) {
    if (!draft || !draft.id) throw new Error('Reply draft was not created');
    if (typeof openPreparedEmailDraft === 'function') {
      await openPreparedEmailDraft(draft.id);
      return;
    }
    if (typeof loadEmailDesk === 'function') await loadEmailDesk();
    if (typeof openEmailDraft === 'function') await openEmailDraft(draft.id);
  }
  async function prepareThreadedFollowup(contact) {
    if (!contact) { toast('No relationship selected', true); return; }
    if (!contact.email) { toast('This contact does not have an email address', true); return; }
    try {
      var insight = await latestInsight(contact);
      var draft = null;
      if (insight && insight.id) {
        var response = await fetch('/api/gmail/intelligence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'prepare_reply', id: insight.id }),
        });
        var payload = await safeJson(response);
        if (!response.ok || !payload.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : 'Could not prepare Gmail reply');
        draft = payload.data;
      } else {
        var activity = await latestInboundActivity(contact);
        if (activity) draft = await draftFromActivity(contact, activity);
      }
      if (!draft) {
        toast('No incoming Gmail thread was found for this relationship. Opening a new email instead.');
        if (typeof cmdOpenEmailComposer === 'function') cmdOpenEmailComposer(contact);
        return;
      }
      await openDraft(draft);
      toast('Threaded reply opened from the latest incoming email');
    } catch (error) {
      toast(error.message || 'Could not prepare threaded follow-up', true);
    }
  }

  function replyContextContainer() {
    var existing = document.getElementById('email-draft-reply-context');
    if (existing) return existing;
    var body = document.getElementById('email-draft-body');
    if (!body) return null;
    var group = body.closest ? body.closest('.form-group') : body.parentNode;
    if (!group || !group.parentNode) return null;
    var box = document.createElement('div');
    box.id = 'email-draft-reply-context';
    box.style.marginTop = '18px';
    group.parentNode.insertBefore(box, group.nextSibling);
    return box;
  }

  function friendlyDate(value) {
    if (!value) return '';
    try {
      var date = new Date(value);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
    } catch (_) { return ''; }
  }

  function setReplyMeta(isReplying) {
    var meta = document.getElementById('email-draft-meta');
    if (!meta) return;
    var base = meta.textContent.replace(/\s*·\s*↩\s*Replying in Gmail thread\s*$/i, '');
    meta.textContent = isReplying ? base + ' · ↩ Replying in Gmail thread' : base;
  }

  function togglePreviousEmail(button) {
    var body = document.getElementById('email-draft-previous-body');
    if (!body) return;
    var hidden = body.style.display === 'none';
    body.style.display = hidden ? 'block' : 'none';
    button.textContent = hidden ? 'Hide previous email' : 'Show previous email';
  }

  async function renderReplyContext(draft) {
    var box = replyContextContainer();
    if (!box) return;
    if (!draft || !draft.gmail_thread_id || !draft.gmail_message_id) {
      box.innerHTML = '';
      box.style.display = 'none';
      setReplyMeta(false);
      return;
    }

    box.style.display = 'block';
    box.innerHTML = '<div style="padding:14px 16px;border:1px solid #DCE3EA;border-radius:12px;background:#F7F9FB;font-size:12px;color:#64748B;">Verifying Gmail thread…</div>';
    try {
      var response = await fetch('/api/gmail/reply-context?draft_id=' + encodeURIComponent(draft.id));
      var payload = await safeJson(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : 'Could not verify Gmail thread');
      var data = payload.data || {};
      if (!data.replying || !data.verified || !data.source) {
        box.innerHTML = '';
        box.style.display = 'none';
        setReplyMeta(false);
        return;
      }

      var source = data.source;
      var sender = source.sender_name || source.sender_email || 'Previous sender';
      var senderDetail = source.sender_name && source.sender_email ? source.sender_email : '';
      var body = String(source.body || '').trim();
      var preview = body.length > 1800 ? body.slice(0, 1800) + '…' : body;
      setReplyMeta(true);
      box.innerHTML = '' +
        '<div style="border:1px solid #B7D1C7;border-radius:14px;overflow:hidden;background:#fff;">' +
          '<div style="padding:13px 15px;background:#EEF7F3;border-bottom:1px solid #D7E7E0;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<span style="font-size:13px;font-weight:700;color:#2F6654;">↩ Replying in existing Gmail thread</span>' +
              '<span style="font-size:11px;font-weight:700;color:#2F6654;background:#fff;border:1px solid #B7D1C7;border-radius:999px;padding:2px 8px;">✓ VERIFIED</span>' +
            '</div>' +
            '<div style="font-size:11px;color:#526277;margin-top:4px;">When you press Send, this message will reply to the email shown below — not start a new conversation.</div>' +
          '</div>' +
          '<div style="padding:14px 15px;">' +
            '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">' +
              '<div><div style="font-size:13px;font-weight:700;color:#243247;">' + localEsc(sender) + '</div>' +
              (senderDetail ? '<div style="font-size:11px;color:#64748B;margin-top:2px;">' + localEsc(senderDetail) + '</div>' : '') + '</div>' +
              '<div style="font-size:11px;color:#64748B;text-align:right;white-space:nowrap;">' + localEsc(friendlyDate(source.received_at)) + '</div>' +
            '</div>' +
            '<div style="font-size:12px;font-weight:600;color:#3E4C5F;margin-top:9px;">' + localEsc(source.subject || '(no subject)') + '</div>' +
            '<div id="email-draft-previous-body" style="font-size:12px;line-height:1.55;color:#526277;white-space:pre-wrap;margin-top:10px;padding:12px;background:#F7F9FB;border-radius:10px;max-height:220px;overflow:auto;">' + localEsc(preview || 'Previous email body unavailable.') + '</div>' +
            '<button type="button" id="email-draft-toggle-previous" style="margin-top:10px;border:0;background:transparent;padding:0;color:#243247;font-size:11px;font-weight:700;cursor:pointer;">Hide previous email</button>' +
          '</div>' +
        '</div>';
      var toggle = document.getElementById('email-draft-toggle-previous');
      if (toggle) toggle.onclick = function () { togglePreviousEmail(toggle); };
    } catch (error) {
      setReplyMeta(false);
      box.innerHTML = '<div style="padding:13px 15px;border:1px solid #E8C777;border-radius:12px;background:#FFF9E8;color:#725A16;font-size:12px;line-height:1.45;"><strong>Thread could not be verified.</strong><br>' + localEsc(error.message || 'Refresh and reopen this draft before sending.') + '</div>';
    }
  }

  function installDraftThreadContext() {
    if (typeof openEmailDraft !== 'function' || openEmailDraft.__threadContextFixed) return;
    var original = openEmailDraft;
    var wrapped = async function(id) {
      var result = await original(id);
      try { await renderReplyContext(window.activeEmailDraft || (typeof activeEmailDraft !== 'undefined' ? activeEmailDraft : null)); }
      catch (_) { /* draft remains usable; send endpoint still enforces thread safety */ }
      return result;
    };
    wrapped.__threadContextFixed = true;
    openEmailDraft = wrapped;
  }

  function install() {
    installDraftThreadContext();
    if (typeof relationshipPrepareFollowup === 'function' && !relationshipPrepareFollowup.__threadedReplyFixed) {
      prepareThreadedFollowup.__threadedReplyFixed = true;
      relationshipPrepareFollowup = prepareThreadedFollowup;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(install, 0); });
  else setTimeout(install, 0);
})();
