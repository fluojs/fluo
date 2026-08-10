---
'@fluojs/microservices': patch
---

Share concurrent TCP transport shutdown through one close promise so listener and socket cleanup runs once.
