---
'@fluojs/microservices': patch
'@fluojs/runtime': patch
---

Make microservice shutdown terminally idempotent, including synchronous shutdown-marker failures and reentry, wait for already-admitted inbound handlers before transport cleanup, and preserve failed close results without retrying teardown.
