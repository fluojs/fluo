---
"@fluojs/platform-deno": patch
---

Roll back already registered Deno shutdown signal listeners when later signal registration fails, and document the tightened Deno lifecycle and websocket fallback contracts.
