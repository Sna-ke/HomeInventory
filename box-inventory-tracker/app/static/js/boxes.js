// ── Boxes ──────────────────────────────────────────────────────────────────
// Build thumbnail content for a box card — single image, collage, or placeholder
function fillBoxThumb(el, box) {
  el.innerHTML = '';
  if (box.thumb_url) {
    // Box has its own photo
    const img = document.createElement('img');
    img.src = box.thumb_url;
    img.alt = 'box photo';
    img.loading = 'lazy';
    el.appendChild(img);
  } else if (box.collage_urls && box.collage_urls.length) {
    // Collage from item photos
    const n = Math.min(box.collage_urls.length, 9);
    const grid = document.createElement('div');
    grid.className = 'card-thumb-collage';
    grid.dataset.count = n;
    box.collage_urls.slice(0, 9).forEach(url => {
      const cell = document.createElement('div');
      cell.className = 'collage-img';
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      img.alt = '';
      cell.appendChild(img);
      grid.appendChild(cell);
    });
    el.appendChild(grid);
  } else {
    el.innerHTML = '<span>📦</span>';
  }
}

function setBoxView(v) {
  boxView = v;
  document.getElementById('view-grid-btn').classList.toggle('active', v === 'grid');
  document.getElementById('view-list-btn').classList.toggle('active', v === 'list');
  renderBoxes(window._lastBoxes || []);
}

async function loadBoxes() {
  // Refresh room filter dropdown without full room re-render
  try {
    const freshRooms = await api('/api/rooms');
    rooms = freshRooms;
    const f = document.getElementById('roomFilter');
    if (f) {
      const prev = f.value;
      f.innerHTML = '<option value="">All Rooms</option>' +
        rooms.map(r => `<option value="${r.id}" ${prev==r.id?'selected':''}>${esc(r.name)}</option>`).join('');
    }
  } catch(e) { /* non-fatal */ }
  const roomId = document.getElementById('roomFilter').value;
  const url = roomId ? `/api/boxes?room_id=${roomId}` : '/api/boxes';
  const boxes = await api(url);
  window._lastBoxes = boxes;
  renderBoxes(boxes);
}

function renderBoxes(boxes) {
  const container = document.getElementById('boxes-grid');
  if (!boxes.length) {
    container.className = '';
    container.innerHTML = '<div class="empty">No boxes yet. Tap + New to create one.</div>';
    return;
  }
  // Smart-diff: track which box ids are in the new list
  const newIds = new Set(boxes.map(b => b.id));
  // Remove cards for boxes that no longer exist
  container.querySelectorAll('[data-box-id]').forEach(el => {
    if (!newIds.has(parseInt(el.dataset.boxId))) el.remove();
  });

  if (boxView === 'list') {
    container.className = 'box-list';
    container.innerHTML = '';
    boxes.forEach(b => {
      const row = document.createElement('div');
      row.className = 'box-list-row';
      row.innerHTML = `
        <div class="box-list-thumb"></div>
        <div class="box-list-num">BOX<br>${b.box_number}</div>
        <div class="box-list-info">
          <div class="box-list-title">${esc(b.label || 'Unlabelled')}</div>
          <div class="box-list-meta">${b.room_name ? `📍 ${esc(b.room_name)}` : 'No room'} · ${b.item_count} type${b.item_count!=1?'s':''}</div>
        </div>
        <div class="box-list-actions">
          <button class="btn btn-sm btn-primary">🖨</button>
          <button class="btn btn-sm btn-danger">Del</button>
        </div>`;
      // delegated — avoid onclick string interpolation
      row.dataset.boxId = b.id;
      fillBoxThumb(row.querySelector('.box-list-thumb'), b);
      row.querySelector('.box-list-info').addEventListener('click', () => openBoxDetail(b.id));
      row.querySelector('.box-list-num').addEventListener('click', () => openBoxDetail(b.id));
      row.querySelectorAll('.box-list-actions button')[0].addEventListener('click', e => { e.stopPropagation(); openPrintModal(b.id); });
      row.querySelectorAll('.box-list-actions button')[1].addEventListener('click', e => { e.stopPropagation(); deleteBox(b.id); });
      container.appendChild(row);
    });
  } else {
    container.className = 'card-grid';
    container.innerHTML = '';
    boxes.forEach(b => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-thumb"></div>
        <div class="card-body">
          <div class="card-num">BOX ${b.box_number}</div>
          <div class="card-title">${esc(b.label || 'Unlabelled')}</div>
          <div class="card-meta">${b.room_name ? `📍 ${esc(b.room_name)}` : 'No room'} · ${b.item_count} type${b.item_count!=1?'s':''}</div>
          ${b.description ? `<div class="card-desc">${esc(b.description.substring(0,80))}${b.description.length>80?'…':''}</div>` : ''}
          <div class="card-actions"></div>
        </div>`;
      // Populate thumbnail via DOM (avoids inserting URLs into template strings)
      fillBoxThumb(card.querySelector('.card-thumb'), b);
      // Actions via JS to avoid interpolation
      const actions = card.querySelector('.card-actions');
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-sm btn-secondary'; editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', e => { e.stopPropagation(); openBoxModal(b.id); });
      const printBtn = document.createElement('button');
      printBtn.className = 'btn btn-sm btn-primary'; printBtn.textContent = '🖨';
      printBtn.addEventListener('click', e => { e.stopPropagation(); openPrintModal(b.id); });
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-sm btn-danger'; delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', e => { e.stopPropagation(); deleteBox(b.id); });
      actions.appendChild(editBtn); actions.appendChild(printBtn); actions.appendChild(delBtn);
      card.addEventListener('click', () => openBoxDetail(b.id));
      card.dataset.boxId = b.id;

      // Update existing card in-place, or insert new one in sorted position
      const existing = container.querySelector(`[data-box-id="${b.id}"]`);
      if (existing) {
        // Swap thumbnail in case photos changed
        const newThumb = card.querySelector('.card-thumb');
        const oldThumb = existing.querySelector('.card-thumb');
        if (newThumb && oldThumb) existing.replaceChild(newThumb, oldThumb);
        // Update text fields
        const fields = ['card-num','card-title','card-meta','card-desc'];
        fields.forEach(cls => {
          const n = card.querySelector('.'+cls);
          const o = existing.querySelector('.'+cls);
          if (n && o && n.textContent !== o.textContent) o.textContent = n.textContent;
          if (n && !o && existing.querySelector('.card-body')) existing.querySelector('.card-body').appendChild(n);
        });
      } else {
        container.appendChild(card);
      }
    });
  }
}

function openBoxModal(id = null, presetRoomId = null) {
  editingBox = id;
  document.getElementById('modal-box-title').textContent = id ? 'Edit Box' : 'New Box';
  const sel = document.getElementById('box-room');
  sel.innerHTML = '<option value="">— No Room —</option>' +
    rooms.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  if (id) {
    api(`/api/boxes/${id}`).then(b => {
      document.getElementById('box-label').value = b.label || '';
      document.getElementById('box-description').value = b.description || '';
      sel.value = b.room_id || '';
    });
  } else {
    document.getElementById('box-label').value = '';
    document.getElementById('box-description').value = '';
    sel.value = presetRoomId || '';
  }
  openModal('modal-box');
}

async function saveBox() {
  const label = document.getElementById('box-label').value.trim();
  const description = document.getElementById('box-description').value.trim();
  const room_id = document.getElementById('box-room').value || null;
  try {
    if (editingBox) {
      await api(`/api/boxes/${editingBox}`, { method:'PUT', body:JSON.stringify({label, description, room_id}) });
      closeModal('modal-box');
      toast('Box updated');
      openBoxDetail(editingBox);
    } else {
      const box = await api('/api/boxes', { method:'POST', body:JSON.stringify({label, description, room_id}) });
      closeModal('modal-box');
      toast(`Box #${box.box_number} created`);
      loadBoxes();
    }
  } catch(e) { toast(e.message, true); }
}

