---
"@fluojs/cache-manager": major
"@fluojs/cli": major
"@fluojs/config": major
"@fluojs/core": major
"@fluojs/cqrs": major
"@fluojs/cron": major
"@fluojs/di": major
"@fluojs/discord": major
"@fluojs/drizzle": major
"@fluojs/email": major
"@fluojs/event-bus": major
"@fluojs/graphql": major
"@fluojs/http": major
"@fluojs/i18n": major
"@fluojs/jwt": major
"@fluojs/metrics": major
"@fluojs/microservices": major
"@fluojs/mongoose": major
"@fluojs/notifications": major
"@fluojs/openapi": major
"@fluojs/passport": major
"@fluojs/platform-bun": major
"@fluojs/platform-cloudflare-workers": major
"@fluojs/platform-deno": major
"@fluojs/platform-express": major
"@fluojs/platform-fastify": major
"@fluojs/platform-nodejs": major
"@fluojs/prisma": major
"@fluojs/queue": major
"@fluojs/react": minor
"@fluojs/redis": major
"@fluojs/runtime": major
"@fluojs/serialization": major
"@fluojs/slack": major
"@fluojs/socket.io": major
"@fluojs/studio": major
"@fluojs/terminus": major
"@fluojs/testing": major
"@fluojs/throttler": major
"@fluojs/validation": major
"@fluojs/vite": major
"@fluojs/websockets": major
---

Prepare the coordinated Node.js 24 release with explicit major intent for every current stable public package and minor intent for @fluojs/react. React remains on 0.x; this is not a 1.0 graduation. Pending feature and fix Changesets contribute their notes to the same next release per package, not a second Vite or CLI release. No package versions or changelogs are generated in this preparation change.

Node-bound packages and generated Node starters adopt the package-owned support range `>=24.0.0 <27`. Config's env-file, default `.env`, and watch features use that Node-only policy while its in-memory root stays portable. Preserve the eight package-wide engine omissions: config, email, i18n, platform-bun, platform-cloudflare-workers, platform-deno, react, and runtime.

Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before upgrading Fluo packages, then replace @fluojs/runtime/node imports with @fluojs/platform-nodejs and @fluojs/runtime/internal-node with @fluojs/platform-nodejs/internal. There is no compatibility shim. Reinstall dependencies and native addons, refresh the lockfile, and verify application startup and shutdown.

Existing generated projects are not rewritten by a CLI upgrade. Adopt Vite ^8.2.2, Vitest and @vitest/coverage-v8 ^4.1.11 together, migrate build.rollupOptions to build.rolldownOptions, retain the separate Babel application/testing plugins, and remove the Babel ignore rule for src/**/*.test.ts. Node starters use node24 and @types/node ^24.0.0. The @fluojs/vite peer contract remains vite >=6.2.0; @fluojs/testing requires vitest ^4.1.11.

Follow the [English migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.md) or [Korean migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-node24.ko.md). Exact Node 24.0.0 and latest Node 26.x remain separate verification claims; latest Node 24.x owns release automation and Node 26 is never a publish runtime. Actual release and migration-document publication belong to the maintainer through the canonical Changesets workflow on main. This change does not claim publication; #3169 remains the release umbrella.
