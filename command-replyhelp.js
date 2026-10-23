/* Reply help: add a screenshot of a LinkedIn (or any) message and get replies written the way the founder writes.
   It already knows what they entered in Setup: their company, brands and booking link. Nothing is sent from here. */
(function () {
  'use strict';

  var state = { image: null, last: null, busy: false };
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function shrink(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var max = 1800, scale = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = reject; img.src = dataUrl;
    });
  }
  function readFile(file) { return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = reject; r.readAsDataURL(file); }); }
  function isPicture(file) { return file && (/^image\//.test(file.type || '') || /\.(png|jpe?g|gif|webp|heic)$/i.test(file.name || '')); }
  // A dragged or pasted screenshot can arrive as a file or as a clipboard item. Take whichever is there.
  function pictureFrom(transfer) {
    if (!transfer) return null;
    var files = [].slice.call(transfer.files || []).filter(isPicture);
    if (files.length) return files[0];
    var items = [].slice.call(transfer.items || []);
    for (var i = 0; i < items.length; i += 1) { if (items[i].kind === 'file') { var f = items[i].getAsFile(); if (isPicture(f) || (f && !f.type)) return f; } }
    return null;
  }
  async function useFile(file) {
    if (!file) { say('That did not come through. Try Choose screenshot, or copy the screenshot and paste it here.', true); return; }
    if (!isPicture(file) && file.type) { say('That file is not a picture. Add a screenshot (PNG or JPG).', true); return; }
    say('Reading the screenshot...');
    try { state.image = await shrink(await readFile(file)); paintPicture(); say('Screenshot added. Press Write replies.'); } catch (e) { say('That picture could not be read. Try another screenshot.', true); }
  }

  function modal() {
    var m = $('crh-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'crh-modal'; m.className = 'cmx-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Reply help');
      document.body.appendChild(m);
      m.addEventListener('click', onClick);
      m.addEventListener('paste', function (e) { var f = pictureFrom(e.clipboardData); if (f) { e.preventDefault(); useFile(f); } });
      var dropZone = function (on) { var z = $('crh-drop'); if (z) z.style.background = on ? 'rgba(85,64,160,.08)' : ''; };
      m.addEventListener('dragenter', function (e) { e.preventDefault(); dropZone(true); });
      m.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; dropZone(true); });
      m.addEventListener('dragleave', function (e) { if (e.target === m) dropZone(false); });
      m.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); dropZone(false); useFile(pictureFrom(e.dataTransfer)); });
      // Keep a dropped picture from opening in a new tab when it lands just outside the box.
      window.addEventListener('dragover', function (e) { if (m.classList.contains('cmx-open')) e.preventDefault(); });
      window.addEventListener('drop', function (e) { if (m.classList.contains('cmx-open') && !m.contains(e.target)) { e.preventDefault(); useFile(pictureFrom(e.dataTransfer)); } });
      m.addEventListener('change', function (e) { if (e.target.id === 'crh-file') useFile(e.target.files && e.target.files[0]); });
      document.addEventListener('paste', function (e) { if (!m.classList.contains('cmx-open')) return; var f = pictureFrom(e.clipboardData); if (f && !m.contains(e.target)) { e.preventDefault(); useFile(f); } });
    }
    return m;
  }

  function open() {
    var m = modal();
    m.innerHTML = '<div class="cmx-modal-card"><div class="cmx-modal-head"><h2 class="cmd-h2">Reply help</h2><button type="button" class="cmx-icon-btn" data-crh="close" aria-label="Close">&times;</button></div>' +
      '<div class="cmx-modal-body">' +
      '<div class="cmx-help" style="margin-bottom:10px">Add a screenshot of the conversation. It already knows what you entered in Setup: your company, your brands and your booking link. Nothing sends from here.</div>' +
      '<div id="crh-drop" class="crh-drop"><div id="crh-picture"></div><label class="cmx-btn crh-pick">Choose screenshot<input id="crh-file" type="file" accept="image/*" hidden></label><div class="cmx-help">Or paste it here (Ctrl+V or Cmd+V), or drop it in.</div></div>' +
      '<details class="crh-more"><summary>Paste the words instead</summary><textarea id="crh-text" rows="5" placeholder="Paste the conversation here"></textarea></details>' +
      '<label class="cmx-field" style="margin-top:12px"><span>What you want to say (optional)</span><textarea id="crh-ask" rows="2" placeholder="For example: say yes to a call next week, or politely say no"></textarea></label>' +
      '<div id="crh-out"></div>' +
      '<details class="crh-more" id="crh-notes-box"><summary>More to know</summary><div class="cmx-help">Add anything new it should know, like a new program, an event or a person. It uses this every time.</div><textarea id="crh-notes" rows="5"></textarea><div style="margin-top:6px"><button type="button" class="cmx-btn" data-crh="save-notes">Save</button></div></details>' +
      '</div><div class="cmx-modal-foot"><button type="button" class="cmx-btn" data-crh="clear">Start over</button><span class="cmx-spacer"></span><button type="button" class="cmd-primary-btn" data-crh="write">Write replies</button></div></div>';
    m.classList.add('cmx-open');
    paintPicture();
    fetch('/api/ai/message-help', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (p) { var n = $('crh-notes'); if (n && p && p.data) n.value = p.data.notes || ''; }).catch(function () {});
  }
  function close() { var m = $('crh-modal'); if (m) m.classList.remove('cmx-open'); }

  function paintPicture() {
    var el = $('crh-picture'); if (!el) return;
    el.innerHTML = state.image ? '<img src="' + state.image + '" alt="Your screenshot" class="crh-img"><button type="button" class="cmx-btn" data-crh="remove-picture">Remove picture</button>' : '';
  }
  function say(message, bad) { var out = $('crh-out'); if (out) out.innerHTML = '<div class="cmx-help" style="margin-top:12px;' + (bad ? 'color:#9b2c2c' : '') + '">' + esc(message) + '</div>'; }

  function paintResult(r) {
    var out = $('crh-out'); if (!out) return;
    out.innerHTML = '<div class="crh-result">' +
      (r.who || r.they_said ? '<div class="crh-read"><strong>' + esc(r.who || 'Their message') + '</strong>' + (r.they_said ? '<div>' + esc(r.they_said) + '</div>' : '') + '</div>' : '') +
      (r.watch_for ? '<div class="cmx-flagged" style="margin-top:8px">' + esc(r.watch_for) + '</div>' : '') +
      r.replies.map(function (rep, i) {
        return '<div class="crh-reply"><div class="crh-reply-head"><strong>' + esc(rep.label) + '</strong><button type="button" class="cmx-btn cmx-btn-main" data-crh="copy" data-i="' + i + '">Copy</button></div><textarea id="crh-reply-' + i + '" rows="' + Math.min(10, Math.max(3, Math.ceil(rep.text.length / 70) + rep.text.split('\n').length)) + '">' + esc(rep.text) + '</textarea></div>';
      }).join('') +
      '<div class="crh-tweaks"><span class="cmx-help">Change all three:</span>' +
      ['Shorter', 'Warmer', 'More direct', 'Add my booking link', 'Without links'].map(function (t) { return '<button type="button" class="cmx-btn" data-crh="tweak" data-tweak="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') +
      '</div></div>';
  }

  async function write(tweak) {
    if (state.busy) return;
    var text = ($('crh-text') || {}).value || '';
    var ask = ($('crh-ask') || {}).value || '';
    if (!state.image && !text.trim()) { say('Add a screenshot or paste the words first.', true); return; }
    state.busy = true; say(tweak ? 'Changing the replies...' : 'Reading the conversation and writing replies...');
    try {
      var r = await fetch('/api/ai/message-help', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_data: state.image, text: text, ask: ask, tweak: tweak || '' }) });
      var p = await r.json().catch(function () { return {}; });
      if (!r.ok || p.ok === false) throw new Error((p.error && p.error.message) || 'That did not work. Try again.');
      state.last = p.data; paintResult(p.data);
    } catch (e) { say(e.message || 'That did not work. Try again.', true); }
    finally { state.busy = false; }
  }

  async function copy(i, button) {
    var t = $('crh-reply-' + i); if (!t) return;
    try { await navigator.clipboard.writeText(t.value); } catch (e) { t.select(); try { document.execCommand('copy'); } catch (_) {} }
    var was = button.textContent; button.textContent = 'Copied'; setTimeout(function () { button.textContent = was; }, 1500);
  }

  async function saveNotes(button) {
    var notes = ($('crh-notes') || {}).value || '';
    button.disabled = true; button.textContent = 'Saving...';
    try {
      var r = await fetch('/api/ai/message-help', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_notes', notes: notes }) });
      if (!r.ok) throw new Error('save');
      button.textContent = 'Saved';
    } catch (e) { button.textContent = 'Try again'; }
    setTimeout(function () { button.disabled = false; button.textContent = 'Save'; }, 1500);
  }

  function onClick(e) {
    if (e.target.id === 'crh-modal') { close(); return; }
    var b = e.target.closest('[data-crh]'); if (!b) return;
    var what = b.dataset.crh;
    if (what === 'close') close();
    else if (what === 'write') write('');
    else if (what === 'tweak') write(b.dataset.tweak);
    else if (what === 'copy') copy(b.dataset.i, b);
    else if (what === 'remove-picture') { state.image = null; paintPicture(); }
    else if (what === 'clear') { state.image = null; state.last = null; open(); }
    else if (what === 'save-notes') saveNotes(b);
  }

  window.CommandReplyHelp = { open: open };
})();
