// ── Rooms ──────────────────────────────────────────────────────────────────
async function loadRooms() {
  // Clear all caches
  Object.keys(roomBoxCache).forEach(k => delete roomBoxCache[k]);
  Object.keys(roomItemCache).forEach(k => delete roomItemCache[k]);
  // Clear find-item search
  const ris = document.getElementById('room-item-search');
  if (ris) { ris.value = ''; filterRoomsByItem(''); }
  rooms = await api('/api/rooms');
  // Update filter dropdown
  const f = document.getElementById('roomFilter');
  const prev = f.value;
  f.innerHTML = '<option value="">All Rooms</option>' +
    rooms.map(r => `<option value="${r.id}" ${prev==r.id?'selected':''}>${esc(r.name)}</option>`).join('');
  // Rooms panel — split into occupied / empty, both sorted alphabetically
  const occupied = document.getElementById('rooms-list-occupied');
  const emptyList = document.getElementById('rooms-list-empty');
  const emptySection = document.getElementById('rooms-empty-section');
  if (!occupied) return;

  const sorted = [...rooms].sort((a,b) => a.name.localeCompare(b.name));
  const occupiedRooms = sorted.filter(r => r.box_count > 0);
  const emptyRooms    = sorted.filter(r => r.box_count === 0);

  if (!sorted.length) {
    occupied.innerHTML = '<div class="empty">No rooms or areas yet.</div>';
    emptySection.style.display = 'none';
    return;
  }

  function buildRoomRow(r) {
    const wrap = document.createElement('div');
    wrap.className = 'room-row';
    wrap.dataset.roomId = r.id;

    const hdr = document.createElement('div');
    hdr.className = 'room-row-header';

    const chevron = document.createElement('span');
    chevron.className = 'cat-chevron'; chevron.textContent = '▶';
    chevron.style.visibility = r.box_count > 0 ? 'visible' : 'hidden';

    const nameEl = document.createElement('div');
    nameEl.className = 'room-row-name'; nameEl.textContent = r.name;

    const countEl = document.createElement('div');
    countEl.className = 'room-row-count';
    countEl.textContent = r.box_count > 0
      ? `${r.box_count} box${r.box_count!=1?'es':''}`
      : 'empty';

    // HA area badge
    if (r.ha_area_id) {
      const badge = document.createElement('span');
      badge.className = 'ha-badge' + (r.ha_synced ? '' : ' stale');
      badge.textContent = r.ha_synced ? 'HA Area' : 'HA (removed)';
      badge.title = r.ha_synced
        ? 'Synced from Home Assistant — rename in HA'
        : 'This area was removed from HA. You can now rename or delete it.';
      hdr.appendChild(badge);
    }

    // Add Box button — always visible
    const addBoxBtn = document.createElement('button');
    addBoxBtn.className = 'btn btn-sm btn-secondary';
    addBoxBtn.style.cssText = 'font-size:11px;padding:3px 8px;flex-shrink:0;';
    addBoxBtn.textContent = '+ Box';
    addBoxBtn.addEventListener('click', e => { e.stopPropagation(); openAddBoxToRoom(r.id, r.name); });

    // Edit/delete — hidden for active HA areas
    if (!r.ha_area_id || !r.ha_synced) {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-icon'; editBtn.textContent = '✏️';
      editBtn.addEventListener('click', e => { e.stopPropagation(); openRoomModal(r.id); });
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon danger'; delBtn.textContent = '🗑';
      delBtn.addEventListener('click', e => { e.stopPropagation(); deleteRoom(r.id); });
      hdr.appendChild(chevron); hdr.appendChild(nameEl); hdr.appendChild(countEl);
      hdr.appendChild(addBoxBtn); hdr.appendChild(editBtn); hdr.appendChild(delBtn);
    } else {
      hdr.appendChild(chevron); hdr.appendChild(nameEl); hdr.appendChild(countEl);
      hdr.appendChild(addBoxBtn);
    }

    const expand = document.createElement('div');
    expand.className = 'room-expand';
    expand.id = `room-expand-${r.id}`;
    expand.innerHTML = '<span style="color:var(--muted);font-family:var(--mono);font-size:12px;">Loading…</span>';

    // Drop target for drag-and-drop
    expand.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      expand.classList.add('drag-over');
    });
    expand.addEventListener('dragleave', e => {
      if (!expand.contains(e.relatedTarget)) expand.classList.remove('drag-over');
    });
    expand.addEventListener('drop', async e => {
      e.preventDefault();
      expand.classList.remove('drag-over');
      const boxId = parseInt(e.dataTransfer.getData('text/plain'));
      if (!boxId) return;
      await moveBoxToRoom(boxId, r.id);
    });
    // Also allow drop on the header (for empty rooms where expand isn't shown)
    hdr.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      wrap.classList.add('drag-over');
    });
    hdr.addEventListener('dragleave', e => {
      if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('drag-over');
    });
    hdr.addEventListener('drop', async e => {
      e.preventDefault();
      wrap.classList.remove('drag-over');
      const boxId = parseInt(e.dataTransfer.getData('text/plain'));
      if (!boxId) return;
      await moveBoxToRoom(boxId, r.id);
    });

    if (r.box_count > 0) {
      hdr.addEventListener('click', () => toggleRoomExpand(r.id, hdr, chevron, expand));
    }

    wrap.appendChild(hdr);
    wrap.appendChild(expand);
    return wrap;
  }

  occupied.innerHTML = '';
  occupiedRooms.forEach(r => occupied.appendChild(buildRoomRow(r)));
  if (!occupiedRooms.length) occupied.innerHTML = '<div class="empty">No rooms with boxes yet.</div>';

  emptyList.innerHTML = '';
  emptyRooms.forEach(r => emptyList.appendChild(buildRoomRow(r)));
  emptySection.style.display = emptyRooms.length ? 'block' : 'none';
}

