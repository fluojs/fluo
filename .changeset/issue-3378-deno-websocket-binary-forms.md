---
"@fluojs/platform-deno": major
---

`DenoWebSocketMessage` now includes the `ArrayBuffer` and `ArrayBufferView` binary
payload forms delivered by Deno websocket bindings. Update exhaustive handlers that
previously covered only `Blob | string`.
