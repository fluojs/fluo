---
"@fluojs/graphql": patch
---

Keep GraphQL/Yoga HTTP and SSE loading on Web-standard request/response imports within the supported Node.js 20.16.0+ package boundary, while keeping the Node-only `graphql-ws`/`ws` upgrade transport behind the opt-in websocket subscription path.
