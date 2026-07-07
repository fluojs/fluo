---
"@fluojs/cron": patch
---

Preserve distributed lock lifecycle contracts by validating enabled lock TTLs before Redis I/O, bounding shutdown lock release attempts, retaining local ownership when release I/O times out, and returning immutable scheduling descriptor snapshots.
