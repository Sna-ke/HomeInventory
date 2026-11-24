# BoxTrack — Scanning, QR Locations & Labels

## One scanner, typed identifiers

- Manufacturer UPC-A/UPC-E/EAN/GTIN and supported GS1 2D codes identify a product; UPC alone does **not** identify a unique purchased unit or its expiry.
- BoxTrack QR codes identify a stable box/item/location resource. Never embed mutable box path, direct HA ingress token, shared secret or unrestricted inventory payload.
- Support camera scanner, hardware/Bluetooth keyboard scanner, and manual entry; ensure web fallback on unsupported cameras or insecure contexts during legacy HA operation.
- Resolve codes through authenticated/authorized API calls. QR codes are pointers, not proof of entitlement.

## Two valid relocation sequences

1. Scan Box 42 -> scan Shelf 3 -> preview breadcrumb -> confirm movement.
2. Scan Shelf 3 -> scan Box 42, Box 37, Box 19 -> Done. Destination remains selected; each box receives its own movement/confirmation event.
3. If one QR is missing, select the item or location in the interface. Allow a free-text sublocation such as "behind decorations."
4. A location QR scan by itself opens **expected contents** and last physical confirmations. No scan magically proves all boxes are present.
5. Audit mode: scan a shelf, then its actual boxes; mark confirmed vs missing/not yet checked; provide timestamps/actor information.
6. Log `scan`, `digital_open`, `physical_confirm`, `move`, `contents_changed` as distinct events. Scanning may optionally facilitate confirmation but not silently conflate those events.

## QR hierarchy

Property -> room/locker -> shelving unit -> shelf -> bin/box -> contained asset/stock. Each addressable location gets an immutable opaque ID, optionally printed on a QR label. Renaming or moving a shelf/box must not invalidate its QR.

## Niimbot B1

Current legacy code: `box-inventory-tracker/app/static/js/labels.js`. Defined sizes: 50x30, 40x30, 40x40, 50x50, 40x60, 40x70, 50x70, 50x80 mm. Support landscape/portrait where media dimensions and printer behavior permit. Save model, roll dimensions and template defaults.

**Box label:** large box number, human-readable title, English contents summary, optional current location, scannable QR.
**Shelf label:** prominent shelf identifier, shelving unit/room path, scannable QR.
**Other labels:** food prep/use-by, craft material and batch, sellable stock SKU, durable asset ID.

Text summary is a snapshot; scanning opens live contents. Reprint can be offered when actual contents change. Auto-summarize from item names/categories, but keep summaries editable and fit to available space. QR quiet zone and contrast take priority over longer text. Actual print templates must be tested on the physical B1 for each roll/orientation.

## Printing adapters

Decouple SVG/PDF label rendering from output: browser/system print first, B1 adapter for supported native/Bluetooth transport later. Validate B1 communication on actual iOS/Android hardware before assuming direct printing works.

## Offline

Use local signed-in cache of authorized inventory and pending scan/move events; mark "pending sync" distinctly from server-confirmed changes. Idempotency keys and per-record versions prevent duplicate moves; conflict if two devices place the same box differently while disconnected. See [OFFLINE.md](OFFLINE.md).
