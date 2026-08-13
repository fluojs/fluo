---
'@fluojs/cqrs': patch
---

Serialize nested different-event saga continuations for the same singleton provider token without concurrent `handle(...)` entry or publish deadlocks, while preserving cycle and depth protections.
