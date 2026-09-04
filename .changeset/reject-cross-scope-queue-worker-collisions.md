---
"@fluojs/queue": minor
---

Add application-supplied BullMQ `ownershipNamespace` validation for cross-scope worker ownership. Queue now groups collisions by `(ownershipNamespace, jobName)` rather than the DI-only `clientName`; unconfigured identities emit 2.x compatibility diagnostics by default, and `ownershipEnforcement: 'reject'` opts into bootstrap rejection before BullMQ resources are created.
