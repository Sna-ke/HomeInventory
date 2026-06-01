// ── Vision / Identify ─────────────────────────────────────────────────────
let visionConfig = { backend: 'none', ready: false };

async function loadVisionConfig() {
  try {
    visionConfig = await api('/api/vision-config');
    const noVisionMsg = document.getElementById('atb-no-vision-msg');
    const visionUi = document.getElementById('atb-vision-ui');

    if (visionConfig.ready) {
      if (noVisionMsg) noVisionMsg.style.display = 'none';
      if (visionUi) visionUi.style.display = 'block';
      const label = visionConfig.backend === 'ollama'
        ? `🤖 Ollama (${visionConfig.model})`
        : '☁️ Anthropic Claude';
      document.getElementById('atb-identify-status').textContent = label;
    } else {
      if (visionUi) visionUi.style.display = 'none';
      if (noVisionMsg) {
        // Show warning with detail if available
        const msg = visionConfig.warning
          ? visionConfig.warning
          : (visionConfig.backend === 'none'
            ? 'Vision identification not configured. Set a backend in the app configuration.'
            : 'Vision backend not ready.');
        noVisionMsg.textContent = msg;
        noVisionMsg.style.display = 'block';

        // Show available models as hints if Ollama is configured but model missing
        if (visionConfig.backend === 'ollama' && visionConfig.available_models && visionConfig.available_models.length) {
          const hint = document.createElement('div');
          hint.style.cssText = 'margin-top:8px;font-size:11px;color:var(--muted);';
          hint.textContent = 'Installed models: ' + visionConfig.available_models.join(', ');
          noVisionMsg.appendChild(hint);
        }
      }
    }
  } catch(e) {
    // Vision not available — silently hide
  }
}

function triggerIdentifyPhoto() {
  const inp = document.getElementById('atb-identify-input');
  inp.value = '';
  inp.click();
}

// ── Image identification state ─────────────────────────────────────────────
let imageResults = [];
let imageSelectedIdx = 0;
let imagePendingMerge = null;

function resetImageUI() {
  imageResults = [];
  imageSelectedIdx = 0;
  imagePendingMerge = null;
  document.getElementById('atb-image-result').innerHTML = '';
  document.getElementById('atb-image-merge').style.display = 'none';
  document.getElementById('atb-identify-status').textContent = '';
}

