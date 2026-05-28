---
"@fluojs/passport": patch
"@fluojs/prisma": patch
---

Redact sensitive refresh-token backing store diagnostics in passport status surfaces and remove Prisma's static Node async-hooks import while preserving transaction context behavior where host AsyncLocalStorage is available. Prisma now rejects transaction boundaries and reports `transactionContext: 'unavailable'` instead of using a synchronous fallback that can lose context across async boundaries when the host cannot provide AsyncLocalStorage.
