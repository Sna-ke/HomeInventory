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

  // First tip + context-specific infographic
  const tips = ctx.tips?.packing || [];
  if (tips.length) {
    const tip = document.createElement('div');
    tip.className = 'wiz-tip';
    tip.innerHTML = `<span class="wiz-tip-icon">💡</span><span>${esc(tips[0])}</span>`;
    body.appendChild(tip);
  }
  // Storage locker: show Tetris infographic upfront
  if (ctxKey === 'storage') {
    const infoEl = document.createElement('div');
    infoEl.className = 'wiz-info-section';
    infoEl.innerHTML = `
      <div class="wiz-section-hdr" style="margin-bottom:4px;">How to pack a storage locker</div>
      ${makeStorageTetrisSVG()}`;
    body.appendChild(infoEl);
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

// ═══════════════════════════════════════════════════════════════════════════════
// ── MOVING DAY PHASE ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function startMovingDay() {
  // Transition session to moving_day phase
  _wizardSession = await api('/api/wizard/session', {
    method: 'PUT',
    body: JSON.stringify({
      phase: 'moving_day',
      state: { ..._wizardSession.state, movingDayChecklist: {} },
    }),
  });
  const el = document.getElementById('wizard-content');
  renderMovingDay(el);
}

async function renderMovingDay(el) {
  if (!el) return;
  el.innerHTML = '<div class="wiz-loading">Loading manifest…</div>';

  const [manifest, session] = await Promise.all([
    api('/api/wizard/manifest'),
    api('/api/wizard/session'),
  ]);
  _wizardSession = session;

  const checklist = session?.state?.movingDayChecklist || {};
  const ctx = _wizardData?.contexts?.[session?.context];
  const dayChecks = ctx?.moving_day_checklist || [];

  el.innerHTML = '';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'wiz-header';
  hdr.innerHTML = `
    <div class="wiz-header-title">🚛 Moving Day</div>
    <div class="wiz-phase-pills">
      <span class="wiz-phase-pill done" onclick="resumePacking()">Packing</span>
      <span class="wiz-phase-pill active">Moving Day</span>
      <span class="wiz-phase-pill" onclick="startSettling()">Settling In</span>
    </div>`;
  el.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'wiz-body';

  // ── Truck loading infographic ──────────────────────────────────────────────
  const infoSection = document.createElement('div');
  infoSection.className = 'wiz-info-section';
  infoSection.innerHTML = `
    <div class="wiz-section-hdr">How to load the truck</div>
    ${makeTruckDiagramSVG()}
    <div class="wiz-info-tips">
      <div class="wiz-info-tip">🧱 Back wall: heaviest items first (appliances, furniture, boxes of books)</div>
      <div class="wiz-info-tip">📦 Middle: medium-weight boxes, stacked uniformly</div>
      <div class="wiz-info-tip">🛋️ Mattresses and boards: upright against the side walls</div>
      <div class="wiz-info-tip">🌸 Last in: fragile boxes, floor lamps, items for first room</div>
      <div class="wiz-info-tip">🚗 Valuables, documents, medications: travel in your car</div>
    </div>`;
  body.appendChild(infoSection);

  // ── Pre-move checklist ─────────────────────────────────────────────────────
  if (dayChecks.length) {
    const checkSection = document.createElement('div');
    checkSection.className = 'wiz-checklist-section';
    const checkHdr = document.createElement('div');
    checkHdr.className = 'wiz-section-hdr';
    checkHdr.textContent = 'Before you drive away';
    checkSection.appendChild(checkHdr);

    dayChecks.forEach(item => {
      const done = checklist[item.id];
      const row = document.createElement('div');
      row.className = 'wiz-check-row' + (done ? ' done' : '');
      row.innerHTML = `
        <button class="wiz-check-btn ${done ? 'checked' : ''}"
          onclick="toggleDayCheck('${item.id}', this.closest('.wiz-check-row'))">
          ${done ? '✓' : ''}
        </button>
        <span class="wiz-check-label">${esc(item.label)}</span>`;
      checkSection.appendChild(row);
    });
    body.appendChild(checkSection);
  }

  // ── Box manifest by room ───────────────────────────────────────────────────
  const manifestSection = document.createElement('div');
  const manifestHdr = document.createElement('div');
  manifestHdr.className = 'wiz-section-hdr';

  // Stats
  const allBoxes = manifest.flatMap(r => r.boxes);
  const loaded   = allBoxes.filter(b => b.move_status === 'loaded').length;
  const total    = allBoxes.length;
  manifestHdr.innerHTML = `Box Manifest <span class="wiz-manifest-count">${loaded}/${total} loaded</span>`;
  manifestSection.appendChild(manifestHdr);

  // Overall progress bar
  const pct = total > 0 ? Math.round(loaded / total * 100) : 0;
  const progEl = document.createElement('div');
  progEl.className = 'wiz-progress-bar';
  progEl.style.marginBottom = '12px';
  progEl.innerHTML = `
    <div class="wiz-progress-track" style="flex:1;">
      <div class="wiz-progress-fill" style="width:${pct}%"></div>
    </div>
    <div class="wiz-progress-label">${pct}% loaded</div>`;
  manifestSection.appendChild(progEl);

  manifest.forEach(room => {
    const roomEl = document.createElement('div');
    roomEl.className = 'wiz-manifest-room';

    const roomHdr = document.createElement('div');
    roomHdr.className = 'wiz-manifest-room-hdr';
    const roomLoaded = room.boxes.filter(b => b.move_status === 'loaded').length;
    roomHdr.innerHTML = `
      <span class="wiz-manifest-room-name">${esc(room.room_name)}</span>
      <span class="wiz-manifest-room-count">${roomLoaded}/${room.boxes.length}</span>
      <button class="wiz-manifest-room-all"
        onclick="setRoomStatus('${room.room_id}', ${JSON.stringify(room.boxes.map(b=>b.id))}, event)">
        All loaded
      </button>`;
    roomEl.appendChild(roomHdr);

    room.boxes.forEach(box => {
      const boxRow = document.createElement('div');
      boxRow.className = 'wiz-manifest-box';
      boxRow.dataset.boxId = box.id;
      boxRow.dataset.status = box.move_status;

      const statusIcon = { packing: '⬜', loaded: '✅', delivered: '📦', unpacked: '✓' };
      const nextStatus = box.move_status === 'packing'   ? 'loaded'
                       : box.move_status === 'loaded'    ? 'delivered'
                       : box.move_status === 'delivered' ? 'unpacked'
                       : 'packing';

      boxRow.innerHTML = `
        <button class="wiz-status-btn status-${box.move_status}"
          onclick="cycleBoxStatus(${box.id}, '${nextStatus}', this.closest('.wiz-manifest-box'))">
          ${statusIcon[box.move_status] || '⬜'}
        </button>
        <div class="wiz-manifest-box-info">
          <div class="wiz-manifest-box-num">BOX ${box.box_number}</div>
          <div class="wiz-manifest-box-label">${esc(box.label || 'Unlabelled')}</div>
        </div>
        <div class="wiz-manifest-box-count">${box.item_count} items</div>`;
      roomEl.appendChild(boxRow);
    });

    manifestSection.appendChild(roomEl);
  });

  body.appendChild(manifestSection);

  // Next phase button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'wiz-done-btn';
  nextBtn.textContent = 'We have arrived → Settling In';
  nextBtn.addEventListener('click', startSettling);
  body.appendChild(nextBtn);

  el.appendChild(body);
}

