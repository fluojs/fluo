---
"@fluojs/email": patch
---

Preserve binary email attachment views through JSON queue storage and restore Uint8Array content before transport delivery.

Reject unsupported or malformed stored attachment payloads before transport delivery, and preserve structurally assignable public queue jobs.

Keep direct notification and native/string attachment objects unchanged when no wire bytes require decoding, preserving inherited fields.

Preserve original notification JSON projections when no native encoding is needed, and retain getter-based attachment filenames and MIME types through single and bulk queue serialization.
