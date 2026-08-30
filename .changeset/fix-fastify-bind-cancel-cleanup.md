---
"@fluojs/platform-fastify": patch
---

Run Fastify `onClose` cleanup when shutdown cancels startup, including after the final port bind completes, without masking the startup failure when cleanup also rejects.