function renderImageResults(results) {
  imageResults = results;
  imageSelectedIdx = 0;
  const el = document.getElementById('atb-image-result');
  el.innerHTML = '';
  results.forEach((r, idx) => {
    const card = document.createElement('div');
    card.className = 'barcode-result-card' + (idx === 0 ? ' selected' : '');
    card.dataset.idx = idx;
    const nameEl = document.createElement('div');
    nameEl.className = 'barcode-card-name';
    nameEl.textContent = r.name;
    const srcEl = document.createElement('div');
    srcEl.className = 'barcode-card-source';
    srcEl.textContent = r.source === 'local' ? '✓ Saved' : '🤖 AI';
    card.appendChild(nameEl); card.appendChild(srcEl);
    card.addEventListener('click', () => {
      el.querySelectorAll('.barcode-result-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      imageSelectedIdx = idx;
    });
    el.appendChild(card);
  });
}

async function imageAddSelected() {
  const r = imageResults[imageSelectedIdx];
  if (!r) { toast('No item selected', true); return; }
  if (!addToBoxId) { toast('Select a box first', true); return; }

  // If this is an AI suggestion (no id), check for name match in local DB
  if (!r.id) {
    const matches = await api(`/api/items/find-by-name?name=${encodeURIComponent(r.name)}`);
    if (matches.length) {
      const noUpc = matches.filter(m => !m.upc);
      const withUpc = matches.filter(m => m.upc);
      // Exact existing item with no UPC → offer merge
      if (noUpc.length) {
        imagePendingMerge = { result: r, matchedItem: noUpc[0] };
        const msg = document.getElementById('atb-image-merge-msg');
        msg.textContent = `"${noUpc[0].name}" already exists in your inventory. Use the existing item or create a new one?`;
        document.getElementById('atb-image-merge').style.display = 'block';
        return;
      }
      // Has UPC already — use the existing item directly
      if (withUpc.length) {
        await finishImageAdd(withUpc[0].id, withUpc[0].name, false);
        return;
      }
    }
  }

  await finishImageAdd(r.id || null, r.name, !r.id);
}

async function imageMergeConfirm() {
  if (!imagePendingMerge) return;
  const { matchedItem } = imagePendingMerge;
  document.getElementById('atb-image-merge').style.display = 'none';
  await finishImageAdd(matchedItem.id, matchedItem.name, false);
}

async function imageKeepSeparate() {
  if (!imagePendingMerge) return;
  const { result } = imagePendingMerge;
  document.getElementById('atb-image-merge').style.display = 'none';
  imagePendingMerge = null;
  await finishImageAdd(null, result.name, true);
}

async function finishImageAdd(item_id, name, createNew) {
  if (createNew) {
    const newItem = await api('/api/items', { method: 'POST', body: JSON.stringify({ name }) });
    item_id = newItem.id;
  }
  const qty = parseInt(document.getElementById('atb-qty').value) || 1;
  const notes = document.getElementById('atb-notes').value.trim();
  const photoCount = atbPendingPhotos.filter(Boolean).length;
  if (photoCount > 0) await uploadPendingPhotos(item_id);

  const result = await api(`/api/boxes/${addToBoxId}/items`, {
    method: 'POST', body: JSON.stringify({ item_id, quantity: qty, notes })
  });
  closeModal('modal-atb');
  toast(result.incremented ? `Qty updated to ${result.quantity}` : `${name} added`);
  trackRecentItem(item_id);
  trackRecentBox(addToBoxId);
  const boxField = document.getElementById('atb-box-field');
  if (boxField.style.display === 'none') refreshBoxItemsInPlace(addToBoxId);
}

async function handleIdentifyPhoto(input) {
  if (!input.files.length) return;
  const file = input.files[0];
  const statusEl = document.getElementById('atb-identify-status');
  const btn = document.getElementById('atb-identify-btn');

  resetImageUI();
  statusEl.innerHTML = '<span class="spinner"></span> Identifying…';
  btn.disabled = true;

  // Stage as item photo
  atbPendingPhotos.push(file);
  const url = URL.createObjectURL(file);
  const idx = atbPendingPhotos.length - 1;
  const div = document.createElement('div');
  div.className = 'gallery-item';
  div.id = `atb-pending-${idx}`;
  div.innerHTML = `<img src="${url}"><button class="del-img" onclick="removeATBPhoto(${idx})">✕</button>`;
  document.getElementById('atb-photo-preview').appendChild(div);

  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(API_BASE + '/api/identify', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Identification failed');

    const suggestions = data.suggestions || [];
    if (!suggestions.length) {
      statusEl.textContent = 'Nothing detected — switch to By Name tab';
      return;
    }
    statusEl.textContent = 'Select a match:';
    renderImageResults(suggestions.map(n => ({ name: n, source: 'ai' })));
  } catch(e) {
    statusEl.textContent = `Error: ${e.message}`;
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ── Add Item to Box ────────────────────────────────────────────────────────
let atbPendingPhotos = []; // File objects staged before the item is saved

let lastUsedBoxId = null; // persists across quick-add calls

function openAddToBoxModal(boxId) {
  // Called from box detail page — box is known, hide box selector
  addToBoxId = boxId;
  lastUsedBoxId = boxId;
  document.getElementById('atb-box-field').style.display = 'none';
  resetATBModal();
}

function toggleQuickAddMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('quick-add-menu');
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Position the menu below the button
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    menu.style.top = rect.bottom + 'px';
    menu.style.left = rect.left + 'px';
  }
}

document.addEventListener('click', () => {
  const menu = document.getElementById('quick-add-menu');
  if (menu) menu.style.display = 'none';
});

function openQuickAddWithTab(tab) {
  const menu = document.getElementById('quick-add-menu');
  if (menu) menu.style.display = 'none';
  // openQuickAddItem sets up box field then we switch tab
  openQuickAddItem();
  // setATBTab is called in resetATBModal to 'name'; override after
  setTimeout(() => setATBTab(tab), 0);
}

function openQuickAddItem() {
  // Called from topbar — box unknown, show box selector
  addToBoxId = lastUsedBoxId; // pre-fill with last used box if available
  document.getElementById('atb-box-field').style.display = 'block';
  // Pre-fill box selector if we have a last-used box
  if (lastUsedBoxId) {
    const box = (window._lastBoxes || []).find(b => b.id === lastUsedBoxId);
    if (box) setATBBox(box.id, `BOX ${box.box_number}${box.label ? ' · ' + box.label : ''}`);
  } else {
    clearATBBox();
  }
  resetATBModal();
}

function resetATBModal() {
  atbPendingPhotos = [];
  document.getElementById('atb-search').value = '';
  document.getElementById('atb-item-id').value = '';
  document.getElementById('atb-category').value = '';
  document.getElementById('atb-qty').value = '1';
  document.getElementById('atb-notes').value = '';
  document.getElementById('atb-photo-preview').innerHTML = '';
  document.getElementById('atb-photo-input').value = '';
  document.getElementById('atb-identify-input').value = '';
  document.getElementById('atb-barcode-input').value = '';
  resetImageUI();
  resetBarcodeUI();
  closeAllATBDropdowns();
  setATBSelection(null, null, null);
  setATBTab('name'); // always start on By Name tab
  openModal('modal-atb');
}

function setATBBox(id, label) {
  addToBoxId = id;
  lastUsedBoxId = id;
  trackRecentBox(id);
  document.getElementById('atb-box-selected-name').textContent = label;
  document.getElementById('atb-box-selected-badge').style.display = 'flex';
  document.getElementById('atb-box-search').style.display = 'none';
  document.getElementById('atb-box-suggestions').classList.remove('open');
}

function clearATBBox() {
  addToBoxId = null;
  document.getElementById('atb-box-search').value = '';
  document.getElementById('atb-box-search').style.display = '';
  document.getElementById('atb-box-selected-badge').style.display = 'none';
  document.getElementById('atb-create-box-panel').style.display = 'none';
  document.getElementById('atb-box-search').focus();
}

// ── Recency tracking ──────────────────────────────────────────────────────
// Stored as arrays of IDs, most recent first, capped at 20 entries.
const recentItemIds = [];
const recentBoxIds  = [];

function trackRecentItem(id) {
  const idx = recentItemIds.indexOf(id);
  if (idx !== -1) recentItemIds.splice(idx, 1);
  recentItemIds.unshift(id);
  if (recentItemIds.length > 20) recentItemIds.pop();
}

function trackRecentBox(id) {
  const idx = recentBoxIds.indexOf(id);
  if (idx !== -1) recentBoxIds.splice(idx, 1);
  recentBoxIds.unshift(id);
  if (recentBoxIds.length > 20) recentBoxIds.pop();
}

function sortByRecency(items, recentIds, idKey) {
  return [...items].sort((a, b) => {
    const ai = recentIds.indexOf(a[idKey]);
    const bi = recentIds.indexOf(b[idKey]);
    // Recent items first (lower index = more recent); untracked items go last alphabetically
    if (ai === -1 && bi === -1) return 0; // preserve existing order (already alpha)
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// ── Box search ─────────────────────────────────────────────────────────────
async function getBoxesCached() {
  if (!window._lastBoxes || !window._lastBoxes.length) {
    window._lastBoxes = await api('/api/boxes');
  }
  return window._lastBoxes;
}

function renderBoxSuggestions(boxes, list, createLabel) {
  list.innerHTML = '';
  boxes.forEach(b => {
    const opt = document.createElement('div');
    opt.className = 'ac-item';
    opt.dataset.boxId = b.id;
    opt.dataset.boxLabel = `BOX ${b.box_number}${b.label ? ' · ' + b.label : ''}`;
    opt.innerHTML = `<span><strong>BOX ${b.box_number}</strong>${b.label ? ' · ' + esc(b.label) : ''}</span><small>${esc(b.room_name || '')}</small>`;
    list.appendChild(opt);
  });
  // "+ Create box" option when user has typed something
  if (createLabel) {
    const create = document.createElement('div');
    create.className = 'ac-item ac-create';
    create.dataset.createBox = '1';
    create.dataset.boxLabel = createLabel;
    create.textContent = `+ Create box "${createLabel}"`;
    list.appendChild(create);
  }
  if (list.children.length) {
    positionDropdownFixed(list);
    list.classList.add('open');
  } else {
    list.classList.remove('open');
  }
}

function closeAllATBDropdowns() {
  document.getElementById('atb-suggestions').classList.remove('open');
  document.getElementById('atb-cat-suggestions').classList.remove('open');
  document.getElementById('atb-box-suggestions').classList.remove('open');
}

async function showInitialBoxSuggestions() {
  if (document.getElementById('atb-box-selected-badge').style.display === 'flex') return;
  closeAllATBDropdowns();
  const list = document.getElementById('atb-box-suggestions');
  const boxes = await getBoxesCached();
  const sorted = sortByRecency(boxes, recentBoxIds, 'id');
  renderBoxSuggestions(sorted.slice(0, 5), list);
}

async function searchBoxesAC(q) {
  const list = document.getElementById('atb-box-suggestions');
  if (!q.trim()) {
    // Empty query — show initial suggestions instead of closing
    showInitialBoxSuggestions();
    return;
  }
  const boxes = await getBoxesCached();
  const lq = q.toLowerCase();

  // Match "box 2", "box2", or just "2" against box_number;
  // also strip leading "box" word so "box 3" finds #3.
  const stripped = q.replace(/^box\s*/i, '').trim();

  let filtered = boxes.filter(b =>
    String(b.box_number) === stripped ||
    String(b.box_number).startsWith(stripped) ||
    (b.label || '').toLowerCase().includes(lq) ||
    (b.room_name || '').toLowerCase().includes(lq) ||
    (`box ${b.box_number}`).includes(lq) ||
    (`box${b.box_number}`).includes(lq.replace(/\s/g,''))
  );

  if (!filtered.length) {
    // Refresh cache and retry once
    window._lastBoxes = await api('/api/boxes');
    filtered = window._lastBoxes.filter(b =>
      String(b.box_number) === stripped ||
      String(b.box_number).startsWith(stripped) ||
      (b.label || '').toLowerCase().includes(lq) ||
      (b.room_name || '').toLowerCase().includes(lq) ||
      (`box ${b.box_number}`).includes(lq)
    );
  }
  const sorted = sortByRecency(filtered, recentBoxIds, 'id');
  // Pass the typed text as createLabel so user can create a new box
  renderBoxSuggestions(sorted.slice(0, 10), list, q.trim() || null);
}

// Delegated listener for box search suggestions
document.getElementById('atb-box-suggestions').addEventListener('mousedown', e => e.preventDefault());
document.getElementById('atb-box-suggestions').addEventListener('click', e => {
  const item = e.target.closest('.ac-item');
  if (!item) return;
  if (item.dataset.createBox) {
    // User wants to create a new box — show inline panel
    openCreateATBBox(item.dataset.boxLabel);
  } else {
    trackRecentBox(parseInt(item.dataset.boxId));
    setATBBox(parseInt(item.dataset.boxId), item.dataset.boxLabel);
  }
});

function openCreateATBBox(label) {
  // Hide the search input and show the create panel
  document.getElementById('atb-box-suggestions').classList.remove('open');
  document.getElementById('atb-box-search').style.display = 'none';

  // Pre-fill label with whatever the user typed
  document.getElementById('atb-new-box-label').value = label || '';

  // Populate room selector from current rooms list
  const sel = document.getElementById('atb-new-box-room');
  sel.innerHTML = '<option value="">— No Room —</option>' +
    (rooms || []).map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');

  document.getElementById('atb-create-box-panel').style.display = 'block';
  document.getElementById('atb-new-box-label').focus();
}

function cancelCreateATBBox() {
  document.getElementById('atb-create-box-panel').style.display = 'none';
  document.getElementById('atb-box-search').style.display = '';
  document.getElementById('atb-box-search').value = '';
  document.getElementById('atb-box-search').focus();
}

async function confirmCreateATBBox() {
  const label = document.getElementById('atb-new-box-label').value.trim();
  const roomId = document.getElementById('atb-new-box-room').value || null;

  try {
    const newBox = await api('/api/boxes', {
      method: 'POST',
      body: JSON.stringify({ label: label || null, room_id: roomId })
    });
    // Invalidate box cache so the new box appears in future searches
    window._lastBoxes = null;
    // Select the newly created box
    document.getElementById('atb-create-box-panel').style.display = 'none';
    const displayLabel = `BOX ${newBox.box_number}${label ? ' · ' + label : ''}`;
    trackRecentBox(newBox.id);
    setATBBox(newBox.id, displayLabel);
    toast(`Box ${newBox.box_number} created`);
  } catch(e) {
    toast(`Failed to create box: ${e.message}`, true);
  }
}

// Show/hide the "selected item" badge and category field
function setATBSelection(id, name, cat) {
  const badge = document.getElementById('atb-selected-badge');
  const catField = document.getElementById('atb-category-field');
  const searchInput = document.getElementById('atb-search');
  if (id) {
    document.getElementById('atb-item-id').value = id;
    document.getElementById('atb-selected-name').textContent = name + (cat ? ' · ' + cat : '');
    badge.style.display = 'flex';
    searchInput.style.display = 'none';
    catField.style.display = 'none'; // category already set on existing item
  } else {
    document.getElementById('atb-item-id').value = '';
    badge.style.display = 'none';
    searchInput.style.display = '';
    catField.style.display = 'none'; // hidden until user is creating a new item
  }
}

function showATBCategoryField() {
  document.getElementById('atb-category-field').style.display = 'block';
}

function clearATBItem() {
  setATBSelection(null, null, null);
  const inp = document.getElementById('atb-search');
  inp.value = '';
  inp.focus();
}

function renderItemSuggestions(items, list, showCreate, createLabel) {
  list.innerHTML = '';
  items.forEach(i => {
    const div = document.createElement('div');
    div.className = 'ac-item';
    div.dataset.itemId = i.id;
    div.dataset.itemName = i.name;
    div.dataset.itemCat = i.category || '';
    div.innerHTML = `<span>${esc(i.name)}</span><small>${esc(i.category||'')}</small>`;
    list.appendChild(div);
  });
  if (showCreate && createLabel) {
    const createDiv = document.createElement('div');
    createDiv.className = 'ac-item ac-create';
    createDiv.dataset.createNew = '1';
    createDiv.textContent = `+ Create "${createLabel}"`;
    list.appendChild(createDiv);
  }
  if (list.children.length) list.classList.add('open');
  else list.classList.remove('open');
}

async function showInitialItemSuggestions() {
  if (document.getElementById('atb-item-id').value) return;
  closeAllATBDropdowns();
  const list = document.getElementById('atb-suggestions');
  let items = allItems && allItems.length ? allItems : await api('/api/items');
  const sorted = sortByRecency(items, recentItemIds, 'id');
  renderItemSuggestions(sorted.slice(0, 5), list, false, null);
}

async function searchItemsAC(q) {
  if (document.getElementById('atb-item-id').value) return;
  const list = document.getElementById('atb-suggestions');
  if (!q.trim()) {
    showInitialItemSuggestions();
    document.getElementById('atb-category-field').style.display = 'none';
    return;
  }
  const items = await api(`/api/items?q=${encodeURIComponent(q)}`);
  const sorted = sortByRecency(items, recentItemIds, 'id');
  renderItemSuggestions(sorted, list, true, q);
  // No existing matches — user is probably creating new, reveal category field
  if (!items.length) showATBCategoryField();
}

// Single delegated listener on the suggestions list — avoids all inline-onclick quoting issues
document.getElementById('atb-suggestions').addEventListener('mousedown', e => {
  e.preventDefault(); // prevent input blur before click registers
});
document.getElementById('atb-suggestions').addEventListener('click', e => {
  const item = e.target.closest('.ac-item');
  if (!item) return;
  if (item.dataset.createNew) {
    // User wants to create a new item with the typed name
    document.getElementById('atb-item-id').value = '';
    document.getElementById('atb-suggestions').classList.remove('open');
    showATBCategoryField(); // Show category for new item
  } else {
    trackRecentItem(parseInt(item.dataset.itemId));
    setATBSelection(item.dataset.itemId, item.dataset.itemName, item.dataset.itemCat);
    document.getElementById('atb-suggestions').classList.remove('open');
  }
});

// Photo handling for the ATB modal
function triggerATBPhoto() {
  const inp = document.getElementById('atb-photo-input');
  inp.value = '';
  inp.click();
}

function handleATBPhotoSelect(input) {
  const preview = document.getElementById('atb-photo-preview');
  for (const file of input.files) {
    atbPendingPhotos.push(file);
    const url = URL.createObjectURL(file);
    const idx = atbPendingPhotos.length - 1;
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.id = `atb-pending-${idx}`;
    div.innerHTML = `<img src="${url}"><button class="del-img" onclick="removeATBPhoto(${idx})">✕</button>`;
    preview.appendChild(div);
  }
}

function removeATBPhoto(idx) {
  atbPendingPhotos[idx] = null; // null = removed
  const el = document.getElementById(`atb-pending-${idx}`);
  if (el) el.remove();
}

async function uploadPendingPhotos(itemId) {
  for (const file of atbPendingPhotos) {
    if (!file) continue;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entity_type', 'item');
    fd.append('entity_id', itemId);
    try {
      await fetch(API_BASE + '/api/images/upload', { method: 'POST', body: fd });
    } catch(e) {
      toast(`Photo upload failed: ${e.message}`, true);
    }
  }
}

async function confirmAddToBox() {
  if (!addToBoxId) { toast('Select a box first', true); return; }

  const activeTab = document.querySelector('.atb-tab.active')?.dataset?.tab || 'name';

  try {
    if (activeTab === 'barcode') {
      if (barcodeResults.length) { await barcodeAddSelected(); }
      else { toast('Scan a barcode first', true); }
      return;
    }

    if (activeTab === 'image') {
      if (imageResults.length) { await imageAddSelected(); }
      else { toast('Take a photo first', true); }
      return;
    }

    // ── By Name ──────────────────────────────────────────────────────────────
    let item_id = document.getElementById('atb-item-id').value;
    const qty = parseInt(document.getElementById('atb-qty').value) || 1;
    const notes = document.getElementById('atb-notes').value.trim();
    const category = document.getElementById('atb-category').value.trim();

    if (!item_id) {
      const name = document.getElementById('atb-search').value.trim();
      if (!name) { toast('Enter an item name', true); return; }
      const newItem = await api('/api/items', { method:'POST', body:JSON.stringify({name, category}) });
      item_id = newItem.id;
    }

    const photoCount = atbPendingPhotos.filter(Boolean).length;
    if (photoCount > 0) await uploadPendingPhotos(item_id);

    const result = await api(`/api/boxes/${addToBoxId}/items`, {
      method:'POST', body:JSON.stringify({ item_id, quantity:qty, notes })
    });
    // Save asset details for this specific box_item placement
    if (result.id) await saveATBMetaForBoxItem(result.id);
    closeModal('modal-atb');
    const photoMsg = photoCount > 0 ? ` with ${photoCount} photo${photoCount>1?'s':''}` : '';
    toast(result.incremented ? `Quantity updated to ${result.quantity}${photoMsg}` : `Item added${photoMsg}`);

    const boxField = document.getElementById('atb-box-field');
    if (boxField.style.display === 'none') refreshBoxItemsInPlace(addToBoxId);
  } catch(e) {
    toast(`Error: ${e.message || e}`, true);
    console.error('confirmAddToBox error:', e);
  }
}

// ── ATB tab switching ──────────────────────────────────────────────────────
function setATBTab(tab) {
  ['name','image','barcode'].forEach(t => {
    document.getElementById(`atb-tab-${t}`).style.display = t === tab ? 'block' : 'none';
    document.querySelector(`.atb-tab[data-tab="${t}"]`).classList.toggle('active', t === tab);
  });
}

// ── Barcode lookup ─────────────────────────────────────────────────────────

// ── Barcode decode ────────────────────────────────────────────────────────
async function decodeBarcode(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // @zxing/library UMD exposes ZXing global
        const ZX = window.ZXing;
        if (!ZX) { reject(new Error('ZXing library not loaded')); return; }

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const luminanceSource = new ZX.HTMLCanvasElementLuminanceSource(canvas);
        const binarizer = new ZX.HybridBinarizer(luminanceSource);
        const bitmap = new ZX.BinaryBitmap(binarizer);

        const hints = new Map();
        const formats = [
          ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E,
          ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8,
          ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39,
          ZX.BarcodeFormat.ITF,
        ].filter(Boolean);
        if (formats.length) {
          hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, formats);
          hints.set(ZX.DecodeHintType.TRY_HARDER, true);
        }

        const reader = new ZX.MultiFormatReader();
        reader.setHints(hints);
        const result = reader.decode(bitmap);
        resolve(result.getText());
      } catch(e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = URL.createObjectURL(file);
  });
}

// ── Barcode state ─────────────────────────────────────────────────────────
let barcodeCurrentUpc = null;      // last decoded UPC string
let barcodeResults = [];           // [{id, name, source, upc?}] — current results
let barcodeSelectedIdx = 0;        // index into barcodeResults

function triggerBarcodePhoto() {
  const inp = document.getElementById('atb-barcode-input');
  inp.value = ''; inp.click();
}

// Pending merge state: the external result that triggered the merge prompt
let barcodePendingMerge = null; // { result, matchedItem }

function resetBarcodeUI() {
  barcodeCurrentUpc = null;
  barcodeResults = [];
  barcodeSelectedIdx = 0;
  barcodePendingMerge = null;
  document.getElementById('atb-barcode-upc').style.display = 'none';
  document.getElementById('atb-barcode-result').innerHTML = '';
  document.getElementById('atb-barcode-actions').style.display = 'none';
  document.getElementById('atb-barcode-notright').style.display = 'none';
  document.getElementById('atb-barcode-merge').style.display = 'none';
  document.getElementById('atb-barcode-manual-name').value = '';
  document.getElementById('atb-barcode-status').textContent = '';
}

function renderBarcodeResults(results) {
  barcodeResults = results;
  barcodeSelectedIdx = 0;
  const el = document.getElementById('atb-barcode-result');
  el.innerHTML = '';
  results.forEach((r, idx) => {
    const card = document.createElement('div');
    card.className = 'barcode-result-card' + (idx === 0 ? ' selected' : '');
    card.dataset.idx = idx;
    const nameEl = document.createElement('div');
    nameEl.className = 'barcode-card-name';
    nameEl.textContent = r.name;
    const srcEl = document.createElement('div');
    srcEl.className = 'barcode-card-source';
    srcEl.textContent = r.source === 'local' ? '✓ Saved' : r.source === 'ai' ? '🤖 AI' : '🌐 Online';
    card.appendChild(nameEl);
    card.appendChild(srcEl);
    card.addEventListener('click', () => {
      el.querySelectorAll('.barcode-result-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      barcodeSelectedIdx = idx;
    });
    el.appendChild(card);
  });
  if (results.length) {
    document.getElementById('atb-barcode-actions').style.display = 'flex';
  }
}

async function barcodeAddSelected() {
  const r = barcodeResults[barcodeSelectedIdx];
  if (!r) { toast('No item selected', true); return; }
  if (!addToBoxId) { toast('Select a box first', true); return; }

  // If this is an external (non-local) result, check whether an item with the
  // same name already exists in the local DB before creating a new one.
  if (!r.id && barcodeCurrentUpc) {
    const matches = await api(`/api/items/find-by-name?name=${encodeURIComponent(r.name)}`);
    if (matches.length) {
      // Classify each match:
      //   no UPC  → offer to merge (save UPC to this item)
      //   same UPC → already the same product, use directly
      //   different UPC → different variant, keep separate
      const noUpc = matches.filter(m => !m.upc);
      const sameUpc = matches.filter(m => m.upc === barcodeCurrentUpc || m.upc === barcodeCurrentUpc.replace(/^0+/, ''));

      if (sameUpc.length) {
        // Already linked — just use it
        await finishBarcodeAdd(sameUpc[0].id, r.name, false);
        return;
      }
      if (noUpc.length) {
        // Prompt to merge
        barcodePendingMerge = { result: r, matchedItem: noUpc[0] };
        const msg = document.getElementById('atb-barcode-merge-msg');
        msg.textContent = `"${noUpc[0].name}" already exists in your inventory without a barcode. `
          + `Merge to save this barcode to the existing item, or keep them separate.`;
        document.getElementById('atb-barcode-merge').style.display = 'block';
        document.getElementById('atb-barcode-actions').style.display = 'none';
        return;
      }
      // All matches have different UPCs — fall through to create new
    }
  }

  // Local item or no name conflict — proceed directly
  await finishBarcodeAdd(r.id || null, r.name, !r.id);
}

async function barcodeMergeConfirm() {
  if (!barcodePendingMerge) return;
  const { result, matchedItem } = barcodePendingMerge;
  // Save the scanned UPC onto the existing item
  await api(`/api/items/${matchedItem.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: matchedItem.name, category: matchedItem.category || '', upc: barcodeCurrentUpc })
  });
  toast(`Barcode saved to "${matchedItem.name}"`);
  await finishBarcodeAdd(matchedItem.id, matchedItem.name, false);
}

async function barcodeKeepSeparate() {
  if (!barcodePendingMerge) return;
  const { result } = barcodePendingMerge;
  document.getElementById('atb-barcode-merge').style.display = 'none';
  document.getElementById('atb-barcode-actions').style.display = 'flex';
  barcodePendingMerge = null;
  // Create a new item with the UPC (will have same name but separate record)
  await finishBarcodeAdd(null, result.name, true);
}

async function finishBarcodeAdd(item_id, name, createNew) {
  try {
    if (createNew) {
      const newItem = await api('/api/items', {
        method: 'POST',
        body: JSON.stringify({ name, upc: barcodeCurrentUpc })
      });
      item_id = newItem.id;
    } else if (item_id && barcodeCurrentUpc) {
      const existing = allItems.find(i => i.id === item_id);
      if (existing && !existing.upc) {
        await api(`/api/items/${item_id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, category: existing?.category || '', upc: barcodeCurrentUpc })
        }).catch(() => {});
      }
    }

    const qty = parseInt(document.getElementById('atb-qty').value) || 1;
    const notes = document.getElementById('atb-notes').value.trim();
    const photoCount = atbPendingPhotos.filter(Boolean).length;
    if (photoCount > 0) await uploadPendingPhotos(item_id);

    const result = await api(`/api/boxes/${addToBoxId}/items`, {
      method: 'POST', body: JSON.stringify({ item_id, quantity: qty, notes })
    });
    closeModal('modal-atb');
    toast(result.incremented ? `Qty updated to ${result.quantity}` : `${name} added`);
    trackRecentItem(item_id);
    trackRecentBox(addToBoxId);

    const boxField = document.getElementById('atb-box-field');
    if (boxField.style.display === 'none') refreshBoxItemsInPlace(addToBoxId);
  } catch(e) {
    toast(`Error: ${e.message || e}`, true);
    console.error('finishBarcodeAdd error:', e);
  }
}

