---
"@fluojs/drizzle": patch
---

Keep nested request transactions linked to ambient request abort signals and report completed nested request callbacks as inactive even while an outer manual transaction continues.
