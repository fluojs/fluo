---
"@fluojs/websockets": patch
---

Harden the root WebSocket import boundary so plain `@fluojs/websockets` imports preserve the existing Node default export names without eagerly resolving the concrete Node `ws` implementation until runtime module provider resolution.
