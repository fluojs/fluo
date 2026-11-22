---
"@fluojs/persistence": patch
---

Preserve request cancellation forwarding and reason identity when an earlier caller signal listener stops event propagation. Keep cleanup idempotent and local controller cancellation independent from the caller.