function makeTruckDiagramSVG() {
  return `<svg viewBox="0 0 320 120" xmlns="http://www.w3.org/2000/svg"
    style="width:100%;max-width:400px;display:block;margin:8px auto;">
    <!-- Truck outline -->
    <rect x="10" y="20" width="240" height="85" rx="4"
      fill="var(--surface2)" stroke="var(--border)" stroke-width="2"/>
    <!-- Cab -->
    <rect x="250" y="45" width="55" height="60" rx="4"
      fill="var(--surface2)" stroke="var(--border)" stroke-width="2"/>
    <rect x="258" y="52" width="30" height="20" rx="2"
      fill="var(--accent)" opacity="0.3"/>
    <!-- Wheels -->
    <circle cx="50"  cy="108" r="10" fill="var(--border)"/>
    <circle cx="200" cy="108" r="10" fill="var(--border)"/>
    <circle cx="270" cy="108" r="10" fill="var(--border)"/>

    <!-- Zone: Heavy (back) -->
    <rect x="15" y="25" width="70" height="75" rx="2"
      fill="var(--accent)" opacity="0.18"/>
    <text x="50" y="52" text-anchor="middle"
      font-family="sans-serif" font-size="9" fill="var(--accent)" font-weight="700">HEAVY</text>
    <text x="50" y="65" text-anchor="middle"
      font-family="sans-serif" font-size="8" fill="var(--muted)">first in</text>
    <text x="50" y="76" text-anchor="middle" font-size="16">🧱</text>

    <!-- Zone: Medium -->
    <rect x="88" y="25" width="75" height="75" rx="2"
      fill="var(--surface)" opacity="0.6" stroke="var(--border)" stroke-width="1"/>
    <text x="126" y="52" text-anchor="middle"
      font-family="sans-serif" font-size="9" fill="var(--text)" font-weight="700">MEDIUM</text>
    <text x="126" y="76" text-anchor="middle" font-size="16">📦</text>

    <!-- Zone: Light/Fragile (front) -->
    <rect x="166" y="25" width="78" height="75" rx="2"
      fill="var(--surface2)" opacity="0.8" stroke="var(--border)" stroke-width="1"/>
    <text x="205" y="49" text-anchor="middle"
      font-family="sans-serif" font-size="9" fill="var(--text)" font-weight="700">FRAGILE</text>
    <text x="205" y="60" text-anchor="middle"
      font-family="sans-serif" font-size="8" fill="var(--muted)">last in</text>
    <text x="205" y="76" text-anchor="middle" font-size="16">🌸</text>

    <!-- Arrow showing load order -->
    <text x="155" y="115" text-anchor="middle"
      font-family="sans-serif" font-size="9" fill="var(--muted)">← load this end first</text>
  </svg>`;
}

