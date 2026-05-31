// ── State ──────────────────────────────────────────────────────────────────
let rooms = [];
let allItems = [];
let editingBox = null;
let editingRoom = null;
let editingItem = null;
let currentBoxId = null;
let addToBoxId = null;
let uploadTarget = null; // { entity_type, entity_id, refresh }
let searchTimer = null;
let boxView = 'grid'; // 'grid' | 'list'
let currentPrintBox = null; // box object held for label re-render on size change
