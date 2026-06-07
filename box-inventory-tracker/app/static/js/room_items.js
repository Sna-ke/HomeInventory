// ── Room Placements — items placed directly in a room (not a box) ─────────
let roomItemsOpenId = null; // currently-open room for the placement panel

async function loadRoomPlacements(roomId, container) {
  container.innerHTML = '<div style="color:var(--muted);font-size:12px;font-family:var(--mono);">Loading…</div>';
  try {
    const items = await api(`/api/rooms/${roomId}/items`);
    renderRoomPlacements(roomId, items, container);
  } catch(e) {
    container.innerHTML = `<div style="color:#c33;font-size:12px;">${esc(e.message)}</div>`;
  }
}

function renderRoomPlacements(roomId, items, container) {
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<div style="color:var(--muted);font-size:12px;font-style:italic;' +
      'padding:6px 0;">No items placed directly in this room.</div>';
  } else {
    // Group by location
    const groups = {};
    items.forEach(item => {
      const loc = item.location || '';
      if (!groups[loc]) groups[loc] = [];
      groups[loc].push(item);
    });

    Object.keys(groups).sort().forEach(loc => {
      if (loc) {
        const locHdr = document.createElement('div');
        locHdr.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:1px;' +
          'text-transform:uppercase;color:var(--accent);margin:6px 0 3px;';
        locHdr.textContent = loc;
        container.appendChild(locHdr);
      }
    groups[loc].forEach(item => {
      const row = document.createElement('div');
      row.className = 'room-placed-item-row';
      row.dataset.roomItemId = item.room_item_id;

      const thumb = document.createElement('div');
      thumb.className = 'room-placed-thumb';
      if (item.thumb_url) {
        const img = document.createElement('img');
        img.src = item.thumb_url; img.loading = 'lazy'; img.alt = item.name;
        thumb.appendChild(img);
      } else {
        thumb.textContent = '📦';
        thumb.style.fontSize = '18px';
        thumb.style.display = 'flex';
        thumb.style.alignItems = 'center';
        thumb.style.justifyContent = 'center';
      }

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      info.innerHTML = `
        <div style="font-size:14px;font-weight:700;">${esc(item.name)}</div>
        ${item.category ? `<div style="font-size:11px;color:var(--muted);">${esc(item.category)}</div>` : ''}
        ${item.notes ? `<div style="font-size:12px;color:var(--muted);font-style:italic;">${esc(item.notes)}</div>` : ''}
      `;

      const qtySpan = document.createElement('div');
      qtySpan.style.cssText = 'font-family:var(--mono);font-size:13px;color:var(--accent);' +
        'font-weight:700;flex-shrink:0;';
      qtySpan.textContent = `×${item.quantity}`;

      const metaBtn = document.createElement('button');
      metaBtn.className = 'btn-icon';
      metaBtn.title = 'Asset details';
      metaBtn.textContent = '📋';
      metaBtn.addEventListener('click', e => {
        e.stopPropagation();
        openMetadataModal('room_item', item.room_item_id, item.name);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon danger';
      delBtn.textContent = '🗑';
      delBtn.title = 'Remove from room';
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Remove this item from the room?')) return;
        try {
          await api(`/api/room-items/${item.room_item_id}`, { method: 'DELETE' });
          toast('Removed');
          loadRoomPlacements(roomId, container);
        } catch(err) { toast(err.message, true); }
      });

      row.appendChild(thumb); row.appendChild(info);
      row.appendChild(qtySpan); row.appendChild(metaBtn); row.appendChild(delBtn);
      container.appendChild(row);
    }); // end items in group
    }); // end groups
  }

  // Add-item button at the bottom
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary btn-sm';
  addBtn.style.marginTop = '8px';
  addBtn.textContent = '+ Place Item in Room';
  addBtn.addEventListener('click', () => {
    // Use unified ATB modal, pre-set destination to this room
    addToBoxId = null; addToRoomId = roomId;
    document.getElementById('atb-dest-field').style.display = 'none'; // dest already known
    document.getElementById('atb-room-location-field').style.display = 'block';
    document.getElementById('atb-room-location').value = '';
    const btn = document.getElementById('atb-confirm-btn');
    if (btn) btn.textContent = 'Place in Room';
    // Store container for post-add refresh
    window._lastRoomPlacingContainer = container;
    window._lastRoomPlacingId = roomId;
    resetATBModal();
    document.getElementById('atb-dest-field').style.display = 'none';
    document.getElementById('atb-room-location-field').style.display = 'block';
    openModal('modal-atb');
    setTimeout(() => document.getElementById('atb-search').focus(), 100);
  });
  container.appendChild(addBtn);
}

// Room placement now uses the unified ATB modal

function searchRPItems(q) {
  const list = document.getElementById('rp-suggestions');
  q = q.trim();
  if (!q) { list.classList.remove('open'); return; }

  const lower = q.toLowerCase();
  const matches = allItems.filter(i => i.name.toLowerCase().includes(lower)).slice(0, 8);
  list.innerHTML = '';
  matches.forEach(i => {
    const opt = document.createElement('div');
    opt.className = 'ac-item';
    opt.innerHTML = `<span>${esc(i.name)}</span><small>${esc(i.category || '')}</small>`;
    opt.addEventListener('click', () => {
      document.getElementById('rp-search').value = i.name;
      document.getElementById('rp-item-id').value = i.id;
      list.classList.remove('open');
    });
    list.appendChild(opt);
  });

  if (matches.length) {
    positionDropdownFixed(list);
    list.classList.add('open');
  } else {
    list.classList.remove('open');
  }
}

async function confirmRoomPlacement() {
  const itemId = document.getElementById('rp-item-id').value;
  const name   = document.getElementById('rp-search').value.trim();
  const qty    = parseInt(document.getElementById('rp-qty').value) || 1;
  const notes  = document.getElementById('rp-notes').value.trim() || null;

  if (!_placingRoomId) { toast('No room selected', true); return; }
  if (!itemId && !name) { toast('Select or type an item name', true); return; }

  let resolvedItemId = itemId;

  // Create new item if no match selected
  if (!resolvedItemId && name) {
    try {
      const newItem = await api('/api/items', {
        method: 'POST', body: JSON.stringify({ name })
      });
      resolvedItemId = newItem.id;
    } catch(e) { toast(`Failed to create item: ${e.message}`, true); return; }
  }

  try {
    await api(`/api/rooms/${_placingRoomId}/items`, {
      method: 'POST',
      body: JSON.stringify({ item_id: resolvedItemId, quantity: qty, notes })
    });
    closeModal('modal-room-placement');
    toast('Item placed in room');
    if (_placingContainer) loadRoomPlacements(_placingRoomId, _placingContainer);
  } catch(e) {
    toast(`Failed: ${e.message}`, true);
  }
}
