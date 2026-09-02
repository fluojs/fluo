---
"@fluojs/event-bus": major
---

Align event-bus handler discovery with normalized effective provider registrations and match the package's Node.js support range to its mandatory `@fluojs/runtime` dependency. Duplicate losing providers are no longer discovered, and factory-provider scope follows canonical DI normalization.

Migration: Node.js 21 is no longer supported. Node.js 20.0.0-20.19.2, Node.js 22 before 22.2.0, and Node.js 27 or newer are also no longer supported. Upgrade to Node.js >=20.19.3 <21 or >=22.2.0 <27 before installing this version. Handler, module visibility, and publish failure-isolation APIs otherwise remain unchanged.
