/* Email Desk UX guard: normalize email text, preview URLs, and keep founder approval reversible until send. */
(function () {
  'use strict';

  var attempts = 0;
  var approvedSnapshot = null;
  var editTimer = null;

  function normalizeEmailBody(value) {
    var text = String(value == null ? '' : value)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n');

    text = text
      .split('\n')
      .map(function (line) { return line.replace(/[ \t]+$/g, ''); })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');

    return text.trim();
  }

  function urlsIn(value) {
    var matches = String(value || '').match(/https?:\/\/[^\s<>"']+/g) || [];
    return Array.from(new Set(matches));
  }

  function renderLinkPreview(textarea) {
    if (!textarea || !textarea.parentNode) return;
    var id = 'email-draft-live-links';
    var existing = document.getElementById(id);
    var urls = urlsIn(textarea.value);

    if (!urls.length) {
      if (existing) existing.remove();
      return;
    }

    var box = existing || document.createElement('div');
    box.id = id;
    box.style.marginTop = '10px';
    box.style.fontSize = '14px';
    box.style.lineHeight = '1.5';
    box.style.color = '#52627a';
    box.innerHTML = '';

    var label = document.createElement('span');
    label.textContent = urls.length === 1 ? 'Live link: ' : 'Live links: ';
    label.style.fontWeight = '700';
    box.appendChild(label);

    urls.forEach(function (url, index) {
      if (index) box.appendChild(document.createTextNode('  '));
      var link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = url.replace(/^https?:\/\//, '');
      link.style.color = '#2f6f5e';
      link.style.textDecoration = 'underline';
      link.style.fontWeight = '700';
      box.appendChild(link);
    });

    if (!existing) textarea.insertAdjacentElement('afterend', box);
  }

  function currentDraft() {
    try { return activeEmailDraft || null; } catch (_) { return null; }
  }

  function setCurrentDraft(value) {
    try { activeEmailDraft = value; } catch (_) {}
  }

  function isApproved(draft) {
    return !!draft && (draft.status === 'approved' || draft.status === 'ready_to_send') && draft.needs_human !== true;
  }

  function visibleValues() {
    var subject = document.getElementById('email-draft-subject');
    var body = document.getElementById('email-draft-body');
    return {
      subject: subject ? subject.value.trim() : '',
      body: body ? normalizeEmailBody(body.value) : ''
    };
  }

  function snapshot(values) {
    return JSON.stringify([values.subject, values.body]);
  }

  function actionButtons() {
    var panel = document.getElementById('email-draft-panel');
    var result = { approve: null, send: null };
    if (!panel) return result;
    Array.from(panel.querySelectorAll('button')).forEach(function (button) {
      var text = String(button.textContent || '').trim();
      if (text === 'Approve' || text === 'Unapprove') result.approve = button;
      if (text === 'Send') result.send = button;
    });
    return result;
  }

  function syncApprovalUi() {
    var draft = currentDraft();
    var approved = isApproved(draft);
    var found = actionButtons();

    if (found.approve) {
      found.approve.textContent = approved ? 'Unapprove' : 'Approve';
      found.approve.onclick = function () { window.updateEmailDraft(approved ? 'unapprove' : 'approve'); };
      found.approve.setAttribute('aria-pressed', approved ? 'true' : 'false');
    }

    if (found.send) {
      found.send.disabled = !approved;
      found.send.setAttribute('aria-disabled', approved ? 'false' : 'true');
      found.send.title = approved ? 'Send this approved email' : 'Approve this draft before sending';
      found.send.style.opacity = approved ? '1' : '0.48';
      found.send.style.cursor = approved ? 'pointer' : 'not-allowed';
    }

    var meta = document.getElementById('email-draft-meta');
    if (meta && draft) {
      meta.textContent = (draft.to_email || 'Audience') + ' · ' + (approved ? 'approved - ready to send' : String(draft.status || 'needs_review').replace(/_/g, ' '));
    }
  }

  async function saveVisibleDraftAsReview(reason) {
    var draft = currentDraft();
    if (!draft || typeof emailDeskApi !== 'function') return null;
    var values = visibleValues();
    var updated = await emailDeskApi('?id=' + encodeURIComponent(draft.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: values.subject,
        body: values.body,
        status: 'needs_review',
        needs_human: true,
        human_reason: reason || 'Founder review required before sending'
      })
    });
    setCurrentDraft(updated);
    return updated;
  }

  function revokeApprovalAfterEdit() {
    var draft = currentDraft();
    if (!isApproved(draft) && !approvedSnapshot) return;

    if (editTimer) clearTimeout(editTimer);
    if (draft) {
      draft.status = 'needs_review';
      draft.needs_human = true;
      draft.human_reason = 'Draft changed after approval; founder re-approval required before sending';
      setCurrentDraft(draft);
    }
    approvedSnapshot = null;
    syncApprovalUi();

    editTimer = setTimeout(async function () {
      try {
        await saveVisibleDraftAsReview('Draft changed after approval; founder re-approval required before sending');
        if (typeof loadEmailDesk === 'function') await loadEmailDesk();
      } catch (error) {
        if (typeof showToast === 'function') showToast(error.message || 'Could not remove approval after edit', true);
      }
    }, 400);
  }

  function ensureSampleReportPurpose() {
    var select = document.getElementById('communication-prep-purpose');
    if (!select || select.querySelector('option[value="sample_report"]')) return;
    var option = document.createElement('option');
    option.value = 'sample_report';
    option.textContent = 'Send sample report';
    var followUp = select.querySelector('option[value="follow_up"]');
    if (followUp && followUp.nextSibling) select.insertBefore(option, followUp.nextSibling);
    else select.appendChild(option);
  }

  window.normalizeCommandEmailBody = normalizeEmailBody;

  function install() {
    attempts += 1;
    ensureSampleReportPurpose();
    if (typeof window.openEmailDraft !== 'function' || typeof window.updateEmailDraft !== 'function') {
      if (attempts < 80) setTimeout(install, 150);
      return;
    }
    if (window.openEmailDraft.__emailDeskApprovalGuard) return;

    var originalOpen = window.openEmailDraft;
    var originalUpdate = window.updateEmailDraft;

    window.openEmailDraft = async function (id) {
      var result = await originalOpen.apply(this, arguments);
      var textarea = document.getElementById('email-draft-body');
      var draft = currentDraft();
      if (!textarea) return result;

      var source = draft && draft.body != null ? draft.body : textarea.value;
      var normalized = normalizeEmailBody(source);
      textarea.value = normalized;
      renderLinkPreview(textarea);

      if (draft && normalized !== String(source || '') && typeof emailDeskApi === 'function') {
        try {
          var healed = await emailDeskApi('?id=' + encodeURIComponent(draft.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: normalized })
          });
          setCurrentDraft(healed);
          draft = healed;
        } catch (_) {}
      }

      approvedSnapshot = isApproved(draft) ? snapshot(visibleValues()) : null;
      syncApprovalUi();
      return result;
    };
    window.openEmailDraft.__emailDeskApprovalGuard = true;

    window.updateEmailDraft = async function (action) {
      var draft = currentDraft();
      if (!draft) return;

      if (action !== 'approve' && action !== 'unapprove' && action !== 'send') {
        return originalUpdate.apply(this, arguments);
      }

      if (editTimer) {
        clearTimeout(editTimer);
        editTimer = null;
      }

      try {
        if (action === 'approve') {
          await saveVisibleDraftAsReview('Founder review required before sending');
          draft = currentDraft();
          var approved = await emailDeskApi('?id=' + encodeURIComponent(draft.id) + '&action=approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          });
          setCurrentDraft(approved);
          approvedSnapshot = snapshot(visibleValues());
          syncApprovalUi();
          if (typeof loadEmailDesk === 'function') await loadEmailDesk();
          if (typeof showToast === 'function') showToast('Draft approved. Review once more, then send.');
          return;
        }

        if (action === 'unapprove') {
          var unapproved = await saveVisibleDraftAsReview('Founder removed approval before sending');
          setCurrentDraft(unapproved);
          approvedSnapshot = null;
          syncApprovalUi();
          if (typeof loadEmailDesk === 'function') await loadEmailDesk();
          if (typeof showToast === 'function') showToast('Approval removed.');
          return;
        }

        if (action === 'send') {
          draft = currentDraft();
          if (!isApproved(draft)) {
            syncApprovalUi();
            if (typeof showToast === 'function') showToast('Approve this draft before sending.', true);
            return;
          }
          if (approvedSnapshot && snapshot(visibleValues()) !== approvedSnapshot) {
            await saveVisibleDraftAsReview('Draft changed after approval; founder re-approval required before sending');
            approvedSnapshot = null;
            syncApprovalUi();
            if (typeof showToast === 'function') showToast('The draft changed after approval. Please approve it again before sending.', true);
            return;
          }
          return originalUpdate.call(this, 'send');
        }
      } catch (error) {
        syncApprovalUi();
        if (typeof showToast === 'function') showToast(error.message || 'Email Desk update failed', true);
      }
    };

    var body = document.getElementById('email-draft-body');
    var subject = document.getElementById('email-draft-subject');

    if (body && !body.dataset.paragraphGuard) {
      body.dataset.paragraphGuard = '1';
      body.addEventListener('blur', function () {
        body.value = normalizeEmailBody(body.value);
        renderLinkPreview(body);
      });
      body.addEventListener('input', function () {
        renderLinkPreview(body);
        revokeApprovalAfterEdit();
      });
    }

    if (subject && !subject.dataset.approvalGuard) {
      subject.dataset.approvalGuard = '1';
      subject.addEventListener('input', revokeApprovalAfterEdit);
    }

    syncApprovalUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(install, 100); });
  } else {
    setTimeout(install, 100);
  }
})();
