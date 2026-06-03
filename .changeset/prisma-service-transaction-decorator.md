---
'@fluojs/prisma': minor
---

Add a Prisma service `Transaction` decorator and current-less client delegate facade.

Remove the previously exported `PrismaTransactionInterceptor`; use `@Transaction()` or explicit `requestTransaction()` boundaries instead.
