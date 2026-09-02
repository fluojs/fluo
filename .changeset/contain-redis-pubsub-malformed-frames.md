---
"@fluojs/microservices": major
---

Redis Pub/Sub now discards malformed inbound frames before runtime dispatch and reports them through the configured transport logger.

Migration: Ensure every Redis Pub/Sub publisher emits a JSON object with `kind: "event"` and a string `pattern`; malformed frames are no longer forwarded to application handlers.
