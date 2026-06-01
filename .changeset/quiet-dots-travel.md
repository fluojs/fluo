---
"@fluojs/graphql": patch
---

Keep the root GraphQL package import portable by loading websocket transport dependencies only when websocket subscriptions are enabled.
