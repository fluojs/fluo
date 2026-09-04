---
"@fluojs/drizzle": major
---

**Breaking change:** `@fluojs/drizzle` supports Node.js `>=20.19.3 <21 || >=22.2.0 <27` to match its mandatory `@fluojs/runtime` dependency. Node 21 and Node 27+ are unsupported.

Migration: Node.js 20.0.0 support is removed. Move to Node.js `>=20.19.3 <21` or Node.js `>=22.2.0 <27` before updating; Node.js 21 and Node.js 27+ remain unsupported. Run the application's driver-specific Drizzle query and migration tests after the runtime upgrade.
