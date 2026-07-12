---
'@fluojs/prisma': patch
'@fluojs/mongoose': patch
---

Restore the deprecated Prisma and Mongoose transaction interceptor exports for 1.x compatibility while keeping service transactions and explicit request boundaries as the preferred migration path.
