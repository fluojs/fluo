---
"@fluojs/diagnostics": minor
"@fluojs/core": patch
"@fluojs/runtime": patch
"@fluojs/studio": patch
"@fluojs/cli": patch
"@fluojs/prisma": patch
"@fluojs/drizzle": patch
"@fluojs/mongoose": patch
"@fluojs/redis": patch
"@fluojs/queue": patch
"@fluojs/cache-manager": patch
"@fluojs/throttler": patch
"@fluojs/jwt": patch
"@fluojs/passport": patch
"@fluojs/cron": patch
"@fluojs/cqrs": patch
"@fluojs/event-bus": patch
"@fluojs/microservices": patch
"@fluojs/notifications": patch
"@fluojs/email": patch
"@fluojs/slack": patch
"@fluojs/discord": patch
---

Introduce portable `@fluojs/diagnostics` as the single owner of shared platform status, graph, trace, timing and static/report/live data contracts and readers. Existing runtime, core/internal, Studio root and feature status imports remain compatible. Preserve wire version 1, legacy route normalization, validation/privacy behavior, typed status details, Node support and runtime resource/lifecycle ownership.

Migration: existing imports and stored artifacts require no changes. New data-only consumers may install `@fluojs/diagnostics` instead of runtime or Studio implementation. Filters, Mermaid rendering and viewer APIs stay in `@fluojs/studio`; the previously removed `@fluojs/studio/contracts` subpath is not restored. See `docs/getting-started/migrate-diagnostics.md`.
