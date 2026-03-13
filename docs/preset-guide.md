# preset guide

This guide keeps public docs aligned with the current ORM x DB support matrix.

## tier meanings

- `recommended` — the default path the project wants most users to start with
- `official` — supported and documented, but not always the primary default
- `preview` — core support exists, but docs/examples/test depth is narrower

## current matrix

| Preset | Tier | Notes |
| --- | --- | --- |
| `Prisma + PostgreSQL` | recommended / official | default onboarding path |
| `Prisma + MySQL` | official | same runtime model, not the default recommendation |
| `Drizzle + PostgreSQL` | official | official stack with narrower docs/examples than the default path |
| `Drizzle + MySQL` | preview | template path exists, but end-to-end verification is intentionally narrower than the default path |

## CLI behavior

`konekti new` prints a tier note before dependency installation starts. `@konekti/cli` uses generated project package metadata to infer the selected preset for commands like `konekti g repo User`.

## generated repo behavior

- Prisma presets generate repositories that resolve `this.prisma.current()`
- Drizzle presets generate repositories that resolve `this.database.current()`
- generic generation stays available for non-scaffolded or mixed project layouts