async function deleteBox(id) {
  if (!confirm('Delete this box and all its contents?')) return;
  await api(`/api/boxes/${id}`, { method:'DELETE' });
  toast('Box deleted');
  showPanel('boxes');
}

// ── Box Detail ─────────────────────────────────────────────────────────────
async function openBoxDetail(id) {
  currentBoxId = id;
  const box = await api(`/api/boxes/${id}`);

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tabbar button, .sidebar button').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-box-detail').classList.add('active');
  // Write URL hash and persist to sessionStorage (fallback for HA ingress)
  const _navKey = `box/${id}`;
  if (location.hash !== `#${_navKey}`) location.hash = _navKey;
  saveNav(_navKey);
  // Keep "Boxes" highlighted in nav while viewing a box
  const tb = document.getElementById('tab-boxes');
  if (tb) tb.classList.add('active');
  const sb = document.getElementById('sidebar-boxes');
  if (sb) sb.classList.add('active');
  document.getElementById('mainContent').scrollTop = 0;

  // Build item rows using DOM — never inline data in HTML strings
  const itemRowsEl = document.createElement('div');
  if (box.items.length) {
    box.items.forEach(i => {
      const row = document.createElement('div');
      row.className = 'item-row';

      // Thumbnail — shows item photo if exists, camera icon if not
      const thumb = document.createElement('div');
      thumb.className = 'item-row-thumb';
      thumb.dataset.itemId = i.item_id;
      if (i.thumb_url) {
        const img = document.createElement('img');
        img.src = i.thumb_url;
        img.loading = 'lazy';
        img.alt = i.name;
        thumb.appendChild(img);
        thumb.dataset.action = 'item-thumb-view';
        thumb.dataset.url = i.thumb_url;
        thumb.title = 'View photo';
      } else {
        const icon = document.createElement('span');
        icon.className = 'no-photo';
        icon.textContent = '📷';
        thumb.appendChild(icon);
        thumb.dataset.action = 'item-thumb-upload';
        thumb.title = 'Add photo';
      }

      // Info section
      const info = document.createElement('div');
      info.className = 'item-row-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'item-row-name';
      nameEl.textContent = i.name;
      const metaEl = document.createElement('div');
      metaEl.className = 'item-row-meta';
      if (i.category) {
        const chip = document.createElement('span');
        chip.className = 'chip cat';
        chip.textContent = i.category;
        metaEl.appendChild(chip);
      }
      if (i.notes) {
        const noteSpan = document.createElement('span');
        noteSpan.textContent = ' · ' + i.notes;
        metaEl.appendChild(noteSpan);
      }
      info.appendChild(nameEl);
      info.appendChild(metaEl);

      // Inline qty control: [−] [num▾] [+]
      const qtyCtrl = document.createElement('div');
      qtyCtrl.className = 'item-qty-control';

      const minusBtn = document.createElement('button');
      minusBtn.className = 'item-qty-btn';
      minusBtn.textContent = '−';
      minusBtn.dataset.action = 'qty-minus';
      minusBtn.dataset.id = i.box_item_id;

      const numWrap = document.createElement('div');
      numWrap.style.position = 'relative';

      const numEl = document.createElement('div');
      numEl.className = 'item-qty-num';
      numEl.textContent = i.quantity;
      numEl.dataset.action = 'qty-pick';
      numEl.dataset.id = i.box_item_id;
      numEl.dataset.qty = i.quantity;

      // Dropdown: scrollable list 0–999, 6 rows visible, centered on current qty
      const dropdown = document.createElement('div');
      dropdown.className = 'item-qty-dropdown';
      dropdown.id = `qty-dd-${i.box_item_id}`;
      const maxQty = Math.max(999, i.quantity + 50);
      for (let n = 0; n <= maxQty; n++) {
        const opt = document.createElement('div');
        opt.className = 'item-qty-option' + (n === i.quantity ? ' selected' : '');
        opt.textContent = n;
        opt.dataset.action = 'qty-select';
        opt.dataset.id = i.box_item_id;
        opt.dataset.val = n;
        dropdown.appendChild(opt);
      }

      const plusBtn = document.createElement('button');
      plusBtn.className = 'item-qty-btn';
      plusBtn.textContent = '+';
      plusBtn.dataset.action = 'qty-plus';
      plusBtn.dataset.id = i.box_item_id;

      numWrap.appendChild(numEl);
      numWrap.appendChild(dropdown);
      qtyCtrl.appendChild(minusBtn);
      qtyCtrl.appendChild(numWrap);
      qtyCtrl.appendChild(plusBtn);

      // Edit & remove buttons
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-icon';
      editBtn.dataset.action = 'edit-box-item';
      editBtn.dataset.id = i.box_item_id;
      editBtn.dataset.qty = i.quantity;
      editBtn.dataset.notes = i.notes || '';
      editBtn.dataset.name = i.name;
      editBtn.textContent = '✏️';

      const moveBtn = document.createElement('button');
      moveBtn.className = 'btn-move';
      moveBtn.dataset.action = 'move-box-item';
      moveBtn.dataset.id = i.box_item_id;
      moveBtn.dataset.name = i.name;
      moveBtn.dataset.qty = i.quantity;
      moveBtn.title = 'Move to another box';
      moveBtn.textContent = '⇄';

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon danger';
      delBtn.dataset.action = 'remove-box-item';
      delBtn.dataset.id = i.box_item_id;
      delBtn.textContent = '🗑';

      row.appendChild(thumb);
      row.appendChild(info);
      row.appendChild(qtyCtrl);
      row.appendChild(editBtn);
      row.appendChild(moveBtn);
      row.appendChild(delBtn);
      itemRowsEl.appendChild(row);
    });
  } else {
    itemRowsEl.innerHTML = '<div class="empty">No items yet.</div>';
  }
  const itemsHtml = itemRowsEl.innerHTML;

  const imagesHtml = renderGallery(box.images, 'box', box.id);

  document.getElementById('box-detail-content').innerHTML = `
    <div class="detail">
      <div class="detail-back">
        <button class="btn btn-secondary btn-sm" onclick="showPanel('boxes')">← Back</button>
      </div>
      <div class="detail-hdr">
        <div class="detail-num">${box.box_number}</div>
        <div style="flex:1;min-width:0;">
          <div class="detail-title">${esc(box.label || 'Unlabelled Box')}</div>
          <div class="detail-room">📍 ${esc(box.room_name || 'No room assigned')}</div>
          ${box.description ? `<div class="detail-desc">${esc(box.description)}</div>` : ''}
        </div>
        <div class="detail-actions">
          <button class="btn btn-secondary btn-sm" onclick="openBoxModal(${box.id})">Edit</button>
          <button class="btn btn-primary btn-sm" onclick="openPrintModal(${box.id})">🖨</button>
        </div>
      </div>

      <div class="section-hdr">
        <h3>Photos</h3>
        <button class="btn btn-secondary btn-sm" data-action="upload-box-photo" data-box-id="${box.id}">+ Photo</button>
      </div>
      <div id="gallery-box-${box.id}" class="gallery">${imagesHtml}</div>

      <div class="section-hdr">
        <h3>Contents (${box.items.length})</h3>
        <button class="btn btn-primary btn-sm" onclick="openAddToBoxModal(${box.id})">+ Item</button>
      </div>
      <div id="box-items-list">${itemsHtml}</div>
    </div>
  `;
}

