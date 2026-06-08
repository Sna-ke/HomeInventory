// ── BoxTrack Guided Wizard ────────────────────────────────────────────────────
// Guided packing assistant. State persisted to DB via /api/wizard/session.
// wizard_data.json drives all suggestions.

let _wizardData   = null;   // loaded once from /api/wizard/data
let _wizardSession = null;  // current session object from DB
let _chipCounts   = {};     // { itemName: qty } for current box

// ── Entry point ───────────────────────────────────────────────────────────────

async function loadWizard() {
  const el = document.getElementById('wizard-content');
  if (!el) return;
  el.innerHTML = '<div class="wiz-loading">Loading…</div>';

  try {
    // Load wizard data and active session in parallel
    [_wizardData, _wizardSession] = await Promise.all([
      _wizardData ? Promise.resolve(_wizardData) : api('/api/wizard/data'),
      api('/api/wizard/session'),
    ]);

    // Resume or start
    if (_wizardSession) {
      renderWizardFromSession(el);
    } else {
      const ctx = localStorage.getItem('packingContext') || 'move';
      renderWizardContext(el, ctx);
    }
  } catch(e) {
    el.innerHTML = `<div class="wiz-error">Could not load wizard: ${esc(e.message)}</div>`;
  }
}

// ── Context intro screen ───────────────────────────────────────────────────────

function renderWizardContext(el, ctxKey) {
  const ctx = _wizardData.contexts[ctxKey];
  if (!ctx) { el.innerHTML = '<div class="wiz-error">Unknown context</div>'; return; }

  el.innerHTML = '';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'wiz-header';
  hdr.innerHTML = `
    <button class="wiz-back-btn" onclick="showPanel('dashboard')">← Back</button>
    <div class="wiz-header-title">${ctx.icon} ${esc(ctx.label)}</div>`;
  el.appendChild(hdr);

  // Body
  const body = document.createElement('div');
  body.className = 'wiz-body';

  // First tip
  const tips = ctx.tips?.packing || [];
  if (tips.length) {
    const tip = document.createElement('div');
    tip.className = 'wiz-tip';
    tip.innerHTML = `<span class="wiz-tip-icon">💡</span><span>${esc(tips[0])}</span>`;
    body.appendChild(tip);
  }

  // Room question
  const q = document.createElement('div');
  q.className = 'wiz-question';
  q.textContent = ctxKey === 'move'    ? 'Which room are we starting with?' :
                  ctxKey === 'storage' ? 'What type of items are you storing?' :
                  ctxKey === 'organize'? 'Which area are you organising?' :
                                        'Where are you starting?';
  body.appendChild(q);

  // Room chips
  const rooms = (ctx.rooms || []).sort((a, b) => (a.order || 99) - (b.order || 99));
  const grid = document.createElement('div');
  grid.className = 'wiz-room-grid';

  rooms.forEach(room => {
    const btn = document.createElement('button');
    btn.className = 'wiz-room-btn';
    btn.innerHTML = `<span class="wiz-room-icon">${room.icon}</span><span class="wiz-room-label">${esc(room.label)}</span>`;
    btn.addEventListener('click', () => startSession(ctxKey, room.id, el));
    grid.appendChild(btn);
  });

  // Custom room
  const customBtn = document.createElement('button');
  customBtn.className = 'wiz-room-btn wiz-room-custom';
  customBtn.innerHTML = `<span class="wiz-room-icon">✏️</span><span class="wiz-room-label">Other</span>`;
  customBtn.addEventListener('click', () => promptCustomRoom(ctxKey, el));
  grid.appendChild(customBtn);

  body.appendChild(grid);

  // Skip to normal mode
  const skip = document.createElement('div');
  skip.className = 'wiz-skip';
  skip.innerHTML = `<a href="#" onclick="showPanel('boxes');return false;">Skip wizard → go to Boxes</a>`;
  body.appendChild(skip);

  el.appendChild(body);
}

function promptCustomRoom(ctxKey, el) {
  const name = prompt('Room name:');
  if (!name || !name.trim()) return;
  startSession(ctxKey, 'custom_' + Date.now(), el, name.trim());
}

// ── Session start / resume ─────────────────────────────────────────────────────

