---
"@fluojs/mongoose": patch
---

Preserve nested request transaction tracking for ambient manual Mongoose transactions and avoid false session-conflict errors for projection/document fields named `session`.
