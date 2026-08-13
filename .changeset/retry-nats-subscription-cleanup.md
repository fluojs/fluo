---
'@fluojs/microservices': patch
---

Attempt every NATS subscription cleanup, preserve all failure evidence, and retain failed subscriptions for retry without repeating successful teardown.
