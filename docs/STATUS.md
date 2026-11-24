# BoxTrack — Status

Updated 2026-11-24. Documentation planning branch: `docs/boxtrack-groundcore-transition`.

## Current implementation (reviewed repository layout)

- Home Assistant add-on under `box-inventory-tracker/`, with Python Flask routes, MariaDB, a large server-rendered `app/templates/index.html`, static CSS and JavaScript.
- Implemented routes/modules include boxes, rooms, items, categories, dashboard, images, wizard, lockers, metadata, vision, imports, export/reset.
- Existing capabilities include box numbering, room and loose-item placement, QR label preview/print, search, quick packing, images, item purchase/warranty metadata and storage locker records.
- `app/static/js/labels.js` already has Niimbot B1 sizes (`50x30`, `40x30`, `40x40`, `50x50`, `40x60`, `40x70`, `50x70`, `50x80`), portrait/landscape layout and QR generation.
- Current QR base resolution includes HA ingress/direct URL assumptions; the standalone design must replace this with secure, stable routes.
- The current application is **not** confirmed to support GroundCore auth, offline local database/sync, full nested shelf QR placement, Presents, adaptive workspaces, or a standalone native app.

## This documentation change

Create a GroundCore-style docs/ entry point with design, decisions, playbook, requirements, UX, migration, integrations, offline, scanning, and Presents threat model. **Documentation only: no application logic, database or existing deployment changed.**

## Next

1. Review the documented requirements and especially the Presents security boundary.
2. Run a full code/API/schema inventory; capture current database schema and actual behavior with regression tests.
3. Define versioned BoxTrack OpenAPI contract and migration/compatibility mapping.
4. Design the first task-first Vue slice (find -> box -> add photo/UPC -> label), feature-flagged alongside HA UI.
5. Add shelf/location scan pair, activity trail, and offline queue tests before implementation.
6. Integrate GroundCore household roles and ensure legacy Home Assistant permissions do not leak across tenants.
7. Pilot native packaging, camera and B1 printing with real devices, then roll out additional workspaces.

## Verification

GroundCore documentation layout inspected; existing HomeInventory route/module and label code inspected. **No CI, physical device, migration or security tests have been run for this docs-only branch.** Future PRs must report test evidence and unresolved gaps.