async function startSession(ctxKey, roomId, el, customRoomLabel) {
  const ctx   = _wizardData.contexts[ctxKey];
  const room  = ctx.rooms.find(r => r.id === roomId);
  const state = {
    context:          ctxKey,
    roomId:           roomId,
    roomLabel:        customRoomLabel || room?.label || roomId,
    roomIcon:         room?.icon || '📦',
    completedRooms:   [],
    completedBoxes:   [],
    currentBoxId:     null,
    currentBoxTypeId: null,
  };

  _chipCounts = {};
  _wizardSession = await api('/api/wizard/session', {
    method: 'POST',
    body: JSON.stringify({ context: ctxKey, phase: 'packing', state }),
  });

  renderRoomBoxPicker(el, state);
}

function renderWizardFromSession(el) {
  const s = _wizardSession.state;
  if (!s) { renderWizardContext(el, _wizardSession.context); return; }

  // If we're mid-box, go to chip screen
  if (s.currentBoxId && s.currentBoxTypeId) {
    renderChipScreen(el, s);
  } else {
    renderRoomBoxPicker(el, s);
  }
}

// ── Box type picker ────────────────────────────────────────────────────────────

function renderRoomBoxPicker(el, state) {
  const ctx    = _wizardData.contexts[state.context];
  const room   = ctx?.rooms?.find(r => r.id === state.roomId);
  const boxes  = room?.boxes || [];

  el.innerHTML = '';

  // Progress bar
  el.appendChild(makeProgressBar(state, ctx));

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'wiz-header';
  hdr.innerHTML = `
    <button class="wiz-back-btn" onclick="wizGoBack()">← Rooms</button>
    <div class="wiz-header-title">${state.roomIcon} ${esc(state.roomLabel)}</div>`;
  el.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'wiz-body';

  // Room tip
  const tips = ctx?.tips?.packing || [];
  if (tips.length > 1) {
    const tipIdx = state.completedBoxes.length % (tips.length - 1) + 1;
    const tip = document.createElement('div');
    tip.className = 'wiz-tip';
    tip.innerHTML = `<span class="wiz-tip-icon">💡</span><span>${esc(tips[tipIdx])}</span>`;
    body.appendChild(tip);
  }

  // Completed boxes in this room
  const doneHere = state.completedBoxes.filter(b => b.roomId === state.roomId);
  if (doneHere.length) {
    const doneEl = document.createElement('div');
    doneEl.className = 'wiz-done-list';
    doneEl.innerHTML = doneHere.map(b =>
      `<div class="wiz-done-item">✓ ${esc(b.label)} <span class="wiz-done-count">${b.itemCount} item${b.itemCount!==1?'s':''}</span></div>`
    ).join('');
    body.appendChild(doneEl);
  }

  // Question
  const q = document.createElement('div');
  q.className = 'wiz-question';
  q.textContent = doneHere.length ? 'Start another box, or move to a new room?' : 'Start a box for…';
  body.appendChild(q);

  // Box type chips
  const grid = document.createElement('div');
  grid.className = 'wiz-box-grid';

  boxes.forEach(boxType => {
    const done = doneHere.some(b => b.boxTypeId === boxType.id);
    const btn = document.createElement('button');
    btn.className = 'wiz-box-btn' + (done ? ' done' : '');
    btn.innerHTML = `
      <span class="wiz-box-icon">${boxType.icon || '📦'}</span>
      <span class="wiz-box-label">${esc(boxType.label)}</span>
      ${done ? '<span class="wiz-box-done-badge">✓</span>' : ''}`;
    btn.addEventListener('click', () => startBox(boxType, state, el));
    grid.appendChild(btn);
  });

  // Custom box
  const customBtn = document.createElement('button');
  customBtn.className = 'wiz-box-btn wiz-box-custom';
  customBtn.innerHTML = `<span class="wiz-box-icon">✏️</span><span class="wiz-box-label">Build it myself</span>`;
  customBtn.addEventListener('click', () => buildCustomBox(state));
  grid.appendChild(customBtn);

  body.appendChild(grid);

  // New room button (if there are more rooms)
  const roomActions = document.createElement('div');
  roomActions.className = 'wiz-room-actions';
  roomActions.innerHTML = `
    <button class="wiz-action-btn secondary" onclick="wizGoBack()">← Different Room</button>
    <button class="wiz-action-btn secondary" onclick="showPanel('boxes')">View All Boxes</button>`;
  body.appendChild(roomActions);

  el.appendChild(body);
}

