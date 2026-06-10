---
"@fluojs/terminus": patch
---

Harden Terminus health/readiness diagnostics by preventing overlapping probes for the same timed-out indicator instance and preserving platform diagnostic payloads when user indicator keys collide with reserved platform keys.
