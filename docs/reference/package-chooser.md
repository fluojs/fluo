# package chooser — pick packages by task

<p><strong><kbd>English</kbd></strong> <a href="./package-chooser.ko.md"><kbd>한국어</kbd></a></p>

> Looking for what `fluo new` actually scaffolds today? See the [fluo new support matrix](./fluo-new-support-matrix.md). This chooser covers the broader package ecosystem, not just current starter presets.

## build a new web API (Node.js)

| condition | package choice | notes |
| --- | --- | --- |
| Need the base application stack | `@fluojs/core`, `@fluojs/di`, `@fluojs/runtime` | Start here for any Node.js web API. |
| Need HTTP routing | `@fluojs/http` | Required for controller and route execution. |
| Need GraphQL endpoints | `@fluojs/graphql` | Add on top of the HTTP stack. |
| Need the default Node.js adapter | `@fluojs/platform-fastify` | Recommended starter path for most Node.js 20+ projects; the package declares `engines.node >=20.0.0`. |
| Need Fastify-owned HTTPS/TLS startup | `@fluojs/platform-fastify` | Pass Node.js `https` server options on the adapter/bootstrap startup surface when the process owns TLS directly. If TLS terminates at a load balancer, ingress, or gateway, keep the adapter on plain HTTP behind that boundary. |
| Need Express host compatibility | `@fluojs/platform-express` | Node.js 20+ package with `engines.node >=20.0.0`, also available as a first-class `fluo new` application starter. An Express host swap does not retain NestJS legacy decorator or reflection-metadata behavior, so migrate to TC39 standard decorators and explicit DI/module wiring first. Use fluo `Middleware` for the application pipeline; register migration-only Express/Connect handlers through the adapter's pre-router `nativeMiddleware` option or wrap them behind the portable fluo contract. |
| Need direct Node.js HTTP control | `@fluojs/platform-nodejs` | Also available as a first-class `fluo new` application starter on Node.js. |
| Need request validation | `@fluojs/validation` | Add when DTO binding and validation are required. |
| Need response serialization or output DTO shaping | `@fluojs/serialization` | Add when response DTOs need controlled field exposure, sensitive-field exclusion, synchronous value transforms, or HTTP interceptor-based response-boundary shaping. |
| Need typed configuration access | `@fluojs/config` | Use instead of direct `process.env` access inside packages. |
| Need localization or i18n services | `@fluojs/i18n` | Use for framework-agnostic internationalization module registration, standalone service creation, shared option/error types, `@fluojs/i18n/icu` ICU MessageFormat plural/select support, `@fluojs/i18n/http` HTTP locale helpers and opt-in `Accept-Language` policies, `@fluojs/i18n/adapters` opt-in non-HTTP locale resolution and header policies, `@fluojs/i18n/validation` validation localization, `@fluojs/i18n/loaders/fs` and `@fluojs/i18n/loaders/remote` catalog loading with opt-in remote cache wrappers, and `@fluojs/i18n/typegen` catalog key plus typed translation helper declarations. For NestJS i18n, i18next, next-intl, or request/validation convenience parity decisions, start with the [i18n ecosystem bridge decision record](./i18n-ecosystem-bridges.md). |

## render React pages with stable SSR

