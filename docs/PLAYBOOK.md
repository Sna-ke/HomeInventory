# BoxTrack — Build Playbook

Adapted to the GroundCore docs/ pattern. One small, demonstrable slice per step; proposals need review before contracts or code are locked.

## Ground rules

1. **Spec-first:** versioned OpenAPI contracts govern endpoints, schemas and generated client types. Stop when the spec is missing; do not fabricate types.
2. **Test-first:** describe behavior -> failing tests -> implementation -> refactor -> CI and real-stack verification. Do not rewrite accepted tests to make code pass without approval.
3. **Human-readable code:** prefer clear modules and comments over clever abstractions or premature optimization.
4. **Platform boundary:** GroundCore owns reusable identity/household/permissions; BoxTrack owns inventory domain rules. An app never becomes a platform dependency.
5. **Migration:** existing HA app continues working until an explicitly tested replacement cutover. Maintain parity where possible.
6. **Documentation:** update DESIGN, DECISIONS, STATUS, requirements, tests and API spec in the same PR as behavior.
7. **Security:** do not use real household or gift data in samples, screenshots, prompts or fixture files.
8. **PRs:** each step has its own branch/PR and checkpoint evidence; ChatGPT work uses squash-and-merge consistent with GroundCore playbook. End PR descriptions with `Merge: squash and merge`.

## Phases

| Phase | Focus | Done when |
| --- | --- | --- |
| 0 | Inventory current code, SQL migrations and routes | Verified compatibility matrix and regression fixtures |
| 1 | Preserve HA backend; introduce modular Vue UI foundation | New find/box/packing/label slice operates alongside old UI and passes tests |
| 2 | Normalize locations, shelf QR and activity | Scans in both orders, multi-box placement, last-confirmed timestamps and audit tests |
| 3 | Stabilize inventory service domain and OpenAPI | Item/stock/location/activity APIs and idempotency/role contract tests |
| 4 | GroundCore household integration | Role/tenant boundaries tested against live platform; no bypass through legacy routes |
| 5 | Offline clients and native device integration | iOS/Android/tablet scanning, local queue, sync conflicts and B1 printing tested |
| 6 | Pantry + MealPlanner transformations | Batch accounting, leftovers, spoilage and consumption integration verified |
| 7 | Crafts, Garden, Make & Sell and optional workspaces | Transformations and workspace manifests with per-module tests |
| 8 | Presents + Digital + POS and hardening | Gift privacy adversarial tests, secure offline behavior, transaction reconciliation |
| 9 | HA retirement | Export/migration parity verified; separately approved deprecation and rollback plan |

These phases suggest dependency order, not committed release dates. Presents needs a privacy proof before release; can be developed earlier on an isolated branch.

## Working cycle for a step

- Check current docs/STATUS.md, docs/DESIGN.md, docs/DECISIONS.md, relevant contracts and GroundCore compatibility.
- Define acceptance tests, edge cases, rollback and any new API permissions.
- Checkpoint A: agree on behavior/tests. Checkpoint B: review implementation/architecture. Checkpoint C: show CI, security tests, production-style build and running UI/device evidence.
- Capture outstanding issues in GitHub; keep docs up to date, then request merge.

## First proposed engineering slice

Use existing Flask endpoints behind adapters if possible. Build responsive Vue routes for Universal Find, Location/Box detail, Quick Pack, and Label Preview. Preserve existing stored data and endpoint behavior. Add real API fixtures, not a fabricated second data model. A next slice can address shelf QR and event history. **Do not** silently replace the current HA interface.
