---
'@fluojs/cli': patch
---

Ensure `fluo typegen --watch` waits for caller-process generation bootstrap and application cleanup,
as well as owned generation-child cancellation, before watch exit or stale artifact publication.
