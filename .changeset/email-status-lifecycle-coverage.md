---
"@fluojs/email": minor
---

Expose root email lifecycle status APIs for diagnostics, keep status snapshots transport-agnostic by omitting queue worker metadata unless callers provide it explicitly, and cover caller-owned shutdown and notification payload forwarding regressions.
