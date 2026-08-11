---
'@fluojs/prisma': patch
---

Serialize overlapping Prisma connect and shutdown transitions so a late `$connect()` completion cannot restore readiness or transaction admission, and `$disconnect()` waits for the connect attempt to settle.
