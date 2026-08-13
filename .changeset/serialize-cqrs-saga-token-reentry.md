---
'@fluojs/cqrs': patch
---

Serialize nested different-event saga continuations, external publications, and awaited delegated-subscriber re-entry on one provider-token FIFO chain without concurrent `handle(...)` entry or publish deadlocks, while preserving cycle and depth protections.
