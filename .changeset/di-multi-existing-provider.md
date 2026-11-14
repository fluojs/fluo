---
"@fluojs/di": minor
"@fluojs/runtime": patch
"@fluojs/testing": patch
---

Honor `multi: true` on `useExisting` providers instead of silently treating them as single aliases. Alias contributions preserve registration order, target identity and scope, scope validation, full-set overrides, and indexed internal resolution.

Keep single and multi aliases distinct in runtime module graph cache keys, and preserve target lifetimes when testing modules resolve multi aliases through synchronous `get()`.
