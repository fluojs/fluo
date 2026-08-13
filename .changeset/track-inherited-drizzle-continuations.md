---
'@fluojs/drizzle': patch
---

Track transaction boundaries started by inherited async continuations after their original Drizzle owner settles, so they use a fresh root and drain before database disposal.
