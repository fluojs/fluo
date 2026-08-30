---
"@fluojs/cli": patch
---

Fail `fluo dev` with terminal cleanup and exit code `1` when recursive watching is unavailable and required fallback source watcher acquisition fails totally, partially after sibling watchers succeed, or for a directory discovered while fallback watching is active.
