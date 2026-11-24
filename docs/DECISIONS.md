# BoxTrack — Decisions

Updated 2026-11-24. Record new decisions newest first, including alternatives and affected documents. Distinguish user direction from proposed implementation detail.

## 2026-11-24 — Staged transition and household authorization

| Status | Decision / direction | Why |
| --- | --- | --- |
| **Confirmed** | Keep the existing Home Assistant app operational while gradually implementing the new interface and GroundCore integration | Protect existing users/data and permit iterative acceptance |
| **Confirmed** | Target standalone web, iOS, Android and tablet apps with offline storage; **not** a Home Assistant-only product | Mobile packing, scanning and disconnected locker use |
| **Confirmed** | GroundCore provides household, sharing and roles; ordinary inventory is household-owned | Simpler common inventory authorization than person-owned health records |
| **Confirmed** | Permissions distinguish general viewing, adding and updating | Household collaboration |
| **Confirmed** | Presents is privacy-sensitive, per-user or expressly shared, unlike regular household inventory | Surprises must be protected from recipients and some children |
| **Proposed** | GroundCore integration through versioned client packages and gateway APIs; isolate temporary legacy auth | Consistent platform contracts and incremental migration |

## 2026-11-24 — Inventory and workspaces

| Status | Decision / direction | Why |
| --- | --- | --- |
| **Confirmed** | One inventory engine; opt-in/out workspaces are views | Shared items and extensibility |
| **Confirmed** | UI is driven by item capabilities and contextual task | Different fields for food, gifts, tools, licences |
| **Confirmed** | Shelf/room/locker/bin/box codes can identify locations; scan box then shelf or shelf then boxes | Fast relocations and audits |
| **Confirmed** | Track scanned, digitally opened, last confirmed and moved separately | "Viewed" does not prove physical presence |
| **Confirmed** | Niimbot B1 printer, multiple label sizes and both orientations; readable English summary plus QR | Physical searching without a phone |
| **Confirmed** | Food/craft production uses shared transformations including leftovers and byproducts | One source of truth |
| **Proposed** | Opaque stable QR IDs and short HTTPS deep links | Long-lived labels without HA session or internal address leakage |
| **Proposed** | Server-owned declarative workspace manifests and typed action handlers | Safe extensibility without executing arbitrary rules |

## Pending decisions

- Exact household role matrix, household-member/guardian visibility rules for Presents, explicit sharing behavior and revocation.
- Standalone deployment path, database conversion (MariaDB -> PostgreSQL or interim MariaDB), image storage and migration cutover.
- Native camera/UPC library and supported scanners/printer transport for B1.
- Gift giver attribution: labels such as "Santa" are fiction in the UI; restrictions and disclosures require careful product rules.
- Gift redemption/transfer after delivery: recipient can be given ownership explicitly without leaking the hidden pre-gift record.
- Offline privacy, key protection and sync strategy for private gifts.
- Square catalog/order/inventory mapping and reconciliation direction.
- API contract/spec ownership and build/publish versioning for BoxTrack.

Do not infer that a proposal is approved because it appears in a mockup.
