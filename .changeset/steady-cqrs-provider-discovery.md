---
"@fluojs/cqrs": patch
---

Tighten CQRS handler discovery to provider-only registrations and reject command/query dispatch after shutdown starts while clearing preloaded handler caches.
