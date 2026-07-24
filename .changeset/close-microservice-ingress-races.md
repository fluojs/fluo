---
'@fluojs/microservices': patch
'@fluojs/runtime': patch
---

Reject new microservice `send()` and `emit()` calls as soon as shutdown begins, including while `listen()` is still pending, before runtime or transport handoff.
