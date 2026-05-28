---
"@fluojs/passport": patch
"@fluojs/prisma": patch
---

Redact sensitive refresh-token backing store diagnostics in passport status surfaces and remove Prisma's static Node async-hooks import while preserving transaction context behavior.
