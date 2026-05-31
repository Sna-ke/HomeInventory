# Changelog

## 2.8.2
- Fixed Settings panel first-click going to Boxes: 'settings' was missing from the applyNav panels list, so the hashchange event triggered by showPanel('settings') resolved to the 'boxes' fallback
- Fixed Settings buttons/inputs not clickable: added pointer-events:auto and z-index:1 to .panel.active, preventing any invisible overlapping element from intercepting clicks
- Fixed re-entrant showPanel calls: setting location.hash inside showPanel fired hashchange which called applyNav → showPanel again. Added guard flag and temporary hashchange listener removal while the hash is being set
- loadCreditCardsSettings now wrapped in try/catch so a failed API call can't break the settings UI

## 2.8.1
- **Fixed metadata button not opening**: the 📋 button used addEventListener which was stripped when refreshBoxItemsInPlace used innerHTML swap to update the item list. Switched all buttons to dataset.action delegated events and fixed the DOM swap to use direct node moves instead
- **Fixed 📋 missing on first load**: the button was only added in refreshBoxItemsInPlace but not in openBoxDetail's initial render
- **Metadata moved into item modal**: clicking 📋 now opens the standard Add/Edit Item modal with an expandable 'Asset Details' section at the bottom (collapsed by default). Saves name/category/UPC and metadata in one step. Section auto-expands when editing an item that already has metadata

## 2.8.0
- **Fixed Settings page**: was rendering under other panels due to unclosed mainContent div; reset modals were inside the content area rather than outside it. Settings now opens correctly and is fully interactive
- **Fixed Settings missing from mobile tabbar**: ⚙️ Settings tab now appears in the bottom navigation on iPhone/mobile
- **Warranty redesigned**: warranty is now entered as a duration from purchase date (e.g. '2 years', '30 days', '18 months') rather than a raw expiry date. The expiry is calculated automatically from purchase date + duration
- **Credit card warranty extension types**: two modes: (1) Add a fixed duration to the manufacturer warranty (e.g. +1 year); (2) Double the manufacturer warranty, with an optional total cap in months (e.g. Amex doubles up to 2 years total = cap 24 months). A live preview shows both manufacturer expiry and effective expiry as you fill in the form
- **DB migration 9**: updates credit_cards and item_metadata tables for new warranty model; migrates existing data automatically

## 2.7.0
- **Room placements**: items can now be placed directly in a room without being in a box. Each room on the Rooms page shows an 'Items in Room' section when expanded, with a '+ Place Item in Room' button. Useful for furniture, appliances, wall-mounted items, and anything that isn't getting packed
- **Asset metadata**: every item now has a 📋 button in box detail (and room placements). Opens an Asset Details modal with: Serial Number, Model Number, Purchase Date, Purchase Price, Store/Vendor, Manufacturer Warranty Expiry, and Notes
- **Credit card warranty tracking**: add your credit cards in Settings with their warranty extension period (in months). When a card is linked to an item's purchase, the effective warranty end date is calculated and displayed automatically (e.g. 1-year manufacturer + 1-year Visa = 2027-06-15)
- **Schema migrations 6/7/8**: credit_cards, item_metadata, and room_items tables added automatically on upgrade

## 2.6.0
- **Settings: Export / Backup** — download a full JSON backup of all rooms, boxes, items, and categories. Optionally select specific boxes to export. The backup file is importable back into BoxTrack to restore your inventory
- **Settings: Reset All Data** — two-step confirmation: first a warning dialog, then a text field requiring you to type 'I want to delete all data' before the delete button becomes active. Clears all boxes, rooms, items, categories, and photos
- **Import extended** — import now also handles rooms and full boxes with their contents (from a backup). Item deduplication is by name (case-insensitive); boxes always get fresh box numbers

## 2.5.0
- **Settings page**: new ⚙️ tab in the navigation with configuration functions
- **JSON import**: upload any JSON file with 'categories' and 'items' arrays to bulk-load your inventory. Preview shows validation results before committing. Duplicate items (matched by name) are skipped by default
- **Household starter pack**: 1,000 pre-made items across 30 categories (Kitchen, Bedroom, Bathroom, Tools, Garden, Electronics, Clothing, Toys, Baby, Pets, and more). Download from the Settings page and import with one click to pre-populate your inventory before you start packing

## 2.4.3
- Fixed missing imports across refactored modules: request in db.py, pymysql in rooms.py and categories.py, PIL.Image in vision.py. Removed leftover __main__ block from routes/frontend.py

## 2.4.2
- Fixed NameError on startup: routes/vision.py had leftover inline env var reads (HA_TOKEN, VISION_BACKEND, etc.) from the old monolithic server.py. These are now imported from config.py

