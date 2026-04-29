---
'@fluojs/websockets': patch
---

Fix Deno and Cloudflare Workers websocket payload limit checks so string frames no longer depend on Node's `Buffer` global before runtime handlers run.
