// ── Item Metadata & Credit Cards ──────────────────────────────────────────
// Shared state
let creditCards = [];

async function loadCreditCards() {
  try {
    creditCards = await api('/api/credit-cards');
  } catch(e) {
    creditCards = [];
  }
}

// ── Metadata modal ─────────────────────────────────────────────────────────
let metadataItemId = null;

async function openMetadataModal(itemId, itemName) {
  metadataItemId = itemId;
  document.getElementById('metadata-item-name').textContent = itemName;

  // Ensure cards are loaded
  if (!creditCards.length) await loadCreditCards();
  populateCardSelect('metadata-card-select', null);

  // Clear fields
  clearMetadataForm();

  // Load existing metadata
  try {
    const meta = await api(`/api/items/${itemId}/metadata`);
    if (meta) fillMetadataForm(meta);
  } catch(e) { /* no metadata yet */ }

  openModal('modal-metadata');
}

function clearMetadataForm() {
  ['metadata-serial', 'metadata-model', 'metadata-purchase-date',
   'metadata-price', 'metadata-store', 'metadata-warranty-expiry',
   'metadata-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('metadata-card-select').value = '';
  updateEffectiveWarranty();
}

function fillMetadataForm(meta) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== null && val !== undefined) el.value = val;
  };
  set('metadata-serial',          meta.serial_number || '');
  set('metadata-model',           meta.model_number || '');
  set('metadata-purchase-date',   meta.purchase_date || '');
  set('metadata-price',           meta.purchase_price !== null ? meta.purchase_price : '');
  set('metadata-store',           meta.purchase_store || '');
  set('metadata-warranty-expiry', meta.warranty_expiry || '');
  set('metadata-card-select',     meta.credit_card_id || '');
  set('metadata-notes',           meta.notes || '');
  updateEffectiveWarranty();
}

function populateCardSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const prev = selectedId !== null ? selectedId : sel.value;
  sel.innerHTML = '<option value="">— No card used —</option>';
  creditCards.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${esc(c.name)} (+${c.warranty_months} mo)`;
    if (String(c.id) === String(prev)) opt.selected = true;
    sel.appendChild(opt);
  });
}

function updateEffectiveWarranty() {
  const baseEl = document.getElementById('metadata-warranty-expiry');
  const cardEl = document.getElementById('metadata-card-select');
  const effEl  = document.getElementById('metadata-effective-warranty');
  if (!effEl) return;

  const base = baseEl?.value;
  const cardId = cardEl?.value;
  if (!base) { effEl.textContent = ''; return; }

  const card = creditCards.find(c => String(c.id) === String(cardId));
  if (!card) { effEl.textContent = `Effective: ${base}`; return; }

  // Calculate extended date
  const d = new Date(base + 'T00:00:00');
  d.setMonth(d.getMonth() + card.warranty_months);
  const extended = d.toISOString().slice(0, 10);
  effEl.textContent = `Effective with ${card.name}: ${extended} (+${card.warranty_months} mo)`;
}

async function saveMetadata() {
  if (!metadataItemId) return;
  const get = id => document.getElementById(id)?.value?.trim() || null;

  const payload = {
    serial_number:    get('metadata-serial'),
    model_number:     get('metadata-model'),
    purchase_date:    get('metadata-purchase-date') || null,
    purchase_price:   get('metadata-price') ? parseFloat(get('metadata-price')) : null,
    purchase_store:   get('metadata-store'),
    warranty_expiry:  get('metadata-warranty-expiry') || null,
    credit_card_id:   get('metadata-card-select') ? parseInt(get('metadata-card-select')) : null,
    notes:            get('metadata-notes'),
  };

  try {
    await api(`/api/items/${metadataItemId}/metadata`, {
      method: 'PUT', body: JSON.stringify(payload)
    });
    closeModal('modal-metadata');
    toast('Metadata saved');
  } catch(e) {
    toast(`Save failed: ${e.message}`, true);
  }
}

// ── Credit card management (in Settings) ──────────────────────────────────
let editingCardId = null;

async function loadCreditCardsSettings() {
  await loadCreditCards();
  renderCreditCardsSettings();
}

function renderCreditCardsSettings() {
  const list = document.getElementById('cc-list');
  if (!list) return;
  list.innerHTML = '';
  if (!creditCards.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;">No cards added yet.</div>';
    return;
  }
  creditCards.forEach(c => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;' +
      'border-bottom:1px solid var(--border);font-size:14px;';
    row.innerHTML = `
      <div style="flex:1;">
        <strong>${esc(c.name)}</strong>
        <span style="color:var(--muted);font-family:var(--mono);font-size:12px;margin-left:8px;">
          +${c.warranty_months} mo extended warranty
        </span>
        ${c.notes ? `<div style="color:var(--muted);font-size:12px;">${esc(c.notes)}</div>` : ''}
      </div>
      <button class="btn btn-secondary btn-sm" onclick="editCreditCard(${c.id})">Edit</button>
      <button class="btn btn-secondary btn-sm" onclick="deleteCreditCard(${c.id})"
        style="color:#c33;">Delete</button>
    `;
    list.appendChild(row);
  });
}

function openCreditCardModal(id = null) {
  editingCardId = id;
  const card = id ? creditCards.find(c => c.id === id) : null;
  document.getElementById('cc-modal-title').textContent = id ? 'Edit Card' : 'Add Card';
  document.getElementById('cc-name').value = card?.name || '';
  document.getElementById('cc-months').value = card?.warranty_months ?? 12;
  document.getElementById('cc-notes').value = card?.notes || '';
  openModal('modal-credit-card');
}

function editCreditCard(id) { openCreditCardModal(id); }

async function saveCreditCard() {
  const name   = document.getElementById('cc-name').value.trim();
  const months = parseInt(document.getElementById('cc-months').value) || 12;
  const notes  = document.getElementById('cc-notes').value.trim() || null;
  if (!name) { toast('Card name required', true); return; }

  try {
    if (editingCardId) {
      await api(`/api/credit-cards/${editingCardId}`, {
        method: 'PUT', body: JSON.stringify({ name, warranty_months: months, notes })
      });
    } else {
      await api('/api/credit-cards', {
        method: 'POST', body: JSON.stringify({ name, warranty_months: months, notes })
      });
    }
    closeModal('modal-credit-card');
    toast(editingCardId ? 'Card updated' : 'Card added');
    await loadCreditCardsSettings();
  } catch(e) {
    toast(`Failed: ${e.message}`, true);
  }
}

async function deleteCreditCard(id) {
  const card = creditCards.find(c => c.id === id);
  if (!confirm(`Delete "${card?.name}"? Items purchased on this card will lose the warranty link.`)) return;
  try {
    await api(`/api/credit-cards/${id}`, { method: 'DELETE' });
    toast('Card deleted');
    await loadCreditCardsSettings();
  } catch(e) {
    toast(`Failed: ${e.message}`, true);
  }
}

// ── Metadata badge helper — shown on item rows in box detail ───────────────
function metadataBadge(meta) {
  if (!meta) return '';
  const parts = [];
  if (meta.serial_number) parts.push(`S/N: ${esc(meta.serial_number)}`);
  if (meta.effective_warranty_expiry) {
    const d = new Date(meta.effective_warranty_expiry + 'T00:00:00');
    const now = new Date();
    const daysLeft = Math.ceil((d - now) / 86400000);
    const color = daysLeft < 0 ? '#c33' : daysLeft < 90 ? '#f90' : 'var(--accent)';
    parts.push(`<span style="color:${color};">Warranty: ${meta.effective_warranty_expiry}${daysLeft < 0 ? ' (expired)' : ''}</span>`);
  }
  return parts.length ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${parts.join(' · ')}</div>` : '';
}
