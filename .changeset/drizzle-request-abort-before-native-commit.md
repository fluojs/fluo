---
"@fluojs/drizzle": patch
---

Roll back a native Drizzle request transaction if the request is cancelled while inherited child callbacks settle before commit. This applies even with after-commit hooks or `requireAfterCommit` and preserves cancellation behavior once native commit has started.
