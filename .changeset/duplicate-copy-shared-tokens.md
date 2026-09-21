---
'@fluojs/runtime': patch
'@fluojs/redis': patch
'@fluojs/queue': patch
'@fluojs/config': patch
'@fluojs/http': patch
---

Stabilize framework-owned shared symbol identities across compatible same-realm duplicate package copies. Redis and Queue now preserve application- and scope-owned duplicate registration checks across copies before external clients or workers start.