async function openAddBoxToRoom(roomId, roomName) {
  // Open the new-box modal pre-set to this room
  await loadRooms(); // ensure room list is fresh for the selector
  openBoxModal(null, roomId);
}

async function moveBoxToRoom(boxId, roomId) {
  try {
    const box = await api(`/api/boxes/${boxId}`);
    await api(`/api/boxes/${boxId}`, {
      method: 'PUT',
      body: JSON.stringify({ label: box.label, description: box.description, room_id: roomId })
    });
    // Invalidate cache for both old and new rooms
    Object.keys(roomBoxCache).forEach(k => delete roomBoxCache[k]);
    toast('Box moved');
    await loadRooms();
    // Re-expand the destination room
    const destExpand = document.getElementById(`room-expand-${roomId}`);
    const destHdr = destExpand?.previousElementSibling;
    const destChevron = destHdr?.querySelector('.cat-chevron');
    if (destExpand && destHdr && destChevron && !destExpand.classList.contains('open')) {
      toggleRoomExpand(roomId, destHdr, destChevron, destExpand);
    }
  } catch(e) { toast(`Move failed: ${e.message}`, true); }
}

// Tracks which room boxes have been loaded already (cache)
const roomBoxCache = {};

async function toggleRoomExpand(roomId, hdr, chevron, expand) {
  const isOpen = expand.classList.contains('open');
  // Multiple rooms can be open simultaneously — just toggle this one
  if (isOpen) {
    expand.classList.remove('open');
    hdr.classList.remove('expanded');
    chevron.classList.remove('open');
    // Collapse all boxes inside when room closes
    expand.querySelectorAll('.room-box-expand.open').forEach(e => e.classList.remove('open'));
    expand.querySelectorAll('.room-box-expand-zone .cat-chevron.open').forEach(c => c.classList.remove('open'));
    return;
  }
  hdr.classList.add('expanded');
  chevron.classList.add('open');
  expand.classList.add('open');
  // Render room placements section at the top of the expand area (once)
  if (!expand.querySelector('.room-placements-section')) {
    const placementsSection = document.createElement('div');
    placementsSection.className = 'room-placements-section';
    placementsSection.style.cssText =
      'margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border);';
    const hdr2 = document.createElement('div');
    hdr2.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:1.5px;' +
      'text-transform:uppercase;color:var(--muted);margin-bottom:6px;';
    hdr2.textContent = 'Items in Room';
    placementsSection.appendChild(hdr2);
    const placementsBody = document.createElement('div');
    placementsBody.className = 'room-placements-body';
    placementsSection.appendChild(placementsBody);
    expand.insertBefore(placementsSection, expand.firstChild);
    loadRoomPlacements(roomId, placementsBody);
  }

  // Only fetch if not already populated
  if (roomBoxCache[roomId]) return;
  roomBoxCache[roomId] = true;

  try {
    const boxes = await api(`/api/rooms/${roomId}/boxes`);
    expand.innerHTML = '';
    if (!boxes.length) {
      expand.innerHTML = '<div style="color:var(--muted);font-size:12px;font-family:var(--mono);">No boxes in this room.</div>';
      return;
    }

    // Expand/collapse-all toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'room-expand-toolbar';
    const expandAll = document.createElement('button');
    expandAll.textContent = '⊞ Expand Boxes';
    expandAll.addEventListener('click', () => expandAllRoomBoxes(expand, boxes));
    const collapseAll = document.createElement('button');
    collapseAll.textContent = '⊟ Collapse Boxes';
    collapseAll.addEventListener('click', () => collapseAllRoomBoxes(expand));
    toolbar.appendChild(expandAll);
    toolbar.appendChild(collapseAll);
    expand.appendChild(toolbar);

    boxes.forEach(b => {
      const wrap = document.createElement('div');
      wrap.className = 'room-box-wrap';
      wrap.draggable = true;
      wrap.dataset.boxId = b.id;
      wrap.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', String(b.id));
        e.dataTransfer.effectAllowed = 'move';
        wrap.classList.add('dragging');
      });
      wrap.addEventListener('dragend', () => wrap.classList.remove('dragging'));

      // The row: [expand zone | nav button]
      const row = document.createElement('div');
      row.className = 'room-box-row';

      // ── Left: expand zone ────────────────────────────
      const expandZone = document.createElement('div');
      expandZone.className = 'room-box-expand-zone';

      const chevBox = document.createElement('span');
      chevBox.className = 'cat-chevron'; chevBox.textContent = '▶';

      const numEl = document.createElement('div');
      numEl.className = 'room-box-num'; numEl.textContent = `BOX ${b.box_number}`;

      const infoEl = document.createElement('div');
      infoEl.className = 'room-box-info';
      const labelEl = document.createElement('div');
      labelEl.className = 'room-box-label'; labelEl.textContent = b.label || 'Unlabelled';
      const metaEl = document.createElement('div');
      metaEl.className = 'room-box-meta';
      metaEl.textContent = `${b.item_count} type${b.item_count!=1?'s':''} · ${b.total_qty} qty`;
      infoEl.appendChild(labelEl); infoEl.appendChild(metaEl);

      expandZone.appendChild(chevBox);
      expandZone.appendChild(numEl);
      expandZone.appendChild(infoEl);

      // ── Right: navigate button ───────────────────────
      const navBtn = document.createElement('div');
      navBtn.className = 'room-box-nav';
      navBtn.title = 'Open box page';
      navBtn.innerHTML = '→ View';

      // Contents panel
      const boxExpand = document.createElement('div');
      boxExpand.className = 'room-box-expand';

      // Expand zone click → toggle contents
      expandZone.addEventListener('click', () => toggleRoomBoxExpand(b.id, chevBox, boxExpand));
      // Nav button click → go to box
      navBtn.addEventListener('click', () => openBoxDetail(b.id));

      row.appendChild(expandZone);
      row.appendChild(navBtn);
      wrap.appendChild(row);
      wrap.appendChild(boxExpand);
      expand.appendChild(wrap);
    });
  } catch(e) {
    expand.innerHTML = `<span style="color:var(--danger)">Error: ${esc(e.message)}</span>`;
  }
}

