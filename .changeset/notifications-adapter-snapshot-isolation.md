---
"@fluojs/notifications": patch
---

Isolate channel and queue adapter inputs from admitted notification snapshots so adapter byte mutations cannot change lifecycle event values or direct delivery fallback identifiers.