function makeStorageTetrisSVG() {
  return `<svg viewBox="0 0 320 160" xmlns="http://www.w3.org/2000/svg"
    style="width:100%;max-width:420px;display:block;margin:8px auto;">

    <!-- Locker outline -->
    <rect x="10" y="10" width="300" height="140" rx="4"
      fill="var(--surface2)" stroke="var(--border)" stroke-width="2"/>
    <!-- Door opening indicator -->
    <text x="155" y="158" text-anchor="middle"
      font-family="sans-serif" font-size="9" fill="var(--muted)">↑ DOOR — access aisle here</text>

    <!-- Zone: Back (climate-sensitive / rarely needed) -->
    <rect x="15" y="15" width="80" height="130" rx="2"
      fill="var(--surface)" stroke="var(--border)" stroke-width="1"/>
    <text x="55" y="42" text-anchor="middle"
      font-family="sans-serif" font-size="8" fill="var(--muted)" font-weight="700">BACK</text>
    <text x="55" y="54" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">rarely needed</text>
    <text x="55" y="66" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">electronics</text>
    <text x="55" y="78" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">furniture</text>
    <text x="55" y="90" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">seasonal</text>
    <text x="55" y="108" text-anchor="middle" font-size="20">🏛️</text>

    <!-- Zone: Middle (medium access) -->
    <rect x="100" y="15" width="80" height="130" rx="2"
      fill="var(--surface)" stroke="var(--border)" stroke-width="1"/>
    <text x="140" y="42" text-anchor="middle"
      font-family="sans-serif" font-size="8" fill="var(--text)" font-weight="700">MIDDLE</text>
    <text x="140" y="54" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">occasional access</text>
    <text x="140" y="66" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">heavy boxes</text>
    <text x="140" y="78" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">floor level</text>
    <text x="140" y="108" text-anchor="middle" font-size="20">📦</text>

    <!-- Zone: Front (frequent access) -->
    <rect x="185" y="15" width="120" height="130" rx="2"
      fill="var(--accent)" opacity="0.12" stroke="var(--accent)" stroke-width="1"/>
    <text x="245" y="42" text-anchor="middle"
      font-family="sans-serif" font-size="8" fill="var(--accent)" font-weight="700">FRONT</text>
    <text x="245" y="54" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">need soonest</text>
    <text x="245" y="66" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">sports gear</font>
    <text x="245" y="78" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">tools</text>
    <text x="245" y="108" text-anchor="middle" font-size="20">🚪</text>

    <!-- Mattress standing upright indicator -->
    <rect x="18" y="20" width="12" height="120" rx="1"
      fill="var(--border)" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3,2"/>
    <text x="24" y="148" text-anchor="middle"
      font-family="sans-serif" font-size="7" fill="var(--muted)">🛏️</text>

    <!-- Aisle arrow -->
    <line x1="160" y1="30" x2="160" y2="140" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4,3"/>
    <text x="163" y="90" font-family="sans-serif" font-size="7" fill="var(--muted)">aisle</text>
  </svg>`;
}