async function expandAllRoomBoxes(roomExpand, boxes) {
  // Fire all expands in parallel
  const wraps = roomExpand.querySelectorAll('.room-box-wrap');
  const promises = [];
  wraps.forEach((wrap, i) => {
    const expandZone = wrap.querySelector('.room-box-expand-zone');
    const chevron = expandZone?.querySelector('.cat-chevron');
    const boxExpand = wrap.querySelector('.room-box-expand');
    if (chevron && boxExpand && !boxExpand.classList.contains('open')) {
      promises.push(toggleRoomBoxExpand(boxes[i].id, chevron, boxExpand));
    }
  });
  await Promise.all(promises);
}

function collapseAllRoomBoxes(roomExpand) {
  roomExpand.querySelectorAll('.room-box-expand.open').forEach(e => e.classList.remove('open'));
  roomExpand.querySelectorAll('.room-box-expand-zone .cat-chevron.open').forEach(c => c.classList.remove('open'));
}

async function toggleRoomBoxExpand(boxId, chevron, boxExpand) {
  const isOpen = boxExpand.classList.contains('open');
  if (isOpen) {
    boxExpand.classList.remove('open');
    chevron.classList.remove('open');
    return;
  }
  chevron.classList.add('open');
  boxExpand.classList.add('open');

  // If already populated, just show it
  if (boxExpand.dataset.loaded) return;
  boxExpand.dataset.loaded = '1';
  boxExpand.innerHTML = '<span style="color:var(--muted);font-family:var(--mono);font-size:11px;">Loading…</span>';

  try {
    const box = await api(`/api/boxes/${boxId}`);
    boxExpand.innerHTML = '';
    if (!box.items || !box.items.length) {
      boxExpand.innerHTML = '<div style="color:var(--muted);font-size:11px;font-family:var(--mono);">Empty box.</div>';
      return;
    }
    box.items.forEach(item => {
      const itemRow = document.createElement('div');
      itemRow.className = 'room-box-item-row';
      const qty = document.createElement('span');
      qty.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--accent);flex-shrink:0;';
      qty.textContent = `×${item.quantity}`;
      const name = document.createElement('span');
      name.textContent = item.name;
      const cat = document.createElement('span');
      cat.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--muted);margin-left:auto;';
      cat.textContent = item.category || '';
      itemRow.appendChild(qty); itemRow.appendChild(name); itemRow.appendChild(cat);
      boxExpand.appendChild(itemRow);
    });
  } catch(e) {
    boxExpand.dataset.loaded = ''; // allow retry
    boxExpand.innerHTML = `<span style="color:var(--danger);font-size:11px;">Error loading</span>`;
  }
}

