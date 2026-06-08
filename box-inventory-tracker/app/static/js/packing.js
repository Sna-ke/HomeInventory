// ── Packing Mode ─────────────────────────────────────────────────────────────
// Full-screen distraction-free item entry. Fast, flashy, feels good.

let pmDestType    = null;   // 'box' | 'room'
let pmDestId      = null;
let pmDestLabel   = '';
let pmItemId      = null;
let pmItemName    = '';
let pmItemCat     = '';
let pmQty         = 1;
let pmTab         = 'name';
let pmSessionItems = [];    // [{name, dest, qty}]
let pmBarcodeStream = null;
let pmInitialTab  = 'name'; // can be overridden before open

// ── Open / Close ──────────────────────────────────────────────────────────────

function openPackingMode(tab) {
  pmInitialTab = tab || 'name';
  const overlay = document.getElementById('packing-mode');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  pmClearSearch();
  pmClearConfirm();
  setPMTab(pmInitialTab);
  pmRenderSessionList();
  updatePMDestBtn();

  // Re-set last used destination
  if (!pmDestId) {
    if (addToBoxId) {
      const box = (window._lastBoxes || []).find(b => b.id === addToBoxId);
      if (box) pmSetDest('box', box.id, `BOX ${box.box_number}${box.label ? ' · ' + box.label : ''}`);
    }
  }

  requestAnimationFrame(() => {
    if (pmInitialTab === 'name') {
      const inp = document.getElementById('pm-search');
      if (inp) { inp.focus(); inp.value = ''; }
    }
  });
}

function openPackingModeBarcode() { openPackingMode('barcode'); }

