---
"@fluojs/testing": patch
---

Keep Vitest mock-only declaration types on the `@fluojs/testing/mock` boundary so non-mock testing entrypoints do not pull Vitest peer types through shared declarations.
