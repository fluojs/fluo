---
"@fluojs/email": patch
---

Preserve binary email attachment views through JSON queue storage and restore Uint8Array content before transport delivery.

Reject unsupported or malformed stored attachment payloads before transport delivery, and preserve structurally assignable public queue jobs.
