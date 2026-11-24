# BoxTrack documentation

BoxTrack is the next evolution of the HomeInventory / Box Inventory Tracker repository. The application **continues to run as a Home Assistant app during the transition**. The target is a standalone web and native mobile app using GroundCore for identity, household, roles and sharing. The present Flask/MariaDB implementation is the migration source, not something to discard abruptly.

## Start here

| File | Purpose |
| --- | --- |
| [DESIGN.md](DESIGN.md) | Current architectural direction, data model and boundaries |
| [DECISIONS.md](DECISIONS.md) | Decisions, rationale, and clearly marked proposals |
| [STATUS.md](STATUS.md) | What exists, next work, risks, and verification |
| [PLAYBOOK.md](PLAYBOOK.md) | GroundCore-style, test-first implementation sequence and checkpoints |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Functional and nonfunctional requirements |
| [UX.md](UX.md) | Task-first responsive UI and adaptive item presentation |
| [SCANNING-LABELS.md](SCANNING-LABELS.md) | UPC/QR workflows, Niimbot B1, shelf labels and audits |
| [OFFLINE.md](OFFLINE.md) | Offline-first native/mobile sync and conflict rules |
| [INTEGRATIONS.md](INTEGRATIONS.md) | MealPlanner, Square, workspaces and transformations |
| [PRESENTS.md](PRESENTS.md) | Gift lifecycle, confidential visibility and audience rules |
| [MIGRATION.md](MIGRATION.md) | From the existing HA app toward GroundCore |

## Documentation rules

- A **decision** is a confirmed direction. An **open proposal** must not be implemented as settled policy without review.
- API shapes are governed by a separately versioned OpenAPI specification when introduced; do not invent fields in clients.
- Update DESIGN, DECISIONS, STATUS, and relevant specs/tests in the same PR as a behavioral change.
- Keep readable code, test-first changes, migration safety, and regular working slices.
- Don't put credentials, real household details, private gift information or test data from production into documentation.
- See [GroundCore docs](https://github.com/Sna-ke/GroundCore/tree/main/docs) for cross-app identity/security conventions.
