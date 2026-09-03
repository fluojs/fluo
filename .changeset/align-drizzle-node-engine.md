---
"@fluojs/drizzle": major
---

**Breaking change:** `@fluojs/drizzle` supports Node.js `>=20.19.3 <21 || >=22.2.0 <27` to match its mandatory `@fluojs/runtime` dependency. Node 21 and Node 27+ are unsupported.

Migration: Move Node 20 deployments to `>=20.19.3` or Node 22 deployments to `>=22.2.0` before updating. Run the application's driver-specific Drizzle query and migration tests after the runtime upgrade.