async function cycleBoxStatus(boxId, newStatus, rowEl) {
  await api(`/api/boxes/${boxId}/status`, {
    method: 'POST', body: JSON.stringify({ status: newStatus }),
  });
  rowEl.dataset.status = newStatus;
  const statusIcon = { packing: '⬜', loaded: '✅', delivered: '📦', unpacked: '✓' };
  const nextMap    = { packing: 'loaded', loaded: 'delivered', delivered: 'unpacked', unpacked: 'packing' };
  const nextStatus = nextMap[newStatus];
  const btn = rowEl.querySelector('.wiz-status-btn');
  btn.className = `wiz-status-btn status-${newStatus}`;
  btn.textContent = statusIcon[newStatus];
  btn.onclick = () => cycleBoxStatus(boxId, nextStatus, rowEl);
  // Refresh count
  const el = document.getElementById('wizard-content');
  if (el) setTimeout(() => renderMovingDay(el), 300);
}

async function setRoomStatus(roomId, boxIds, e) {
  e.stopPropagation();
  await Promise.all(boxIds.map(id =>
    api(`/api/boxes/${id}/status`, { method:'POST', body: JSON.stringify({ status: 'loaded' }) })
  ));
  const el = document.getElementById('wizard-content');
  if (el) renderMovingDay(el);
}

async function toggleDayCheck(itemId, rowEl) {
  const state = _wizardSession?.state || {};
  const checklist = { ...(state.movingDayChecklist || {}) };
  checklist[itemId] = !checklist[itemId];
  _wizardSession = await api('/api/wizard/session', {
    method: 'PUT',
    body: JSON.stringify({ state: { ...state, movingDayChecklist: checklist } }),
  });
  rowEl.classList.toggle('done', !!checklist[itemId]);
  const btn = rowEl.querySelector('.wiz-check-btn');
  btn.classList.toggle('checked', !!checklist[itemId]);
  btn.textContent = checklist[itemId] ? '✓' : '';
}

