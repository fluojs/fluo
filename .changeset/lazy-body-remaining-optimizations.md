---
"@fluojs/runtime": patch
---

Memoize request body and raw body parsing per request, and optimize module-graph transitive token computation.

- Request body and raw body parsing is now memoized per request; the body is parsed once during request creation and subsequent accesses return the same parsed result without re-parsing.
- Module-graph validation now caches transitive exported token closures, reducing repeated computations for modules with shared imports.