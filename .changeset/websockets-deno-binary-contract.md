---
'@fluojs/websockets': patch
---

Normalize Deno websocket binary frames across `ArrayBuffer`, typed array, and `Blob` hosts so gateway message dispatch and payload limits match the documented cross-runtime contract.
