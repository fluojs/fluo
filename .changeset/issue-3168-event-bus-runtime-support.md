---
"@fluojs/event-bus": major
---

Align event-bus handler discovery with normalized effective provider registrations and declare its package-owned Node.js support range `>=24.0.0 <27`; portable `@fluojs/runtime` no longer declares a package-wide Node engine. Duplicate losing providers are no longer discovered, and factory-provider scope follows canonical DI normalization.

Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Handler, module visibility, and publish failure-isolation APIs otherwise remain unchanged.