## 2.4.1
- Fixed startup error: db.py referenced HA_TOKEN and HA_API_URL without importing them from config.py

## 2.4.0
- **Backend refactored**: server.py split from 1603 lines into focused modules:
  - `server.py`          53 lines  — Flask app + blueprint registration (entry point)
  - `config.py`          28 lines  — all env var configuration
  - `db.py`             360 lines  — DB connection, init, migrations, shared helpers
  - `sse.py`             66 lines  — Server-Sent Events broadcaster
  - `routes/boxes.py`   313 lines  — box CRUD + box_items CRUD
  - `routes/rooms.py`   131 lines  — room CRUD + HA area sync
  - `routes/items.py`   173 lines  — item CRUD + search + find-by-name
  - `routes/categories.py` 141 lines — category CRUD
  - `routes/images.py`   98 lines  — image upload / serve / delete
  - `routes/vision.py`  365 lines  — AI identification + UPC lookup
  - `routes/frontend.py`  27 lines  — index page route

## 2.3.0
- **Frontend refactored**: index.html split from 5200 lines into separate files for maintainability:
  - `static/css/main.css` — all styles (839 lines)
  - `static/js/state.js` — shared application state
  - `static/js/api.js` — fetch wrapper, esc(), toast()
  - `static/js/boxes.js` — box list, box detail, item rows, qty controls (1017 lines)
  - `static/js/rooms.js` — rooms page, expand/collapse, item search (666 lines)
  - `static/js/items.js` — items page, filters, expand rows (301 lines)
  - `static/js/categories.js` — categories page and autocomplete (233 lines)
  - `static/js/atb.js` — Add-to-Box modal: by name, image, barcode, UPC lookup (978 lines)
  - `static/js/images.js` — gallery, photo upload, overlay (48 lines)
  - `static/js/labels.js` — print modal, label preview, QR (178 lines)
  - `static/js/nav.js` — routing, SSE live-sync, theme, init (243 lines)
  - `templates/index.html` — HTML structure only (664 lines)

## 2.2.7
- Box detail page no longer scrolls to top or re-renders the header when items are added, removed, moved, or quantities changed. A new refreshBoxItemsInPlace() function replaces only the item list and count, leaving scroll position and the box header untouched
- SSE live-sync on box detail also uses the in-place refresh

## 2.2.6
- Fixed unhandled promise rejection errors (3 / [object Object]) when adding items — all add flows now wrapped in try/catch with toast error messages
- Boxes page no longer fully re-renders on live update — existing cards are updated in-place (thumbnail, title, meta) without wiping the page. New boxes are appended, removed boxes are cleaned up

## 2.2.5
- Quick-add from header: box search now shows a "+ Create box" option when typing. Clicking it reveals an inline panel to set a label and optional room, then creates the box and auto-selects it so you can immediately add the item to it

## 2.2.3
- Boxes page: live-updates when boxes or items change without reloading rooms
- Items page: live-updates in-place, preserving which item row is currently expanded
- Categories page: live-updates in-place, preserving which category is currently expanded
- Box detail page: already updated in-place (unchanged)

## 2.2.2
- Fixed live sync not working: gunicorn was running 2 worker processes, each with their own in-memory SSE client registry. Mutations in worker A had no way to notify clients connected to worker B. Switched to 1 worker + 8 threads (all share the same process memory, so SSE broadcasts reach all connected clients)
- Added SSE connection and push logging for easier diagnostics in HA logs

## 2.2.0
- Rooms page now updates in-place when items are added or quantities change. Open rooms and boxes stay expanded; only item rows and counts are refreshed. A full reload only happens when room structure changes (add/rename/delete room)

## 2.1.8
- Room item search: non-matching boxes within a matching room are now faded to 45% opacity (same treatment as non-matching rooms), in addition to being collapsed

## 2.1.7
- Room item search: when the query matches nothing, highlights are cleared but rooms and boxes stay open at their current expand state

## 2.1.6
- Room item search: highlights are now cleared when a box collapses (not left behind in hidden boxes)
- Room item search: if the refined query matches nothing at all, the current view is left unchanged instead of collapsing everything at once

## 2.1.5
- Rooms page item search: non-matching rooms are now collapsed and faded (opacity 45%) instead of hidden. All rooms remain visible and draggable during a search

## 2.1.4
- Fixed navigation state not persisting through HA ingress page loads. HA strips URL fragments before serving the page, so navigation is now saved to sessionStorage as a fallback. On reload, the app checks: QR code param → URL hash → sessionStorage, and restores the correct panel or box view

