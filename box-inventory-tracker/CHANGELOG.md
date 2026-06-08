# Changelog

## 3.2.3
- **Fixed: QR codes return 401 when scanned from another device via HA ingress** — when the app is opened through Home Assistant ingress, the URL contains a session-specific token (e.g. /api/hassio_ingress/<token>/) that is only valid for the generating browser session. Scanning on another phone hits a 401. The QR code generator now calls getQRBaseURL() which: (1) uses a user-configured override if set; (2) falls back to location.origin if accessed directly (no ingress path); (3) auto-detects http://hostname:5000 when accessed via ingress, stripping the session-specific token
- **Settings → QR Code URL**: new section lets you set the direct URL of the add-on (e.g. http://homeassistant.local:5000 or http://192.168.1.x:5000). A preview shows exactly what URL will be encoded. Save it once and all QR codes will work from any device on the network

## 3.2.2
- **Fixed: dashboard SyntaxError** — unescaped apostrophes in single-quoted JS string literals (you'll, self's, can't, they're) caused a parse error that prevented dashboard.js loading entirely, which caused the 'Can't find variable: loadDashboard' error in nav.js. Replaced contractions with full forms
- **Fixed: packing mode room/box picker not working** — positionDropdownFixed() was adding .fixed-position class and inline top/left/width styles to the dropdown after it opened, overriding the absolute CSS positioning and placing the list off-screen. Packing mode now strips those overrides immediately after opening either dropdown

## 3.2.1
- **Fixed: QR code 'library not loaded' error** — the qrcode package (npm) has no pre-built browser bundle on jsDelivr; the build/ folder only exists locally after running the package build step. Switched to a self-hosted 80KB browserified bundle (qrcode.min.js) served from the add-on's own static files — no CDN dependency, no 404, no MIME type errors

## 3.2.0
- **Dashboard is now the start screen**: opens to Home (📊) on every launch instead of Boxes
- **Packing context question**: the dashboard opens with 'What are you packing for?' — Moving Home 🚛, Storage Locker 🏚️, Travel / Trip ✈️, or Home Organisation 🏠. Each context shows a relevant hint and a smart suggestion tip. Persists to localStorage. A small 'Change' button resets it
- **Box types — Inventory vs Quick Label**: when creating or editing a box, choose its type. Inventory boxes track individual items (current behaviour). Quick Label boxes are just a name, description, and photo — done in seconds. Perfect for 'Box of linens', 'Kitchen stuff', 'Books'. The description field is now explicitly labelled as making the box searchable so you can type 'flannel sheets duvet pillow' and find the box without itemizing
- **Flagged items** (⭐): tap the star icon on any item in a box to flag it as important. Flagged items show with an amber left border and the star is filled. Use this for the special blanket, the favourite pillow, the passport — things you need to be able to find specifically. The flag syncs instantly via SSE
- **DB migration 12**: boxes.box_type ENUM and box_items.flagged TINYINT columns added

## 3.1.1
- **Fixed: QR codes not scannable** — replaced the custom hand-rolled QR Code generator with the battle-tested `qrcode` npm package (v1.5.4, browser UMD build from jsDelivr). The custom implementation had multiple spec errors: version selection loop always picked the highest version, finder pattern inner ring was drawn incorrectly, format info copy 2 bit ordering was wrong, and the interleave block size calculation had an off-by-one. The `qrcode` library implements the full ISO/IEC 18004 spec correctly and is used in production by millions of projects. Renders as inline SVG, still vector-sharp at any size

## 3.1.0
- **Dashboard (Home tab)**: new 📊 Home panel as the first tab, giving a summary of everything at a glance:
  - Hero stats row: total boxes, rooms, items, and item types across the whole inventory
  - Progress ring: animated SVG ring showing % of known item types that have been catalogued, with breakdown of packed vs placed vs total types
  - Warnings: surfaces empty boxes and boxes with no room assigned
  - Quick actions: ⚡ Start Packing, + Add Item, View Boxes, Find Something — one tap to the most common workflows
  - Room cards: every room shown with box count and item count, click to go to Rooms panel
  - Top categories bar chart: animated horizontal bars showing which categories have the most items packed
  - Recent activity: last 20 items added to boxes with destination breadcrumb, click to open the box
  - Refreshes automatically via SSE when any data changes

## 3.0.3
- **Packing Mode now respects app theme**: all hard-coded dark hex colors replaced with CSS variables (--bg, --surface, --border, --text, --muted, --accent). Light mode users see the packing overlay in their normal light theme; dark mode stays dark
- **Fixed destination picker not working**: the dropdown was using fixed positioning calculated from screen coordinates (positionDropdownFixed), which breaks inside an overlay with its own stacking context. Switched to CSS absolute positioning within the dest bar and search wrap containers. Touch/click outside now also properly closes the picker on mobile

## 3.0.2
- **Fixed box list view: BOX # badge no longer stretches full width** — grid was defined as 3 columns (thumb | info | actions) but the DOM has 4 (thumb | num | info | actions), so the num badge was getting 1fr — the full middle column. Fixed to 4-column grid with num as auto-sized
- **Packing Mode more discoverable**: ⚡ PACK button in the topbar is now filled accent color (same weight as + Item). The ⚡ Pack tab in the bottom nav bar is always accent-colored with a glow so it stands out from the regular navigation tabs

## 3.0.0
- **Packing Mode**: full-screen distraction-free overlay for fast item entry. Tap ⚡ Pack in the nav bar or topbar to open it. Features:
  - Dark theme, no chrome, nothing to navigate — just a search field and an Add button
  - Destination bar at top: tap to choose any box or room from a grouped picker, pre-fills with the last-used box
  - By Name tab: 22px search input, auto-focus, shows recently-packed items before you type; match highlighting inline; ＋ Add shortcut at top of results to create a new item inline without leaving packing mode
  - Barcode / Scan tab: uses native BarcodeDetector API (modern iOS/Android browsers) with animated scan line; looks up UPC against local DB then external API; switches to name tab with result pre-filled
  - AI Image tab: tap to take or choose a photo; sends to vision API and pre-fills the search with the top result
  - Quantity stepper and optional note on each item before confirming
  - Add button flashes green and resets for the next item — minimal pause between additions
  - Session counter in top-right shows total items packed this session with a satisfying bounce animation
  - Running session list shows last 8 items added with destination and quantity
  - Escape key exits packing mode
- **Room header fix**: room name and count now stack on two lines (name bold, count small mono below) so the room title never wraps or fights with action buttons on narrow iPhone screens. Added ＋ Item button directly on each room row alongside ＋ Box

## 2.9.16
- **Fixed: QR code not rendering** — qrcode-svg is a Node.js module and does not expose a browser global; all calls to new QRCode() were silently failing. Replaced with a fully self-contained QR Code generator (~150 lines, pure JS, no dependencies) that runs directly in the browser. Generates clean SVG path output — vector, sharp at any size or print DPI. No CDN required, no loading failures possible

## 2.9.15
- **QR code now renders as pure SVG instead of canvas**: replaced QRCode.js (canvas-based, blurry when small) with qrcode-svg (vector SVG, infinitely sharp at any size or print DPI). The QR is now crisp regardless of label size or screen resolution
- **QR minimum size increased**: raised from 15mm to 18mm minimum, 42% of the label short edge, capped at 32mm — gives phones more pixels to decode
- **Print window now correctly uses mm dimensions**: the popup print window forces label dimensions in mm via CSS so the physical print size matches the selected label exactly, and the SVG QR scales correctly to fill its allocated space

## 2.9.14
- **New category: Outdoor & Winter Clothing** in household_items.json — covers weather-specific and gender-neutral clothing that doesn't belong in Men's/Women's/Kids' buckets: outerwear (coats, rain jackets, ski jackets/pants, fleece, down, softshell, windbreakers), base layers (thermals, merino wool), gloves (winter, work, garden, touchscreen, mittens), hats (toque, beanie, sun, balaclava), scarves, neck gaiters, Wellington/rain/muck boots, waterproof gaiters, snow pants, rain ponchos, hi-vis vests, UV shirts, insulated vests, and a full range of kids' versions. 52 items total
- Moved 13 previously misplaced items into the new category: Gloves – winter was in Clothing – Men's; winter coats/rain jackets were duplicated across Men's/Women's/Kids' instead of being unisex; scarves and winter toques were in Shoes & Accessories; winter boots were in Shoes & Accessories; thermals were split across Men's and Women's

## 2.9.13
- **Fixed: photo added to one item appearing on both when two items share the same type** — images are now stored per box_item placement (entity_type='box_item', entity_id=box_item_id) rather than per item type (entity_type='item'). Two 'Blanket' entries in the same or different boxes each have their own independent photos
- **Fixed: Asset Details Save Failed: Not Found** — the metadata delegated handler was reading btn.dataset.itemId but the button stored btn.dataset.boxItemId. Now correctly passes the box_item_id and placement type 'box_item' to the metadata API
- **Fixed: Print button not working on iPhone** — window.print() inside a modal is unreliable on iOS Safari. The Print button now opens a clean new window/tab containing just the label at the correct physical size, then calls print() on that window with a short delay for font loading
- **Fixed: QR code too small to scan** — minimum size raised to 15mm and percentage increased from 30% to 38% of the label short edge, capped at 30mm. Should now be scannable by most phones
- **Fixed: item name/category/quantity overlapping on mobile** — item rows now use flex-column layout for the info section, name gets ellipsis truncation, chips wrap on a second line, and on very narrow screens action buttons reflow to a second row

## 2.9.12
- **Fix / Merge Categories in Settings**: new section lets you move all items from one category into another with autocomplete on both fields. Source category is deleted automatically if left empty after the move. Use this to fix typos, merge duplicates, or consolidate after importing a new JSON file
- **Import: Update Category option**: new checkbox on the Import screen — 'Update category of existing items to match file'. When checked, items that already exist will have their category updated to whatever the JSON says, without creating duplicates. This is how to fix category assignments on data already in the system
- **Import: merge_categories map**: the /api/import/run endpoint now accepts a merge_categories object (e.g. {"Board & Paddle Sports": "Water Sports"}) to remap categories within the JSON before processing — useful for programmatic imports
- **Data fixes**: Gloves – winter moved from Shoes & Accessories → Clothing – Men's; Backpack – everyday → Miscellaneous; Gym bag → Sports & Fitness; Luggage (carry-on, checked) → Miscellaneous in household_items.json
- **Data fixes**: Board & Paddle Sports merged into Water Sports in household_items_2.json (18 items remapped, category removed)

## 2.9.11
- **Bedding & Linens – Sized category added** (131 items): duvet inserts, duvet covers, comforters, quilts, electric blankets, weighted blankets, throws, fitted sheets, flat/top sheets, sheet sets, pillowcases, pillow shams — all in twin/twin XL/full/double/queen/king/California king variants where applicable. Pillows by type (standard, queen, king, euro, body, memory foam, bamboo, pregnancy, cervical, toddler). Mattress protectors and toppers by size. Bed skirts by size. Towels (bath, hand, washcloth, bath sheet, beach, kitchen, hair, gym), robes, table linens, and specialty bedding (flannel/sateen/bamboo/linen/wool variants, crib sets, bunk bed curtains, storage bags). Storage locker pack now 1,514 items across 47 categories

## 2.9.10
- **Storage locker pack expanded**: household_items_2.json grown from 1,000 to 1,383 items and from 30 to 39 categories. New additions: Furniture (Bedroom, Living Room, Dining Room, Office, Outdoor) — bed frames, headboards, nightstands, dressers, wardrobes, sofas, sectionals, dining tables, desks, outdoor furniture; Mattresses & Bases — twin/full/queen/king/California king/crib mattresses, box springs, adjustable bases; Lighting — chandeliers, pendants, floor/table/desk lamps, outdoor; Window Treatments — curtains, blinds, shades, film; Rugs & Flooring — area rugs by size and style, underlayment, flooring boxes; Wall Decor — art, mirrors, shelves, wallpaper; Home Appliances — refrigerators, ranges, dishwashers, washers/dryers, HVAC, generators; Home Improvement — drywall, insulation, tile, paint, fixtures; Party & Events; School & Office Supplies; Food Preservation — canning, fermenting, dehydrating; Brewing & Winemaking
- Removed all "set of N" quantity descriptors from both JSON files (2.9.8 fix applied to new items as well)

## 2.9.9
- **Global search rebuilt**: the header search box now searches across everything — item names, categories, box labels/descriptions, room names, serial numbers, model numbers, placement notes, and asset notes
- **Prioritised results**: results grouped into sections by match type — (1) Item name match, (2) Category match, (3) Details match (serial/model/notes), (4) Box label match, (5) Room name match
- **Location breadcrumb on every result**: each result shows its full path — 🏠 Room  ›  📦 BOX 3 · Kitchen  ›  📌 Top shelf — so you know exactly where to find it without clicking
- **Match highlighting**: the matching portion of item names is highlighted in the results
- **Click to navigate**: clicking a result opens the box detail or scrolls to and expands the room, then clears the search box

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
