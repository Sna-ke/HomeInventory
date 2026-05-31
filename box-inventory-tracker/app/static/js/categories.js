// ── Category autocomplete ──────────────────────────────────────────────────
async function searchCategories(q, listId) {
  const list = document.getElementById(listId);
  if (!q.trim()) { list.classList.remove('open'); return; }
  const cats = await api(`/api/categories?q=${encodeURIComponent(q)}`);
  const matches = cats.filter(c => c.name.toLowerCase().includes(q.toLowerCase()));
  const exact = matches.some(c => c.name.toLowerCase() === q.toLowerCase());

  list.innerHTML = '';
  matches.forEach(c => {
    const div = document.createElement('div');
    div.className = 'ac-item';
    div.dataset.catName = c.name;
    div.dataset.listId = listId;
    div.textContent = c.name;
    list.appendChild(div);
  });
  if (!exact && q.trim()) {
    const div = document.createElement('div');
    div.className = 'ac-item ac-create';
    div.dataset.catName = q;
    div.dataset.listId = listId;
    div.textContent = `+ Create "${q}"`;
    list.appendChild(div);
  }
  if (!list.children.length) { list.classList.remove('open'); return; }

  // Position using fixed coords so it escapes modal overflow clipping
  positionDropdownFixed(list);
  list.classList.add('open');
}

function positionDropdownFixed(list) {
  // Find the input that triggered this list (previousElementSibling of the list)
  const input = list.previousElementSibling;
  if (!input) return;
  const rect = input.getBoundingClientRect();
  list.classList.add('fixed-position');
  list.style.top  = (rect.bottom + 2) + 'px';
  list.style.left = rect.left + 'px';
  list.style.width = rect.width + 'px';
}

// Delegated listener for all category suggestion lists
document.addEventListener('mousedown', e => {
  if (e.target.closest('.ac-list') && e.target.closest('.ac-item[data-cat-name]')) {
    e.preventDefault();
  }
});
document.addEventListener('click', e => {
  const item = e.target.closest('.ac-item[data-cat-name]');
  if (!item) return;
  const name = item.dataset.catName;
  const listId = item.dataset.listId;
  const list = document.getElementById(listId);
  const input = list.previousElementSibling;
  input.value = name;
  list.classList.remove('open');
});

// ── Categories panel ───────────────────────────────────────────────────────
let allCategories = [];

async function loadCategories() {
  allCategories = await api('/api/categories?counts=1');
  renderCategories();
}

async function refreshCategoriesInPlace() {
  // Remember which category is expanded
  const openExpand = document.querySelector('.cat-expand.open');
  const openCatId = openExpand ? openExpand.id.replace('cat-expand-', '') : null;

  allCategories = await api('/api/categories?counts=1');
  renderCategories();

  // Re-expand the same category if it was open
  if (openCatId) {
    const hdr = document.querySelector(`.cat-row-header[data-cat-id="${openCatId}"]`);
    const chevron = hdr?.querySelector('.cat-chevron');
    const expand = document.getElementById(`cat-expand-${openCatId}`);
    if (hdr && chevron && expand && !expand.classList.contains('open')) {
      toggleCatExpand(parseInt(openCatId), hdr, chevron, expand);
    }
  }
}

function renderCategories() {
  const list = document.getElementById('categories-list');
  if (!allCategories.length) {
    list.innerHTML = '<div class="empty">No categories yet.</div>'; return;
  }
  list.innerHTML = '';
  allCategories.forEach(cat => {
    const wrap = document.createElement('div');
    wrap.className = 'cat-row';

    const hdr = document.createElement('div');
    hdr.className = 'cat-row-header';
    hdr.dataset.catId = cat.id;

    const chevron = document.createElement('span');
    chevron.className = 'cat-chevron'; chevron.textContent = '▶';

    const nameEl = document.createElement('div');
    nameEl.className = 'cat-row-name'; nameEl.textContent = cat.name;

    const countEl = document.createElement('div');
    countEl.className = 'cat-row-count';
    countEl.textContent = `${cat.item_count} item${cat.item_count !== 1 ? 's' : ''}`;

    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn-icon'; renameBtn.textContent = '✏️';
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', e => { e.stopPropagation(); openCategoryModal(cat.id, cat.name); });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon danger'; delBtn.textContent = '🗑';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', e => { e.stopPropagation(); openCatDeleteModal(cat.id, cat.name); });

    hdr.appendChild(chevron); hdr.appendChild(nameEl);
    hdr.appendChild(countEl); hdr.appendChild(renameBtn); hdr.appendChild(delBtn);

    const expand = document.createElement('div');
    expand.className = 'cat-expand';
    expand.id = `cat-expand-${cat.id}`;
    expand.innerHTML = '<span style="color:var(--muted);font-family:var(--mono);font-size:12px;">Loading…</span>';

    hdr.addEventListener('click', () => toggleCatExpand(cat.id, hdr, chevron, expand));
    wrap.appendChild(hdr); wrap.appendChild(expand);
    list.appendChild(wrap);
  });
}