function resumePacking() {
  showPanel('wizard');
  const el = document.getElementById('wizard-content');
  if (_wizardSession?.state) renderRoomBoxPicker(el, _wizardSession.state);
  else renderWizardContext(el, _wizardSession?.context || 'move');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── SETTLING IN PHASE ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function startSettling() {
  _wizardSession = await api('/api/wizard/session', {
    method: 'PUT',
    body: JSON.stringify({
      phase: 'settling',
      state: { ..._wizardSession.state, settlingChecklist: {} },
    }),
  });
  const el = document.getElementById('wizard-content');
  renderSettling(el);
}

async function renderSettling(el) {
  if (!el) return;
  el.innerHTML = '<div class="wiz-loading">Loading…</div>';

  const [manifest, session] = await Promise.all([
    api('/api/wizard/manifest'),
    api('/api/wizard/session'),
  ]);
  _wizardSession = session;

  const ctx = _wizardData?.contexts?.[session?.context];
  const settlingChecks = ctx?.settling_checklist || [];
  const checklist = session?.state?.settlingChecklist || {};

  el.innerHTML = '';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'wiz-header';
  hdr.innerHTML = `
    <div class="wiz-header-title">🏠 Settling In</div>
    <div class="wiz-phase-pills">
      <span class="wiz-phase-pill done" onclick="resumePacking()">Packing</span>
      <span class="wiz-phase-pill done" onclick="goToMovingDay()">Moving Day</span>
      <span class="wiz-phase-pill active">Settling In</span>
    </div>`;
  el.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'wiz-body';

  // ── Settling tip ───────────────────────────────────────────────────────────
  const tips = ctx?.tips?.settling || [];
  if (tips[0]) {
    const tip = document.createElement('div');
    tip.className = 'wiz-tip';
    tip.innerHTML = `<span class="wiz-tip-icon">💡</span><span>${esc(tips[0])}</span>`;
    body.appendChild(tip);
  }

  // ── Settling checklist ─────────────────────────────────────────────────────
  if (settlingChecks.length) {
    const checkSection = document.createElement('div');
    const doneCount = Object.values(checklist).filter(Boolean).length;
    const checkHdr = document.createElement('div');
    checkHdr.className = 'wiz-section-hdr';
    checkHdr.innerHTML = `First priorities <span class="wiz-manifest-count">${doneCount}/${settlingChecks.length}</span>`;
    checkSection.appendChild(checkHdr);

    settlingChecks.forEach(item => {
      const done = checklist[item.id];
      const row  = document.createElement('div');
      row.className = 'wiz-check-row' + (done ? ' done' : '');
      row.innerHTML = `
        <button class="wiz-check-btn ${done ? 'checked' : ''}"
          onclick="toggleSettlingCheck('${item.id}', this.closest('.wiz-check-row'))">
          ${done ? '✓' : ''}
        </button>
        <span class="wiz-check-label">${esc(item.label)}</span>`;
      checkSection.appendChild(row);
    });
    body.appendChild(checkSection);
  }

  // ── Unpack tracker ─────────────────────────────────────────────────────────
  const unpackSection = document.createElement('div');
  const allBoxes  = manifest.flatMap(r => r.boxes);
  const unpacked  = allBoxes.filter(b => b.move_status === 'unpacked').length;
  const total     = allBoxes.length;
  const pct       = total > 0 ? Math.round(unpacked / total * 100) : 0;

  const unpackHdr = document.createElement('div');
  unpackHdr.className = 'wiz-section-hdr';
  unpackHdr.innerHTML = `Unpack Tracker <span class="wiz-manifest-count">${unpacked}/${total} done</span>`;
  unpackSection.appendChild(unpackHdr);

  const progEl = document.createElement('div');
  progEl.className = 'wiz-progress-bar';
  progEl.style.marginBottom = '12px';
  progEl.innerHTML = `
    <div class="wiz-progress-track" style="flex:1;">
      <div class="wiz-progress-fill" style="width:${pct}%"></div>
    </div>
    <div class="wiz-progress-label">${pct}% unpacked</div>`;
  unpackSection.appendChild(progEl);

  // Tip cycle
  if (tips.length > 1) {
    const tipIdx = Math.min(Math.floor(unpacked / Math.max(total/tips.length, 1)), tips.length - 1);
    const tip2 = document.createElement('div');
    tip2.className = 'wiz-tip';
    tip2.innerHTML = `<span class="wiz-tip-icon">💡</span><span>${esc(tips[tipIdx])}</span>`;
    unpackSection.appendChild(tip2);
  }

  manifest.forEach(room => {
    const roomEl = document.createElement('div');
    roomEl.className = 'wiz-manifest-room';

    const roomUnpacked = room.boxes.filter(b => b.move_status === 'unpacked').length;
    const roomHdr = document.createElement('div');
    roomHdr.className = 'wiz-manifest-room-hdr';
    roomHdr.innerHTML = `
      <span class="wiz-manifest-room-name">${esc(room.room_name)}</span>
      <span class="wiz-manifest-room-count">${roomUnpacked}/${room.boxes.length}</span>
      <button class="wiz-manifest-room-all"
        onclick="setAllUnpacked(${JSON.stringify(room.boxes.map(b=>b.id))}, event)">
        All done
      </button>`;
    roomEl.appendChild(roomHdr);

    room.boxes.forEach(box => {
      const done = box.move_status === 'unpacked';
      const boxRow = document.createElement('div');
      boxRow.className = 'wiz-manifest-box' + (done ? ' unpacked' : '');
      boxRow.dataset.boxId = box.id;
      boxRow.innerHTML = `
        <button class="wiz-check-btn ${done ? 'checked' : ''}"
          onclick="markBoxUnpacked(${box.id}, this.closest('.wiz-manifest-box'), ${done})">
          ${done ? '✓' : ''}
        </button>
        <div class="wiz-manifest-box-info">
          <div class="wiz-manifest-box-num">BOX ${box.box_number}</div>
          <div class="wiz-manifest-box-label">${esc(box.label || 'Unlabelled')}</div>
        </div>
        <div class="wiz-manifest-box-count">${box.item_count} items</div>
        <button class="wiz-manifest-view-btn"
          onclick="openBoxDetail(${box.id})">View</button>`;
      roomEl.appendChild(boxRow);
    });
    unpackSection.appendChild(roomEl);
  });

  body.appendChild(unpackSection);

  // All done!
  if (unpacked === total && total > 0) {
    const doneEl = document.createElement('div');
    doneEl.className = 'wiz-all-done';
    doneEl.innerHTML = `
      <div class="wiz-all-done-icon">🎉</div>
      <div class="wiz-all-done-title">You are home!</div>
      <div class="wiz-all-done-sub">All ${total} boxes unpacked. Welcome to your new place.</div>
      <button class="wiz-done-btn" onclick="finishWizard()" style="margin-top:16px;">
        Finish & go to dashboard
      </button>`;
    body.appendChild(doneEl);
  }

  el.appendChild(body);
}

async function toggleSettlingCheck(itemId, rowEl) {
  const state = _wizardSession?.state || {};
  const checklist = { ...(state.settlingChecklist || {}) };
  checklist[itemId] = !checklist[itemId];
  _wizardSession = await api('/api/wizard/session', {
    method: 'PUT',
    body: JSON.stringify({ state: { ...state, settlingChecklist: checklist } }),
  });
  rowEl.classList.toggle('done', !!checklist[itemId]);
  const btn = rowEl.querySelector('.wiz-check-btn');
  btn.classList.toggle('checked', !!checklist[itemId]);
  btn.textContent = checklist[itemId] ? '✓' : '';
}

async function markBoxUnpacked(boxId, rowEl, currentlyDone) {
  const newStatus = currentlyDone ? 'delivered' : 'unpacked';
  await api(`/api/boxes/${boxId}/status`, {
    method: 'POST', body: JSON.stringify({ status: newStatus }),
  });
  const el = document.getElementById('wizard-content');
  if (el) renderSettling(el);
}

async function setAllUnpacked(boxIds, e) {
  e.stopPropagation();
  await Promise.all(boxIds.map(id =>
    api(`/api/boxes/${id}/status`, { method:'POST', body: JSON.stringify({ status: 'unpacked' }) })
  ));
  const el = document.getElementById('wizard-content');
  if (el) renderSettling(el);
}

async function goToMovingDay() {
  _wizardSession = await api('/api/wizard/session', {
    method: 'PUT', body: JSON.stringify({ phase: 'moving_day' }),
  });
  const el = document.getElementById('wizard-content');
  renderMovingDay(el);
}

async function finishWizard() {
  await api('/api/wizard/session', { method: 'DELETE' });
  localStorage.removeItem('packingContext');
  _wizardSession = null;
  showPanel('dashboard');
  loadDashboard();
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Phase navigation from dashboard / anywhere ────────────────────────────────

function openWizardPhase(phase) {
  showPanel('wizard');
  const el = document.getElementById('wizard-content');
  if (!el) return;
  if (phase === 'moving_day') renderMovingDay(el);
  else if (phase === 'settling') renderSettling(el);
  else loadWizard();
}
