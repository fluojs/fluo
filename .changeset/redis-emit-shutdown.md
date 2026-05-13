---
"@fluojs/microservices": patch
---

Reject Redis Pub/Sub and Redis Streams event emits once transport shutdown has started so no outbound work is accepted during a closing lifecycle.
