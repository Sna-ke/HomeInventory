# Changelog

## 2.9.8
- **Item starter packs cleaned up**: removed all "set of N" quantity descriptors from both the household starter pack and the storage locker pack (e.g. "Bath towels – set of 6" → "Bath towels"). 121 items updated across both files

## 2.9.7
- **Rooms with only placed items no longer show as empty**: the occupied/empty split now checks both box_count and room_item_count. The room count label shows "2 boxes, 5 items", "4 items" (no boxes), or "empty" as appropriate. DB query updated to include room_item_count via LEFT JOIN on room_items

## 2.9.6
- **FAB**: floating + button on the Boxes panel (bottom-right) opens the Add Item modal immediately — no need to open a box first
- **Box card quick-add**: each box card now has a '+ Item' button that opens the Add Item modal pre-loaded with that box, from the grid view without drilling in
- **Recent items**: the By Name tab shows up to 8 recently-added items the moment you open it (before typing), with a 'Recently added' header. Tap to select instantly during a packing session
- **Prominent create-new**: when you type a name that doesn't match any existing item, '＋ Add "name"' appears at the top of the list in bold — not buried at the bottom. Tap it to create and add in one step
- **Box detail + Item button**: now auto-focuses the search field when the modal opens

## 2.9.5
- **Named locations within rooms**: room_items now has an optional 'location' field (e.g. 'Top shelf', 'Freezer', 'Shelf B'). Items in a room are grouped by location when you expand the room. Locations can be set when placing an item from the unified Add Item modal
- **Unified Add Item modal**: the separate 'Place Item in Room' modal has been removed. The same Add Item modal (three tabs: By Name, By Image, By Barcode) now handles both boxes and rooms. The destination field shows boxes and rooms in grouped autocomplete — type a room name to select a room, or a box number/label to select a box
- **Quick-add destination includes rooms**: the + menu at the top now lets you choose a room as the destination, not just boxes
- **DB migration 11**: room_items.location column added

## 2.9.4
- **Storage locker starter pack**: second item JSON (household_items_2.json) with 1,000 items across 30 categories covering automotive, cycling, winter sports, water sports, camping, fitness, team & racket sports, golf, fishing & hunting, skateboarding, motorsports, musical instruments, photography, collectibles, luggage, storage, workshop, marine, safety, and more. Available for download from Settings → Import

## 2.9.3
- **Fixed adding items to rooms with no boxes**: room header click handler was gated on box_count > 0, so rooms with no boxes could not be expanded and the 'Items in Room' section was never shown. Click handler now always attaches regardless of box count

## 2.9.2
- **Fixed panel-settings outside mainContent**: modal extraction script had left panel-search unclosed, causing panel-settings to nest inside it and fall outside mainContent when parsed. Reconstructed mainContent with all seven panels as direct children, no modals inside
- Reverted unnecessary z-index changes introduced in 2.9.1 — the correct fix was structural placement, not z-index manipulation

## 2.9.1
- **Fixed Settings panel rendered outside mainContent**: modal-box, modal-room, and modal-item were inside the mainContent div, pushing panel-settings outside it. All three modals moved to after the mainContent closing tag
- **Asset details moved to Add-to-Box modal**: removed from Add/Edit Item modal (which defines an item type). The ATB modal now has a collapsible Asset Details section — serial number, model, purchase date, price, store, warranty duration + unit, credit card, asset notes — saved against the box_item placement when confirmed
- **Rooms expansion no longer wipes placements**: fixed expand.innerHTML wipe that destroyed the room placements section each time boxes loaded

## 2.9.0
- **Asset metadata is now placement-level**: serial number, warranty, and purchase info are tracked per box-item or room-item instance, not per item type. Two units of the same item can have different serial numbers and warranty start dates. The 📋 button passes the box_item_id or room_item_id as appropriate
- **Room items UI fully working**: room placements persist correctly alongside boxes in the room expand area, including the 📋 metadata button on each placed item
- **Credit card CRUD accessible**: Settings panel navigation fully fixed. Credit cards can be added, edited, and deleted from Settings → Credit Cards
- **DB migration 10**: converts item_metadata from item_id-based to placement_type/placement_id-based schema