## 2.1.3
- Fixed hash routing: clicking Rooms/Items/Boxes/Categories now updates the URL bar correctly
- Fixed refreshing on any panel now returns to that panel instead of the home screen
- Used hashchange event (not popstate) so tab clicks are captured correctly
- Fixed brace balance error from 2.1.2 that could cause parse failures

## 2.1.2
- Fixed syntax error (stray closing brace) introduced in 2.1.1 that prevented the page from loading

## 2.1.1
- Fixed URL hash not updating on navigation (now uses location.hash directly, compatible with HA ingress subpaths)
- Fixed room item search injecting extra elements — matching boxes now expand in-place with item names highlighted inline
- Fixed room item search destroying room list DOM when no results found — rooms now hide/show with display:none without losing their DOM state
- Fixed SSE performance issue: change events are now debounced (400ms) and only trigger a refresh of the current panel rather than cascading loadRooms() on every mutation

## 2.1.0
- **URL-based navigation**: navigating between panels and boxes now updates the URL hash (`#boxes`, `#rooms`, `#items`, `#box/42`). Refreshing the page returns you to exactly where you were
- **Live multi-user sync**: all connected browsers update automatically when any data changes. Multiple people can pack boxes simultaneously and see each other's changes in real time — no manual refresh needed
- Server-Sent Events (SSE) with automatic reconnection and HA ingress keepalive

## 2.0.0
- **Multiple rooms can now be expanded simultaneously** on the Rooms page
- **Expand All / Collapse All** buttons added to the Rooms page header
- **Find Item search**: live search across all rooms — as you type, matching rooms expand automatically and the matching portion of each item name is highlighted in amber. Rooms with no matches collapse out of the way

## 1.9.8
- **Robust AI response parsing**: vision identification no longer errors on malformed JSON. Handles markdown-fenced responses, bullet/numbered lists, prose responses, and arrays with missing commas

## 1.9.7
- **Box card image collages**: if a box has no photo but its items do, the box card shows a collage of up to 9 item photos in a CSS grid. Applies to both grid and list views
- Collage layouts: 1 (full bleed), 2 (columns), 3 (large left + stacked right), 4 (2×2), 5–9 (3-column grid)

## 1.9.6
- **Partial quantity moves**: when moving an item between boxes with qty > 1, a stepper appears defaulting to the full quantity. Move a subset and the remainder stays in the source box
- Qty = 1 skips the stepper entirely — one tap to confirm

## 1.9.5
- **Single "Add to Box" button**: removed the duplicate button inside the barcode tab. The modal footer button now dispatches to the correct handler based on the active tab
- **By Image tab now uses result cards** (same pattern as By Barcode) with merge detection

## 1.9.4
- **Barcode merge detection**: if a scanned item matches an existing inventory item by name but without a barcode, offers to merge (saves the UPC to the existing item) or keep separate
- Merge check also applies to the "Not Right" manual name entry flow

## 1.9.3
- **Restored missing barcode decode function**: `decodeBarcode()` was accidentally dropped in 1.9.2, causing all scans to fail immediately. Restored with correct ZXing API usage

## 1.9.2
- **Direct "Add to Box" from barcode results**: after a successful scan, tap "Add to Box" immediately — no need to switch to the By Name tab
- **UPC saved locally**: scanned barcodes are stored on the item record. Future scans check the local database first
- **Multiple barcode results**: all matches shown as selectable cards labelled ✓ Saved, 🌐 Online, or 🤖 AI
- **"Not Right…" flow**: enter the correct product name to create a new item with the scanned UPC attached
- **UPC field on item add/edit modal**: view and edit barcodes for any item
- **Header button dropdown**: ▾ arrow next to "+ Item" opens a menu for By Name, By Image, or By Barcode

## 1.9.1
- **Fixed image 404 errors under HA ingress**: image URLs are now constructed with the ingress path prefix on the server side, so `img.src` attributes always resolve correctly regardless of access method

## 1.9.0
- **HA ingress support**: the app now works correctly when accessed through the HA sidebar via ingress. All API calls use the injected ingress path prefix
- **Fixed ZXing CDN**: switched from broken cdnjs path to correct jsDelivr UMD build
- QR code URLs also include the ingress prefix so scanning a label opens the app correctly

## 1.8.3
- **Fast barcode lookup**: ZXing-js decodes barcodes entirely in the browser (no AI, no network). Decoded UPC is looked up against Open Food Facts and UPCitemdb
- Three-stage fallback: browser decode → database lookup → AI identification
- Scanned UPC shown on screen for transparency
- New `GET /api/upc-lookup` endpoint proxies external lookups (avoids CORS)

## 1.8.2
- **Gunicorn timeout increased to 180s** with gthread workers to prevent 500 errors during slow Ollama inference