// ── Box creation + chip screen ─────────────────────────────────────────────────

async function startBox(boxType, state, el) {
  // Create the box in the DB
  const label = `${state.roomLabel} — ${boxType.label}`;

  // Find or create room
  let roomDbId = null;
  try {
    const rooms = await api('/api/rooms');
    const match = rooms.find(r => r.name.toLowerCase() === state.roomLabel.toLowerCase());
    if (match) {
      roomDbId = match.id;
    } else {
      const newRoom = await api('/api/rooms', { method:'POST', body: JSON.stringify({ name: state.roomLabel }) });
      roomDbId = newRoom.id;
    }
  } catch(e) { console.warn('Room find/create failed:', e); }

  const box = await api('/api/boxes', {
    method: 'POST',
    body: JSON.stringify({ label, description: boxType.label, room_id: roomDbId, box_type: 'inventory' }),
  });

  _chipCounts = {};

  // Update session state
  const newState = {
    ...state,
    currentBoxId:     box.id,
    currentBoxNum:    box.box_number,
    currentBoxLabel:  label,
    currentBoxTypeId: boxType.id,
  };
  _wizardSession = await api('/api/wizard/session', {
    method: 'PUT',
    body: JSON.stringify({ state: newState }),
  });

  renderChipScreen(el, newState, boxType);
}

async function buildCustomBox(state) {
  // Drop to normal box creation then packing mode
  await api('/api/wizard/session', { method: 'PUT', body: JSON.stringify({
    state: { ...state, currentBoxId: null, currentBoxTypeId: null }
  })});
  openPackingMode();
}

// ── Chip screen ────────────────────────────────────────────────────────────────

function renderChipScreen(el, state, boxTypeOverride) {
  const ctx     = _wizardData.contexts[state.context];
  const room    = ctx?.rooms?.find(r => r.id === state.roomId);
  const boxType = boxTypeOverride || room?.boxes?.find(b => b.id === state.currentBoxTypeId);

  el.innerHTML = '';
  el.appendChild(makeProgressBar(state, ctx));

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'wiz-header';
  hdr.innerHTML = `
    <button class="wiz-back-btn" onclick="abandonCurrentBox(state)">← Back</button>
    <div class="wiz-header-title">📦 BOX ${state.currentBoxNum}</div>`;
  el.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'wiz-body';

  // Box label
  const boxLbl = document.createElement('div');
  boxLbl.className = 'wiz-current-box-label';
  boxLbl.textContent = state.currentBoxLabel;
  body.appendChild(boxLbl);

  // Packing tip for this box type
  if (boxType?.tip) {
    const tip = document.createElement('div');
    tip.className = 'wiz-tip';
    tip.innerHTML = `<span class="wiz-tip-icon">💡</span><span>${esc(boxType.tip)}</span>`;
    body.appendChild(tip);
  }

  // Question
  const q = document.createElement('div');
  q.className = 'wiz-question';
  q.textContent = 'Tap everything going in this box:';
  body.appendChild(q);

  // Live item count
  const countBar = document.createElement('div');
  countBar.className = 'wiz-count-bar';
  countBar.id = 'wiz-count-bar';
  countBar.textContent = 'Nothing added yet';
  body.appendChild(countBar);

  // Chip grid
  const chipGrid = document.createElement('div');
  chipGrid.className = 'wiz-chip-grid';
  chipGrid.id = 'wiz-chip-grid';

  const items = boxType?.items || [];
  items.forEach(itemName => {
    chipGrid.appendChild(makeChip(itemName, state));
  });

  // "Add something else" chip
  const otherChip = document.createElement('button');
  otherChip.className = 'wiz-chip wiz-chip-other';
  otherChip.textContent = '+ Other';
  otherChip.addEventListener('click', () => openQuickAddItem_wizard(state));
  chipGrid.appendChild(otherChip);

  body.appendChild(chipGrid);

  // Done button
  const doneBtn = document.createElement('button');
  doneBtn.className = 'wiz-done-btn';
  doneBtn.id = 'wiz-done-btn';
  doneBtn.textContent = 'Done with this box →';
  doneBtn.addEventListener('click', () => finishBox(state, el));
  body.appendChild(doneBtn);

  // View box link
  const viewLink = document.createElement('div');
  viewLink.className = 'wiz-skip';
  viewLink.innerHTML = `<a href="#" onclick="openBoxDetail(${state.currentBoxId});return false;">View box detail →</a>`;
  body.appendChild(viewLink);

  el.appendChild(body);
  updateChipCountBar();
}

