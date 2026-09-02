---
"@fluojs/cli": patch
---

Fail `fluo dev` with terminal cleanup and exit code `1` when the required source target is missing or becomes inaccessible before watcher registration, or recursive watching is unavailable and fallback traversal cannot establish required source coverage, including total acquisition failure, partial acquisition after sibling watchers succeed, and a directory discovered while fallback watching is active.
