---
"@fluojs/prisma": patch
---

Document the public `PRISMA_OPTIONS` runtime option shape as `{ strictTransactions: boolean; rollbackObserver?: TransactionRollbackObserver }` in the Prisma package README (EN/KO) and the docs package guide. A registered rollback observer is exposed by reference and the key is omitted when no observer is registered, including through `getPrismaOptionsToken(name?)` named registrations. Add Vitest regressions that resolve the default and named options tokens through `forRoot`/`forRootAsync`, verify observer reference identity, own-key omission, the limited public own-key set, explicit `strictTransactions` preservation, and per-registration observer isolation.