// ── Chip interaction ──────────────────────────────────────────────────────────

function makeChip(itemName, state) {
  const chip = document.createElement('button');
  chip.className = 'wiz-chip';
  chip.dataset.item = itemName;
  const qty = _chipCounts[itemName] || 0;
  chip.innerHTML = qty > 0
    ? `${esc(itemName)}<span class="wiz-chip-qty">${qty}</span>`
    : esc(itemName);
  if (qty > 0) chip.classList.add('active');
  chip.addEventListener('click',      () => tapChip(itemName, state, chip));
  chip.addEventListener('contextmenu', e => { e.preventDefault(); detailChip(itemName, state); });
  // Long press for mobile
  let pressTimer;
  chip.addEventListener('touchstart', () => { pressTimer = setTimeout(() => detailChip(itemName, state), 600); });
  chip.addEventListener('touchend',   () => clearTimeout(pressTimer));
  return chip;
}

async function tapChip(itemName, state, chipEl) {
  // Each tap increments qty by 1 and adds one item to the box
  const qty = (_chipCounts[itemName] || 0) + 1;
  _chipCounts[itemName] = qty;

  // Animate
  chipEl.classList.add('active', 'bump');
  setTimeout(() => chipEl.classList.remove('bump'), 200);
  chipEl.innerHTML = `${esc(itemName)}<span class="wiz-chip-qty">${qty}</span>`;

  // Find or create item, add to box
  try {
    let itemId;
    const existing = (allItems || []).find(i => i.name.toLowerCase() === itemName.toLowerCase());
    if (existing) {
      itemId = existing.id;
    } else {
      const newItem = await api('/api/items', { method:'POST', body: JSON.stringify({ name: itemName }) });
      itemId = newItem.id;
      if (allItems) allItems.push(newItem);
    }
    await api(`/api/boxes/${state.currentBoxId}/items`, {
      method: 'POST',
      body: JSON.stringify({ item_id: itemId, quantity: 1, notes: null }),
    });
    trackRecentItem(itemId);
    updateChipCountBar();
  } catch(e) {
    // Revert on error
    _chipCounts[itemName] = Math.max(0, qty - 1);
    chipEl.innerHTML = _chipCounts[itemName] > 0
      ? `${esc(itemName)}<span class="wiz-chip-qty">${_chipCounts[itemName]}</span>`
      : esc(itemName);
    if (_chipCounts[itemName] === 0) chipEl.classList.remove('active');
    toast('Error adding item: ' + e.message, true);
  }
}

function detailChip(itemName, state) {
  // Open a small dialog to add a note or mark unique
  const note = prompt(`Add a note for "${itemName}" (e.g. "Sarah's", "Summer", "Large"):`, '');
  if (note === null) return;
  addNamedChipItem(itemName, note.trim() || null, state);
}

async function addNamedChipItem(itemName, note, state) {
  try {
    let itemId;
    const existing = (allItems || []).find(i => i.name.toLowerCase() === itemName.toLowerCase());
    if (existing) {
      itemId = existing.id;
    } else {
      const newItem = await api('/api/items', { method:'POST', body: JSON.stringify({ name: itemName }) });
      itemId = newItem.id;
      if (allItems) allItems.push(newItem);
    }
    await api(`/api/boxes/${state.currentBoxId}/items`, {
      method: 'POST',
      body: JSON.stringify({ item_id: itemId, quantity: 1, notes: note }),
    });
    // Update chip UI
    _chipCounts[itemName] = (_chipCounts[itemName] || 0) + 1;
    const chip = document.querySelector(`.wiz-chip[data-item="${CSS.escape(itemName)}"]`);
    if (chip) {
      chip.classList.add('active');
      chip.innerHTML = `${esc(itemName)}<span class="wiz-chip-qty">${_chipCounts[itemName]}</span>`;
    }
    updateChipCountBar();
    toast(note ? `Added: ${itemName} (${note})` : `Added: ${itemName}`);
  } catch(e) {
    toast('Error: ' + e.message, true);
  }
}

