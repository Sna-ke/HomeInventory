# BoxTrack — Product & System Design

Updated 2026-11-24. **Design direction**, not an assertion that all features are implemented.

## Product

BoxTrack answers *what do I have, where is it, what changed, and what can I do with it?* The app should be fast to use while packing or shopping: scan or photograph now; organize later. It is **not a statistics dashboard**. The app has universal search and configurable entry-point workspaces, all reading the same inventory engine.

## Workspaces

Optional views: Storage, Pantry & Food, Belongings, Crafts & Hobbies, Make & Sell, Garden, Camping/RV, Digital, and **Presents** (privacy-sensitive). Additional workspaces can be registered without creating another inventory database. A second home/cabin is primarily a distinct property/location tree, not by default another workspace. Hiding/disabling a workspace does **not** grant or revoke access to records.

## GroundCore boundary

GroundCore owns account login, groups/households, people/profiles, household memberships, roles, consent, sessions, authorization infrastructure and shared API conventions. BoxTrack owns its inventory records, capability rules, physical locations, activity, labels, gift privacy policy and domain authorization decisions. Ordinary inventory is **household-owned**; members receive role-based permissions to view/add/update/manage it. The Presents workspace is an explicit exception with private or selectively shared records; see [PRESENTS.md](PRESENTS.md).

App data remains in the BoxTrack service's store. The platform never depends on BoxTrack, and BoxTrack does not read another app's tables. Cross-app access is through authorized APIs/events, with explicitly defined scopes and allowed app relationships.

## Domain model

- **Catalogue definition:** what an item/product is; optional UPC/EAN/GTIN, name, imagery, category and capabilities.
- **Stock/asset instance:** quantity and unit, or individually identifiable asset; batch, purchase metadata, serial, expiry, warranties and provenance as applicable.
- **Location/container:** recursive physical hierarchy: property > room/locker > shelf unit > shelf > bin/box, with optional free-text placement. A location may have a permanent QR identity.
- **Activity:** acquisition, placement, scanning, digital open/view, physical confirmation, move, adjustment, consumption, spoilage, gift, loan, sale, return and disposal. These are distinct event types with distinct meaning.
- **Transformation:** recorded inputs -> outputs/byproducts/waste. Ingredients -> cooked meal -> leftovers -> ingredient; filament -> printed object; plants -> harvest; flour -> baked goods. Preserve lineage and quantity units.
- **Allocation:** a batch may be available for household use or earmarked for sale without duplicating the underlying stock.
- **Capabilities:** independent flags such as locatable, stockable, perishable, transformable, sellable, lendable, warrantable, renewable, serializable and traceable. Capabilities drive applicable fields and actions, not unchecked arbitrary frontend code.
- **Visibility:** household defaults, plus restricted classes including private gift records.

A product record is **not** always one physical unit. A drill is typically an individually identifiable asset; rice may be a measured stock quantity split into lots; a digital licence is an entitlement.

## Ownership, authorization and isolation

Every regular inventory record belongs to a household (tenant/group ID). Household permissions distinguish read, add, edit, move, manage and destructive operations; enforce them on the server. User-specific inventory ACLs are not the default. Private gifts use an additional allowlist/policy and must be excluded from global search, autocomplete, counts, activity, exports, notifications, AI prompts, shared caches and QR responses for unauthorized viewers.

## Data-driven application

A workspace is a registered view: query/filter, navigation, field groups, actions, and optional domain-specific workflow. Item capability schemas select visible fields and actions. Rules govern bridge actions between views; most "bridges" are changes to location, allocation, custody or state, not movement between separate inventory stores. Backend services validate every transition, permissions and transactional stock update.

## Migration principle

Keep the Home Assistant deployment working while extracting reusable service and Vue UI pieces in tested slices. Target: standalone responsive web plus iOS/Android/tablet clients with offline cache; the app **will not depend on Home Assistant in production**. Current endpoints and SQL are a source for migration mapping, not the final API contract.

References: [MIGRATION.md](MIGRATION.md), [SCANNING-LABELS.md](SCANNING-LABELS.md), [OFFLINE.md](OFFLINE.md).
