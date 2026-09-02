---
"@fluojs/cli": patch
---

Fail `fluo dev` with terminal cleanup and exit code `1` when an initially discovered source target disappears before watcher registration, or recursive watching is unavailable and fallback traversal cannot establish required source coverage, including total acquisition failure, partial acquisition after sibling watchers succeed, and a directory discovered while fallback watching is active.