async function refreshBoxItemsInPlace(id) {
  // Re-fetch box items and update the list without scrolling or re-rendering the header.
  // Only valid when already viewing this box.
  if (!id || !document.getElementById('box-items-list')) {
    // Not on box detail view — fall back to full reload
    await openBoxDetail(id);
    return;
  }
  try {
    const box = await api(`/api/boxes/${id}`);

    // Build item rows (same logic as openBoxDetail but only the list part)
    const itemRowsEl = document.createElement('div');
    if (box.items && box.items.length) {
      box.items.forEach(i => {
        const row = document.createElement('div');
        row.className = 'item-row';

        const thumb = document.createElement('div');
        thumb.className = 'item-row-thumb';
        thumb.dataset.itemId = i.item_id;
        if (i.thumb_url) {
          const img = document.createElement('img');
          img.src = i.thumb_url; img.loading = 'lazy'; img.alt = i.name;
          thumb.appendChild(img);
          thumb.dataset.action = 'item-thumb-view';
          thumb.dataset.url = i.thumb_url;
          thumb.title = 'View photo';
        } else {
          const icon = document.createElement('span');
          icon.className = 'no-photo'; icon.textContent = '📷';
          thumb.appendChild(icon);
          thumb.dataset.action = 'item-thumb-upload';
          thumb.title = 'Add photo';
        }

        const info = document.createElement('div');
        info.className = 'item-row-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'item-row-name'; nameEl.textContent = i.name;
        const metaEl = document.createElement('div');
        metaEl.className = 'item-row-meta';
        if (i.category) {
          const chip = document.createElement('span');
          chip.className = 'chip cat'; chip.textContent = i.category;
          metaEl.appendChild(chip);
        }
        if (i.notes) {
          const noteSpan = document.createElement('span');
          noteSpan.textContent = ' · ' + i.notes;
          metaEl.appendChild(noteSpan);
        }
        info.appendChild(nameEl); info.appendChild(metaEl);

        const qtyCtrl = document.createElement('div');
        qtyCtrl.className = 'item-qty-control';
        const minusBtn = document.createElement('button');
        minusBtn.className = 'item-qty-btn'; minusBtn.textContent = '−';
        minusBtn.dataset.action = 'qty-minus'; minusBtn.dataset.id = i.box_item_id;
        const numWrap = document.createElement('div');
        numWrap.style.position = 'relative';
        const numEl = document.createElement('div');
        numEl.className = 'item-qty-num'; numEl.textContent = i.quantity;
        numEl.dataset.action = 'qty-pick'; numEl.dataset.id = i.box_item_id;
        numEl.dataset.qty = i.quantity;
        const dropdown = document.createElement('div');
        dropdown.className = 'item-qty-dropdown';
        dropdown.id = `qty-dd-${i.box_item_id}`;
        const maxQty = Math.max(999, i.quantity + 50);
        for (let n = 0; n <= maxQty; n++) {
          const opt = document.createElement('div');
          opt.className = 'item-qty-option' + (n === i.quantity ? ' selected' : '');
          opt.textContent = n;
          opt.dataset.action = 'qty-select'; opt.dataset.id = i.box_item_id; opt.dataset.val = n;
          dropdown.appendChild(opt);
        }
        const plusBtn = document.createElement('button');
        plusBtn.className = 'item-qty-btn'; plusBtn.textContent = '+';
        plusBtn.dataset.action = 'qty-plus'; plusBtn.dataset.id = i.box_item_id;
        numWrap.appendChild(numEl); numWrap.appendChild(dropdown);
        qtyCtrl.appendChild(minusBtn); qtyCtrl.appendChild(numWrap); qtyCtrl.appendChild(plusBtn);

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-icon';
        editBtn.dataset.action = 'edit-box-item'; editBtn.dataset.id = i.box_item_id;
        editBtn.dataset.qty = i.quantity; editBtn.dataset.notes = i.notes || '';
        editBtn.dataset.name = i.name; editBtn.textContent = '✏️';

        const moveBtn = document.createElement('button');
        moveBtn.className = 'btn-move';
        moveBtn.dataset.action = 'move-box-item'; moveBtn.dataset.id = i.box_item_id;
        moveBtn.dataset.name = i.name; moveBtn.dataset.qty = i.quantity;
        moveBtn.title = 'Move to another box'; moveBtn.textContent = '⇄';

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-icon danger';
        delBtn.dataset.action = 'remove-box-item'; delBtn.dataset.id = i.box_item_id;
        delBtn.textContent = '🗑';

        fillBoxThumb(thumb, i.thumb_url ? { thumb_url: i.thumb_url } : {});

        row.appendChild(thumb); row.appendChild(info); row.appendChild(qtyCtrl);
        row.appendChild(editBtn); row.appendChild(moveBtn); row.appendChild(delBtn);
        itemRowsEl.appendChild(row);
      });
    } else {
      itemRowsEl.innerHTML = '<div class="empty">No items yet.</div>';
    }

    // Swap in-place — no scroll, no header rebuild
    const list = document.getElementById('box-items-list');
    if (list) list.innerHTML = itemRowsEl.innerHTML;

    // Update the contents heading count
    const hdr = document.querySelector('#box-detail-content .section-hdr h3');
    if (hdr && hdr.textContent.startsWith('Contents')) {
      hdr.textContent = `Contents (${box.items ? box.items.length : 0})`;
    }
  } catch(e) {
    console.error('refreshBoxItemsInPlace error:', e);
  }
}

