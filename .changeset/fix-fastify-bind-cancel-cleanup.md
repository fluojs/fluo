---
"@fluojs/platform-fastify": patch
---

Run Fastify `onClose` cleanup when shutdown cancels startup, including after the final port bind completes, without masking the startup failure when cleanup also rejects. Startup rejection objects retain their identity and expose cleanup failures through `cause` only when that property can be read, written, and read back; every other rejection instead throws a startup-first `AggregateError` because identity preservation and cleanup reachability cannot both be guaranteed.
