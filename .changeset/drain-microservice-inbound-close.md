---
'@fluojs/microservices': patch
'@fluojs/runtime': patch
---

Make microservice shutdown terminally idempotent, wait for already-admitted inbound handlers before transport cleanup, and preserve failed close results without retrying teardown.
