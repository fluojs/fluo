---
"@fluojs/config": patch
---

Reduce redundant config snapshot cloning during bootstrap and reloads, optimize multi-source deep merging, and serialize overlapping reload requests so consumers keep isolated snapshots without reload interleaving corrupting the active config state.
