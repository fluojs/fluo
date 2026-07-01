---
"@fluojs/platform-bun": patch
"@fluojs/websockets": patch
---

Tighten the Bun websocket binding boundary so raw websocket bindings receive only an upgrade-capable host instead of the adapter-owned Bun server lifecycle/fetch handle, and add Bun adapter regressions for shutdown failure reporting, stale native handoff rematching, custom fetch multipart parsing, and websocket response short-circuit behavior.

This remains a patch-level boundary tightening because the low-level Bun websocket binding seam has no known external consumers yet. New binding code should depend only on `BunWebSocketUpgradeHost.upgrade(...)`; keep direct `server.fetch(...)` or `server.stop()` usage in the Bun platform adapter lifecycle/fetch integration instead of the websocket binding seam.
