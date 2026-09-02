---
"@fluojs/notifications": major
---

Isolate lifecycle event observation snapshots from notification dispatch so publishers cannot change channel routing, queued jobs, derived identity, or provider payloads.

Migration: Treat `NotificationLifecycleEvent` values as read-only observation snapshots. Move any delivery policy that previously mutated lifecycle event fields into application code before `NotificationsService.dispatch(...)`.
