# support matrix

<p><strong><kbd>English</kbd></strong> <a href="./support-matrix.ko.md"><kbd>한국어</kbd></a></p>

This file is the compact reference table for current support policy.

## support tiers

- `official` -> supported and actively validated
- `preview` -> intentionally available, but not yet held to full parity/coverage
- `experimental` -> available for exploration, not a stable support promise

## ORM x DB matrix

| ORM | DB | Tier | Note |
| --- | --- | --- | --- |
| Prisma | PostgreSQL | official / recommended | callback-style request transaction interceptor supported; nested/savepoint semantics are not guaranteed |
| Prisma | MySQL | official | callback-style request transaction interceptor supported; nested/savepoint semantics are not guaranteed |
| Drizzle | PostgreSQL | official | callback-style request transaction interceptor supported; nested/savepoint semantics depend on driver/database capability |
| Drizzle | MySQL | preview | narrower docs/examples/test coverage expected; nested/savepoint semantics are not guaranteed |

## runtime matrix

| Runtime | Tier | Note |
| --- | --- | --- |
| Node.js | official | first official runtime |
| Fastify adapter | preview | `@konekti/platform-fastify` adapter with Node-runtime option parity for host/HTTPS/CORS/multipart/rawBody; WebSocket gateways are also validated through the shared Node `upgrade` listener exposed by `getServer()` |
| Socket.IO adapter | preview | `@konekti/platform-socket.io` adds Socket.IO v4 namespace and room wiring on the shared Node HTTP server while reusing `@konekti/websocket` gateway decorators and metadata |
| GraphQL subscriptions (SSE) | official | available at `/graphql` through GraphQL Yoga server-sent events |
| GraphQL subscriptions (`graphql-ws`) | preview | opt-in via `createGraphqlModule({ subscriptions: { websocket: { enabled: true } } })` on the shared Node HTTP adapter |
| Microservices transport | preview | `@konekti/microservices` with TCP, Redis Pub/Sub, Kafka (request/reply + event), NATS, and RabbitMQ (event-only) transport adapters plus `KonektiFactory.createMicroservice()`; promotion is evaluated per transport and requires transport-specific docs, tests, CI, example coverage, and troubleshooting guidance |
| Bun | preview | core contracts should remain promotable to this runtime |
| Fetch-style adapter | preview | adapter may exist with narrower guarantees |
| Deno | experimental | later candidate only |

## promotion gate summary

Promotion requires all of the following together:

- docs
- tests
- CI
- example coverage
- troubleshooting guidance

## current boundary

- the current official matrix is limited to the combinations listed above
- no additional ORM x DB combinations are promoted today
- no additional public data-integration packages are promised today
- out-of-matrix candidates should stay issue-driven until they satisfy the same promotion gate

## transaction support notes

- request-scoped automatic transactions are opt-in interceptor integrations, not the default service policy
- streaming/file/SSE/long-lived response paths should be treated as non-transactional unless a stack-specific guide says otherwise
- request abort rollback depends on the active adapter wiring `FrameworkRequest.signal`
- nested/savepoint / `requires_new` semantics are not part of the current official guarantee

## related docs

- `./package-surface.md`
- `./toolchain-contract-matrix.md`
- `../concepts/transactions.md`
- `../operations/release-governance.md`
