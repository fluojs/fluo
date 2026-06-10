---
"@fluojs/testing": patch
"@fluojs/runtime": patch
---

Harden `overrideModule()` so testing module replacements preserve authored module identities without mutating source module metadata, add the runtime module replacement compile seam used by testing, and document the testing module, `createTestApp`, Vitest entrypoint, and NestJS migration contracts.
