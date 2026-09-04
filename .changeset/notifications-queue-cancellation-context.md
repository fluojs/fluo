---
"@fluojs/notifications": minor
---

Forward `NotificationDispatchOptions.signal` through the optional `NotificationsQueueContext` passed to single, native bulk, and sequential fallback queue adapters. Pre-aborted queue handoffs now fail before adapter I/O, while adapters receive the same live signal to apply their own cancellation policy.
