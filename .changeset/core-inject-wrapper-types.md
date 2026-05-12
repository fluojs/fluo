---
"@fluojs/core": patch
"@fluojs/di": patch
---

Fix documented `@Inject(forwardRef(...))` and `@Inject(optional(...))` TypeScript compatibility by sharing wrapper-aware injection token types across core decorators and DI helpers.
