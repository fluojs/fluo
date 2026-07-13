# fluo Decision Guide

<p><strong><kbd>English</kbd></strong> <a href="./decision-guide.ko.md"><kbd>한국어</kbd></a></p>

## Platform Adapter Selection

| condition | decision | package |
| --- | --- | --- |
| Default Node.js HTTP application | Use the recommended high-performance Node.js adapter | `@fluojs/platform-fastify` |
| Node.js application needs direct control over the HTTP listener | Use the bare Node adapter | `@fluojs/platform-nodejs` |
| Node.js application must use Express as the host/platform HTTP engine while application middleware stays on the fluo `Middleware` contract and migration-only native handlers use an explicit pre-router seam | Use the Express adapter and its `nativeMiddleware` option only at the platform boundary | `@fluojs/platform-express` |
| Bun-native fetch-style runtime target | Use the Bun adapter | `@fluojs/platform-bun` |
| Deno `serve()` runtime target | Use the Deno adapter | `@fluojs/platform-deno` |
| Cloudflare Workers isolate target | Use the Workers adapter | `@fluojs/platform-cloudflare-workers` |

## Database Adapter Selection

| condition | decision | package |
| --- | --- | --- |
| Relational database with Prisma workflow and ORM lifecycle integration | Use the Prisma adapter | `@fluojs/prisma` |
| Relational database with Drizzle workflow and ALS-backed transaction context | Use the Drizzle adapter | `@fluojs/drizzle` |
| Document database with Mongoose models | Use the Mongoose adapter | `@fluojs/mongoose` |
| Shared Redis service or named Redis clients are required | Use the Redis package | `@fluojs/redis` |
| Cache abstraction is needed on top of application data access | Use the cache manager package | `@fluojs/cache-manager` |

## Transport Selection

| condition | decision | command or package |
| --- | --- | --- |
| Runnable microservice starter with the default transport | Select TCP | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` |
| Message stream transport backed by Redis Streams | Select Redis Streams | `fluo new my-service --shape microservice --transport redis-streams --runtime node --platform none` |
| NATS-based microservice topology | Select NATS | `fluo new my-service --shape microservice --transport nats --runtime node --platform none` |
| Kafka-based event transport | Select Kafka | `fluo new my-service --shape microservice --transport kafka --runtime node --platform none` |
| RabbitMQ queue topology | Select RabbitMQ | `fluo new my-service --shape microservice --transport rabbitmq --runtime node --platform none` |
| MQTT broker integration | Select MQTT | `fluo new my-service --shape microservice --transport mqtt --runtime node --platform none` |
| gRPC service contract | Select gRPC | `fluo new my-service --shape microservice --transport grpc --runtime node --platform none` |

## Package Stability Tier

| condition | decision | contract signal |
| --- | --- | --- |
| Package appears in the canonical runtime matrix or generated-app baseline, and the package surface describes a settled responsibility | Treat as Official | Backed by `docs/reference/package-surface.md` or `docs/reference/toolchain-contract-matrix.md` |
| Package is first-party and documented in package chooser or package surface, but it is not part of the starter baseline or canonical runtime matrix | Treat as Preview | Usable, but selection depends on narrower task-specific guidance |
| Package or integration lacks documented package-surface ownership, runtime matrix presence, or release-governance expectation | Treat as Experimental | Do not assume stable contracts without explicit documentation |
