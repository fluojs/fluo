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
"@fluojs/event-bus": major
"@fluojs/graphql": major
"@fluojs/http": major
"@fluojs/jwt": major
"@fluojs/metrics": major
"@fluojs/microservices": major
"@fluojs/mongoose": major
"@fluojs/notifications": major
"@fluojs/openapi": major
"@fluojs/passport": major
"@fluojs/platform-express": major
"@fluojs/platform-fastify": major
"@fluojs/platform-nodejs": major
"@fluojs/prisma": major
"@fluojs/queue": major
"@fluojs/redis": major
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

Adopt Node.js 24 LTS as the supported floor for Node-bound packages and all generated Node starters, with `engines.node: ">=24.0.0 <27"`. Config's Node-only env-file and watch features adopt the same support policy while its portable root keeps no package-wide Node engine. The other seven portable engine omissions remain intact.

Migration: Node.js 20 and Node.js 22 support is removed. Upgrade local development, CI runners, and deployment hosts to latest Node.js 24 LTS in `>=24.0.0 <27` before installing this major release. Replace both build and runtime container images with Node 24 images such as `node:24-slim`, reinstall dependencies and native addons, and rerun build, typecheck, tests, and application startup. Existing generated Node projects must update their own engines, Vite server target to `node24`, and Node typings to `@types/node@^24.0.0`, then refresh their lockfile. Keep Bun/Deno/Workers deployment metadata native and upgrade only Node-hosted tooling; portable config callers should continue passing explicit in-memory maps.

Exact Node 24.0.0 and latest Node 26.x are separate verification claims; latest Node 24.x owns canonical verification and release automation. Node 26 is verification-only, never a publish runtime. See `docs/reference/node-support.md` and its Korean companion for the full migration. #3679 reconciles coordinated release metadata; this change does not alter package versions or publish.
