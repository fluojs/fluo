---
"@fluojs/platform-fastify": patch
---

Run Fastify `onClose` cleanup when shutdown cancels startup, including after the final port bind completes, without masking the startup failure when cleanup also rejects. Mutable startup rejection objects retain their identity and expose cleanup failures through `cause`; frozen or primitive rejections instead throw a startup-first `AggregateError` because identity preservation and cleanup reachability cannot both be guaranteed.
