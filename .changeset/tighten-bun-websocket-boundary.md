---
"@fluojs/platform-bun": patch
"@fluojs/websockets": patch
---

Tighten the Bun websocket binding boundary so raw websocket bindings receive only an upgrade-capable host instead of the adapter-owned Bun server lifecycle/fetch handle, and add Bun adapter regressions for shutdown failure reporting, stale native handoff rematching, custom fetch multipart parsing, and websocket response short-circuit behavior.
