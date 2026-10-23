/* Relationship system reliability fixes: contact areas, AI drafts, sent-email logging, and River relationship intake. */
(function () {
  'use strict';

  // The founder's booking link from setup (for example a 20-minute intro call). Empty until they add one.
  var CAFE_CONVO = {
    get name() { var l = window.CommandSettings && CommandSettings.get() && CommandSettings.get().links; return (l && l.booking_label) || 'intro call'; },
    get url() { var l = window.CommandSettings && CommandSettings.get() && CommandSettings.get().links; return (l && l.booking_url) || ''; },
  };
  Object.defineProperty(window, 'ATARA_CAFE_CONVO', { configurable: true, get: function () { return CAFE_CONVO.url ? CAFE_CONVO : null; } });

  function safeJson(response) { return response.json().catch(function(){ return {}; }); }
  function removeLoading(id) {
    var el = document.getElementById(id);
    if (el) { var row = el.closest('.river-msg'); if (row) row.remove(); else el.remove(); }
  }
  function toast(message, isError) {
    if (typeof showToast === 'function') showToast(message, Boolean(isError));
  }
  function compactText(value, max) {
    var text = String(value || '').replace(/\s+/g, ' ').trim();
    var limit = max || 280;
    return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
  }
  function cafeConvoContext() {
    if (!CAFE_CONVO.url) return '';
    return '\n\nScheduling resource available when it is relevant: the founder\'s ' + CAFE_CONVO.name + '. Booking link: ' + CAFE_CONVO.url + '. Do not add the link unless the email is actually at the scheduling stage or the founder asks for it.';
  }

  function installCheckboxFix() {
    if (document.getElementById('relationship-checkbox-fix')) return;
    var style = document.createElement('style');
    style.id = 'relationship-checkbox-fix';
    style.textContent = [
      '.slide-panel .form-group input[type="checkbox"], .form-group input[type="checkbox"] {',
      '  -webkit-appearance: checkbox !important;',
      '  appearance: auto !important;',
      '  width: 18px !important;',
      '  min-width: 18px !important;',
      '  height: 18px !important;',
      '  min-height: 18px !important;',
      '  padding: 0 !important;',
      '  border-radius: 3px !important;',
      '  flex: 0 0 18px !important;',
      '  cursor: pointer;',
      '}',
      '.slide-panel .form-group label:has(> input[type="checkbox"]), .form-group label:has(> input[type="checkbox"]) {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  cursor: pointer;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function installComposerContactBinding() {
    if (typeof cmdOpenEmailComposer !== 'function' || cmdOpenEmailComposer.__relationshipFixed) return;
    var original = cmdOpenEmailComposer;
    var wrapped = function(contact) {
      var resolved = contact;
      if (typeof resolved === 'string') {
        try { resolved = JSON.parse(resolved); } catch (_) { resolved = null; }
      }
      if (resolved && typeof resolved === 'object') cmdActiveContact = resolved;
      var result = original(contact);
      setTimeout(installCafeConvoComposerButton, 0);
      return result;
    };
    wrapped.__relationshipFixed = true;
    cmdOpenEmailComposer = wrapped;
  }

  function installCafeConvoComposerButton() {
    var body = document.getElementById('cmd-email-body');
    if (!body || document.getElementById('cmd-insert-cafe-convo')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'cmd-insert-cafe-convo';
    button.className = 'btn btn-outline btn-sm';
    button.textContent = 'Insert ' + CAFE_CONVO.name + ' link';
    if (!CAFE_CONVO.url) button.style.display = 'none';
    button.style.marginBottom = '8px';
    button.onclick = function() {
      var current = body.value || '';
      if (!CAFE_CONVO.url) { toast('Add your booking link in Setup first.', true); return; }
      var insertion = 'Here is my ' + CAFE_CONVO.name + ' link. Grab a time that works for you:\n' + CAFE_CONVO.url;
      if (current.indexOf(CAFE_CONVO.url) !== -1) { toast('Your booking link is already in this email'); return; }
      body.value = current ? current.replace(/\s+$/, '') + '\n\n' + insertion : insertion;
      body.dispatchEvent(new Event('input', { bubbles: true }));
      body.focus();
    };
    body.parentNode.insertBefore(button, body);
  }

  function installAiDraftFix() {
    if (typeof cmdGenerateDrafts !== 'function' || cmdGenerateDrafts.__relationshipFixed) return;
    var replacement = async function() {
      var promptEl = document.getElementById('cmd-ai-draft-prompt');
      var prompt = promptEl ? promptEl.value.trim() : '';
      if (!prompt) { toast('Describe what you want to say first', true); return; }
      var btn = document.getElementById('cmd-ai-draft-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
      try {
        var contact = cmdActiveContact || null;
        var response = await fetch('/api/ai/email-draft-variants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt + cafeConvoContext(),
            contact_id: contact && contact.id ? contact.id : null,
            contact: contact ? { name: contact.name || '', email: contact.email || '', title: contact.title || '', company: contact.company || '', notes: contact.notes || '', areas: contact.areas || [], interest: contact.interest || '' } : null,
          }),
        });
        var payload = await safeJson(response);
        if (!response.ok || !payload.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : 'Draft generation failed');
        var versions = payload.data && Array.isArray(payload.data.versions) ? payload.data.versions : [];
        if (versions.length < 3) throw new Error('Draft generation returned incomplete results');
        cmdDraftVersions = versions;
        var container = document.getElementById('cmd-draft-versions');
        if (container) {
          container.style.display = '';
          container.innerHTML = versions.map(function(v, i) {
            return '<div class="cmd-draft-card" id="cmd-draft-' + i + '" onclick="cmdSelectDraft(' + i + ')"><div class="cmd-draft-label">' + esc(v.label || ('Version ' + (i + 1))) + '</div><div class="cmd-draft-text">' + esc(String(v.body || '').substring(0,120) + (String(v.body || '').length > 120 ? '...' : '')) + '</div></div>';
          }).join('');
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Generate again'; }
      } catch (error) {
        if (btn) { btn.disabled = false; btn.textContent = 'Generate 3 versions'; }
        toast(error.message || 'Draft generation failed - try again', true);
      }
    };
    replacement.__relationshipFixed = true;
    cmdGenerateDrafts = replacement;
  }

  async function updateContactWaitingState(contact, body) {
    if (!contact || !contact.id) return;
    var nextAction = CAFE_CONVO.url && String(body || '').indexOf(CAFE_CONVO.url) !== -1 ? 'Awaiting ' + CAFE_CONVO.name + ' booking' : 'Awaiting reply';
    try {
      await fetch('/api/crm/contacts?id=' + encodeURIComponent(contact.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_action: nextAction, next_action_at: null, contact_status: 'new' }),
      });
    } catch (_) { /* sent mail remains authoritative */ }
  }

  function installReliableSendLogging() {
    if (typeof cmdSendEmail !== 'function' || cmdSendEmail.__relationshipFixed) return;
    var replacement = async function() {
      if (!cmdEmailChips.to.length) { toast('Add at least one recipient', true); return; }
      var subject = document.getElementById('cmd-email-subject').value.trim();
      var body = document.getElementById('cmd-email-body').value.trim();
      if (!subject || !body) { toast('Subject and body are required', true); return; }
      var btn = document.getElementById('cmd-send-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
      try {
        var response = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: cmdEmailChips.to, cc: cmdEmailChips.cc, subject: subject, body: body, attachments: [] }),
        });
        var result = await safeJson(response);
        if (!response.ok || !result.ok) throw new Error(result.error || 'Send failed');

        var contact = cmdActiveContact || null;
        if (!contact || !contact.id) {
          var recipient = String(cmdEmailChips.to[0] || '').toLowerCase();
          contact = (cmdAllContacts || []).find(function(c){ return String(c.email || '').toLowerCase() === recipient; }) || null;
        }
        if (contact && contact.id) {
          var activityResponse = await fetch('/api/crm/activities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contact_id: contact.id,
              account_id: contact.account_id || null,
              activity_type: 'email_sent',
              subject: subject,
              description: body,
              external_id: result.id ? ('gmail:' + result.id) : null,
              metadata: { gmail_message_id: result.id || null, gmail_thread_id: result.threadId || null, direction: 'outbound', source: 'gmail', sent_from: 'command_contact_composer' },
              occurred_at: new Date().toISOString(),
            }),
          });
          var activityPayload = await safeJson(activityResponse);
          if (!activityResponse.ok || !activityPayload.ok) throw new Error(activityPayload.error && activityPayload.error.message ? activityPayload.error.message : 'Email sent, but relationship log could not be updated');
          await updateContactWaitingState(contact, body);
        }

        toast(contact && contact.id ? 'Email sent and relationship log updated' : 'Email sent');
        if (typeof closePanel === 'function') closePanel('cmd-email-panel');
        if (typeof loadCmdContacts === 'function') await loadCmdContacts();
        if (typeof loadRelationshipDesk === 'function') loadRelationshipDesk();
      } catch (error) {
        toast(error.message || 'Connection error', true);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
      }
    };
    replacement.__relationshipFixed = true;
    cmdSendEmail = replacement;
  }

  function isReferralSource(value) {
    return /\b(referred|referral|introduced|introduction|recommended by|connected by)\b/i.test(String(value || ''));
  }

  function stableReferralExternalId(contactId, source, type) {
    var key = String(source || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    return 'relationship-context:' + contactId + ':' + (type || 'note') + ':' + (key || 'general');
  }

  async function saveRelationshipContext(contactId, source, notes, activityType) {
    if (!contactId) return;
    var externalId = stableReferralExternalId(contactId, source, activityType);
    try {
      var existingResponse = await fetch('/api/crm/activities?contact_id=' + encodeURIComponent(contactId) + '&limit=250');
      var existingPayload = await safeJson(existingResponse);
      var existing = existingPayload && existingPayload.ok && Array.isArray(existingPayload.data) ? existingPayload.data : [];
      if (existing.some(function(row){ return row.external_id === externalId; })) return;
      await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          activity_type: activityType,
          subject: activityType === 'referral' ? source : 'Relationship note',
          description: notes || source || null,
          external_id: externalId,
          metadata: { source: source || null, relationship_context: activityType },
          occurred_at: new Date().toISOString(),
        }),
      });
    } catch (_) { /* contact save remains authoritative */ }
  }

  function installReferralSourceFix() {
    if (typeof connectPost !== 'function' || connectPost.__relationshipContextFixed) return;
    var original = connectPost;
    var wrapped = async function(payload) {
      var isContactSave = payload && (payload.action === 'updateContact' || payload.action === 'addContact');
      var source = isContactSave ? String(payload.eventSource || '').trim() : '';
      var notes = isContactSave ? String(payload.notes || '').trim() : '';
      var contextType = source && isReferralSource(source) ? 'referral' : (!source && notes ? 'relationship_note' : '');
      if (!contextType) return original(payload);

      var sanitized = Object.assign({}, payload, { eventSource: '', notes: '' });
      var result = await original(sanitized);
      var contactId = payload.id || payload.rowIndex || (result && result.data && result.data.id) || null;
      if (!contactId) return result;

      if (notes) {
        try {
          await fetch('/api/crm/contacts?id=' + encodeURIComponent(contactId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: notes }),
          });
        } catch (_) { /* leave saved contact intact */ }
      }
      await saveRelationshipContext(contactId, source, notes, contextType);
      return result;
    };
    wrapped.__relationshipContextFixed = true;
    connectPost = wrapped;
  }

  var relationshipInboxSyncPromise = null;
  function syncRelationshipInbox() {
    var now = Date.now();
    var last = Number(sessionStorage.getItem('atara_relationship_gmail_sync_at') || 0);
    if (now - last < 5 * 60 * 1000) return Promise.resolve(false);
    if (relationshipInboxSyncPromise) return relationshipInboxSyncPromise;
    relationshipInboxSyncPromise = fetch('/api/gmail/intelligence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'scan', days: 14 }),
    }).then(function(response){ return safeJson(response).then(function(payload){
      if (response.ok && payload.ok) {
        sessionStorage.setItem('atara_relationship_gmail_sync_at', String(Date.now()));
        return true;
      }
      return false;
    }); }).catch(function(){ return false; }).finally(function(){ relationshipInboxSyncPromise = null; });
    return relationshipInboxSyncPromise;
  }

  function gmailUrlForActivity(activity) {
    var metadata = activity && activity.metadata && typeof activity.metadata === 'object' ? activity.metadata : {};
    var messageId = metadata.gmail_message_id || '';
    if (!messageId && /^gmail:/.test(String(activity.external_id || ''))) messageId = String(activity.external_id).replace(/^gmail:/, '');
    var target = messageId || metadata.gmail_thread_id || '';
    return target ? 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(target) : '';
  }

  function activityTypeLabel(type) {
    var labels = {
      email_sent: 'email sent',
      email_received: 'email received',
      referral: 'referral',
      relationship_note: 'note',
      relationship_added: 'relationship',
      in_person: 'in person',
    };
    return labels[type] || String(type || '').replace(/_/g, ' ');
  }

  function installRelationshipTimeline() {
    if (typeof cmdLoadTouchpoints !== 'function' || cmdLoadTouchpoints.__relationshipTimelineFixed) return;
    var render = async function(contactId) {
      if (!contactId) return;
      var el = document.getElementById('cmd-touchpoints-list');
      if (!el) return;
      try {
        var data = await connectGet('touchpoints', { contactId: contactId });
        var rows = Array.isArray(data.rows) ? data.rows : [];
        var superseded = new Set(rows.map(function(row){
          return row && row.metadata && typeof row.metadata === 'object' ? row.metadata.supersedes_activity_id : null;
        }).filter(Boolean));
        rows = rows.filter(function(row){ return !superseded.has(row.id); });
        if (!rows.length) { el.innerHTML = '<p class="loading">No touchpoints yet.</p>'; return; }
        var sorted = rows.slice().sort(function(a,b) { return new Date(b.date || b.occurred_at || 0) - new Date(a.date || a.occurred_at || 0); });
        el.innerHTML = sorted.map(function(t) {
          var type = activityTypeLabel(t.type || t.activity_type);
          var subject = compactText(t.subject || '', 180);
          var notes = compactText(t.notes || t.description || '', /email_/.test(String(t.activity_type || t.type || '')) ? 240 : 360);
          var gmailUrl = gmailUrlForActivity(t);
          return '<div style="padding:10px 0;border-bottom:1px solid var(--color-gray-light);">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap;"><span style="font-size:11px;font-weight:600;color:var(--color-navy);">' + esc(fmtDate(t.date || t.occurred_at || '')) + '</span><span class="badge badge-in-progress">' + esc(type) + '</span>' +
            (t.outcome ? '<span class="badge badge-done">' + esc(t.outcome) + '</span>' : '') +
            (gmailUrl ? '<a href="' + esc(gmailUrl) + '" target="_blank" rel="noopener noreferrer" style="font-size:11px;font-weight:700;color:var(--color-teal);text-decoration:none;margin-left:auto;">Open email ↗</a>' : '') + '</div>' +
            (subject ? '<div style="font-size:12px;font-weight:600;color:var(--color-navy);line-height:1.4;margin-top:4px;">' + esc(subject) + '</div>' : '') +
            (notes && notes !== subject ? '<div style="font-size:12px;color:var(--color-gray-text);line-height:1.5;margin-top:2px;">' + esc(notes) + '</div>' : '') +
            (t.nextStep ? '<div style="font-size:11px;color:var(--color-teal);margin-top:2px;font-weight:600;">Next: ' + esc(t.nextStep) + '</div>' : '') +
            '</div>';
        }).join('');
      } catch(e) {
        el.innerHTML = '<p class="loading">Could not load touchpoints.</p>';
      }
    };

    var replacement = async function(contactId) {
      await render(contactId);
      var synced = await syncRelationshipInbox();
      if (synced) await render(contactId);
    };
    replacement.__relationshipTimelineFixed = true;
    cmdLoadTouchpoints = replacement;
  }

  function relationshipIntent(text) {
    var value = String(text || '').trim();
    if (value.length < 12) return false;
    var explicitAdd = /\b(add|save|log|put)\b[\s\S]{0,120}\b(contact|person|relationship|relationships|command)\b/i.test(value);
    var warmContact = /\b(contact|introduction|introduced|referral|referred|connection)\b/i.test(value) && /\b(email|draft|send|reach out|introduce|follow up|follow-up)\b/i.test(value);
    return explicitAdd || warmContact;
  }

  function renderRelationshipApproval(bubble, data) {
    var draft = data && data.draft;
    if (!draft || !draft.id) return;
    var box = document.createElement('div');
    box.style.cssText = 'margin-top:12px;padding:12px;border:1px solid var(--color-gray-mid);border-radius:12px;background:#fff;';
    var label = document.createElement('div');
    label.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-secondary);margin-bottom:8px;';
    label.textContent = 'Email ready for approval';
    box.appendChild(label);

    var subject = document.createElement('input');
    subject.type = 'text'; subject.value = draft.subject || '';
    subject.style.cssText = 'width:100%;padding:9px 10px;border:1px solid var(--color-gray-mid);border-radius:8px;font:inherit;margin-bottom:8px;';
    box.appendChild(subject);

    var body = document.createElement('textarea');
    body.value = draft.body || ''; body.rows = 9;
    body.style.cssText = 'width:100%;padding:10px;border:1px solid var(--color-gray-mid);border-radius:8px;font:inherit;line-height:1.45;resize:vertical;';
    box.appendChild(body);

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;';
    var send = document.createElement('button');
    send.type = 'button'; send.className = 'btn btn-teal btn-sm'; send.textContent = 'Approve & Send';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn-outline btn-sm'; cancel.textContent = 'Keep as draft';
    actions.appendChild(send); actions.appendChild(cancel); box.appendChild(actions);

    cancel.onclick = function(){ cancel.disabled = true; cancel.textContent = 'Saved for review'; };
    send.onclick = async function() {
      send.disabled = true; send.textContent = 'Sending...';
      try {
        var patch = await fetch('/api/crm/email-drafts?id=' + encodeURIComponent(draft.id), {
          method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ subject:subject.value.trim(), body:body.value.trim(), status:'needs_review', needs_human:true })
        });
        var patchData = await safeJson(patch); if (!patch.ok || !patchData.ok) throw new Error(patchData.error && patchData.error.message ? patchData.error.message : 'Could not save your edits');
        var approve = await fetch('/api/crm/email-drafts?id=' + encodeURIComponent(draft.id) + '&action=approve', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
        var approveData = await safeJson(approve); if (!approve.ok || !approveData.ok) throw new Error(approveData.error && approveData.error.message ? approveData.error.message : 'Could not approve email');
        var sent = await fetch('/api/crm/email-drafts?id=' + encodeURIComponent(draft.id) + '&action=send', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
        var sentData = await safeJson(sent); if (!sent.ok || !sentData.ok) throw new Error(sentData.error && sentData.error.message ? sentData.error.message : 'Could not send email');
        send.textContent = 'Sent';
        cancel.style.display = 'none'; subject.disabled = true; body.disabled = true;
        if (typeof appendRiverMessage === 'function') appendRiverMessage('river', 'Sent. I also logged the email automatically in ' + ((data.contact && data.contact.name) || 'this contact') + "'s relationship history.");
        if (typeof loadCmdContacts === 'function') await loadCmdContacts();
        if (typeof loadEmailDesk === 'function') loadEmailDesk();
        if (typeof loadRelationshipDesk === 'function') loadRelationshipDesk();
      } catch (error) {
        send.disabled = false; send.textContent = 'Approve & Send';
        toast(error.message || 'Could not send the approved email', true);
      }
    };
    bubble.appendChild(box);
  }

  async function handleRiverRelationship(text) {
    var input = document.getElementById('river-input');
    var sendBtn = document.getElementById('river-send-btn');
    if (typeof riverLoading !== 'undefined' && riverLoading) return;
    if (input) { input.value = ''; input.style.height = 'auto'; }
    if (sendBtn) sendBtn.disabled = true;
    if (typeof riverLoading !== 'undefined') riverLoading = true;
    if (typeof riverMessages !== 'undefined') riverMessages.push({ role:'user', content:text });
    appendRiverMessage('user', text);
    var loadingId = 'river-relationship-' + Date.now();
    appendRiverMessage('river', 'Adding the relationship and preparing the email for your approval...', loadingId, true);
    try {
      var response = await fetch('/api/river/relationship', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ instruction:text, messages: typeof riverMessages !== 'undefined' ? riverMessages.slice(-8) : [] }),
      });
      var payload = await safeJson(response);
      removeLoading(loadingId);
      if (!response.ok || !payload.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : 'River could not prepare the relationship');
      var data = payload.data || {};
      var contactName = data.contact && data.contact.name ? data.contact.name : 'the contact';
      var message = data.draft
        ? 'I added ' + contactName + ' to Command and prepared the email. Review it below. Nothing will send until you approve it.'
        : 'I added ' + contactName + ' to Command. I could not prepare an email because an email address or email goal is still missing.';
      if (typeof riverMessages !== 'undefined') riverMessages.push({ role:'assistant', content:message });
      var element = appendRiverMessage('river', message);
      var bubble = element && element.querySelector ? element.querySelector('.river-bubble') : null;
      if (bubble) renderRelationshipApproval(bubble, data);
      if (typeof loadCmdContacts === 'function') await loadCmdContacts();
      if (typeof loadRelationshipDesk === 'function') loadRelationshipDesk();
      if (typeof loadEmailDesk === 'function') loadEmailDesk();
    } catch (error) {
      removeLoading(loadingId);
      appendRiverMessage('river', 'I could not complete that relationship workflow: ' + (error.message || 'the request failed') + '.');
    } finally {
      if (typeof riverLoading !== 'undefined') riverLoading = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function installRiverRelationshipFlow() {
    if (typeof riverSend !== 'function' || riverSend.__relationshipFixed) return;
    var original = riverSend;
    var wrapped = function() {
      var input = document.getElementById('river-input');
      var text = input ? input.value.trim() : '';
      if (relationshipIntent(text)) return handleRiverRelationship(text);
      return original();
    };
    wrapped.__relationshipFixed = true;
    riverSend = wrapped;
  }

  function install() {
    installCheckboxFix();
    installComposerContactBinding();
    installCafeConvoComposerButton();
    installAiDraftFix();
    installReliableSendLogging();
    installReferralSourceFix();
    installRelationshipTimeline();
    installRiverRelationshipFlow();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(install, 0); });
  else setTimeout(install, 0);
})();
