---
"@fluojs/platform-bun": major
"@fluojs/websockets": major
---

Tighten the Bun websocket binding boundary so raw websocket bindings receive only an upgrade-capable host instead of the adapter-owned Bun server lifecycle/fetch handle, and add Bun adapter regressions for shutdown failure reporting, stale native handoff rematching, custom fetch multipart parsing, and websocket response short-circuit behavior.

This is a breaking Bun websocket binding contract change for consumers that implemented low-level Bun bindings against the previous `BunServerLike` host. Migrate binding code to depend only on `BunWebSocketUpgradeHost.upgrade(...)`; move any direct `server.fetch(...)` or `server.stop()` usage into the Bun platform adapter lifecycle/fetch integration instead of the websocket binding seam.

Release governance: this PR carries major release intent and must not be merged until explicit maintainer approval is granted.
