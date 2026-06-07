// ── State ──────────────────────────────────────────────────────────────────
let rooms = [];
let allItems = [];
let editingBox = null;
let editingRoom = null;
let editingItem = null;
let currentBoxId = null;
let addToBoxId  = null;  // numeric box id (null when destination is a room)
let addToRoomId = null;  // numeric room id (null when destination is a box)
let uploadTarget = null; // { entity_type, entity_id, refresh }
let searchTimer = null;
let boxView = 'grid'; // 'grid' | 'list'
let currentPrintBox = null; // box object held for label re-render on size change
