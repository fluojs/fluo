---
"@fluojs/notifications": major
---

Isolate lifecycle event observation snapshots from notification dispatch so publishers cannot change channel routing, queued jobs, derived identity, or provider payloads.

Migration: Treat `NotificationLifecycleEvent` values as read-only observation snapshots. Mutable built-ins are now immutable data representations: `Map` and `Set` use ordered entries/values, `Date` uses epoch milliseconds (`null` when invalid), `URL` uses `href`, `URLSearchParams` uses its query string, and `RegExp` uses source, flags, and `lastIndex`. Move any delivery policy that previously mutated lifecycle event fields or relied on native built-in instances into application code before `NotificationsService.dispatch(...)`.
