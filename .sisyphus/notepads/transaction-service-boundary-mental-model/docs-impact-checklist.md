# Transaction Service Boundary Docs Impact Checklist

This document maps the documentation updates required for the new `@Transaction()` service-boundary mental model.

## Primary Path Changes
These documents currently teach `current()`/`currentSession()` or Interceptors as the main way to handle transactions. They must be updated to lead with `@Transaction()` on Services.

| Doc (EN) | Doc (KO) | Change Description |
| :--- | :--- | :--- |
| `docs/architecture/transactions.md` | `docs/architecture/transactions.ko.md` | Lead with `@Transaction()` as the primary boundary. Update "Context Resolution Rules" to emphasize Service -> Repository flow without manual `current()` calls in repositories. |
| `packages/prisma/README.md` | `packages/prisma/README.ko.md` | Update "Common Patterns" to lead with `@Transaction()`. Move `PrismaService.current()` to advanced section for cases where explicit root/tx choice is needed. |
| `packages/drizzle/README.md` | `packages/drizzle/README.ko.md` | Update "Common Patterns" to lead with `@Transaction()`. Move `DrizzleDatabase.current()` to advanced. |
| `packages/mongoose/README.md` | `packages/mongoose/README.ko.md` | **CRITICAL**: lead with `@Transaction()`. Remove requirement for explicit session passing in repositories when inside `@Transaction()`. |
| `book/beginner/ch13-transactions.md` | `book/beginner/ch13-transactions.ko.md` | Rewrite chapter flow to teach `@Transaction()` first. Use `current()`-less repositories in examples. |
| `book/beginner/ch12-prisma.md` | `book/beginner/ch12-prisma.ko.md` | Update examples to use `@Transaction()` on services instead of Interceptors or manual `transaction()` calls. |
| `book/intermediate/ch19-mongoose.md` | `book/intermediate/ch19-mongoose.ko.md` | Lead with Service-level transactions. Demonstrate that sessions are now managed automatically. |
| `book/intermediate/ch20-drizzle.md` | `book/intermediate/ch20-drizzle.ko.md` | Lead with Service-level transactions. |

## Compatibility/Advanced Path
These patterns are NOT being deleted but must be moved to "Advanced" or "Compatibility" sections to avoid confusing new users.

| Doc (EN) | Doc (KO) | Item to Move |
| :--- | :--- | :--- |
| `docs/architecture/transactions.md` | `docs/architecture/transactions.ko.md` | Interceptors and `requestTransaction()` boundary semantics. |
| `packages/prisma/README.md` | `packages/prisma/README.ko.md` | `PrismaTransactionInterceptor` and manual `current()` access. |
| `packages/drizzle/README.md` | `packages/drizzle/README.ko.md` | `DrizzleTransactionInterceptor` and manual `current()` access. |
| `packages/mongoose/README.md` | `packages/mongoose/README.ko.md` | `MongooseTransactionInterceptor` and manual `currentSession()` passing. |
| `book/beginner/ch09-guards-interceptors.md` | `book/beginner/ch09-guards-interceptors.ko.md` | Move Transaction Interceptor examples to advanced or "How it works" section. |

## Behavior Contract Changes
Specific behavioral statements that are now incorrect and must be rewritten.

| Doc (EN/KO) | Current Statement (Incorrect) | New Statement (Correct) |
| :--- | :--- | :--- |
| `packages/mongoose/README.md` | "Fluo never rewrites Mongoose operation options." | "Fluo automatically attaches the ambient session to Mongoose operations when inside a `@Transaction()` or `transaction()` boundary." |
| `docs/architecture/transactions.md` | "Mongoose code still passes the session explicitly to model operations even though session lookup is ambient." | "Mongoose operations automatically participate in the ambient transaction session; explicit session passing is only required for advanced cross-connection scenarios." |
| `docs/reference/package-surface.md` | Mention of `current()`/`currentSession()` as "Primary access API" | Update to mention `@Transaction()` as the primary entry point for transaction participation. |

## Verification Checklist
- [ ] `pnpm docs:sync-check` passes after all updates.
- [ ] No mention of "session passing" remains in beginner tutorials.
- [ ] Mongoose "never rewrites options" claim is removed from all localized versions.
