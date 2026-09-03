---
"@fluojs/cli": patch
"@fluojs/runtime": patch
---

Resolve `@fluojs/runtime` from the inspected project's dependency tree at the `inspect` command boundary, preflight its availability before importing the application module, and preserve command-scoped missing-runtime guidance across the CLI's documented Node.js `>=20.0.0` range.
