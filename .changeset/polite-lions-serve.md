---
"@fluojs/graphql": patch
---

Preserve the documented portable GraphQL HTTP/SSE bootstrap path by loading core GraphQL/Yoga dependencies through runtime-neutral imports and keeping the Node-only `graphql-ws`/`ws` upgrade transport behind the opt-in websocket subscription path.