| condition | package choice | notes |
| --- | --- | --- |
| Need HTTP-owned React page handlers with Web Streams SSR | `@fluojs/react` + `@fluojs/http` | Use the root `@fluojs/react` package when pages should stay in fluo's existing module/controller pipeline. `@Router(...)` and `@Path(...)` are lexical React facades over HTTP metadata; URL matching, route grammar, DTO-bound path/search params, validation, guards, interceptors, middleware, headers, and request lifecycle remain owned by `@fluojs/http`. This is not a Next.js App Router, TanStack route tree, Angular `Routes[]`, file routing, RSC, Server Functions, or React-owned `routes: []` model. |
| Need hydration assets for stable SSR | `@fluojs/react` or `@fluojs/react/vite` | Pass explicit `bootstrapScripts`, `bootstrapModules`, trusted `bootstrapScriptContent`, `nonce`, `identifierPrefix`, and trusted `assetMap` snapshots directly to `createReactServerEntry(...)`, or use `@fluojs/react/vite` to parse an already-loaded Vite manifest into deterministic CSS, JavaScript bootstrap assets, asset maps, trusted bootstrap data, and diagnostics for the same hydration contract. This stable path does not imply RSC or Server Functions. |
| Need navigation and URL state in hydrated React pages | `@fluojs/react/client` + `@fluojs/http` | Wrap the shared document in `ReactClientRouterProvider` with a request-owned `createReactRouteSnapshot(...)`, then use real-anchor `Link`, `useRouter()`, `usePathname()`, `useParams()`, `useSearchParams()`, `useNavigation()`, or `useRouterState()`. Navigation is same-origin and full-document: server HTTP matching, DTO validation, guards, redirects, and failures remain authoritative. There is no client route table, SPA document swap, data cache, or prefetch contract. |
| Need to prototype RSC with an application-owned renderer/build adapter | `@fluojs/react/experimental/rsc` + `@fluojs/http` | Pin React, React DOM, and the Flight renderer to exactly `19.2.6`; provide explicit client-reference and server-to-client module maps; then return application-encoded Flight payloads through ordinary fluo HTTP handlers. The subpath is unstable, has no built-in renderer/plugin, and does not create a separate router. |
| Need mutation-oriented experimental Server Functions | `@fluojs/react/experimental/rsc` + `@fluojs/http` | Create a signed action registry, mount `invoke(context)` on an explicit guarded `@Post(...)` endpoint, pass exact allowed origins plus an application-owned Web Crypto provider and 32-byte-or-longer secret, and configure platform pre-parse body limits. Arguments remain untrusted; authorization belongs inside actions or surrounding guards. This is not a query loader, data cache, generic mutation convention, or HTTP-dispatch bypass. |
| Need a stable RSC import | unavailable | `@fluojs/react/rsc` remains blocked. Use the experimental path only for prototypes and follow the [React RSC graduation policy](../contracts/react-rsc-graduation.md); it requires renderer/version, manifest/transport, hydration/data-safety, route/navigation, dual-import, docs, and release evidence before a stable subpath can exist. |

## deploy to edge / modern runtimes

| condition | package choice | notes |
| --- | --- | --- |
| Need a Bun runtime adapter | `@fluojs/platform-bun` | Maps to the matching `fluo new` runtime/platform starter path. |
| Need a Deno runtime adapter | `@fluojs/platform-deno` | Maps to the matching `fluo new` runtime/platform starter path. |
| Need a Cloudflare Workers adapter | `@fluojs/platform-cloudflare-workers` | Maps to the matching `fluo new` runtime/platform starter path. |

## configure build tooling

| condition | package choice | notes |
| --- | --- | --- |
| Need Vite to build TypeScript with TC39 standard decorators | `@fluojs/vite` | Use `fluoDecoratorsPlugin()` in `vite.config.ts` to apply Babel's `@babel/plugin-proposal-decorators` transform with `{ version: '2023-11' }` plus `@babel/preset-typescript` while preserving fluo's Vite file-boundary skips for tests, declarations, dependencies, and non-TypeScript files. Keep `vitest.config.ts` on `@fluojs/testing/vitest`; the Vite plugin uses lazy Babel loading only for eligible application files and reports missing Babel peers from the transform hook. |

## build a microservice starter

