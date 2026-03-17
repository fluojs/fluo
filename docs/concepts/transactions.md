# transactions

<p><strong><kbd>English</kbd></strong> <a href="./transactions.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current transaction semantics across the runtime and official ORM integrations.

See also:

- `../../packages/prisma/README.md`
- `../../packages/drizzle/README.md`
- `./http-runtime.md`

## default rule

- the recommended transaction boundary belongs to the service layer
- automatic request transaction is opt-in interceptor integration only
- global implicit transactions are not the default

## repository and service boundary

- services may open `transaction(...)`
- repositories do not start transactions
- repositories resolve the current transaction-aware handle exposed by the integration package
- generated repositories follow the same rule

## propagation stance

The current default is closest to `required` propagation:

- start a transaction if none exists
- join the active one if one already exists

Not part of the current default contract:

- `requires_new`
- savepoints
- distributed transactions

## request-scoped transaction path

- request-scoped transaction behavior is interceptor-owned
- it starts after guard success at the interceptor boundary
- transaction handle resolution remains package/integration specific
- auth deny is a non-start path rather than a rollback path

## commit and rollback timing

- commit happens after the wrapped request path succeeds
- rollback covers controller/interceptor failure, binding/validation failure, and request abort before commit
- aborted requests must not leave transactions open

## streaming and long-lived responses

- automatic request transactions are not the default for streaming, file, or long-lived responses
- explicit non-transactional handling is preferred there

## testing implications

- unit tests should not require transaction interceptors
- integration tests should explicitly cover propagation, join, rollback, and adapter interaction paths