// ── In-place refresh of open boxes on rooms page ──────────────────────────
// Called by SSE instead of loadRooms() so expand state is preserved.
async function refreshOpenRoomBoxes() {
  // Re-render the room counts in headers (lightweight)
  try {
    const fresh = await api('/api/rooms');
    rooms = fresh;
    // Update box-count text in each room header without re-rendering
    fresh.forEach(r => {
      const wrap = document.querySelector(`.room-row[data-room-id="${r.id}"]`);
      if (!wrap) return;
      const countEl = wrap.querySelector('.room-row-count');
      if (countEl) {
        countEl.textContent = r.box_count > 0
          ? `${r.box_count} box${r.box_count !== 1 ? 'es' : ''}`
          : 'empty';
      }
    });
    // Update room filter dropdown
    const f = document.getElementById('roomFilter');
    if (f) {
      const prev = f.value;
      f.innerHTML = '<option value="">All Rooms</option>' +
        fresh.map(r => `<option value="${r.id}" ${prev==r.id?'selected':''}>${esc(r.name)}</option>`).join('');
    }
  } catch(e) { /* non-fatal */ }

  // Invalidate item caches and re-render any open box panels
  Object.keys(roomItemCache).forEach(k => delete roomItemCache[k]);

  const openBoxPanels = [...document.querySelectorAll('.room-box-expand.open')];
  await Promise.all(openBoxPanels.map(async boxExpand => {
    const boxWrap = boxExpand.closest('.room-box-wrap');
    if (!boxWrap) return;
    const boxId = parseInt(boxWrap.dataset.boxId);
    if (!boxId) return;

    try {
      const box = await api(`/api/boxes/${boxId}`);
      // Update the box meta line (item count + qty) in the expand zone
      const metaEl = boxWrap.querySelector('.room-box-meta');
      if (metaEl && box.items) {
        const totalQty = box.items.reduce((s, i) => s + i.quantity, 0);
        metaEl.textContent = `${box.items.length} type${box.items.length !== 1 ? 's' : ''} · ${totalQty} qty`;
      }

      // Re-render item rows in-place
      boxExpand.innerHTML = '';
      boxExpand.dataset.loaded = '1';
      if (!box.items || !box.items.length) {
        boxExpand.innerHTML = '<div style="color:var(--muted);font-size:11px;font-family:var(--mono);">Empty box.</div>';
        return;
      }
      box.items.forEach(item => {
        const itemRow = document.createElement('div');
        itemRow.className = 'room-box-item-row';
        const qty = document.createElement('span');
        qty.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--accent);flex-shrink:0;';
        qty.textContent = `×${item.quantity}`;
        const name = document.createElement('span');
        name.textContent = item.name;
        const cat = document.createElement('span');
        cat.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--muted);margin-left:auto;';
        cat.textContent = item.category || '';
        itemRow.appendChild(qty); itemRow.appendChild(name); itemRow.appendChild(cat);
        boxExpand.appendChild(itemRow);
      });
    } catch(e) { /* leave as-is on error */ }
  }));
}

