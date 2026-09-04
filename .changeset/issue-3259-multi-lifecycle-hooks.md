---
"@fluojs/di": minor
"@fluojs/runtime": patch
"@fluojs/testing": patch
---

Add the internal contribution-resolution seam used by framework packages while keeping index-based contribution resolution off the root `Container` API. Run lifecycle hooks for every eligible singleton `multi: true` provider contribution in provider order, with reverse contribution order during shutdown and bootstrap rollback. Make testing-module lifecycle compilation report the canonical DI scope and circular-dependency errors.