function renderGallery(images, entityType, entityId) {
  // Build via DOM to avoid putting URLs/strings inside onclick attributes
  const wrap = document.createElement('div');
  images.forEach(img => {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.id = `img-${img.id}`;

    const imgEl = document.createElement('img');
    imgEl.src = img.url;
    imgEl.loading = 'lazy';
    imgEl.dataset.action = 'view-image';
    imgEl.dataset.url = img.url;

    const delBtn = document.createElement('button');
    delBtn.className = 'del-img';
    delBtn.textContent = '✕';
    delBtn.dataset.action = 'delete-image';
    delBtn.dataset.imageId = img.id;
    delBtn.dataset.entityType = entityType;
    delBtn.dataset.entityId = entityId;

    item.appendChild(imgEl);
    item.appendChild(delBtn);
    wrap.appendChild(item);
  });
  return wrap.innerHTML;
}

// Close any open qty dropdowns when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.item-qty-control')) {
    document.querySelectorAll('.item-qty-dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

// Delegated listener for the box-detail panel
document.getElementById('panel-box-detail').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'remove-box-item') {
    if (!confirm('Remove this item from the box?')) return;
    await api(`/api/box-items/${btn.dataset.id}`, { method:'DELETE' });
    toast('Item removed');
    refreshBoxItemsInPlace(currentBoxId);

  } else if (action === 'edit-box-item') {
    openEditBoxItemModal(btn.dataset.id, btn.dataset.qty, btn.dataset.notes, btn.dataset.name);

  } else if (action === 'qty-minus') {
    const numEl = btn.closest('.item-qty-control').querySelector('.item-qty-num');
    const cur = parseInt(numEl.textContent) || 0;
    if (cur <= 1) {
      if (confirm('Set quantity to 0? This will remove the item from the box.')) {
        await api(`/api/box-items/${btn.dataset.id}`, { method: 'DELETE' });
        toast('Item removed');
        refreshBoxItemsInPlace(currentBoxId);
      }
    } else {
      await patchQty(btn.dataset.id, cur - 1, numEl);
    }

  } else if (action === 'qty-plus') {
    const numEl = btn.closest('.item-qty-control').querySelector('.item-qty-num');
    const cur = parseInt(numEl.textContent) || 0;
    await patchQty(btn.dataset.id, cur + 1, numEl); // no upper cap

  } else if (action === 'qty-pick') {
    const dd = document.getElementById(`qty-dd-${btn.dataset.id}`);
    const wasOpen = dd.classList.contains('open');
    document.querySelectorAll('.item-qty-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) {
      dd.classList.add('open');
      // Scroll so the selected option is centered in the 6-row viewport
      const selected = dd.querySelector('.item-qty-option.selected');
      if (selected) {
        const rowH = selected.offsetHeight || 30;
        dd.scrollTop = Math.max(0, selected.offsetTop - rowH * 2);
      }
    }

  } else if (action === 'qty-select') {
    e.stopPropagation();
    const val = parseInt(btn.dataset.val);
    const dd = btn.closest('.item-qty-dropdown');
    dd.classList.remove('open');
    const numEl = dd.previousElementSibling; // the .item-qty-num div
    await patchQty(btn.dataset.id, val, numEl);

  } else if (action === 'view-image') {
    viewImage(btn.dataset.url);

  } else if (action === 'delete-image') {
    if (!confirm('Delete this photo?')) return;
    await api(`/api/images/${btn.dataset.imageId}`, { method:'DELETE' });
    toast('Photo deleted');
    if (btn.dataset.entityType === 'box') openBoxDetail(parseInt(btn.dataset.entityId));

  } else if (action === 'move-box-item') {
    openMoveItemModal(btn.dataset.id, btn.dataset.name, currentBoxId, btn.dataset.qty);

  } else if (action === 'upload-box-photo') {
    const boxId = parseInt(btn.dataset.boxId);
    triggerImageUpload('box', boxId, () => openBoxDetail(boxId));

  } else if (action === 'item-thumb-view') {
    // Tap existing photo — show full image with option to delete/replace
    showItemPhotoOverlay(btn.dataset.url, parseInt(btn.dataset.itemId));

  } else if (action === 'item-thumb-upload') {
    // Tap camera icon — upload a new photo for this item
    triggerImageUpload('item', parseInt(btn.dataset.itemId), () => refreshBoxItemsInPlace(currentBoxId));
  }
});

