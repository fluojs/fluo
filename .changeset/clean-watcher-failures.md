---
"@fluojs/cli": patch
---

Route primary and fallback development watcher errors through the restart runner's bounded terminal cleanup so app children and sibling watchers are not left running.