function updateChipCountBar() {
  const bar = document.getElementById('wiz-count-bar');
  if (!bar) return;
  const total = Object.values(_chipCounts).reduce((s, n) => s + n, 0);
  const types = Object.keys(_chipCounts).filter(k => _chipCounts[k] > 0).length;
  bar.textContent = total === 0
    ? 'Nothing added yet — tap items below'
    : `${total} item${total!==1?'s':''} added (${types} type${types!==1?'s':''})`;
  bar.style.color = total > 0 ? 'var(--accent)' : 'var(--muted)';
}

function openQuickAddItem_wizard(state) {
  // Opens packing mode pre-set to the current box
  addToBoxId = state.currentBoxId;
  addToRoomId = null;
  const label = state.currentBoxLabel;
  setATBDest('box', state.currentBoxId, `BOX ${state.currentBoxNum} · ${label}`);
  document.getElementById('atb-dest-field').style.display = 'none';
  document.getElementById('atb-room-location-field').style.display = 'none';
  resetATBModal();
  document.getElementById('atb-dest-field').style.display = 'none';
  openModal('modal-atb');
  setTimeout(() => document.getElementById('atb-search').focus(), 80);
}

// ── Finish box ────────────────────────────────────────────────────────────────

async function finishBox(state, el) {
  const total = Object.values(_chipCounts).reduce((s, n) => s + n, 0);
  const newCompleted = [...(state.completedBoxes || []), {
    boxId:     state.currentBoxId,
    boxTypeId: state.currentBoxTypeId,
    label:     state.currentBoxLabel,
    roomId:    state.roomId,
    itemCount: total,
  }];

  const newState = {
    ...state,
    currentBoxId:     null,
    currentBoxTypeId: null,
    currentBoxNum:    null,
    currentBoxLabel:  null,
    completedBoxes:   newCompleted,
  };

  _chipCounts = {};
  _wizardSession = await api('/api/wizard/session', {
    method: 'PUT',
    body: JSON.stringify({ state: newState }),
  });

  renderRoomBoxPicker(el, newState);
}

async function abandonCurrentBox(state) {
  // Go back without marking box as complete
  const newState = { ...state, currentBoxId: null, currentBoxTypeId: null };
  _wizardSession = await api('/api/wizard/session', {
    method: 'PUT', body: JSON.stringify({ state: newState }),
  });
  const el = document.getElementById('wizard-content');
  renderRoomBoxPicker(el, newState);
}

// ── Room navigation ────────────────────────────────────────────────────────────

async function wizGoBack() {
  if (!_wizardSession?.state) { showPanel('dashboard'); return; }
  const state   = _wizardSession.state;
  const ctx     = _wizardData.contexts[state.context];
  const el      = document.getElementById('wizard-content');

  // Mark current room as complete and pick a new one
  const doneRooms = [...(state.completedRooms || [])];
  if (!doneRooms.includes(state.roomId)) doneRooms.push(state.roomId);

  const newState = { ...state, roomId: null, completedRooms: doneRooms,
    currentBoxId: null, currentBoxTypeId: null };
  _wizardSession = await api('/api/wizard/session', {
    method: 'PUT', body: JSON.stringify({ state: newState }),
  });
  renderWizardContext(el, state.context);
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function makeProgressBar(state, ctx) {
  const totalRooms = (ctx?.rooms || []).length;
  const doneRooms  = (state.completedRooms || []).length;
  const pct = totalRooms > 0 ? Math.round(doneRooms / totalRooms * 100) : 0;

  const bar = document.createElement('div');
  bar.className = 'wiz-progress-bar';
  bar.innerHTML = `
    <div class="wiz-progress-track">
      <div class="wiz-progress-fill" style="width:${pct}%"></div>
    </div>
    <div class="wiz-progress-label">${doneRooms} of ${totalRooms} rooms done</div>`;
  return bar;
}
