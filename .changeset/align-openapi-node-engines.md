---
"@fluojs/openapi": major
---

Declare the package-owned Node.js support range `>=24.0.0 <27` for `@fluojs/openapi` in the upcoming coordinated release. The portable `@fluojs/runtime` package no longer supplies a transitive Node engine requirement. The package API and runtime behavior are unchanged by this engine metadata alignment.

Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.