## 2.8.2
- **Fixed Settings first-click going to Boxes**: 'settings' was missing from the applyNav panels list, so the hashchange event triggered by showPanel('settings') fell back to 'boxes'
- **Fixed Settings inputs not clickable**: added pointer-events:auto and position:relative to .panel.active
- **Fixed re-entrant showPanel**: setting location.hash fired hashchange → applyNav → showPanel again. Added guard flag and temporary listener removal
- loadCreditCardsSettings wrapped in try/catch so a failed API call cannot break the Settings UI

## 2.8.1
- **Fixed 📋 button not opening**: button used addEventListener which was stripped when refreshBoxItemsInPlace serialised the item list to innerHTML. Switched to dataset.action delegated events and fixed the DOM swap to use direct node moves
- **Fixed 📋 missing on first load**: button was only added in refreshBoxItemsInPlace, not in the initial openBoxDetail render

## 2.8.0
- **Fixed Settings page rendering**: unclosed mainContent div caused the panel to render outside the content area and behind everything. Now opens correctly and is fully interactive
- **Fixed Settings missing from mobile tabbar**: ⚙️ Settings tab now appears in the bottom navigation on iPhone
- **Warranty redesigned**: entered as a duration from purchase date (e.g. '2 years', '30 days', '18 months') rather than a raw expiry date. Expiry is calculated automatically
- **Credit card warranty extension types**: (1) Add a fixed duration to the manufacturer warranty; (2) Double the manufacturer warranty with an optional total cap in months. Live preview shows manufacturer expiry and effective expiry as you fill in the form
- **DB migration 9**: updates credit_cards and item_metadata tables for the new warranty model; migrates existing data automatically

## 2.7.0
- **Room placements**: items can now be placed directly in a room without being in a box. Each room on the Rooms page shows an 'Items in Room' section when expanded. Useful for furniture, appliances, wall-mounted TVs, and anything that isn't getting packed
- **Asset metadata**: every item in a box or room now has a 📋 button opening an Asset Details modal with serial number, model number, purchase date, price, store/vendor, manufacturer warranty, credit card, and notes
- **Credit card warranty tracking**: add your credit cards in Settings with their warranty extension period. The effective warranty end date is calculated automatically when a card is linked to an item's purchase
- **Schema migrations 6/7/8**: credit_cards, item_metadata, and room_items tables added automatically on upgrade

## 2.6.0
- **Export / Backup**: download a full JSON backup of all rooms, boxes, items, and categories. Optionally select specific boxes. The file can be re-imported to restore your inventory
- **Reset All Data**: two-step confirmation — first a warning dialog, then a text field requiring you to type 'I want to delete all data' before the delete button activates. Clears all boxes, rooms, items, categories, and photos
- **Import extended**: import now handles rooms and full boxes with contents (from a backup). Item deduplication is by name (case-insensitive); boxes always get fresh box numbers

## 2.5.0
- **Settings page**: new ⚙️ tab in the navigation
- **JSON import**: upload any JSON file with 'categories' and 'items' arrays to bulk-load your inventory. Preview shows validation results before committing. Duplicate items are skipped by default
- **Household starter pack**: 1,000 pre-made items across 30 categories. Download from Settings → Import and import with one click to pre-populate your inventory before you start packing

## 2.4.3
- Fixed missing imports across refactored modules: request in db.py, pymysql in rooms.py and categories.py, PIL.Image in vision.py. Removed leftover __main__ block from routes/frontend.py

## 2.4.2
- Fixed NameError on startup: routes/vision.py had leftover inline env var reads from the old monolithic server.py — now imported from config.py

## 2.4.1
- Fixed startup error: db.py referenced HA_TOKEN and HA_API_URL without importing them from config.py

## 2.4.0
- **Backend refactored**: server.py split from 1,603 lines into focused modules — server.py (entry point), config.py (env vars), db.py (DB + migrations + helpers), sse.py (SSE broadcaster), and route blueprints for boxes, rooms, items, categories, images, vision, and frontend

## 2.3.0
- **Frontend refactored**: index.html split from 5,200 lines into separate CSS and JS files — main.css, state.js, api.js, boxes.js, rooms.js, items.js, categories.js, atb.js, images.js, labels.js, nav.js

## 2.2.7
- Box detail no longer scrolls to top or re-renders the header when items are added, removed, moved, or quantities changed. refreshBoxItemsInPlace() replaces only the item list and count. SSE live-sync on box detail also uses in-place refresh

## 2.2.6
- Fixed unhandled promise rejection errors when adding items — all add flows now wrapped in try/catch with toast error messages
- Boxes page no longer fully re-renders on live update — existing cards updated in-place without wiping the page

