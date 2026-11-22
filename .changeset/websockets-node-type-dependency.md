---
"@fluojs/websockets": patch
---

Ship `@types/ws` as a dependency so isolated TypeScript consumers of
`@fluojs/websockets/node` can resolve its existing WebSocket types without
installing `ws` or `@types/ws` directly.
