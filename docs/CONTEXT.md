# fluo — AI Context Document

This document is the primary AI-reference entrypoint for the fluo repository. It summarizes framework identity, non-negotiable authoring rules, package boundaries, and the fastest path to the correct source document.

## Identity

fluo is a standard-first TypeScript backend framework built on TC39 standard decorators, explicit dependency boundaries, and metadata-free runtime wiring. It rejects legacy decorator compiler modes and treats behavioral contracts, platform parity, and package surface clarity as core design constraints.

## Hard Constraints

- NEVER use `experimentalDecorators`.
- NEVER use `emitDecoratorMetadata`.
- NEVER access `process.env` directly inside packages, use `@fluojs/config` at the application boundary.
- Platform packages MUST implement the `PlatformAdapter` interface.
- All public exports MUST have TSDoc.
- Breaking changes in `1.0+` MUST trigger a major version bump.

## Package Families

| Family | Purpose | Representative packages |
| --- | --- | --- |
| Core | Decorators, DI, config, runtime orchestration | `@fluojs/core`, `@fluojs/di`, `@fluojs/config`, `@fluojs/runtime` |
| HTTP | Request execution and API surface | `@fluojs/http`, `@fluojs/graphql`, `@fluojs/validation`, `@fluojs/serialization`, `@fluojs/openapi` |
| Auth | Authentication and authorization | `@fluojs/jwt`, `@fluojs/passport` |
| Platform | Runtime adapters | `@fluojs/platform-fastify`, `@fluojs/platform-nodejs`, `@fluojs/platform-express`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, `@fluojs/platform-cloudflare-workers` |
| Realtime | Bidirectional transport | `@fluojs/websockets`, `@fluojs/socket.io` |
| Persistence | Database and cache integration | `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose`, `@fluojs/redis`, `@fluojs/cache-manager` |
| Patterns | Messaging and orchestration patterns | `@fluojs/microservices`, `@fluojs/cqrs`, `@fluojs/event-bus`, `@fluojs/cron`, `@fluojs/queue`, `@fluojs/notifications`, `@fluojs/email`, `@fluojs/slack`, `@fluojs/discord` |
| Operations | Health, metrics, throttling | `@fluojs/metrics`, `@fluojs/terminus`, `@fluojs/throttler` |
| Tooling | CLI and diagnostics | `@fluojs/cli`, `@fluojs/studio`, `@fluojs/testing` |

Canonical package and runtime coverage lives in [`docs/reference/package-surface.md`](./reference/package-surface.md).

## File Structure

| Path | Role |
| --- | --- |
| `docs/CONTEXT.md` | Primary AI orientation summary for the repository. |
| `docs/architecture/` | Framework architecture facts, execution model, platform design, and lifecycle boundaries. |
| `docs/contracts/` | Governance rules, release policy, authoring constraints, and conformance expectations. |
| `docs/guides/` | AI-targeted anti-pattern and decision-reference documents. |
| `docs/getting-started/` | Bootstrap and setup facts for common starting paths. |
| `docs/reference/` | Lookup-oriented tables, glossary terms, package matrices, and support snapshots. |

## Navigation

| Need | Read first | Follow with |
| --- | --- | --- |
| Repository identity and non-negotiable rules | `docs/CONTEXT.md` | `docs/contracts/behavioral-contract-policy.md` |
| Architecture model, request flow, and runtime boundaries | `docs/architecture/architecture-overview.md` | `docs/reference/glossary-and-mental-model.md` |
| Package family lookup or runtime coverage | `docs/reference/package-surface.md` | `docs/reference/package-chooser.md` when selection logic is needed |
| Behavioral guarantees, Changesets release flow, and versioning policy | `docs/contracts/behavioral-contract-policy.md` | `docs/contracts/release-governance.md` |
| Public API authoring and documentation baseline | `docs/contracts/public-export-tsdoc-baseline.md` | `docs/contracts/platform-conformance-authoring-checklist.md` |
| Bootstrap path or startup sequence facts | `docs/getting-started/quick-start.md` | `docs/architecture/lifecycle-and-shutdown.md` |
| Human learning flow or tutorial material | `book/README.md` | relevant chapters under `book/` |

## Anti-Patterns at a Glance

- Enabling `experimentalDecorators` or `emitDecoratorMetadata`, this violates fluo's standard-decorator baseline.
- Reading `process.env` inside package code, this breaks environment isolation and bypasses `@fluojs/config`.
- Shipping a platform package without `PlatformAdapter`, this breaks runtime portability and conformance.
- Exposing public exports without TSDoc, this weakens package contracts and reviewability.
- Changing documented behavior in `1.0+` without a major bump, this violates release governance.

Full anti-pattern catalog path: `docs/guides/anti-patterns.md`.
