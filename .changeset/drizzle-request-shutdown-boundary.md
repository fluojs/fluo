---
"@fluojs/drizzle": patch
---

Reject late request transactions after Drizzle shutdown begins and preserve request abort errors until the active Drizzle transaction lifecycle settles, so commit/rollback cleanup is not interrupted before the caller sees the abort reason.
