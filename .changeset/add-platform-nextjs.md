---
"@fluojs/platform-nextjs": minor
---

Add a decorator-first Next.js platform for `FluoFactory.create()`, supporting
App Router Route Handlers and streaming Pages Router API Routes with packaged
Turbopack decorator compiler configuration.

`createNextAppRouterHandler()` returns one method-keyed handler record
(`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`) that route modules
destructure directly into named App Router exports.