| condition | package choice | notes |
| --- | --- | --- |
| Need the default microservice starter | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` | TCP is the default transport. |
| Need a Redis Streams starter | `fluo new my-service --shape microservice --transport redis-streams --runtime node --platform none` | Runnable starter preset. |
| Need a NATS starter | `fluo new my-service --shape microservice --transport nats --runtime node --platform none` | Runnable starter preset. |
| Need a Kafka starter | `fluo new my-service --shape microservice --transport kafka --runtime node --platform none` | Runnable starter preset. |
| Need a RabbitMQ starter | `fluo new my-service --shape microservice --transport rabbitmq --runtime node --platform none` | Runnable starter preset. |
| Need an MQTT starter | `fluo new my-service --shape microservice --transport mqtt --runtime node --platform none` | Runnable starter preset. |
| Need a gRPC starter | `fluo new my-service --shape microservice --transport grpc --runtime node --platform none` | Runnable starter preset. |

## add persistence & data access

| condition | package choice | notes |
| --- | --- | --- |
| Need Prisma-based relational access on Node.js | `@fluojs/prisma` | Use for Node.js 20+ Prisma ORM integration. The root wrapper uses host `AsyncLocalStorage` for transaction context and `engines.node >=20.0.0`; runtimes without a compatible ALS boundary should register raw Prisma-compatible handles behind application-owned providers until a runtime-specific transaction-context adapter is documented. |
| Need Drizzle-based relational access on Node.js | `@fluojs/drizzle` | Use for Node.js 20+ Drizzle ORM integration. The root wrapper uses Node's `node:async_hooks` transaction context and `engines.node >=20.0.0`; Drizzle's Bun SQL, Cloudflare D1, and other non-Node drivers are outside the current fluo wrapper until a non-Node context adapter is documented. For those runtimes, register the raw Drizzle driver handle behind runtime-specific fluo providers (`useFactory` or `useValue`) instead of importing this wrapper. |
| Need document database access on Node.js | `@fluojs/mongoose` | Use for Node.js 20+ Mongoose integration. The root wrapper uses Node's `node:async_hooks` transaction context and `engines.node >=20.0.0`; non-Node runtimes should register raw Mongoose-compatible handles behind application-owned providers until a runtime-specific transaction-context adapter is documented. |
| Need cache abstraction | `@fluojs/cache-manager` | Use for cache-backed reads and writes. |
| Need a shared Redis client/service layer | `@fluojs/redis` | Use for default or named Redis registrations. |

Use `@fluojs/redis` when you want one shared default client (`REDIS_CLIENT` / `RedisService`) with optional named clients layered on through `RedisModule.forRoot({ name, ... })`. When app code needs to inject one named binding directly, resolve it with `getRedisClientToken(name)` or `getRedisServiceToken(name)`.

## implement security & auth

| condition | package choice | notes |
| --- | --- | --- |
| Need JWT signing and verification | `@fluojs/jwt` | Use for token issuance, verification, and principal normalization. |
| Need Passport strategy integration | `@fluojs/passport` | Use when bridging Passport-based auth flows. |
| Need request throttling | `@fluojs/throttler` | Use for rate limiting and guard-stage enforcement. |

## realtime & messaging

| condition | package choice | notes |
| --- | --- | --- |
| Need transport-neutral WebSockets | `@fluojs/websockets` | Use for raw WebSocket gateway authoring. |
| Need runtime-specific WebSocket lifecycle services or fetch-style gateway authoring without the root Node.js default | `@fluojs/websockets/node`, `@fluojs/websockets/bun`, `@fluojs/websockets/deno`, or `@fluojs/websockets/cloudflare-workers` | Choose the subpath that matches the runtime boundary; each subpath also exposes the shared gateway decorators and metadata helpers. |
| Need Socket.IO semantics | `@fluojs/socket.io` + `@fluojs/websockets` | Use for Socket.IO-compatible integrations on Node.js 20+ server-backed adapters or the official Bun engine path. Install the websockets companion because Socket.IO gateway authoring reuses `@WebSocketGateway`, `@OnMessage`, and lifecycle decorators from `@fluojs/websockets`; inject `SOCKETIO_SERVER` for native Socket.IO emits/ACK-oriented migration seams. Deno and Workers are unsupported, and Bun requires static CORS shapes with no `@WebSocketGateway({ serverBacked })`. |
| Need in-process domain events with optional cross-process fan-out | `@fluojs/event-bus` + optional `@fluojs/event-bus/redis` and `@fluojs/redis` | Use when one published domain fact should notify multiple local handlers, with Redis Pub/Sub fan-out only when reactions must cross process boundaries. |
| Need message-pattern microservices | `@fluojs/microservices` | Use for transport-driven microservice handlers. |
| Need background jobs | `@fluojs/queue` + `@fluojs/redis` | Queue workers depend on Redis. |
| Need scheduled jobs | `@fluojs/cron` | Use for cron-style scheduling; add `@fluojs/redis` only when enabling distributed locks. |
| Need multi-channel notifications | `@fluojs/notifications` | Shared notification orchestration layer. |
| Need portable email delivery | `@fluojs/email` | Transport-agnostic email core. |
| Need Node.js SMTP delivery | `@fluojs/email/node` | Node-specific SMTP transport for `@fluojs/email`. |
| Need queue-backed bulk email notifications | `@fluojs/email/queue` + `@fluojs/queue` | Queue adapter and worker integration for email notifications. |
| Need Slack delivery | `@fluojs/slack` | Webhook-first Slack integration. |
| Need Discord delivery | `@fluojs/discord` | Webhook-first Discord integration. |

## observability & docs

| condition | package choice | notes |
| --- | --- | --- |
| Need OpenAPI output | `@fluojs/openapi` | Use for schema generation and API docs. |
| Need Prometheus metrics | `@fluojs/metrics` | Use for HTTP and application metrics. |
| Need health endpoints | `@fluojs/terminus` | Use for health aggregation, readiness checks, custom endpoint paths, and slow-indicator timeout guardrails through `execution.indicatorTimeoutMs`. |
| Need Node.js memory or disk health indicators | `@fluojs/terminus/node` | Dedicated Node-specific memory/disk indicator helpers; root exports remain available for compatibility. |
| Need Redis-backed health indicators | `@fluojs/terminus/redis` + `@fluojs/redis` | Dedicated Redis indicator integration for Terminus. |

Redis-backed package integrations use the default Redis registration unless a feature exposes `clientName`; add `clientName` only when a named Redis registration should take over that package's dependency edge.

---

For the full package responsibilities, see [package-surface.md](./package-surface.md#canonical-runtime-package-matrix).