## 2.2.5
- Quick-add box search shows a '+ Create box' option when typing. Creates the box and auto-selects it so you can immediately add an item

## 2.2.3
- Boxes, Items, and Categories pages live-update in-place, preserving expanded rows

## 2.2.2
- Fixed live sync not working: gunicorn was running 2 worker processes with separate SSE registries. Switched to 1 worker + 8 threads so all SSE broadcasts reach all connected clients

## 2.2.0
- Rooms page updates in-place when items change. Open rooms and boxes stay expanded; only item rows and counts are refreshed

## 2.1.8
- Room item search: non-matching boxes within a matching room now faded to 45% opacity

## 2.1.7
- Room item search: when query matches nothing, highlights are cleared but rooms and boxes stay open at their current state

## 2.1.6
- Room item search: highlights cleared when a box collapses; if refined query matches nothing the current view is left unchanged

## 2.1.5
- Rooms page item search: non-matching rooms collapsed and faded (45% opacity) instead of hidden

## 2.1.4
- Fixed navigation state not persisting through HA ingress page loads. Navigation now saved to sessionStorage as fallback — on reload the app checks: QR param → URL hash → sessionStorage

## 2.1.3
- Fixed hash routing: tab clicks update the URL bar correctly. Refreshing returns to the correct panel or box

## 2.1.1
- Fixed URL hash not updating on navigation
- Fixed room item search injecting extra elements and destroying DOM on no results
- Fixed SSE performance: change events debounced at 400ms, only refresh the current panel

## 2.1.0
- **URL-based navigation**: navigating between panels and boxes updates the URL hash. Refreshing returns to exactly where you were
- **Live multi-user sync**: all connected browsers update automatically when any data changes. Multiple people can pack boxes simultaneously

## 2.0.0
- Multiple rooms can be expanded simultaneously on the Rooms page
- Expand All / Collapse All buttons on the Rooms page
- Find Item search: live search across all rooms with automatic expand and amber highlights

## 1.9.8
- Robust AI response parsing: handles markdown-fenced responses, bullet lists, prose, and arrays with missing commas

## 1.9.7
- Box card image collages: if a box has no photo but items do, the card shows a collage of up to 9 item photos

## 1.9.6
- Partial quantity moves: move a subset of items between boxes with a qty stepper

## 1.9.5
- Single 'Add to Box' button dispatches to the correct handler based on active tab
- By Image tab uses result cards with merge detection

## 1.9.4
- Barcode merge detection: if a scanned item matches an existing item by name, offers to merge (saves UPC to existing) or keep separate

## 1.9.3
- Restored missing decodeBarcode() function that was accidentally dropped in 1.9.2

## 1.9.2
- Direct 'Add to Box' from barcode results. UPC saved to item record. Multiple results shown as selectable cards. 'Not Right…' flow to correct the name

## 1.9.1
- Fixed image 404 errors under HA ingress: image URLs constructed with ingress path prefix server-side

## 1.9.0
- HA ingress support: app works correctly when accessed via the HA sidebar. All API calls use the injected ingress path prefix

## 1.8.3
- Fast barcode lookup: ZXing-js decodes barcodes in the browser. Decoded UPC looked up against Open Food Facts and UPCitemdb

## 1.8.0
- Move items between boxes with merge detection
- Add Item modal tabs: By Name, By Image (AI), By Barcode

## 1.7.2
- Duplicate item detection: adding an existing item increments quantity instead of creating a duplicate
- Qty scrollable dropdown supporting quantities above 99
- Qty = 0 prompts delete

## 1.7.0
- Rooms page split into occupied and empty sections
- + Box button on every room row
- Drag and drop boxes between rooms

## 1.6.5
- Fixed overlapping dropdowns in the Add Item modal

## 1.6.4
- Initial dropdown on focus showing top 5 suggestions. Recency-sorted suggestions

## 1.6.2
- HA Areas sync fixed. Quick-add '+ Item' in header with box autocomplete

## 1.6.0
- HA Areas integration: rooms synced from Home Assistant Areas automatically on startup and via ⟳ Sync HA button

## 1.5.1
- Item thumbnails in box detail: 48×48 photo per item row

## 1.5.0
- Label orientation toggle (portrait / landscape)
- Light/dark theme toggle respecting system preference

## 1.4.0 and earlier
- Initial release with box tracking, room management, QR code label printing, item management, categories, image upload, and AI item identification
