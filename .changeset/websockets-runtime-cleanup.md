---
"@fluojs/websockets": patch
"@fluojs/socket.io": patch
---

Tighten fetch-style websocket runtime contracts by exposing `Request`-typed upgrade guards, pre-index gateway handlers to avoid hot-path dispatch filtering, keep Socket.IO descriptor handling aligned with the shared indexed handler contract, drain Node shutdown handlers once across attachments, and add close-code regression coverage for oversized fetch-style payloads.
