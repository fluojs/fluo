---
"@fluojs/cli": patch
---

Harden the fluo-owned dev restart runner fallback so platforms without recursive `fs.watch` still restart on nested source-tree changes.