function barcodeNotRight() {
  document.getElementById('atb-barcode-notright').style.display = 'block';
  document.getElementById('atb-barcode-manual-name').focus();
}

async function barcodeManualAdd() {
  const name = document.getElementById('atb-barcode-manual-name').value.trim();
  if (!name) { toast('Enter a product name', true); return; }
  if (!addToBoxId) { toast('Select a box first', true); return; }

  // Check for existing item with this name (no-UPC merge check, same as barcodeAddSelected)
  if (barcodeCurrentUpc) {
    const matches = await api(`/api/items/find-by-name?name=${encodeURIComponent(name)}`);
    const noUpc = matches.filter(m => !m.upc);
    const sameUpc = matches.filter(m => m.upc === barcodeCurrentUpc || m.upc === barcodeCurrentUpc.replace(/^0+/, ''));
    if (sameUpc.length) {
      await finishBarcodeAdd(sameUpc[0].id, name, false); return;
    }
    if (noUpc.length) {
      // Synthesise a result entry and show merge prompt
      barcodeResults = [{ name, source: 'manual' }];
      barcodeSelectedIdx = 0;
      barcodePendingMerge = { result: { name }, matchedItem: noUpc[0] };
      const msg = document.getElementById('atb-barcode-merge-msg');
      msg.textContent = `"${noUpc[0].name}" already exists without a barcode. Merge to link this barcode to it?`;
      document.getElementById('atb-barcode-merge').style.display = 'block';
      document.getElementById('atb-barcode-notright').style.display = 'none';
      return;
    }
  }

  await finishBarcodeAdd(null, name, true);
}

