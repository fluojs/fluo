# transactions

<p><strong><kbd>English</kbd></strong> <a href="./transactions.ko.md"><kbd>한국어</kbd></a></p>

This guide outlines the transaction semantics used across the runtime and official ORM integrations, especially `@konekti/prisma` and `@konekti/drizzle`.

### related documentation

- `../../packages/prisma/README.md`
- `../../packages/drizzle/README.md`
- `./http-runtime.md`

## standard principles

- **Service Layer Ownership**: The service layer is the recommended location for defining transaction boundaries.
- **Opt-in Transactions**: Automatic request-level transactions are available only via interceptor integration.
- **Explicit over Implicit**: Global, implicit transactions are not enabled by default.

## repository and service boundaries

- **Services**: Responsible for opening and managing transactions.
- **Repositories**: Should not initiate transactions. They resolve transaction-aware handles provided by the integration package.
- **Generated Code**: Follows these same boundary rules.

## transaction propagation

The default behavior follows a "REQUIRED" propagation model:

- Start a new transaction if one does not already exist.
- Join the active transaction if one is already present.

The following propagation types are currently not supported as standard defaults:
- `REQUIRES_NEW`
- Savepoints
- Distributed transactions

## request-scoped transactions

- Managed via interceptors.
- Begins at the interceptor boundary, after successful guard execution.
- Transaction handles are resolved in a package-specific manner.
- Authentication failures prevent the transaction from starting, avoiding unnecessary rollback logic.
- Prisma integration (`requestTransaction`) is abort-aware and retries once without transaction `signal` options when a driver rejects them.
- Drizzle integration (`requestTransaction`) is abort-aware and falls back to direct abort-aware execution when the wrapped handle lacks a `transaction` runner (unless strict mode is enabled).

## commit and rollback

- **Commit**: Occurs after the wrapped request path finishes successfully.
- **Rollback**: Triggered by controller or interceptor failures, validation errors, or request abortions before completion.
- **Clean-up**: Aborted requests must not leave orphaned transactions.
- **Shutdown safety**: Prisma and Drizzle integrations abort active request transactions and wait for settlement during application shutdown before disconnect/dispose cleanup proceeds.

## streaming and long-lived requests

- Automatic request-level transactions are not recommended for streaming or long-lived responses.
- Use explicit, non-transactional handling for these scenarios to avoid resource exhaustion.

## testing

- **Unit Tests**: Should be designed to run without transaction interceptors.
- **Integration Tests**: Must explicitly verify propagation, joining, and rollback behavior.
