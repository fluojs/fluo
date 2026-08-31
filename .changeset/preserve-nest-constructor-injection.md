---
"@fluojs/cli": patch
---

Preserve every NestJS constructor dependency when `fluo migrate` converts safe parameter-level `@Inject(...)` usage, and report unsupported constructor shapes without dropping dependencies.
