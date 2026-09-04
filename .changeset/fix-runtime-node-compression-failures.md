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
`@fluojs/cli` and every affected published runtime consumer now require Node
`>=20.19.3 <21 || >=22.2.0 <27` to match their mandatory runtime dependency. Node 21 is
unsupported, and Node 27 is unsupported. Move each process to Node >=20.19.3 <21 or Node
>=22.2.0 <27 before updating.
