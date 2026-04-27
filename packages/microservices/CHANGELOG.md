# @fluojs/microservices

## 1.0.0-beta.2

### Patch Changes

- [#1358](https://github.com/fluojs/fluo/pull/1358) [`106e51d`](https://github.com/fluojs/fluo/commit/106e51d92023c22d7ad1bdb2df2723f8f6986422) Thanks [@ayden94](https://github.com/ayden94)! - Tighten microservice transport ownership, abort, and shutdown contracts so caller-owned NATS clients are not closed by transport shutdown, NATS request/reply honors AbortSignal, and NATS/Kafka/RabbitMQ reject new publishes once close starts.

- Updated dependencies [[`288a0b1`](https://github.com/fluojs/fluo/commit/288a0b1a9a7ee26fd94a1ff66d20390ec94cfd06), [`4333cee`](https://github.com/fluojs/fluo/commit/4333cee59deefe0e96e96903e8a2681cd174761f)]:
  - @fluojs/di@1.0.0-beta.2
  - @fluojs/runtime@1.0.0-beta.2
