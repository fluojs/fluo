---
"@fluojs/socket.io": patch
---

Align Socket.IO guard and runtime-boundary contracts by documenting `void`/`undefined` guard returns as accepted, keeping the root `SocketIoHandshakeRequest` export runtime-neutral instead of importing `node:http` directly, and adding regression coverage for explicit ACK callbacks plus shutdown retry cleanup.