function showItemPhotoOverlay(url, itemId) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position:'fixed', inset:'0', background:'rgba(0,0,0,.92)',
    zIndex:'500', display:'flex', flexDirection:'column',
    alignItems:'center', justifyContent:'center', gap:'16px',
  });

  const img = document.createElement('img');
  img.src = url;
  Object.assign(img.style, {
    maxWidth:'92vw', maxHeight:'75vh', objectFit:'contain',
  });

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:12px;';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-secondary btn-sm';
  closeBtn.textContent = '✕ Close';
  closeBtn.addEventListener('click', () => overlay.remove());

  const replaceBtn = document.createElement('button');
  replaceBtn.className = 'btn btn-secondary btn-sm';
  replaceBtn.textContent = '🔄 Replace';
  replaceBtn.addEventListener('click', () => {
    overlay.remove();
    triggerImageUpload('item', itemId, () => refreshBoxItemsInPlace(currentBoxId));
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-danger btn-sm';
  deleteBtn.textContent = '🗑 Delete Photo';
  deleteBtn.addEventListener('click', async () => {
    // Extract image id — URL ends with the numeric ID regardless of ingress prefix
    const imageId = url.split('/').pop();
    if (!confirm('Delete this photo?')) return;
    await api(`/api/images/${imageId}`, { method: 'DELETE' });
    overlay.remove();
    toast('Photo deleted');
    refreshBoxItemsInPlace(currentBoxId);
  });

  btnRow.appendChild(closeBtn);
  btnRow.appendChild(replaceBtn);
  btnRow.appendChild(deleteBtn);
  overlay.appendChild(img);
  overlay.appendChild(btnRow);

  // Tap backdrop (not buttons/image) to close
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function patchQty(boxItemId, newQty, numEl) {
  numEl.textContent = newQty;
  numEl.dataset.qty = newQty;
  const dd = document.getElementById(`qty-dd-${boxItemId}`);
  if (dd) {
    // Extend dropdown range if needed
    const maxRendered = parseInt(dd.lastElementChild?.dataset.val || 0);
    if (newQty > maxRendered) {
      for (let n = maxRendered + 1; n <= newQty + 50; n++) {
        const opt = document.createElement('div');
        opt.className = 'item-qty-option';
        opt.textContent = n;
        opt.dataset.action = 'qty-select';
        opt.dataset.id = boxItemId;
        opt.dataset.val = n;
        dd.appendChild(opt);
      }
    }
    dd.querySelectorAll('.item-qty-option').forEach(o => {
      o.classList.toggle('selected', parseInt(o.dataset.val) === newQty);
    });
  }
  try {
    // Get current notes from the edit button's data
    const editBtn = numEl.closest('.item-row')?.querySelector('[data-action="edit-box-item"]');
    const notes = editBtn ? editBtn.dataset.notes : '';
    await api(`/api/box-items/${boxItemId}`, {
      method: 'PUT',
      body: JSON.stringify({ quantity: newQty, notes })
    });
    // Update edit button's cached qty
    if (editBtn) editBtn.dataset.qty = newQty;
  } catch(err) {
    toast('Failed to update quantity', true);
    refreshBoxItemsInPlace(currentBoxId); // refresh to get real state
  }
}

function openEditBoxItemModal(boxItemId, qty, notes, name) {
  document.getElementById('edit-item-box-item-id').value = boxItemId;
  document.getElementById('edit-item-name-display').textContent = name || '';
  document.getElementById('edit-item-qty').value = qty || 1;
  document.getElementById('edit-item-notes').value = notes || '';
  document.getElementById('edit-qty-grid').style.display = 'none';

  // Build scrollable qty list centered on current value
  const cells = document.getElementById('edit-qty-cells');
  cells.innerHTML = '';
  const curQty = parseInt(qty) || 0;
  const maxQ = Math.max(999, curQty + 50);
  for (let n = 0; n <= maxQ; n++) {
    const c = document.createElement('div');
    c.className = 'qty-cell' + (n === curQty ? ' selected' : '');
    c.textContent = n;
    c.addEventListener('click', () => {
      document.getElementById('edit-item-qty').value = n;
      cells.querySelectorAll('.qty-cell').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
      document.getElementById('edit-qty-grid').style.display = 'none';
    });
    cells.appendChild(c);
  }

  // Minus / plus buttons in modal — no arbitrary cap
  document.getElementById('edit-qty-minus').onclick = () => {
    const inp = document.getElementById('edit-item-qty');
    const cur = parseInt(inp.value) || 0;
    inp.value = Math.max(0, cur - 1);
  };
  document.getElementById('edit-qty-plus').onclick = () => {
    const inp = document.getElementById('edit-item-qty');
    inp.value = (parseInt(inp.value) || 0) + 1;
  };

  // Tap the number to toggle the scrollable list; center on selected value
  document.getElementById('edit-item-qty').addEventListener('click', () => {
    const grid = document.getElementById('edit-qty-grid');
    const isHidden = grid.style.display === 'none';
    grid.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      const sel = cells.querySelector('.qty-cell.selected');
      if (sel) {
        const rowH = sel.offsetHeight || 34;
        cells.scrollTop = Math.max(0, sel.offsetTop - rowH * 2);
      }
    }
  }, { once: false });

  // Remove button wired to box item id
  document.getElementById('edit-item-remove-btn').onclick = async () => {
    if (!confirm('Remove this item from the box?')) return;
    closeModal('modal-edit-item');
    await api(`/api/box-items/${boxItemId}`, { method: 'DELETE' });
    toast('Item removed');
    refreshBoxItemsInPlace(currentBoxId);
  };

  openModal('modal-edit-item');
}

async function saveEditBoxItem() {
  const boxItemId = document.getElementById('edit-item-box-item-id').value;
  const qty = parseInt(document.getElementById('edit-item-qty').value) || 0;
  const notes = document.getElementById('edit-item-notes').value.trim();
  if (qty === 0) {
    if (!confirm('Set quantity to 0? This will remove the item from the box.')) return;
    closeModal('modal-edit-item');
    await api(`/api/box-items/${boxItemId}`, { method: 'DELETE' });
    toast('Item removed');
    refreshBoxItemsInPlace(currentBoxId);
    return;
  }
  await api(`/api/box-items/${boxItemId}`, {
    method: 'PUT',
    body: JSON.stringify({ quantity: qty, notes })
  });
  closeModal('modal-edit-item');
  toast('Updated');
  refreshBoxItemsInPlace(currentBoxId);
}

async function removeBoxItem(boxItemId) {
  if (!confirm('Remove this item from the box?')) return;
  await api(`/api/box-items/${boxItemId}`, { method:'DELETE' });
  toast('Item removed');
  refreshBoxItemsInPlace(currentBoxId);
}

// ── Move item between boxes ─────────────────────────────────────────────────
let moveItemSourceBoxId = null;

function openMoveItemModal(boxItemId, itemName, sourceBoxId, currentQty) {
  moveItemSourceBoxId = sourceBoxId;
  document.getElementById('move-box-item-id').value = boxItemId;
  document.getElementById('move-item-max-qty').value = currentQty || 1;
  document.getElementById('move-box-search').value = '';
  document.getElementById('move-box-search').style.display = '';
  document.getElementById('move-box-selected-badge').style.display = 'none';
  document.getElementById('move-box-id').value = '';
  document.getElementById('move-box-suggestions').classList.remove('open');

  const qty = parseInt(currentQty) || 1;

  if (qty <= 1) {
    // Single item — no qty chooser, just show info
    document.getElementById('move-item-info').textContent = `Moving: ${itemName}`;
    document.getElementById('move-qty-field').style.display = 'none';
  } else {
    // Multiple — show qty stepper defaulting to full qty
    document.getElementById('move-item-info').textContent = `Moving: ${itemName}`;
    document.getElementById('move-qty-field').style.display = 'block';
    document.getElementById('move-qty-input').value = qty;
    document.getElementById('move-qty-hint').textContent =
      `${qty} in this box · move between 1 and ${qty}`;

    // Build scrollable qty list 1..maxQty
    const dd = document.getElementById('move-qty-dropdown');
    dd.innerHTML = '';
    dd.style.display = 'none';
    for (let n = 1; n <= qty; n++) {
      const opt = document.createElement('div');
      opt.className = 'item-qty-option' + (n === qty ? ' selected' : '');
      opt.textContent = n;
      opt.addEventListener('click', () => {
        document.getElementById('move-qty-input').value = n;
        dd.querySelectorAll('.item-qty-option').forEach(o =>
          o.classList.toggle('selected', parseInt(o.textContent) === n));
        dd.style.display = 'none';
        document.getElementById('move-qty-hint').textContent =
          n === qty
            ? `Moving all ${qty} · ${0} will remain`
            : `Moving ${n} · ${qty - n} will remain in this box`;
      });
      dd.appendChild(opt);
    }

    // Tap the number to toggle dropdown
    const inp = document.getElementById('move-qty-input');
    inp.onclick = () => {
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
      if (dd.style.display === 'block') {
        const sel = dd.querySelector('.item-qty-option.selected');
        if (sel) {
          const rowH = sel.offsetHeight || 30;
          dd.scrollTop = Math.max(0, sel.offsetTop - rowH * 2);
        }
      }
    };

    // Minus / plus buttons
    document.getElementById('move-qty-minus').onclick = () => {
      const cur = parseInt(inp.value) || 1;
      if (cur > 1) {
        inp.value = cur - 1;
        updateMoveQtyHint(cur - 1, qty);
        syncMoveQtyDropdown(cur - 1);
      }
    };
    document.getElementById('move-qty-plus').onclick = () => {
      const cur = parseInt(inp.value) || 1;
      if (cur < qty) {
        inp.value = cur + 1;
        updateMoveQtyHint(cur + 1, qty);
        syncMoveQtyDropdown(cur + 1);
      }
    };
    inp.oninput = () => {
      const v = Math.max(1, Math.min(qty, parseInt(inp.value) || 1));
      updateMoveQtyHint(v, qty);
      syncMoveQtyDropdown(v);
    };
  }

  openModal('modal-move-item');
}

function updateMoveQtyHint(moving, total) {
  const remaining = total - moving;
  document.getElementById('move-qty-hint').textContent =
    remaining === 0
      ? `Moving all ${total}`
      : `Moving ${moving} · ${remaining} will remain in this box`;
}

function syncMoveQtyDropdown(val) {
  document.getElementById('move-qty-dropdown').querySelectorAll('.item-qty-option').forEach(o =>
    o.classList.toggle('selected', parseInt(o.textContent) === val));
}

async function searchBoxesForMove(q) {
  const list = document.getElementById('move-box-suggestions');
  const boxes = await getBoxesCached();
  const lq = (q || '').toLowerCase().trim();
  const stripped = lq.replace(/^box\s*/i, '').trim();

  // Show all except the source box; filter by query if provided
  let filtered = boxes.filter(b => b.id !== moveItemSourceBoxId);
  if (lq && lq !== ' ') {
    filtered = filtered.filter(b =>
      String(b.box_number) === stripped ||
      String(b.box_number).startsWith(stripped) ||
      (b.label || '').toLowerCase().includes(lq) ||
      (b.room_name || '').toLowerCase().includes(lq) ||
      `box ${b.box_number}`.includes(lq)
    );
  }

  list.innerHTML = '';
  filtered.slice(0, 10).forEach(b => {
    const opt = document.createElement('div');
    opt.className = 'ac-item';
    opt.dataset.moveBoxId = b.id;
    opt.dataset.moveBoxLabel = `BOX ${b.box_number}${b.label ? ' · ' + b.label : ''}`;
    opt.innerHTML = `<span><strong>BOX ${b.box_number}</strong>${b.label ? ' · ' + esc(b.label) : ''}</span><small>${esc(b.room_name || '')}</small>`;
    list.appendChild(opt);
  });
  if (list.children.length) {
    positionDropdownFixed(list);
    list.classList.add('open');
  } else {
    list.classList.remove('open');
  }
}

// Delegated listener for move-box suggestions
document.getElementById('move-box-suggestions').addEventListener('mousedown', e => e.preventDefault());
document.getElementById('move-box-suggestions').addEventListener('click', e => {
  const item = e.target.closest('.ac-item');
  if (!item) return;
  document.getElementById('move-box-id').value = item.dataset.moveBoxId;
  document.getElementById('move-box-selected-name').textContent = item.dataset.moveBoxLabel;
  document.getElementById('move-box-selected-badge').style.display = 'flex';
  document.getElementById('move-box-search').style.display = 'none';
  document.getElementById('move-box-suggestions').classList.remove('open');
});

function clearMoveBox() {
  document.getElementById('move-box-id').value = '';
  document.getElementById('move-box-search').value = '';
  document.getElementById('move-box-search').style.display = '';
  document.getElementById('move-box-selected-badge').style.display = 'none';
  document.getElementById('move-box-search').focus();
}

async function confirmMoveItem() {
  const boxItemId = document.getElementById('move-box-item-id').value;
  const targetBoxId = document.getElementById('move-box-id').value;
  if (!targetBoxId) { toast('Select a destination box', true); return; }

  const maxQty = parseInt(document.getElementById('move-item-max-qty').value) || 1;
  const qtyField = document.getElementById('move-qty-field');
  const moveQty = qtyField.style.display !== 'none'
    ? Math.max(1, Math.min(maxQty, parseInt(document.getElementById('move-qty-input').value) || maxQty))
    : maxQty; // qty=1, move all

  try {
    const result = await api(`/api/box-items/${boxItemId}/move`, {
      method: 'POST', body: JSON.stringify({ target_box_id: targetBoxId, quantity: moveQty })
    });
    closeModal('modal-move-item');
    const remaining = result.qty_remaining;
    const moved = result.qty_moved;
    const msg = remaining > 0
      ? `${moved} moved · ${remaining} remain in source box`
      : result.merged ? 'Item moved and merged' : 'Item moved';
    toast(msg);
    Object.keys(roomBoxCache).forEach(k => delete roomBoxCache[k]);
    if (moveItemSourceBoxId) refreshBoxItemsInPlace(moveItemSourceBoxId);
  } catch(e) { toast(e.message, true); }
}

// Also add move button to items expand rows (items panel)
// Called from toggleItemExpand after rendering boxes
function addMoveToExpandRows(inner) {
  inner.querySelectorAll('.expand-box-row').forEach(row => {
    const moveBtn = document.createElement('button');
    moveBtn.className = 'btn-move';
    moveBtn.title = 'Move to another box';
    moveBtn.textContent = '⇄';
    moveBtn.style.marginLeft = '4px';
    const boxItemId = row.dataset.boxItemId;
    const itemName = row.dataset.itemName;
    const sourceBoxId = row.dataset.boxId;
    if (boxItemId) {
      moveBtn.addEventListener('click', e => {
        e.stopPropagation();
        moveItemSourceBoxId = parseInt(sourceBoxId);
        const expandQty = row.dataset.qty;
        openMoveItemModal(boxItemId, itemName, parseInt(sourceBoxId), expandQty);
      });
      row.appendChild(moveBtn);
    }
  });
}
