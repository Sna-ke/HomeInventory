# BoxTrack — Home Assistant to GroundCore Transition

## Current state

The existing repository is a Home Assistant add-on, `box-inventory-tracker/`, with Flask routes (`app/routes/`), MariaDB/SQL in `app/db.py`, single HTML template `app/templates/index.html` and static JavaScript in `app/static/js/`. Existing QR URLs and storage rely partly on HA ingress/direct access. Some functionality already implemented should be retained: boxes, items, rooms, room placements, photos, dashboard, metadata, packing wizard, lockers, category taxonomy and Niimbot B1 label UI.

## Target state

BoxTrack is a standalone app/service behind a GroundCore API gateway with GroundCore authentication, household group memberships, role authorization and optional app registrations. Responsive Vue 3/TypeScript web UI, native iOS/Android/tablet client(s) with offline caching. Data is household-scoped. Presents require explicit private visibility rules rather than ordinary group access.

## Migration constraints

- The HA application must continue working until a **separately approved** deprecation/cutover. Do not delete the existing code in the first UI migration.
- Current rows/photos/box numbers/QR labels must survive; preserve a mapping from legacy primary keys and printed box codes to immutable new IDs.
- Introduce compatibility adapters around old APIs if needed, then migrate domain boundaries incrementally. Avoid rewriting front and back together.
- Begin with characterization tests for existing routes, SQL schema/migrations, label output and export/restore.
- The final service may use PostgreSQL (GroundCore standard), but database choice and conversion approach require measured migration design and backups.
- On-premise/HA transitional auth and future GroundCore auth must not accidentally expose household content across users or tenants.
- Formal API contracts go under `spec/` when established; generated clients/types only, no handwritten diverging DTOs.

## Proposed slices

1. **Audit and safeguard:** capture route inventory, DB schema/migrations, backup/restore tests, sample fixture and existing label scan/print behavior.
2. **Task-first Vue shell:** universal Find, Box/Location detail, Quick Pack, and print preview backed by current API. Mount alongside the original UI; retain HA access.
3. **Location/activity model:** nested optional locations, stable QR IDs, two-scan and shelf-first bulk placement, physically confirmed vs viewed timestamps.
4. **Shared inventory service contract:** catalogue, stock, asset, lot, location, activity, visibility, bridge action; OpenAPI and test fixtures.
5. **GroundCore auth/households/roles:** strict household tenant isolation and role-based view/add/update/manage policies; test a real deployed stack.
6. **Offline/native:** caching, capture queue, conflict handling, camera/UPC and printer adapters, multi-device tests.
7. **Workspaces and integrations:** Pantry/MealPlanner, Garden, Crafts, selling, Digital, RV/cabin workflows, private Presents.
8. **Cutover:** staged data migration, dual-read/verification where feasible, restore test, stable QR redirect, documented rollback, explicit decision to retire HA.

## Risks to plan for

Legacy URL short links may assume `?box=N`; provide migration redirects or a lookup mapping so printed labels remain useful. Existing HA data uses a single installation's database and may lack multi-tenant ownership columns; migration must assign records to an explicit household via a reviewed procedure. Images, metadata and quantity placements require integrity validation. SQL migrations, build conditions and resource constraints need hands-on evaluation before implementing.

## Definition of migration success

Old and new UI agree on item/box counts and locations; printed QR resolves appropriately; no gifts/private items are leaked; role isolation passes; offline operations reconcile without double counting; old data can be restored; app functions independently of HA when GroundCore stack is available.
