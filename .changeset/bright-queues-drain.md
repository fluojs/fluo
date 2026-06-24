---
'@fluojs/queue': patch
---

Drain pending queue dead-letter writes during worker startup rollback before releasing Redis lifecycle state.
