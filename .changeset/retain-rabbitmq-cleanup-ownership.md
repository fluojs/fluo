---
'@fluojs/microservices': patch
---

Retain failed RabbitMQ consumer cleanup ownership so later transport shutdown retries can cancel only the queues that still need cleanup.
