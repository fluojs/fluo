---
"@fluojs/email": patch
---

Keep root email status snapshots transport-agnostic by omitting queue worker metadata unless callers provide it explicitly, and add regression coverage for caller-owned shutdown, notification payload forwarding, and lifecycle public exports.
