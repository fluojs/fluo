# examples

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

This directory contains the official runnable example applications for fluo. Each example has its own README and works best when read alongside the learning path in `../book/`. If you are an AI tool or need contract references, start from `../docs/CONTEXT.md`.

These examples intentionally stay on the HTTP side of the published `fluo new` v2 matrix so the generated scaffold and the runnable examples keep matching. The other first-class starter contracts are the runnable application starter variants for Express, raw Node.js HTTP, Bun, Deno, and Cloudflare Workers; the runnable microservice starter paths (TCP by default, plus Redis Streams, NATS, Kafka, RabbitMQ, MQTT, and gRPC); and the mixed single-package path (Fastify HTTP app + attached TCP microservice).

## current official examples

- `./minimal/` — the smallest runnable fluo app, matching the default and explicit HTTP starter path
- `./realworld-api/` — a more realistic multi-module HTTP API with config, DTO validation, explicit DI, and CRUD
- `./auth-jwt-passport/` — bearer-token auth example with JWT issuance and protected routes via passport core
- `./ops-metrics-terminus/` — operations example centered on `/metrics`, `/health`, and `/ready`

## recommended reading order

If you are new to the repo, follow this order:

1. `./minimal/README.md` — smallest bootstrap and request path
2. `./realworld-api/README.md` — first real domain module and DTO boundary
3. `./auth-jwt-passport/README.md` — auth, JWT issuance, and protected route path
4. `./ops-metrics-terminus/README.md` — metrics and health/readiness path
5. `../book/beginner/ch02-cli-setup.md` — first local project setup through the CLI
6. `../book/beginner/ch03-modules-providers.md` — first module/provider wiring and package mental model

## how these examples fit the docs

- `minimal` proves the canonical `fluo new` HTTP starter shape on both the default and explicit flags-first path
- `realworld-api` proves the first practical module/DTO/test path beyond that HTTP starter baseline
- `auth-jwt-passport` proves the current official bearer-token auth path
- `ops-metrics-terminus` proves the current markdown-first observability/health path

For the other v2 starter contracts, see the CLI README for commands and the contract matrix for the full specification:

- `../packages/cli/README.md` — command examples for HTTP, microservice, mixed, and interactive wizard flows
- `../docs/reference/toolchain-contract-matrix.md` — published starter contract matrix

These examples are intentionally small enough to read in one sitting. They are not meant to replace package READMEs.

## run examples from the repo root

```bash
pnpm install
pnpm vitest run examples/minimal
pnpm vitest run examples/realworld-api
pnpm vitest run examples/auth-jwt-passport
pnpm vitest run examples/ops-metrics-terminus
```

## related docs

- `../README.md`
- `../book/README.md`
- `../docs/CONTEXT.md`
- `../docs/getting-started/quick-start.md`
- `../docs/getting-started/first-feature-path.md`