## 1.8.1
- **Ollama model validation**: checks `/api/tags` before attempting identification. Shows which models are installed if the configured model is missing, with instructions to run `ollama pull`
- Friendly error instead of raw 404 when model is not installed

## 1.8.0
- **Move items between boxes**: ⇄ button on every item row in box detail and in the items panel expand rows. Detects and merges if the item already exists in the destination box
- **Add Item modal tabs**: By Name, By Image (AI), By Barcode — three distinct workflows in one modal
- **Drag-and-drop fix**: removed `pointer-events: none` from dragging class which was preventing `dragend` from firing and breaking subsequent drags

## 1.7.5
- **All autocomplete dropdowns use fixed positioning**: category, item search, and box search dropdowns now escape modal overflow clipping via `getBoundingClientRect`

## 1.7.4
- **Restored category field visibility logic**: category field was missing entirely; now shows only when creating a new item (not when selecting existing)
- **Portrait label layout fixed**: portrait labels (e.g. 40×60mm) now use a top strip for QR + box number, with full label width below for title and description text

## 1.7.3
- Fixed category field still showing by default after 1.7.2 fix

## 1.7.2
- **Duplicate item detection**: adding an item already in a box (same item + notes) increments the existing quantity instead of creating a duplicate entry
- **Qty scrollable dropdown**: qty picker replaced with a scrollable column showing 6 rows, centered on current value. Supports quantities above 99
- **Qty = 0 prompts delete**: decrementing to zero or saving with qty 0 prompts to remove the item from the box
- **Category field hidden by default**: only appears when creating a new item (not when selecting an existing one)
- **Drag-and-drop highlight improved**: entire room row lights up with amber outline and tint when a box is dragged over it

## 1.7.1
- **Label QR size reduced**: QR column capped at 30% of short edge (max 20mm). Text gets proportionally more space
- Always uses left-column layout; orientation toggle now only affects physical print dimensions

## 1.7.0
- **Rooms page split into two sections**: rooms with boxes at top, empty rooms below under "Empty Rooms" heading
- **+ Box button on every room**: opens the New Box modal with that room pre-selected
- **Drag and drop boxes between rooms**: drag any box row onto any room header or expanded area to move it. Drop target highlighted while dragging
- **Blur-to-close on all autocomplete inputs**: clicking outside a dropdown now always closes it

## 1.6.5
- Fixed overlapping dropdowns in the Add Item modal: opening one dropdown now closes all others first

## 1.6.4
- **Initial dropdown on focus**: tapping the item name or box search field shows the top 5 suggestions immediately
- **Recency-sorted suggestions**: recently selected items and boxes appear first
- **"Box 2" search works**: box search strips leading "box " prefix, so "Box 2", "BOX 2", "box2" all find Box #2
- **Centred + Item button** in the topbar

## 1.6.3
- Improved horizontal label layout: QR column is narrower, text section gets more space. Font sizes scale to available text area width

## 1.6.2
- **HA Areas sync fixed**: switched from non-existent REST endpoint to `POST /api/template` with Jinja2. Uses `tojson` filter for safe escaping of area names
- **Quick-add "+ Item" in header**: opens the Add Item modal from any screen. Remembers the last-used box across calls
- Box selector in quick-add modal with searchable autocomplete

## 1.6.1
- Rooms page: each box row split into expand zone (left) and → View button (right) so tapping expands contents and → navigates
- Multiple boxes in a room can be expanded simultaneously
- ⊞ Expand all / ⊟ Collapse all per room
- Room collapse resets all box panels inside it

## 1.6.0
- **HA Areas integration**: rooms are now synced from Home Assistant Areas automatically on startup and via the ⟳ Sync HA button. Name changes in HA propagate on next sync
- HA-managed areas show a blue "HA Area" badge and cannot be renamed or deleted from the app
- Areas removed from HA show an amber "HA (removed)" badge and become editable again
- **Migration 4**: adds `ha_area_id` and `ha_synced` columns to rooms table
- Rooms page: clicking a room with boxes expands to show box list. Clicking a box expands to show item list. Box label navigates to box detail page

## 1.5.1
- **Item thumbnails in box detail**: each item row shows a 48×48 photo thumbnail. Tap existing photo to view full-size with Replace and Delete options. Tap camera icon to add a photo

## 1.5.0
- **Label orientation toggle**: ▯ portrait / ▭ landscape toggle in the print modal
- **Light/dark theme toggle**: 🌙/☀️ button in topbar. Respects system dark mode preference; manual toggle saved to localStorage
- **Clickable box entries in item expand rows**: clicking a box in the items panel expand navigates to that box's detail page

## 1.4.0 and earlier
- Initial release with box tracking, room management, QR code label printing, item management, categories, image upload, and AI item identification
