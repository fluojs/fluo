---
'@fluojs/queue': patch
---

Drain pending queue dead-letter writes during worker startup rollback before releasing Redis lifecycle state, and harden scoped queue registrations with explicit unique scopes, scoped public token helpers, and module-graph Redis visibility checks.
