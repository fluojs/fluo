---
"@fluojs/platform-fastify": major
---

`close()` waits only up to `shutdownTimeoutMs` for Fastify close completion. On timeout, the caller-facing `close()` promise rejects while the underlying Fastify close and adapter cleanup continue until settlement. Consumers that relied on `await close()` as proof that shutdown completed must handle timeout rejection separately and allow the retained close operation to finish before treating the process as fully stopped.
