---
"@fluojs/notifications": major
---

Isolate lifecycle event observation snapshots from notification dispatch so publishers cannot change channel routing, queued jobs, derived identity, or provider payloads.

Migration: Treat `NotificationLifecycleEvent` values as read-only observation snapshots. Mutable built-ins are now immutable data representations: `ArrayBuffer` uses byte length and bytes; `ArrayBufferView` also records byte offset and view kind; `Map` and `Set` use ordered entries/values; `Date` uses epoch milliseconds (`null` when invalid); `URL` uses `href`; `URLSearchParams` uses its query string; and `RegExp` uses source, flags, and `lastIndex`. Move any delivery policy that previously mutated lifecycle event fields or relied on native built-in instances into application code before `NotificationsService.dispatch(...)`. Node.js 20.0.0 support is removed below 20.19.3. Node.js 21, Node.js 22.0.0 through 22.1.x, and Node.js 27+ are no longer supported. Upgrade production to Node.js >=20.19.3 <21 || >=22.2.0 <27 before installing this release.