function closePackingMode() {
  const overlay = document.getElementById('packing-mode');
  overlay.style.display = 'none';
  document.body.style.overflow = '';
  pmStopBarcode();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function setPMTab(tab) {
  pmTab = tab;
  ['name','barcode','image'].forEach(t => {
    document.getElementById(`pm-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`pm-body-${t}`).style.display = t === tab ? 'flex' : 'none';
  });
  if (tab === 'name') {
    setTimeout(() => document.getElementById('pm-search')?.focus(), 80);
  }
  if (tab === 'barcode') pmStartBarcodeScanner();
  if (tab !== 'barcode') pmStopBarcode();
}

// ── Destination picker ────────────────────────────────────────────────────────

function pmSetDest(type, id, label) {
  pmDestType  = type;
  pmDestId    = id;
  pmDestLabel = label;
  updatePMDestBtn();
  pmUpdateAddBtnLabel();
  // sync with ATB state
  if (type === 'box')  { addToBoxId = id; addToRoomId = null; }
  else                 { addToRoomId = id; addToBoxId = null; }
}

function updatePMDestBtn() {
  const btn = document.getElementById('pm-dest-btn');
  const name = document.getElementById('pm-dest-name');
  if (!btn || !name) return;
  if (pmDestId) {
    const prefix = pmDestType === 'room' ? '🏠 ' : '📦 ';
    name.textContent = prefix + pmDestLabel;
    btn.classList.add('has-dest');
  } else {
    name.textContent = '— tap to choose box or room —';
    btn.classList.remove('has-dest');
  }
}

function pmUpdateAddBtnLabel() {
  const label = document.getElementById('pm-add-btn-label');
  if (!label) return;
  label.textContent = pmDestType === 'room' ? 'Place in Room' : 'Add to Box';
}

async function openPMDestPicker() {
  const list = document.getElementById('pm-dest-suggestions');
  const btn  = document.getElementById('pm-dest-btn');

  if (list.classList.contains('open')) {
    list.classList.remove('open'); return;
  }

  list.innerHTML = '<div style="padding:10px 14px;color:#444;font-size:12px;font-family:var(--mono);">Loading…</div>';
  list.classList.add('open');

  const [boxes, rooms] = await Promise.all([getBoxesCached(), getRoomsCached()]);
  list.innerHTML = '';

  if (rooms.length) {
    const rHdr = document.createElement('div');
    rHdr.className = 'recent-hdr';
    rHdr.textContent = 'Rooms';
    list.appendChild(rHdr);
    rooms.forEach(r => {
      const opt = document.createElement('div');
      opt.className = 'ac-item';
      opt.innerHTML = `<span>🏠 ${esc(r.name)}</span><small>${r.box_count||0} boxes</small>`;
      opt.addEventListener('mousedown', e => {
        e.preventDefault();
        pmSetDest('room', r.id, r.name);
        list.classList.remove('open');
      });
      list.appendChild(opt);
    });
  }

  if (boxes.length) {
    const bHdr = document.createElement('div');
    bHdr.className = 'recent-hdr';
    bHdr.textContent = 'Boxes';
    list.appendChild(bHdr);
    const sorted = sortByRecency(boxes, recentBoxIds, 'id');
    sorted.forEach(b => {
      const lbl = b.label ? ` · ${b.label}` : '';
      const room = b.room_name ? ` (${b.room_name})` : '';
      const opt = document.createElement('div');
      opt.className = 'ac-item';
      opt.innerHTML = `<span>📦 BOX ${b.box_number}${esc(lbl)}</span><small>${esc(room)}</small>`;
      opt.addEventListener('mousedown', e => {
        e.preventDefault();
        pmSetDest('box', b.id, `BOX ${b.box_number}${lbl}`);
        list.classList.remove('open');
      });
      list.appendChild(opt);
    });
  }

  // Strip fixed positioning that positionDropdownFixed may have added
  list.classList.remove('fixed-position');
  list.style.top = '';
  list.style.left = '';
  list.style.width = '';

  // Close on outside tap/click
  setTimeout(() => {
    const close = e => {
      if (!list.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        list.classList.remove('open');
        document.removeEventListener('click', close);
        document.removeEventListener('touchend', close);
      }
    };
    document.addEventListener('click', close);
    document.addEventListener('touchend', close);
  }, 50);
}

// ── Item Search ───────────────────────────────────────────────────────────────

async function pmShowInitialSuggestions() {
  pmClearConfirm();
  const list = document.getElementById('pm-suggestions');
  let items = allItems && allItems.length ? allItems : await api('/api/items');
  const sorted = sortByRecency(items, recentItemIds, 'id');
  const recent = sorted.filter(i => recentItemIds.includes(i.id)).slice(0, 8);
  const show   = recent.length ? recent : sorted.slice(0, 8);
  pmRenderSuggestions(show, null, show === recent);
}

async function pmSearchItems(q) {
  document.getElementById('pm-clear-search').style.display = q ? 'block' : 'none';
  if (!q.trim()) { pmShowInitialSuggestions(); pmClearConfirm(); return; }

  const list = document.getElementById('pm-suggestions');
  let items = allItems && allItems.length ? allItems : await api('/api/items');
  const lq = q.toLowerCase();
  const filtered = items.filter(i => i.name.toLowerCase().includes(lq))
    .sort((a, b) => {
      const ai = a.name.toLowerCase().indexOf(lq), bi = b.name.toLowerCase().indexOf(lq);
      return ai !== bi ? ai - bi : a.name.localeCompare(b.name);
    }).slice(0, 12);
  pmRenderSuggestions(filtered, q, false);
}

function pmRenderSuggestions(items, query, showRecentHdr) {
  const list = document.getElementById('pm-suggestions');
  list.innerHTML = '';

  // Create-new always first when searching
  if (query && query.trim()) {
    const create = document.createElement('div');
    create.className = 'ac-item ac-create';
    create.innerHTML = `<span>＋ Add "<strong>${esc(query.trim())}</strong>"</span><small style="color:var(--accent)">new item</small>`;
    create.addEventListener('mousedown', e => { e.preventDefault(); pmSelectItem(null, query.trim(), ''); });
    list.appendChild(create);
  }

  if (showRecentHdr && items.length) {
    const hdr = document.createElement('div');
    hdr.className = 'recent-hdr';
    hdr.textContent = 'Recently packed';
    list.appendChild(hdr);
  }

  items.forEach(i => {
    const div = document.createElement('div');
    div.className = 'ac-item';
    if (query) {
      const lq = query.toLowerCase();
      const ln = i.name.toLowerCase();
      const idx = ln.indexOf(lq);
      div.innerHTML = `<span>${idx>=0
        ? esc(i.name.slice(0,idx))+'<mark style="background:var(--accent);color:#000;padding:0 1px;">'+esc(i.name.slice(idx,idx+query.length))+'</mark>'+esc(i.name.slice(idx+query.length))
        : esc(i.name)}</span><small>${esc(i.category||'')}</small>`;
    } else {
      div.innerHTML = `<span>${esc(i.name)}</span><small>${esc(i.category||'')}</small>`;
    }
    div.addEventListener('mousedown', e => { e.preventDefault(); pmSelectItem(i.id, i.name, i.category||''); });
    list.appendChild(div);
  });

  if (list.children.length) {
    list.classList.add('open');
    list.classList.remove('fixed-position');
    list.style.top = ''; list.style.left = ''; list.style.width = '';
  } else {
    list.classList.remove('open');
  }
}

function pmSelectItem(id, name, cat) {
  pmItemId   = id;
  pmItemName = name;
  pmItemCat  = cat;
  pmQty      = 1;

  document.getElementById('pm-search').value = name;
  document.getElementById('pm-clear-search').style.display = 'block';
  document.getElementById('pm-suggestions').classList.remove('open');

  document.getElementById('pm-selected-name').textContent = name;
  document.getElementById('pm-selected-cat').textContent  = cat || '— new item —';
  document.getElementById('pm-qty-num').textContent = '1';
  document.getElementById('pm-notes').value = '';
  document.getElementById('pm-confirm-bar').style.display = 'flex';
  pmUpdateAddBtnLabel();

  // Scroll confirm bar into view
  setTimeout(() => {
    document.getElementById('pm-confirm-bar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 50);
}

function pmClearSearch() {
  const inp = document.getElementById('pm-search');
  if (inp) inp.value = '';
  const clr = document.getElementById('pm-clear-search');
  if (clr) clr.style.display = 'none';
  const list = document.getElementById('pm-suggestions');
  if (list) list.classList.remove('open');
  pmClearConfirm();
}

function pmClearConfirm() {
  pmItemId = null; pmItemName = ''; pmItemCat = ''; pmQty = 1;
  const bar = document.getElementById('pm-confirm-bar');
  if (bar) bar.style.display = 'none';
}

// ── Quantity ──────────────────────────────────────────────────────────────────

function pmAdjQty(delta) {
  pmQty = Math.max(1, pmQty + delta);
  document.getElementById('pm-qty-num').textContent = pmQty;
}

// ── Add Item ──────────────────────────────────────────────────────────────────

async function pmConfirmAdd() {
  if (!pmDestId)    { pmToast('Choose a box or room first'); return; }
  if (!pmItemName)  { pmToast('Select an item first'); return; }

  const btn   = document.getElementById('pm-add-btn');
  const label = document.getElementById('pm-add-btn-label');
  btn.disabled = true;
  label.textContent = '…';

  const notes = document.getElementById('pm-notes').value.trim() || null;

  try {
    // Create item if new
    let itemId = pmItemId;
    if (!itemId) {
      const newItem = await api('/api/items', { method:'POST',
        body: JSON.stringify({ name: pmItemName }) });
      itemId = newItem.id;
      if (allItems) allItems.push(newItem);
    }

    let resultId;
    if (pmDestType === 'box') {
      const res = await api(`/api/boxes/${pmDestId}/items`, { method:'POST',
        body: JSON.stringify({ item_id: itemId, quantity: pmQty, notes }) });
      resultId = res.id;
      trackRecentBox(pmDestId);
    } else {
      const loc = document.getElementById('atb-room-location')?.value?.trim() || null;
      const res = await api(`/api/rooms/${pmDestId}/items`, { method:'POST',
        body: JSON.stringify({ item_id: itemId, quantity: pmQty, notes, location: loc }) });
      resultId = res.id;
    }

    trackRecentItem(itemId);

    // Session list
    pmSessionItems.unshift({ name: pmItemName, dest: pmDestLabel, qty: pmQty, type: pmDestType });
    if (pmSessionItems.length > 20) pmSessionItems.pop();

    // Update counter with bump animation
    const countEl = document.getElementById('pm-count-num');
    const total = pmSessionItems.reduce((s, i) => s + i.qty, 0);
    countEl.textContent = total;
    countEl.classList.add('bump');
    setTimeout(() => countEl.classList.remove('bump'), 200);

    // Flash success on button
    btn.classList.add('success');
    label.textContent = '✓ Added';
    setTimeout(() => {
      btn.classList.remove('success');
      label.textContent = pmDestType === 'room' ? 'Place in Room' : 'Add to Box';
    }, 700);

    pmRenderSessionList();

    // Clear for next item
    document.getElementById('pm-search').value = '';
    document.getElementById('pm-clear-search').style.display = 'none';
    document.getElementById('pm-suggestions').classList.remove('open');
    document.getElementById('pm-confirm-bar').style.display = 'none';
    pmItemId = null; pmItemName = ''; pmQty = 1;

    setTimeout(() => document.getElementById('pm-search')?.focus(), 80);

  } catch(e) {
    label.textContent = '✗ Failed';
    setTimeout(() => { label.textContent = pmDestType === 'room' ? 'Place in Room' : 'Add to Box'; }, 1200);
    pmToast(e.message || 'Error', true);
  } finally {
    btn.disabled = false;
  }
}

// ── Session list ──────────────────────────────────────────────────────────────

function pmRenderSessionList() {
  const hdr  = document.getElementById('pm-recent-hdr');
  const list = document.getElementById('pm-recent-list');
  if (!list) return;
  if (!pmSessionItems.length) { hdr.style.display = 'none'; list.innerHTML = ''; return; }
  hdr.style.display = 'block';
  list.innerHTML = pmSessionItems.slice(0, 8).map(i =>
    `<div class="pm-recent-item">
      <span class="pm-recent-item-name">${esc(i.name)}</span>
      <span class="pm-recent-item-dest">${esc(i.dest)}</span>
      <span class="pm-recent-item-qty">×${i.qty}</span>
    </div>`
  ).join('');
}

// ── Barcode scanner ───────────────────────────────────────────────────────────

async function pmStartBarcodeScanner() {
  const status = document.getElementById('pm-barcode-status');
  const video  = document.getElementById('pm-barcode-video');
  status.textContent = 'Starting camera…';
  try {
    pmBarcodeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } }
    });
    video.srcObject = pmBarcodeStream;
    await video.play();
    status.textContent = 'Point camera at barcode';
    pmScanLoop(video, status);
  } catch(e) {
    status.textContent = 'Camera not available: ' + e.message;
  }
}

function pmStopBarcode() {
  if (pmBarcodeStream) {
    pmBarcodeStream.getTracks().forEach(t => t.stop());
    pmBarcodeStream = null;
  }
}

async function pmScanLoop(video, status) {
  if (!pmBarcodeStream || pmTab !== 'barcode') return;
  try {
    // Use BarcodeDetector API if available (modern browsers)
    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code'] });
      const scan = async () => {
        if (!pmBarcodeStream || pmTab !== 'barcode') return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const upc = codes[0].rawValue;
            pmStopBarcode();
            status.textContent = `Scanned: ${upc} — looking up…`;
            await pmHandleBarcode(upc, status);
            return;
          }
        } catch(e) {}
        requestAnimationFrame(scan);
      };
      scan();
    } else {
      // Fallback: ZXing via ATB barcode handler if available
      status.textContent = 'Camera ready — barcode scanning requires a modern browser';
    }
  } catch(e) {
    status.textContent = 'Scan error: ' + e.message;
  }
}

async function pmHandleBarcode(upc, status) {
  try {
    // Check local DB first
    const res = await api(`/api/items/find-by-upc?upc=${encodeURIComponent(upc)}`).catch(() => null);
    if (res && res.id) {
      pmSetTab && setPMTab('name');
      setPMTab('name');
      pmSelectItem(res.id, res.name, res.category || '');
      status.textContent = '';
      return;
    }
    // Fall back to UPC lookup API
    const lookup = await api(`/api/upc-lookup?upc=${encodeURIComponent(upc)}`).catch(() => null);
    if (lookup && lookup.name) {
      setPMTab('name');
      pmSelectItem(null, lookup.name, '');
      status.textContent = '';
      return;
    }
    status.textContent = `UPC ${upc} not found — type the name above`;
    setPMTab('name');
    setTimeout(() => document.getElementById('pm-search')?.focus(), 80);
  } catch(e) {
    status.textContent = 'Lookup failed: ' + e.message;
  }
}

// ── AI Image identification ───────────────────────────────────────────────────

async function pmHandleImage(input) {
  if (!input.files || !input.files[0]) return;
  const file    = input.files[0];
  const status  = document.getElementById('pm-image-status');
  const preview = document.getElementById('pm-image-preview');

  // Show preview
  const reader = new FileReader();
  reader.onload = e => { preview.src = e.target.result; preview.style.display = 'block'; };
  reader.readAsDataURL(file);

  status.textContent = 'Identifying…';

  try {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch(API_BASE + '/api/vision/identify', { method: 'POST', body: fd });
    const data = await res.json();
    if (data && data.length) {
      // Switch to name tab and pre-fill with the top result
      setPMTab('name');
      const top = data[0];
      document.getElementById('pm-search').value = top.name;
      pmSearchItems(top.name);
      status.textContent = '';
    } else {
      status.textContent = 'Nothing identified — type the name';
      setPMTab('name');
    }
  } catch(e) {
    status.textContent = 'Identification failed: ' + e.message;
  }
  input.value = '';
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let _pmToastTimer;
function pmToast(msg) {
  const el = document.getElementById('pm-toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(_pmToastTimer);
  _pmToastTimer = setTimeout(() => { el.style.display = 'none'; }, 2500);
}

// ── Close on Escape ───────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('packing-mode')?.style.display !== 'none') {
    closePackingMode();
  }
});