function switchToNameTab() {
  setATBTab('name');
  const name = document.getElementById('atb-barcode-manual-name').value.trim();
  if (name) {
    document.getElementById('atb-search').value = name;
    searchItemsAC(name);
  }
}

async function handleBarcodePhoto(input) {
  if (!input.files.length) return;
  const statusEl = document.getElementById('atb-barcode-status');
  const upcEl = document.getElementById('atb-barcode-upc');
  const btn = document.getElementById('atb-barcode-btn');
  resetBarcodeUI();
  statusEl.innerHTML = '<span class="spinner"></span> Decoding barcode…';
  btn.disabled = true;

  let upc = null;

  try {
    // ── Step 1: Decode barcode in browser ────────────────────────────────────
    try {
      upc = await decodeBarcode(input.files[0]);
      barcodeCurrentUpc = upc;
      upcEl.textContent = `Barcode: ${upc}`;
      upcEl.style.display = 'block';
      statusEl.innerHTML = '<span class="spinner"></span> Looking up…';
    } catch(decodeErr) {
      console.log('ZXing decode failed:', decodeErr.message);
    }

    // ── Step 2: Local DB + external lookup ───────────────────────────────────
    if (upc) {
      const res = await fetch(API_BASE + `/api/upc-lookup?upc=${encodeURIComponent(upc)}`);
      const data = await res.json();
      if (data.items && data.items.length) {
        // Local items found
        renderBarcodeResults(data.items.map(i => ({ ...i, source: 'local' })));
        statusEl.textContent = data.source === 'local'
          ? `Found in your inventory:`
          : `Found online:`;
        return;
      } else if (data.names && data.names.length) {
        renderBarcodeResults(data.names.map(n => ({ name: n, source: 'external' })));
        statusEl.textContent = 'Found online:';
        return;
      }
      statusEl.textContent = `UPC ${upc} not found in database.`;
    }

    // ── Step 3: AI fallback ───────────────────────────────────────────────────
    if (visionConfig.ready) {
      statusEl.innerHTML = `<span class="spinner"></span> ${upc ? 'Trying AI…' : 'Barcode unreadable — trying AI…'}`;
      const fd = new FormData();
      fd.append('file', input.files[0]);
      fd.append('mode', 'barcode');
      const res = await fetch(API_BASE + '/api/identify', { method: 'POST', body: fd });
      const aiData = await res.json();
      if (res.ok && aiData.suggestions && aiData.suggestions.length) {
        renderBarcodeResults(aiData.suggestions.map(n => ({ name: n, source: 'ai' })));
        statusEl.textContent = 'AI suggestion:';
        return;
      }
    }

    // ── Nothing worked ────────────────────────────────────────────────────────
    statusEl.textContent = upc
      ? `UPC ${upc} not found — enter the name below.`
      : 'Could not read barcode — try a clearer photo, or use By Name tab.';
    document.getElementById('atb-barcode-notright').style.display = 'block';

  } catch(e) {
    statusEl.textContent = `Error: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

// ── ATB Asset Details (applies to the box_item placement created) ──────────

function toggleATBMetaSection() {
  const section = document.getElementById('atb-meta-section');
  const chevron = document.getElementById('atb-meta-chevron');
  const open = section.style.display !== 'none';
  section.style.display = open ? 'none' : 'block';
  chevron.style.transform = open ? '' : 'rotate(90deg)';
}

function resetATBMetaSection() {
  ['atb-meta-serial','atb-meta-model','atb-meta-purchase-date',
   'atb-meta-price','atb-meta-store','atb-meta-warranty-value','atb-meta-notes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const u = document.getElementById('atb-meta-warranty-unit');
  if (u) u.value = 'years';
  const c = document.getElementById('atb-meta-card-select');
  if (c) c.value = '';
  const p = document.getElementById('atb-meta-warranty-preview');
  if (p) p.textContent = '';
  const section = document.getElementById('atb-meta-section');
  const chevron = document.getElementById('atb-meta-chevron');
  if (section) section.style.display = 'none';
  if (chevron) chevron.style.transform = '';
  // Populate card dropdown
  if (typeof populateMetaCardSelect === 'function') {
    populateMetaCardSelect(null, 'atb-meta-card-select');
  }
}

function updateATBMetaWarrantyPreview() {
  const preview = document.getElementById('atb-meta-warranty-preview');
  if (!preview) return;
  const purchaseDate = document.getElementById('atb-meta-purchase-date')?.value;
  const wValue = parseInt(document.getElementById('atb-meta-warranty-value')?.value);
  const wUnit  = document.getElementById('atb-meta-warranty-unit')?.value || 'years';
  const cardId = document.getElementById('atb-meta-card-select')?.value;
  if (!purchaseDate || !wValue) { preview.textContent = ''; return; }
  const purchase = new Date(purchaseDate + 'T00:00:00');
  const mfrExpiry = addDuration(purchase, wValue, wUnit);
  const card = (creditCards || []).find(c => String(c.id) === String(cardId));
  let eff = mfrExpiry;
  if (card) {
    eff = card.extension_type === 'double'
      ? addDuration(mfrExpiry, wValue, wUnit)
      : addDuration(mfrExpiry, card.extension_value, card.extension_unit);
    if (card.extension_cap_months) {
      const cap = addDuration(purchase, card.extension_cap_months, 'months');
      if (eff > cap) eff = cap;
    }
  }
  const mfrStr = mfrExpiry.toISOString().slice(0, 10);
  const effStr = eff.toISOString().slice(0, 10);
  const daysLeft = Math.ceil((eff - new Date()) / 86400000);
  const color = daysLeft < 0 ? '#c33' : daysLeft < 90 ? '#f90' : 'var(--accent)';
  preview.innerHTML = card
    ? `<span style="color:var(--muted)">Mfr expires: ${mfrStr}</span><br><span style="color:${color};font-weight:700;">Effective with ${esc(card.name)}: ${effStr}</span>`
    : `<span style="color:${color};font-weight:700;">Expires: ${mfrStr}</span>`;
}

async function saveATBMetaForBoxItem(boxItemId) {
  // Called after a box_item is created; saves meta if any field is filled
  const hasAny = ['atb-meta-serial','atb-meta-model','atb-meta-purchase-date',
    'atb-meta-price','atb-meta-store','atb-meta-warranty-value','atb-meta-notes']
    .some(id => document.getElementById(id)?.value?.trim());
  if (!hasAny) return;
  const get = id => document.getElementById(id)?.value?.trim() || null;
  const payload = {
    serial_number:   get('atb-meta-serial'),
    model_number:    get('atb-meta-model'),
    purchase_date:   get('atb-meta-purchase-date') || null,
    purchase_price:  get('atb-meta-price') ? parseFloat(get('atb-meta-price')) : null,
    purchase_store:  get('atb-meta-store'),
    warranty_value:  get('atb-meta-warranty-value') ? parseInt(get('atb-meta-warranty-value')) : null,
    warranty_unit:   get('atb-meta-warranty-unit') || 'years',
    credit_card_id:  get('atb-meta-card-select') ? parseInt(get('atb-meta-card-select')) : null,
    notes:           get('atb-meta-notes'),
  };
  try {
    await api(`/api/box-items/${boxItemId}/metadata`, { method: 'PUT', body: JSON.stringify(payload) });
  } catch(e) {
    console.warn('Failed to save ATB metadata:', e.message);
  }
}
