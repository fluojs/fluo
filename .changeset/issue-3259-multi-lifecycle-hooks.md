---
"@fluojs/runtime": patch
---

Run lifecycle hooks for every eligible singleton `multi: true` provider contribution in provider order, with reverse contribution order during shutdown and bootstrap rollback.
