---
'@fluojs/di': patch
---

Dispose cached single and multi-provider instances together in reverse materialization order so dependents shut down before their dependencies.
