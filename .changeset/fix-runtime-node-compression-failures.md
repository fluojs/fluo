---
"@fluojs/cli": major
"@fluojs/cron": major
"@fluojs/discord": major
"@fluojs/drizzle": major
"@fluojs/mongoose": major
"@fluojs/notifications": major
"@fluojs/passport": major
"@fluojs/redis": major
"@fluojs/runtime": major
"@fluojs/slack": major
"@fluojs/terminus": major
"@fluojs/throttler": major
"@fluojs/websockets": major
---

**Breaking change:** Node response `send()` now rejects when compression fails before the
response commits. Dispatcher-managed requests recover with the standard JSON 500 envelope.

Migration: Await and handle Node response `send()` rejections in adapter integrations. The
fallback removes only the adapter-assigned default `Content-Type`, so its JSON envelope uses
`application/json`; application-owned explicit `Content-Type` values remain unchanged.
Node integration packages own their Node support contract; the portable runtime root has no package-wide Node engine. Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.
