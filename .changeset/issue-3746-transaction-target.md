---
"@fluojs/core": patch
"@fluojs/prisma": patch
"@fluojs/drizzle": patch
"@fluojs/mongoose": patch
---

Unify transaction boundary errors through `@fluojs/core`, so `AfterCommitError`,
`AfterCommitCapabilityError`, and Result rollback errors retain one runtime identity
when imported from any ORM package. Driver-specific rollback observers and Mongoose
session-cleanup errors remain package-owned.

Prisma now supports the canonical explicit-target form
`@Transaction((self) => self.prisma, nativeOptions, boundary)`. Prisma and Drizzle
normal usage should select the wrapper first, then pass driver-native options, then
the Fluo boundary policy; Mongoose uses
`@Transaction((self) => self.conn, boundary)` because it has no decorator-native
options. Existing no-argument discovery remains only as legacy single-target
compatibility. Migrate it to an accessor before registering another database or ORM
to prevent selecting the wrong transaction owner.