// ── Room expand / collapse all ────────────────────────────────────────────
function expandAllRooms() {
  document.querySelectorAll('.room-row').forEach(wrap => {
    const hdr = wrap.querySelector('.room-row-header');
    const chevron = hdr?.querySelector('.cat-chevron');
    const expand = wrap.querySelector('.room-expand');
    const roomId = wrap.dataset.roomId;
    if (!expand || !hdr || !chevron || !roomId) return;
    // Skip empty rooms (chevron is hidden when box_count === 0)
    if (chevron.style.visibility === 'hidden') return;
    if (!expand.classList.contains('open')) {
      toggleRoomExpand(parseInt(roomId), hdr, chevron, expand);
    }
  });
}

function collapseAllRooms() {
  document.querySelectorAll('.room-row').forEach(wrap => {
    const hdr = wrap.querySelector('.room-row-header');
    const chevron = hdr?.querySelector('.cat-chevron');
    const expand = wrap.querySelector('.room-expand');
    if (!expand || !hdr || !chevron) return;
    if (expand.classList.contains('open')) {
      expand.classList.remove('open');
      hdr.classList.remove('expanded');
      chevron.classList.remove('open');
      expand.querySelectorAll('.room-box-expand.open').forEach(e => e.classList.remove('open'));
    }
  });
}

// ── Find Item in rooms — live search with highlight ───────────────────────
let roomSearchTimer = null;
// Per-room box+item cache: roomId → [{box_number, label, items:[{name}]}]
const roomItemCache = {};

async function getRoomItems(roomId) {
  if (roomItemCache[roomId]) return roomItemCache[roomId];
  const boxes = await api(`/api/rooms/${roomId}/boxes`);
  // Fetch items for each box
  const result = [];
  await Promise.all(boxes.map(async b => {
    try {
      const box = await api(`/api/boxes/${b.id}`);
      result.push({
        box_id: b.id,
        box_number: b.box_number,
        label: b.label || '',
        items: (box.items || []).map(i => ({ id: i.item_id, name: i.name }))
      });
    } catch(e) { /* skip */ }
  }));
  roomItemCache[roomId] = result;
  return result;
}

