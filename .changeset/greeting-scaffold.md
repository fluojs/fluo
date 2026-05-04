---
"@fluojs/cli": minor
---

Replace the generated starter-owned `src/health/*` example slice and `/health-info` route with a `src/greeting/*` feature slice exposed at `/greeting`. Runtime operational health remains owned by `HealthModule.forRoot(...)`, so new projects should treat `/health` and `/ready` as runtime endpoints and use the greeting slice as the starter application-structure example.
