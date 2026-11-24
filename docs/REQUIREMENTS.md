# BoxTrack — Product Requirements

## Primary jobs

1. Add items to boxes, add boxes to rooms/lockers, track items directly in rooms and precise positions (shelf, bin, drawer or descriptive note).
2. Find an item by name, category, barcode, image or box number; display the complete breadcrumb to its expected placement.
3. Rapidly pack using item-name entry, photos and UPC/EAN scanning without navigating lengthy metadata forms. Repeated scans increment quantity with confirmation and Undo.
4. Print human-readable QR labels for boxes and locations, multiple Niimbot B1 sizes and portrait/landscape orientation.
5. Track category, image, receipt, purchase date/cost, warranty, serial, expiration, current value, lending and sale history as applicable.
6. Maintain separate last-scanned, last-digitally-opened, last-moved, last-physically-confirmed and last-contents-updated timestamps; never treat a digital view as proof of physical location.
7. Enable optional workspaces sharing one inventory: Storage, Pantry, Belongings, Crafts, Make & Sell, Garden, Camping/RV, Digital, Presents.
8. Track ingredients, purchases, consumptions, giving away without recipient tracking, spilled/spoiled/discarded quantities, corrections, cooking outputs and leftovers; outputs may become inputs to new production.
9. Track materials, production inputs/outputs/waste, resale allocations, craft fair selling, and future POS/Square integration.
10. Support multiple properties (including cabins/RVs), locations, custody, and structured or free-text placement.
11. Run as HA app during transition; target standalone web and iOS/Android/tablet with offline capture and sync.
12. Use GroundCore household membership/roles for shared inventory; keep gift records restricted to creators and specifically granted viewers.

## Functional acceptance examples

- Scan Box #42 then Shelf 3 (or reverse): confirm a location update; previous placement stays in audit trail; offline queue can replay safely.
- Scan Shelf 3, scan boxes 42/37/19, then Done: all assigned to that shelf and individually confirmed.
- Shelf lookup shows **expected** items/boxes and last physical confirmation dates, not unqualified "currently present" claims.
- Scan Box #42: open the box contents directly, without exposing inventory to someone lacking authorization.
- Pack five UPC-identified items: user chooses destination once; duplicate UPC has a reviewable count; photos may be named later.
- Print label: real QR, large box number, location and concise English summary; layout protects QR scanability on small labels.
- Household role with view-only access cannot create/change stock; role with edit cannot change gift privacy or bypass API validation.
- Gift creator can track idea -> ordered -> shipping -> arrived -> hidden -> wrapped -> given; recipient cannot discover it via any other workspace or aggregate.
- Cooking six portions reduces batch ingredients on actual completion and creates stored portions; planned recipes alone do not deplete inventory.
- Use a material for production, produce stock for sale, sell one at a fair: transactions remain consistent and idempotent.

## Quality attributes

- Low-tap, accessible, touch-friendly workflows; focus on actions rather than KPI dashboards.
- Stable immutable IDs, UTC events, device-local display time.
- Offline queue with idempotency keys and explicit conflicts for competing location updates.
- Tenant isolation, restricted gift ACLs, secure handling of location history and private photos.
- Reversible migration with backups, compatibility contracts, staged releases and tests.
