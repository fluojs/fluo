---
"@fluojs/prisma": patch
---

Consolidate Prisma registration under `PrismaModule.forRoot(...)` and `PrismaModule.forRootAsync(...)`, with the module-owned `PrismaService` facade as the single injection path.

**Breaking migration:** `PrismaService.createFacade(...)` and `PrismaTransactionInterceptor` are removed. Register Prisma through `PrismaModule`, inject `PrismaService` (typed as `PrismaServiceFacade<TClient>` where generated delegates are used), and replace interceptor registrations with an application-owned `requestTransaction(...)` boundary that forwards the request `AbortSignal`.
