---
'@fluojs/drizzle': patch
---

Release the rollback observation scope when a directly connected client's `BEGIN` rejects, so the next independent transaction reuses the same client without a manual release, `ROLLBACK`, or observer recreation. Overlapped `BEGIN` calls from other observation scopes stay rejected while the first is pending, and a rejected `BEGIN` never counts as rollback confirmation.