async function toggleCatExpand(catId, hdr, chevron, expand) {
  const isOpen = expand.classList.contains('open');
  // Close all
  document.querySelectorAll('.cat-expand.open').forEach(e => e.classList.remove('open'));
  document.querySelectorAll('.cat-row-header.expanded').forEach(h => h.classList.remove('expanded'));
  document.querySelectorAll('.cat-chevron.open').forEach(c => c.classList.remove('open'));
  if (isOpen) return;

  hdr.classList.add('expanded');
  chevron.classList.add('open');
  expand.classList.add('open');

  try {
    const items = await api(`/api/categories/${catId}/items`);
    if (!items.length) {
      expand.innerHTML = '<div style="color:var(--muted);font-family:var(--mono);font-size:12px;padding:4px 0;">No items in this category.</div>';
      return;
    }
    expand.innerHTML = '';
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'cat-item-row';

      const nameEl = document.createElement('div');
      nameEl.className = 'cat-item-name'; nameEl.textContent = item.name;

      const boxesEl = document.createElement('div');
      boxesEl.className = 'cat-item-boxes';
      if (item.boxes && item.boxes.length) {
        item.boxes.forEach(b => {
          const chip = document.createElement('span');
          chip.className = 'chip';
          chip.style.cursor = 'pointer';
          chip.title = (b.label || '') + (b.room_name ? ' · ' + b.room_name : '');
          chip.textContent = `#${b.box_number} ×${b.quantity}`;
          chip.addEventListener('click', () => openBoxDetail(b.box_id));
          boxesEl.appendChild(chip);
        });
      } else {
        boxesEl.innerHTML = '<span style="color:var(--muted);font-size:12px;">Not in any box</span>';
      }

      row.appendChild(nameEl); row.appendChild(boxesEl);
      expand.appendChild(row);
    });
  } catch(e) {
    expand.innerHTML = `<span style="color:var(--danger)">Error: ${esc(e.message)}</span>`;
  }
}

function openCategoryModal(id = null, name = '') {
  document.getElementById('cat-editing-id').value = id || '';
  document.getElementById('modal-cat-title').textContent = id ? 'Rename Category' : 'Add Category';
  document.getElementById('cat-name-input').value = name;
  openModal('modal-category');
}

async function saveCategory() {
  const name = document.getElementById('cat-name-input').value.trim();
  if (!name) { toast('Name is required', true); return; }
  const id = document.getElementById('cat-editing-id').value;
  try {
    if (id) {
      await api(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
      toast('Category renamed');
    } else {
      await api('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
      toast('Category added');
    }
    closeModal('modal-category');
    await loadCategories();
    await loadItems(); // refresh items panel too
  } catch(e) { toast(e.message, true); }
}

function openCatDeleteModal(catId, catName) {
  document.getElementById('cat-delete-id').value = catId;
  document.getElementById('cat-delete-name').textContent = catName;
  const sel = document.getElementById('cat-reassign-select');
  sel.innerHTML = '<option value="">(none — remove category from items)</option>';
  allCategories.filter(c => c.id !== catId).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    sel.appendChild(opt);
  });
  openModal('modal-cat-delete');
}

async function confirmDeleteCategory() {
  const catId = document.getElementById('cat-delete-id').value;
  const reassignTo = document.getElementById('cat-reassign-select').value;
  const qs = reassignTo ? `?reassign_to=${reassignTo}` : '';
  await api(`/api/categories/${catId}${qs}`, { method: 'DELETE' });
  closeModal('modal-cat-delete');
  toast('Category deleted');
  await loadCategories();
  await loadItems();
}
