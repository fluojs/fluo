---
"@fluojs/runtime": major
---

**Breaking change:** Node response `send()` now rejects when compression fails before the
response commits. Dispatcher-managed requests recover with the standard JSON 500 envelope.

**Migration:** Await and handle Node response `send()` rejections in adapter integrations. The
fallback removes only the adapter-assigned default `Content-Type`, so its JSON envelope uses
`application/json`; application-owned explicit `Content-Type` values remain unchanged.
