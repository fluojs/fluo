# examples

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

This directory contains the official runnable example applications for fluo. Each example has its own README and is meant to be read alongside the docs hub rather than in isolation.

These examples intentionally stay on the default Node.js + Fastify starter path so the generated scaffold and the runnable examples keep matching. Official Bun, Deno, and Cloudflare Workers runtime guidance lives in the corresponding `@fluojs/platform-*` package READMEs.

## current official examples

- `./minimal/` — the smallest runnable fluo app, matching the canonical starter path
- `./realworld-api/` — a more realistic multi-module HTTP API with config, DTO validation, explicit DI, and CRUD
- `./auth-jwt-passport/` — bearer-token auth example with JWT issuance and protected routes via passport core
- `./ops-metrics-terminus/` — operations example centered on `/metrics`, `/health`, and `/ready`

## recommended reading order

If you are new to the repo, follow this order:

1. `./minimal/README.md` — smallest bootstrap and request path
2. `./realworld-api/README.md` — first real domain module and DTO boundary
3. `./auth-jwt-passport/README.md` — auth, JWT issuance, and protected route path
4. `./ops-metrics-terminus/README.md` — metrics and health/readiness path
5. `../docs/getting-started/first-feature-path.md` — official path from starter app to first feature
6. `../docs/reference/package-chooser.md` — pick the next package by task

## how these examples fit the docs

- `minimal` proves the canonical starter shape from `konekti new` on the default Node.js + Fastify path
- `realworld-api` proves the first practical module/DTO/test path beyond the starter
- `auth-jwt-passport` proves the current official bearer-token auth path
- `ops-metrics-terminus` proves the current markdown-first observability/health path

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
- `../docs/README.md`
- `../docs/getting-started/quick-start.md`
- `../docs/getting-started/first-feature-path.md`
