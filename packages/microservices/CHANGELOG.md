# @fluojs/microservices

## [Unreleased]

## 2.0.0

### Major Changes

- [#3696](https://github.com/fluojs/fluo/pull/3696) [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3) Thanks [@ayden94](https://github.com/ayden94)! - Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

  Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

  Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

  Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/\*_/_.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

  Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; [#3169](https://github.com/fluojs/fluo/issues/3169) remains the release umbrella.

- [#3571](https://github.com/fluojs/fluo/pull/3571) [`7e7b919`](https://github.com/fluojs/fluo/commit/7e7b9190f03c886195f70fe556fd95ffbb6cf161) Thanks [@ayden94](https://github.com/ayden94)! - Declare the package-owned Node.js support range `>=24.0.0 <27` for `@fluojs/microservices` in the upcoming coordinated release. The portable `@fluojs/runtime` package no longer supplies a transitive Node engine requirement.

  Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.

- [#3579](https://github.com/fluojs/fluo/pull/3579) [`e17a387`](https://github.com/fluojs/fluo/commit/e17a3875ccc818d027bed38135a45717359403ca) Thanks [@ayden94](https://github.com/ayden94)! - Redis Pub/Sub now discards malformed inbound frames before runtime dispatch and reports them through the configured transport logger.

  Migration: Ensure every Redis Pub/Sub publisher emits a JSON object with `kind: "event"` and a string `pattern`; malformed frames are no longer forwarded to application handlers.

- [#3582](https://github.com/fluojs/fluo/pull/3582) [`f07a80c`](https://github.com/fluojs/fluo/commit/f07a80cca031a3aba0ac17aa28d54ba4bf5438b2) Thanks [@ayden94](https://github.com/ayden94)! - Redis Streams now enables pending-entry reclaim by default with `pendingReclaimIdleMs: 60_000`. Requests abandoned in the shared request consumer group can be redelivered after a consumer crash, and failed events can be redelivered to the same listener from its instance-scoped event group; handlers must therefore be idempotent. To preserve the prior disabled behavior, set `pendingReclaimIdleMs: 0` (or a negative value). Replacement listeners do not reclaim a crashed listener's event PEL because UUID-scoped event groups preserve broadcast delivery.

- [#3585](https://github.com/fluojs/fluo/pull/3585) [`10b735b`](https://github.com/fluojs/fluo/commit/10b735b36f076caf02cc157827e154c1b380b170) Thanks [@ayden94](https://github.com/ayden94)! - Remove the ineffective `requestTimeoutMs` option from `RedisPubSubMicroserviceTransportOptions`.

  Migration: Delete `requestTimeoutMs` from Redis Pub/Sub transport construction. Redis Pub/Sub is event-only and `send()` always rejects; use `RedisStreamsMicroserviceTransport` or another request-response transport when a request timeout is required.

- [#3663](https://github.com/fluojs/fluo/pull/3663) [`bf28ee4`](https://github.com/fluojs/fluo/commit/bf28ee4f2f3b4fe8048f1092ba0ef29994109dd5) Thanks [@ayden94](https://github.com/ayden94)! - Propagate outbound gRPC writer errors instead of discarding them.

  `GrpcMicroserviceTransport` previously ignored the error passed to `writer.error(err)` on outbound `clientStream()` and `bidiStream()` calls and closed the request half with `end()`. The remote peer read that as a successful end-of-stream, so a failed local producer still produced a completed RPC: `clientStream()` resolved its `result` promise with the server's success response and `bidiStream()` readers observed a clean completion. The caller's error was lost entirely.

  Outbound writers now abort the call. fluo calls the call-level `destroy(err)` path, falling back to `cancel()` and finally `end()` for runtimes that expose neither, so the remote peer observes a failed RPC. The caller's original error — not the transport-level cancellation status that follows the abort — rejects the `clientStream()` result promise and surfaces on the `bidiStream()` reader. Repeated `writer.error()` calls, and an `end()` that follows one, are ignored so the call is aborted once and the first reported cause wins.

  Migration: code that called `writer.error()` on an outbound gRPC `clientStream()` or `bidiStream()` and then awaited the result promise or iterated the reader previously observed success. Those call sites now observe the reported error and must handle a rejected promise or a throwing reader. Server-side handlers that treated the resulting clean EOF as a complete request stream now receive an aborted call and must handle that failure. Callers that want the previous end-of-stream semantics should call `writer.end()` instead of `writer.error()`. Inbound server-stream and bidi-stream writer behavior is unchanged.

- [#2776](https://github.com/fluojs/fluo/pull/2776) [`edf4092`](https://github.com/fluojs/fluo/commit/edf4092030e434ca306735953298d81808b69995) Thanks [@ayden94](https://github.com/ayden94)! - Require `@grpc/grpc-js` 1.14.4 or newer for the optional gRPC transport. Upgrade the peer and refresh consumer lockfiles so the proto-loader chain resolves `protobufjs` 7.6.5 or newer; the fluo transport API is unchanged.

### Minor Changes

- [#3584](https://github.com/fluojs/fluo/pull/3584) [`e5ec6b8`](https://github.com/fluojs/fluo/commit/e5ec6b80d7d4b527e0b1b4bee871502f307a2575) Thanks [@ayden94](https://github.com/ayden94)! - Add `@fluojs/microservices/redis-streams` as a dedicated Redis Streams transport
  subpath. Import `RedisStreamsMicroserviceTransport`,
  `RedisStreamsMicroserviceTransportOptions`, and `RedisStreamClientLike` from
  `@fluojs/microservices/redis-streams` when using this transport.

- [#3664](https://github.com/fluojs/fluo/pull/3664) [`e979ef9`](https://github.com/fluojs/fluo/commit/e979ef9eb353679ba7ffa716d1def5096adadb97) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Kafka and RabbitMQ inbound event handler failure signals. `KafkaMicroserviceTransport` and `RabbitMqMicroserviceTransport` now implement the optional `setLogger()` transport hook and report inbound event handler failures as `Event handler failed.` through the configured microservice logger, matching the NATS, MQTT, gRPC, Redis Pub/Sub, and Redis Streams transports. The documented delivery-safety contract is unchanged: the event failure is still rethrown so the consumer callback rejects and broker adapters can withhold acknowledgement or retry, and a logger that throws no longer masks that failure. No fallback `console.error` is emitted when no logger is configured, and request-handler errors continue to round-trip as error responses without being logged as event failures.

### Patch Changes

- [#2783](https://github.com/fluojs/fluo/pull/2783) [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e) Thanks [@ayden94](https://github.com/ayden94)! - Reject new microservice `send()` and `emit()` calls as soon as shutdown begins, including while `listen()` is still pending, before runtime or transport handoff.

- [#3081](https://github.com/fluojs/fluo/pull/3081) [`ec03145`](https://github.com/fluojs/fluo/commit/ec03145199e92d629f0e78f90fdb568344c7f33b) Thanks [@ayden94](https://github.com/ayden94)! - Contain malformed NATS request frames and response publication failures at the subscription callback boundary, reporting them through the configured transport logger without closing the caller-owned client.

- [#3666](https://github.com/fluojs/fluo/pull/3666) [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438) Thanks [@ayden94](https://github.com/ayden94)! - Make microservice shutdown terminally idempotent, including synchronous shutdown-marker failures and reentry, wait for already-admitted inbound handlers before transport cleanup, and preserve failed close results without retrying teardown.

- [#3656](https://github.com/fluojs/fluo/pull/3656) [`ed9ba99`](https://github.com/fluojs/fluo/commit/ed9ba99c7db6d99265e68beab91cf972b7e3d5c4) Thanks [@ayden94](https://github.com/ayden94)! - Preserve distinct provider-token registrations when discovering decorated handlers.

- [#3010](https://github.com/fluojs/fluo/pull/3010) [`831372d`](https://github.com/fluojs/fluo/commit/831372d86c84efe8f1eb3537083c4b1375a0cc75) Thanks [@ayden94](https://github.com/ayden94)! - Share concurrent TCP transport shutdown through one close promise so listener and socket cleanup runs once.

- [#3077](https://github.com/fluojs/fluo/pull/3077) [`0f96f20`](https://github.com/fluojs/fluo/commit/0f96f20d2cc8da9dff9830a1103d2e6a7c42fb57) Thanks [@ayden94](https://github.com/ayden94)! - Preserve UTF-8 request, response, and event payloads when TCP splits a multibyte code point across socket chunks.

- [#3028](https://github.com/fluojs/fluo/pull/3028) [`77be463`](https://github.com/fluojs/fluo/commit/77be463c8e67a215253356c9d392d83aaf353ec8) Thanks [@ayden94](https://github.com/ayden94)! - Reject new server-, client-, and bidirectional-stream requests at the `Microservice` facade as soon as shutdown starts.

- [#3031](https://github.com/fluojs/fluo/pull/3031) [`cce202c`](https://github.com/fluojs/fluo/commit/cce202c9f3cad2296d1445aeda37c8c4ec03edd1) Thanks [@ayden94](https://github.com/ayden94)! - Report caller-owned gRPC servers and framework-owned cached outbound clients separately in platform status snapshots without changing shutdown behavior.

- [#3657](https://github.com/fluojs/fluo/pull/3657) [`7f93b79`](https://github.com/fluojs/fluo/commit/7f93b7920d8a772f7cd0bbe4a800fcc2a67b1d4f) Thanks [@ayden94](https://github.com/ayden94)! - Retain failed RabbitMQ consumer cleanup ownership so later transport shutdown retries can cancel only the queues that still need cleanup.

- [#3079](https://github.com/fluojs/fluo/pull/3079) [`a919d60`](https://github.com/fluojs/fluo/commit/a919d60121a7e13d378a4421ce34e35e74890642) Thanks [@ayden94](https://github.com/ayden94)! - Attempt every NATS subscription cleanup, preserve all failure evidence, and retain failed subscriptions for retry without repeating successful teardown.

- [#3695](https://github.com/fluojs/fluo/pull/3695) [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367) Thanks [@ayden94](https://github.com/ayden94)! - Make the runtime and config package boundaries truthful for edge consumers. `@fluojs/runtime` and `@fluojs/config` no longer publish package-wide Node engine requirements, while config's env-file, default `.env`, and watch features retain the executable `CONFIG_RUNTIME_UNAVAILABLE` guard on unsupported hosts.

  Migration: replace every `@fluojs/runtime/node` import with `@fluojs/platform-nodejs`, and replace every `@fluojs/runtime/internal-node` import with `@fluojs/platform-nodejs/internal`. Moved symbols retain their existing names; no compatibility shim remains on `@fluojs/runtime`. Express and Fastify now consume the Node integration seam from its platform-owned package.

- Updated dependencies [[`903a56e`](https://github.com/fluojs/fluo/commit/903a56e1c081b5f939331cb1390aa1b7db7be192), [`21866e5`](https://github.com/fluojs/fluo/commit/21866e5356eff74c95eeb8ce3785f44635726d58), [`f9e479a`](https://github.com/fluojs/fluo/commit/f9e479aa9b8f911b3b0d3c98821d9d6d6dbcebc3), [`71b72d2`](https://github.com/fluojs/fluo/commit/71b72d2138e255740216d3a4a76c9a60e054ccbd), [`296056b`](https://github.com/fluojs/fluo/commit/296056bcd9579be703da21a9eb6584698bef2b8b), [`520573c`](https://github.com/fluojs/fluo/commit/520573c4e0324962e31ae59a0ba2612aafbd9639), [`45f8fbd`](https://github.com/fluojs/fluo/commit/45f8fbd8f5302558369eb6e9697e64c4ecd7e2a1), [`23ca767`](https://github.com/fluojs/fluo/commit/23ca7678677b9dc492add364873b210e8d0a6317), [`6c927c1`](https://github.com/fluojs/fluo/commit/6c927c16e8e728f91583dc398444dfbab86befa3), [`8cf4e8c`](https://github.com/fluojs/fluo/commit/8cf4e8cd19394918f0c642ad0d01a08932d1fb84), [`91c7b32`](https://github.com/fluojs/fluo/commit/91c7b3245b7d168b49eeff551be06998cb20b8cd), [`9b1c3ed`](https://github.com/fluojs/fluo/commit/9b1c3ed648e4c48c24384879cc587aedec1ba00e), [`3509d7c`](https://github.com/fluojs/fluo/commit/3509d7cc9307635580b377b77ca7151b8603a5d9), [`d5f38c2`](https://github.com/fluojs/fluo/commit/d5f38c2137a93f2f7bd5d268cadb629efc024c8d), [`be208de`](https://github.com/fluojs/fluo/commit/be208de88d953871463d5ec2e3bd1be026df5f32), [`6dbb83a`](https://github.com/fluojs/fluo/commit/6dbb83abe63ac413256778d31c803c21440a0e67), [`07ee78e`](https://github.com/fluojs/fluo/commit/07ee78ef2ace90727645896fd4cc78c083f6d438), [`8a54766`](https://github.com/fluojs/fluo/commit/8a547669f1fa2151aca018304fe1e833e3bc5230), [`8fef9fa`](https://github.com/fluojs/fluo/commit/8fef9fa22b82f6ca878c19eaae7b06c31cfb0573), [`857ff80`](https://github.com/fluojs/fluo/commit/857ff80a7cd62f475a64853de9be17b8d1fe8604), [`4ba6ca5`](https://github.com/fluojs/fluo/commit/4ba6ca596c86a6b04c130c7985f9bce264eff9fa), [`746a853`](https://github.com/fluojs/fluo/commit/746a853d71ca7fc2903b8bccb9b4d9b35818f976), [`5da3256`](https://github.com/fluojs/fluo/commit/5da325630b49718b9e1711f93287ebc40df145ea), [`3659e65`](https://github.com/fluojs/fluo/commit/3659e652400060a2a8171ebe520df40dd1466a58), [`deca575`](https://github.com/fluojs/fluo/commit/deca575cad1405fa7a45034fa4880ee7d1a808ea), [`b8e9bbd`](https://github.com/fluojs/fluo/commit/b8e9bbdfac77ac83ccbc250948cc6e13146f265c), [`790bef1`](https://github.com/fluojs/fluo/commit/790bef16538c17e081f7f1f1677b093e61ff695a), [`01aaf36`](https://github.com/fluojs/fluo/commit/01aaf368394bfab437eea90304b5e84c1ef2d406), [`e9971be`](https://github.com/fluojs/fluo/commit/e9971be5b0dc30acec10b86f0de128b202fb91a4), [`f6385dc`](https://github.com/fluojs/fluo/commit/f6385dc4623581f47efe8a95c45d4f8f274dc7c2), [`8e79be1`](https://github.com/fluojs/fluo/commit/8e79be1d5520e2144eb16bb40766f3619dfba6a9), [`a7cffb1`](https://github.com/fluojs/fluo/commit/a7cffb16d9f1ba4ad8eea4ffc7d751b2913dd51d), [`e161518`](https://github.com/fluojs/fluo/commit/e161518bba08151ba4f801409e6343e22f7c5dab), [`ba71ce7`](https://github.com/fluojs/fluo/commit/ba71ce75291c12846ebeae0b90d73fc908c71f33), [`26b1ae7`](https://github.com/fluojs/fluo/commit/26b1ae73a4901201094da154b63904091baba835), [`af7485d`](https://github.com/fluojs/fluo/commit/af7485d4c02cd262a99a89d7b130897a04c516a7), [`8131ce1`](https://github.com/fluojs/fluo/commit/8131ce135cbcef8ba3d9b2eb7628176ab850c36b), [`95d8b23`](https://github.com/fluojs/fluo/commit/95d8b23c238cf6aa61fb89a3874a7f11d8434685), [`af24ce9`](https://github.com/fluojs/fluo/commit/af24ce9c5410ea16550f9dca280d005817674c6a), [`1e06150`](https://github.com/fluojs/fluo/commit/1e0615082fd6b9a449a20adeced131eeea856faf), [`344d9bc`](https://github.com/fluojs/fluo/commit/344d9bc15c59ac45572eb63aa3d3c06858d19549), [`a431f72`](https://github.com/fluojs/fluo/commit/a431f72580b8d94b643dcb94071d1bc903c00b88), [`6e4272a`](https://github.com/fluojs/fluo/commit/6e4272afd17ea18177330a4e9de6d2745fb2d6d9), [`1ba9703`](https://github.com/fluojs/fluo/commit/1ba970357e404638f513a84a45da7358ea7384b4), [`fbc2d1b`](https://github.com/fluojs/fluo/commit/fbc2d1b76077079e325b30eca93f36d573f5093d), [`152a25e`](https://github.com/fluojs/fluo/commit/152a25e986eaad51634c0ef77cbe2f12b86807c7), [`f8af8e3`](https://github.com/fluojs/fluo/commit/f8af8e36731378121835396025e3b847c66c10bb), [`29f2766`](https://github.com/fluojs/fluo/commit/29f2766eba394f50291b3413b85fd637286165c7), [`acd28a9`](https://github.com/fluojs/fluo/commit/acd28a962b35f577890c47c9c535e4058f373846), [`547c6d4`](https://github.com/fluojs/fluo/commit/547c6d4ff3328eab7423d32dd01a7f51ca979758), [`c7210fe`](https://github.com/fluojs/fluo/commit/c7210fed9b5883d5bee92863197c344ff6b6210c), [`fe84a43`](https://github.com/fluojs/fluo/commit/fe84a438fa1544365059be80955013cccb5389e5), [`7b61b03`](https://github.com/fluojs/fluo/commit/7b61b03239f2f4f7bc9692fbf430731798909317), [`68e03c4`](https://github.com/fluojs/fluo/commit/68e03c4b5702fa182317e9ea8413fe0557cd3617), [`b245fba`](https://github.com/fluojs/fluo/commit/b245fba06dcb7f9762c2ff15b674a6fac8d39758), [`cc3ea1c`](https://github.com/fluojs/fluo/commit/cc3ea1cc01292e7d91606cd11c1ae9937b431367), [`80505f3`](https://github.com/fluojs/fluo/commit/80505f388e3c96f4aaccc6d9b89975919827481c), [`fc36262`](https://github.com/fluojs/fluo/commit/fc362629bac81234dc52fe1c50d3b717bbb9fbd9)]:
  - @fluojs/runtime@3.0.0
  - @fluojs/core@2.0.0
  - @fluojs/di@3.0.0

## 1.0.5

### Patch Changes

- [#2703](https://github.com/fluojs/fluo/pull/2703) [`b829e8c`](https://github.com/fluojs/fluo/commit/b829e8c13444eb998938d9c9d70281c2d32948a5) Thanks [@ayden94](https://github.com/ayden94)! - Await Kafka and RabbitMQ inbound handlers and response publication from consumer callbacks so processing failures remain visible to broker acknowledgement and retry paths.

- [#2706](https://github.com/fluojs/fluo/pull/2706) [`f0e004b`](https://github.com/fluojs/fluo/commit/f0e004b97e634f839027623058e69aa11c900267) Thanks [@ayden94](https://github.com/ayden94)! - Clean up NATS subscriptions created by a failed listen attempt without closing the caller-owned client.

- [#2482](https://github.com/fluojs/fluo/pull/2482) [`34ca080`](https://github.com/fluojs/fluo/commit/34ca080549e2bf9fcf44fabf2b376665008b45d0) Thanks [@ayden94](https://github.com/ayden94)! - Align the public microservice facade shutdown contract with runtime lifecycle signal forwarding while preserving no-argument transport shutdown adapters.

- [#2390](https://github.com/fluojs/fluo/pull/2390) [`efe09b4`](https://github.com/fluojs/fluo/commit/efe09b441a9515c431957d759df3a871529494ea) Thanks [@ayden94](https://github.com/ayden94)! - Close internally-created MQTT clients when subscription setup fails during startup or when shutdown unwinds a failed in-flight listen attempt.

- [#2301](https://github.com/fluojs/fluo/pull/2301) [`5b0d418`](https://github.com/fluojs/fluo/commit/5b0d41820b20b59a6311e069daa35d741850424c) Thanks [@ayden94](https://github.com/ayden94)! - Close NATS, RabbitMQ, and Redis Streams microservice transports consistently when listen and close race, preserving shutdown guards and Redis Streams cleanup before surfacing startup failures.

- [#2714](https://github.com/fluojs/fluo/pull/2714) [`62b073c`](https://github.com/fluojs/fluo/commit/62b073c39eb65849d18970a284be99782b2c67c0) Thanks [@ayden94](https://github.com/ayden94)! - Restore gRPC `AbortSignal` listener cleanup when server and bidirectional streams end or error before reader iteration, and keep client, server, and bidirectional cleanup one-shot across terminal and early-return races.

  Migration: no API or configuration changes are required. Existing consumers can keep their current stream usage and rely on abort listeners being detached on every terminal or reader-return path.

- Updated dependencies [[`3fafdff`](https://github.com/fluojs/fluo/commit/3fafdffe85fc15f542844b977d8ca40db5c58439), [`c3bc3d6`](https://github.com/fluojs/fluo/commit/c3bc3d6c45fd08d43dbd28eb0d87f780430d9caa), [`1261d96`](https://github.com/fluojs/fluo/commit/1261d96ecae66576fe26fae0a39f03458307e6a4), [`d7e3a98`](https://github.com/fluojs/fluo/commit/d7e3a981e9edd6ec098af1827b2081c49c5197e7), [`33fac0d`](https://github.com/fluojs/fluo/commit/33fac0de23de4e2585355c914bda0427c8eed100), [`6f75ef9`](https://github.com/fluojs/fluo/commit/6f75ef9636e136459952d273a9a189ef0b8a7b67), [`83e7a7d`](https://github.com/fluojs/fluo/commit/83e7a7ddf75812f88ab65ab280e4f5f94adea3ff), [`337c0e2`](https://github.com/fluojs/fluo/commit/337c0e2eeeabce3c4e6fa1749c6919f62a88d925), [`ea78a19`](https://github.com/fluojs/fluo/commit/ea78a1985114392a1658509bd7132987dd289942), [`ccb11fa`](https://github.com/fluojs/fluo/commit/ccb11fab16cc3f8db4dd000ca609b0bf544b72c6), [`e8dd36e`](https://github.com/fluojs/fluo/commit/e8dd36e53e1be1bc96f69587cc7d3641ffdf3896)]:
  - @fluojs/runtime@2.0.0
  - @fluojs/di@2.0.0
  - @fluojs/core@1.1.0

## 1.0.4

### Patch Changes

- [#2122](https://github.com/fluojs/fluo/pull/2122) [`6285f26`](https://github.com/fluojs/fluo/commit/6285f26f84bfcddb11018ff25e137bbb7c0b0005) Thanks [@ayden94](https://github.com/ayden94)! - Align microservice transport status metadata with actual resource ownership and export `TcpMicroserviceTransportOptions` from the root barrel so the public constructor surface is documented and type-accessible.

- [#2236](https://github.com/fluojs/fluo/pull/2236) [`120a2ee`](https://github.com/fluojs/fluo/commit/120a2eed817c80101ba7393f92a952d3f11d1619) Thanks [@ayden94](https://github.com/ayden94)! - Tighten microservice transport lifecycle and abort contracts so Kafka, MQTT, Redis Streams, and gRPC re-check cancellation before deferred dispatch, close/listen races cannot reopen an in-progress shutdown, and caller-supplied gRPC servers remain caller-owned during close.

- Updated dependencies [[`2fa4902`](https://github.com/fluojs/fluo/commit/2fa490247c329d63d32e6ad8208de380490a0451), [`be3fb55`](https://github.com/fluojs/fluo/commit/be3fb55b02f9fcdae66db5efc29089e87ce409ed)]:
  - @fluojs/runtime@1.1.8

## Unreleased

## 1.0.3

### Patch Changes

- [#2084](https://github.com/fluojs/fluo/pull/2084) [`b5a3289`](https://github.com/fluojs/fluo/commit/b5a32890a3c3384d3e8511e81032b80bd8a054d1) Thanks [@ayden94](https://github.com/ayden94)! - Defer TCP `node:net` loading until listen or outbound socket construction paths and preserve transport cleanup when closing after failed in-flight listen attempts.

- Updated dependencies [[`e8f2844`](https://github.com/fluojs/fluo/commit/e8f284469a3b1bf5d5453ba005b8c63cc4ffdd65)]:
  - @fluojs/runtime@1.1.7

## 1.0.2

### Patch Changes

- [#1844](https://github.com/fluojs/fluo/pull/1844) [`70a93bf`](https://github.com/fluojs/fluo/commit/70a93bf1250c85b08b292e669828fd965a590a6e) Thanks [@ayden94](https://github.com/ayden94)! - Reject Redis Pub/Sub and Redis Streams event emits once transport shutdown has started so no outbound work is accepted during a closing lifecycle.

- Updated dependencies [[`01ea60e`](https://github.com/fluojs/fluo/commit/01ea60eff7a8d3b30509aff8aaf21649178a9fad), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2), [`3aa93d9`](https://github.com/fluojs/fluo/commit/3aa93d9bbea28342f225b727f2ec0640acdf7986)]:
  - @fluojs/di@1.0.1
  - @fluojs/runtime@1.1.0
  - @fluojs/core@1.0.1

## 1.0.0

### Minor Changes

- dc8fff1: Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

### Patch Changes

- fa0ecca: Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.
- 1dda8b5: Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
- 8e7acc7: Fix TCP shutdown guards and gRPC streaming AbortSignal cleanup so closing microservice transports reject new work and release stream abort listeners reliably.
- cf14bbb: Correct the microservices README example references and clarify that RabbitMQ request/reply uses instance-scoped response queues rather than direct reply-to.
- 106e51d: Tighten microservice transport ownership, abort, and shutdown contracts so caller-owned NATS clients are not closed by transport shutdown, NATS request/reply honors AbortSignal, and NATS/Kafka/RabbitMQ reject new publishes once close starts.
- Updated dependencies [4fdb48c]
- Updated dependencies [da003a1]
- Updated dependencies [c5aebdf]
- Updated dependencies [33987e4]
- Updated dependencies [fa0ecca]
- Updated dependencies [1d43614]
- Updated dependencies [2159d4f]
- Updated dependencies [f086fa5]
- Updated dependencies [288a0b1]
- Updated dependencies [33d51e1]
- Updated dependencies [1911e11]
- Updated dependencies [1b0a68a]
- Updated dependencies [aaab8c4]
- Updated dependencies [93fc34b]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [53a2b8e]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [b74832f]
- Updated dependencies [4333cee]
- Updated dependencies [f28a8c8]
- Updated dependencies [6b8e8a9]
- Updated dependencies [89f6379]
- Updated dependencies [f0dce1f]
- Updated dependencies [c509e27]
- Updated dependencies [c3ef937]
- Updated dependencies [69936b1]
- Updated dependencies [35f60fd]
- Updated dependencies [d3504c6]
  - @fluojs/core@1.0.0
  - @fluojs/runtime@1.0.0
  - @fluojs/di@1.0.0

## 1.0.0-beta.6

### Patch Changes

- [#1638](https://github.com/fluojs/fluo/pull/1638) [`8e7acc7`](https://github.com/fluojs/fluo/commit/8e7acc789c2fb15c3a23401ffc478629b7f7b478) Thanks [@ayden94](https://github.com/ayden94)! - Fix TCP shutdown guards and gRPC streaming AbortSignal cleanup so closing microservice transports reject new work and release stream abort listeners reliably.

- [#1699](https://github.com/fluojs/fluo/pull/1699) [`cf14bbb`](https://github.com/fluojs/fluo/commit/cf14bbb44237203ad9a361a001d883046de90e5e) Thanks [@ayden94](https://github.com/ayden94)! - Correct the microservices README example references and clarify that RabbitMQ request/reply uses instance-scoped response queues rather than direct reply-to.

- Updated dependencies [[`2159d4f`](https://github.com/fluojs/fluo/commit/2159d4f35993af7f5b6e056afd535a02d1831cab), [`aaab8c4`](https://github.com/fluojs/fluo/commit/aaab8c440caddbf32e7657b859e36a238c7ea3f0), [`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/di@1.0.0-beta.7
  - @fluojs/core@1.0.0-beta.5
  - @fluojs/runtime@1.0.0-beta.12

## 1.0.0-beta.5

### Minor Changes

- [#1568](https://github.com/fluojs/fluo/pull/1568) [`dc8fff1`](https://github.com/fluojs/fluo/commit/dc8fff11bc0880667cebba3aa808ed4e9eef1299) Thanks [@ayden94](https://github.com/ayden94)! - Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.

## 1.0.0-beta.4

### Patch Changes

- [#1544](https://github.com/fluojs/fluo/pull/1544) [`1dda8b5`](https://github.com/fluojs/fluo/commit/1dda8b5e8c949123125dfc73a4e20ad98b1e7cf5) Thanks [@ayden94](https://github.com/ayden94)! - Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.

- Updated dependencies [[`4fdb48c`](https://github.com/fluojs/fluo/commit/4fdb48ca03c76a4164856cd1f9cb18c743bfbad3), [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0)]:
  - @fluojs/core@1.0.0-beta.4
  - @fluojs/runtime@1.0.0-beta.11

## 1.0.0-beta.3

### Patch Changes

- [#1380](https://github.com/fluojs/fluo/pull/1380) [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440) Thanks [@ayden94](https://github.com/ayden94)! - Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Standard metadata bag helpers now document and preserve mixed-era lookup semantics across current/native `Symbol.metadata` and the fallback symbol: own metadata from either era overrides inherited metadata for the same key while preserving inherited keys when the child owns different metadata. Downstream packages receive patch releases because their source now consumes the centralized `@fluojs/core/internal` standard metadata helpers instead of local mixed-era `Symbol.metadata` lookups, preserving the same native/fallback lookup behavior while sharing the core implementation. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results, their collection fields, and module provider descriptor wrappers and middleware route-config wrappers (including their `routes` arrays) as immutable. `useValue` payload objects and runtime middleware/guard/interceptor instances remain mutable references and are not frozen by this change.

- Updated dependencies [[`da003a1`](https://github.com/fluojs/fluo/commit/da003a1a5f7fec7b46fcf37d5a19a91e04d8b301), [`fa0ecca`](https://github.com/fluojs/fluo/commit/fa0eccae6d31f2df5b759061c48b3973c141c440), [`33d51e1`](https://github.com/fluojs/fluo/commit/33d51e163b2fc6d2cf43b820a91d0b95ee552e75), [`c509e27`](https://github.com/fluojs/fluo/commit/c509e27da630c0cd5cffbfc72381dbc1594efc1c)]:
  - @fluojs/runtime@1.0.0-beta.3
  - @fluojs/core@1.0.0-beta.2
  - @fluojs/di@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- [#1358](https://github.com/fluojs/fluo/pull/1358) [`106e51d`](https://github.com/fluojs/fluo/commit/106e51d92023c22d7ad1bdb2df2723f8f6986422) Thanks [@ayden94](https://github.com/ayden94)! - Tighten microservice transport ownership, abort, and shutdown contracts so caller-owned NATS clients are not closed by transport shutdown, NATS request/reply honors AbortSignal, and NATS/Kafka/RabbitMQ reject new publishes once close starts.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