function highlightMatch(text, query) {
  if (!query) return esc(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return esc(text);
  return esc(text.slice(0, idx))
    + `<mark style="background:var(--accent);color:#000;padding:0 1px;">${esc(text.slice(idx, idx + query.length))}</mark>`
    + esc(text.slice(idx + query.length));
}

async function filterRoomsByItem(query) {
  clearTimeout(roomSearchTimer);
  query = query.trim();

  if (!query) {
    // Restore: all rooms visible, clear all highlights, collapse rooms that were
    // only opened by search (we track them via data-search-opened)
    document.querySelectorAll('.room-row').forEach(w => {
      w.style.opacity = '';
      // Collapse rooms that were auto-opened by the search
      if (w.dataset.searchOpened) {
        delete w.dataset.searchOpened;
        const expand = w.querySelector('.room-expand');
        const hdr = w.querySelector('.room-row-header');
        const chevron = hdr?.querySelector('.cat-chevron');
        if (expand?.classList.contains('open')) {
          expand.classList.remove('open');
          hdr?.classList.remove('expanded');
          chevron?.classList.remove('open');
        }
      }
    });
    // Restore all box opacity and clear item highlights
    document.querySelectorAll('.room-box-wrap').forEach(bw => bw.style.opacity = '');
    clearItemHighlights();
    return;
  }

  roomSearchTimer = setTimeout(async () => {
    const lq = query.toLowerCase();
    const roomWraps = [...document.querySelectorAll('.room-row[data-room-id]')];

    // First pass: gather match data for all rooms without touching the DOM
    const roomResults = await Promise.all(roomWraps.map(async wrap => {
      const roomId = parseInt(wrap.dataset.roomId);
      let roomData;
      try { roomData = await getRoomItems(roomId); }
      catch(e) { return { wrap, roomId, matchingBoxIds: new Set(), roomData: [] }; }

      const matchingBoxIds = new Set();
      roomData.forEach(box => {
        if (box.items.some(item => item.name.toLowerCase().includes(lq))) {
          matchingBoxIds.add(box.box_id);
        }
      });
      return { wrap, roomId, matchingBoxIds, roomData };
    }));

    // If absolutely nothing matches, clear highlights but leave expand state untouched
    const anyMatch = roomResults.some(r => r.matchingBoxIds.size > 0);
    if (!anyMatch) {
      clearItemHighlights();
      document.querySelectorAll('.room-row').forEach(w => w.style.opacity = '');
      return;
    }

    // Second pass: apply DOM changes now that we know the full picture
    await Promise.all(roomResults.map(async ({ wrap, roomId, matchingBoxIds, roomData }) => {
      const hdr = wrap.querySelector('.room-row-header');
      const chevron = hdr?.querySelector('.cat-chevron');
      const expand = wrap.querySelector('.room-expand');
      if (!expand) return;

      if (!matchingBoxIds.size) {
        // No matches in this room — fade and collapse it
        wrap.style.opacity = '0.45';
        // Restore box opacity and clear highlights before collapsing the room
        expand.querySelectorAll('.room-box-wrap').forEach(bw => bw.style.opacity = '');
        expand.querySelectorAll('.room-box-expand.open').forEach(be => clearItemHighlights(be));
        if (expand.classList.contains('open')) {
          expand.classList.remove('open');
          hdr?.classList.remove('expanded');
          chevron?.classList.remove('open');
        }
        return;
      }

      // Has matches — full opacity
      wrap.style.opacity = '';

      // Auto-expand the room if not already open
      if (!expand.classList.contains('open')) {
        wrap.dataset.searchOpened = '1';
        await toggleRoomExpand(roomId, hdr, chevron, expand);
        await new Promise(r => setTimeout(r, 50));
      }

      // Per-box: expand matching, collapse non-matching (clearing highlights first)
      const boxWraps = [...expand.querySelectorAll('.room-box-wrap[data-box-id]')];
      await Promise.all(boxWraps.map(async boxWrap => {
        const bid = parseInt(boxWrap.dataset.boxId);
        const boxExpand = boxWrap.querySelector('.room-box-expand');
        const zoneChevron = boxWrap.querySelector('.room-box-expand-zone .cat-chevron');
        if (!boxExpand) return;

        if (!matchingBoxIds.has(bid)) {
          // Fade and collapse non-matching box
          boxWrap.style.opacity = '0.45';
          clearItemHighlights(boxExpand);
          if (boxExpand.classList.contains('open')) {
            boxExpand.classList.remove('open');
            if (zoneChevron) zoneChevron.classList.remove('open');
          }
          return;
        }
        // Matching box — full opacity
        boxWrap.style.opacity = '';

        // Expand this box to show items
        if (!boxExpand.classList.contains('open')) {
          const box = roomData.find(b => b.box_id === bid);
          if (box) await toggleRoomBoxExpand(bid, zoneChevron, boxExpand);
          await new Promise(r => setTimeout(r, 30));
        }

        applyItemHighlights(boxExpand, lq, query);
      }));
    }));
  }, 250);
}

function applyItemHighlights(container, lq, query) {
  // Walk all item name text nodes in room-box-item-row and apply/update highlights
  container.querySelectorAll('.room-box-item-row').forEach(row => {
    // Find the name span (second child, after qty)
    const spans = row.querySelectorAll('span');
    if (spans.length < 2) return;
    const nameSpan = spans[1]; // qty is first, name is second
    // Restore original text if we stored it
    const orig = nameSpan.dataset.origName || nameSpan.textContent;
    nameSpan.dataset.origName = orig;
    if (orig.toLowerCase().includes(lq)) {
      nameSpan.innerHTML = highlightMatch(orig, query);
    } else {
      nameSpan.innerHTML = esc(orig);
    }
  });
}

function clearItemHighlights(container) {
  // If no container given, clear everywhere; otherwise just within the container
  const root = container || document;
  root.querySelectorAll('.room-box-item-row span[data-orig-name]').forEach(span => {
    span.textContent = span.dataset.origName;
    delete span.dataset.origName;
  });
}

async function syncHAAreas() {
  const btn = document.getElementById('ha-sync-btn');
  if (btn) { btn.textContent = '⟳ Syncing…'; btn.disabled = true; }
  try {
    const result = await api('/api/rooms/sync-ha', { method: 'POST' });
    toast(`Synced ${result.synced} HA area${result.synced !== 1 ? 's' : ''}`);
    await loadRooms();
  } catch(e) {
    toast(`Sync failed: ${e.message}`, true);
  } finally {
    if (btn) { btn.textContent = '⟳ Sync HA'; btn.disabled = false; }
  }
}

function openRoomModal(id = null) {
  editingRoom = id;
  document.getElementById('modal-room-title').textContent = id ? 'Edit Room' : 'Add Room';
  const r = id ? rooms.find(x => x.id === id) : null;
  document.getElementById('room-name').value = r ? r.name : '';
  openModal('modal-room');
}

async function saveRoom() {
  const name = document.getElementById('room-name').value.trim();
  if (!name) { toast('Room name required', true); return; }
  try {
    if (editingRoom)
      await api(`/api/rooms/${editingRoom}`, { method:'PUT', body:JSON.stringify({name}) });
    else
      await api('/api/rooms', { method:'POST', body:JSON.stringify({name}) });
    closeModal('modal-room');
    await loadRooms();
    toast(editingRoom ? 'Room updated' : 'Room added');
  } catch(e) { toast(e.message, true); }
}

async function deleteRoom(id) {
  if (!confirm('Delete room? Boxes will become unassigned.')) return;
  try {
    await api(`/api/rooms/${id}`, { method:'DELETE' });
    await loadRooms();
    toast('Room deleted');
  } catch(e) { toast(e.message, true); }
}
