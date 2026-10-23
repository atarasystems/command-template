/* River screenshot attachments: Safari-safe picker, paste, and drag/drop. */
(function () {
  'use strict';

  var attachment = null;
  var installAttempts = 0;

  function safeJson(response) { return response.json().catch(function () { return {}; }); }
  function toast(message, isError) { if (typeof showToast === 'function') showToast(message, Boolean(isError)); }
  function removeLoading(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var row = el.closest('.river-msg');
    if (row) row.remove(); else el.remove();
  }
  function isImageFile(file) {
    return Boolean(file && (/^image\/(png|jpeg|jpg|webp)$/i.test(file.type || '') || /\.(png|jpe?g|webp)$/i.test(file.name || '')));
  }

  function renderAttachmentState() {
    var preview = document.getElementById('river-screenshot-preview');
    var button = document.getElementById('river-screenshot-button');
    if (!preview || !button) return;
    if (!attachment) {
      preview.style.display = 'none';
      preview.innerHTML = '';
      button.textContent = 'Add screenshot';
      return;
    }
    button.textContent = 'Change screenshot';
    preview.style.display = 'flex';
    preview.innerHTML = '';

    var img = document.createElement('img');
    img.src = attachment.dataUrl;
    img.alt = 'Attached screenshot';
    img.style.cssText = 'width:54px;height:42px;object-fit:cover;border:1px solid var(--color-border);border-radius:7px;';

    var meta = document.createElement('div');
    meta.style.cssText = 'min-width:0;flex:1;';
    var name = document.createElement('div');
    name.textContent = attachment.name || 'Screenshot';
    name.style.cssText = 'font-size:12px;font-weight:600;color:var(--color-navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    var hint = document.createElement('div');
    hint.textContent = 'River will read this image with your message.';
    hint.style.cssText = 'font-size:11px;color:var(--color-secondary);margin-top:2px;';
    meta.appendChild(name); meta.appendChild(hint);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.className = 'btn btn-outline btn-sm';
    remove.style.cssText = 'padding:4px 8px;min-height:30px;';
    remove.onclick = function () { attachment = null; renderAttachmentState(); };

    preview.appendChild(img); preview.appendChild(meta); preview.appendChild(remove);
  }

  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!isImageFile(file)) return reject(new Error('Use a PNG, JPEG, or WebP screenshot.'));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read that screenshot. Try saving it first, then attach it again.')); };
      reader.onload = function () {
        var image = new Image();
        image.onerror = function () { reject(new Error('Could not open that screenshot.')); };
        image.onload = function () {
          try {
            var maxEdge = 2200;
            var scale = Math.min(1, maxEdge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
            var width = Math.max(1, Math.round(image.naturalWidth * scale));
            var height = Math.max(1, Math.round(image.naturalHeight * scale));
            var canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, width, height);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            if (dataUrl.length > 4000000) dataUrl = canvas.toDataURL('image/jpeg', 0.80);
            if (dataUrl.length > 4000000) return reject(new Error('That screenshot is too large. Crop it closer to the relevant information and try again.'));
            resolve({ dataUrl: dataUrl, name: file.name || 'Screenshot' });
          } catch (error) { reject(error); }
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function attachFile(file) {
    try {
      attachment = await compressImage(file);
      renderAttachmentState();
      toast('Screenshot attached');
    } catch (error) {
      toast(error.message || 'Could not attach screenshot', true);
    }
  }

  function setDropVisual(active) {
    var controls = document.getElementById('river-screenshot-controls');
    if (!controls) return;
    controls.style.outline = active ? '2px dashed var(--color-teal)' : '';
    controls.style.outlineOffset = active ? '4px' : '';
    controls.style.borderRadius = active ? '10px' : '';
  }

  function installAttachmentUi() {
    if (document.getElementById('river-screenshot-button')) return true;
    var input = document.getElementById('river-input');
    if (!input || !input.parentNode) return false;

    var controls = document.createElement('div');
    controls.id = 'river-screenshot-controls';
    controls.style.cssText = 'display:flex;flex-direction:column;gap:7px;margin-bottom:8px;';

    var preview = document.createElement('div');
    preview.id = 'river-screenshot-preview';
    preview.style.cssText = 'display:none;align-items:center;gap:8px;padding:8px;background:var(--color-gray-light);border:1px solid var(--color-border);border-radius:10px;';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:7px;align-items:center;flex-wrap:wrap;';
    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'river-screenshot-button';
    button.className = 'btn btn-outline btn-sm';
    button.textContent = 'Add screenshot';
    button.title = 'Attach a screenshot for River to read';

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'river-screenshot-file';
    fileInput.accept = 'image/png,image/jpeg,image/webp';
    fileInput.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';

    button.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      fileInput.click();
    };
    fileInput.onchange = function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (file) attachFile(file);
    };

    var hint = document.createElement('span');
    hint.textContent = 'Click, paste, or drag a screenshot here.';
    hint.style.cssText = 'font-size:11px;color:var(--color-secondary);';

    row.appendChild(button); row.appendChild(fileInput); row.appendChild(hint);
    controls.appendChild(preview); controls.appendChild(row);
    input.parentNode.insertBefore(controls, input);

    input.addEventListener('paste', function (event) {
      var items = Array.from((event.clipboardData && event.clipboardData.items) || []);
      var imageItem = items.find(function (item) { return /^image\//i.test(item.type || ''); });
      if (!imageItem) return;
      var file = imageItem.getAsFile();
      if (file) { event.preventDefault(); attachFile(file); }
    });

    // Safari will otherwise navigate the current tab to a macOS screenshot's temporary file path.
    document.addEventListener('dragover', function (event) {
      var types = Array.from((event.dataTransfer && event.dataTransfer.types) || []);
      if (!types.includes('Files') && !types.includes('public.file-url')) return;
      event.preventDefault();
      try { event.dataTransfer.dropEffect = 'copy'; } catch (_) {}
      setDropVisual(true);
    }, true);
    document.addEventListener('dragleave', function (event) {
      if (!event.relatedTarget) setDropVisual(false);
    }, true);
    document.addEventListener('drop', function (event) {
      var files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      setDropVisual(false);
      var image = files.find(isImageFile);
      if (!image) return toast('Drop a PNG, JPEG, or WebP screenshot into River.', true);
      attachFile(image);
    }, true);

    return true;
  }

  function appendUserScreenshot(text, imageData) {
    var element = appendRiverMessage('user', text || 'Read this screenshot.');
    var bubble = element && element.querySelector ? element.querySelector('.river-bubble') : null;
    if (!bubble || !imageData) return;
    var img = document.createElement('img');
    img.src = imageData;
    img.alt = 'Screenshot sent to River';
    img.style.cssText = 'display:block;max-width:220px;max-height:150px;object-fit:contain;border-radius:8px;margin-top:8px;border:1px solid rgba(255,255,255,.28);background:#fff;';
    bubble.appendChild(img);
  }

  function refreshOpportunityViews() {
    try { if (typeof loadProgramOpportunities === 'function') loadProgramOpportunities(); } catch (_) {}
    try { if (typeof loadOpportunityHub === 'function') loadOpportunityHub(); } catch (_) {}
    try { if (typeof refreshCommandData === 'function') refreshCommandData(); } catch (_) {}
  }

  function riverScreenshotMessage(data) {
    var parts = [];
    if (data.opportunity_result) {
      parts.push((data.opportunity_result.created ? 'Added ' : 'Already in the pipeline: ') + data.opportunity_result.title + (data.opportunity_result.organization ? ' (' + data.opportunity_result.organization + ')' : '') + '. Status: ' + data.opportunity_result.status + '.');
    } else if (data.requested && data.requested.opportunity && data.opportunity) {
      parts.push('I found the opportunity details, but it was not added.');
    }
    if (data.requested && data.requested.calendar) {
      if ((data.calendar_candidates || []).length) parts.push('I found ' + data.calendar_candidates.length + ' calendar item' + (data.calendar_candidates.length === 1 ? '' : 's') + '. Review the dates below before I add them.');
      else parts.push('I did not find a specific calendar date in this screenshot, so I did not add anything to your calendar.');
    }
    if (!parts.length && data.summary) parts.push(data.summary);
    return parts.join(' ');
  }

  async function handleScreenshot(text) {
    var current = attachment;
    if (!current) return;
    var input = document.getElementById('river-input');
    var sendBtn = document.getElementById('river-send-btn');
    if (typeof riverLoading !== 'undefined' && riverLoading) return;
    if (input) { input.value = ''; input.style.height = 'auto'; }
    if (sendBtn) sendBtn.disabled = true;
    if (typeof riverLoading !== 'undefined') riverLoading = true;
    attachment = null;
    renderAttachmentState();

    var userText = text || 'Read this screenshot.';
    if (typeof riverMessages !== 'undefined') riverMessages.push({ role: 'user', content: userText + '\n[River screenshot attached]' });
    appendUserScreenshot(userText, current.dataUrl);
    var loadingId = 'river-screenshot-' + Date.now();
    appendRiverMessage('river', 'Reading the screenshot and handling your request...', loadingId, true);

    try {
      var response = await fetch('/api/river/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: userText, image_data: current.dataUrl })
      });
      var payload = await safeJson(response);
      removeLoading(loadingId);
      if (!response.ok || !payload.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : 'River could not read the screenshot');
      var data = payload.data || {};
      var message = riverScreenshotMessage(data);
      if (typeof riverMessages !== 'undefined') riverMessages.push({ role: 'assistant', content: message + (data.screenshot_text ? '\n[Extracted screenshot facts] ' + data.screenshot_text : '') });
      var element = appendRiverMessage('river', message);
      var bubble = element && element.querySelector ? element.querySelector('.river-bubble') : null;
      if (data.opportunity_result) refreshOpportunityViews();
      if (bubble && data.calendar_action_token && Array.isArray(data.calendar_candidates) && data.calendar_candidates.length && typeof riverCalendarRenderPreview === 'function') {
        riverCalendarRenderPreview(bubble, data.calendar_candidates, data.calendar_action_token);
      }
    } catch (error) {
      removeLoading(loadingId);
      attachment = current;
      renderAttachmentState();
      appendRiverMessage('river', 'I could not complete that screenshot request: ' + (error.message || 'the screenshot could not be read') + '.');
    } finally {
      if (typeof riverLoading !== 'undefined') riverLoading = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function wrapRiverSend() {
    if (typeof riverSend !== 'function') return false;
    if (riverSend.__screenshotWrapped) return true;
    var original = riverSend;
    var wrapped = function () {
      var input = document.getElementById('river-input');
      var text = input ? input.value.trim() : '';
      if (attachment) return handleScreenshot(text);
      return original();
    };
    wrapped.__screenshotWrapped = true;
    wrapped.__wrappedOriginal = original;
    riverSend = wrapped;
    return true;
  }

  function install() {
    installAttempts += 1;
    var uiReady = installAttachmentUi();
    var sendReady = wrapRiverSend();
    if ((!uiReady || !sendReady) && installAttempts < 40) return setTimeout(install, 200);
    setTimeout(function () {
      if (typeof riverSend === 'function' && !riverSend.__screenshotWrapped) wrapRiverSend();
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(install, 100); });
  else setTimeout(install, 100);
})();
