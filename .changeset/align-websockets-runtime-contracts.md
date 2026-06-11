---
"@fluojs/websockets": patch
---

Align websocket runtime contracts by keeping shared root types runtime-neutral, tightening Node upgrade guard typing to `IncomingMessage`, documenting room service and payload normalization behavior, and adding package-local regression coverage for room operations, bounded shutdown cleanup, heartbeat opt-out, and under-limit text payload dispatch.
