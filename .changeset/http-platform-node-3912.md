---
"@fluojs/platform-express": patch
---

Defer Express response header normalization and stream facade creation until first access while preserving native header snapshots, mutable facade identity, ordered cookies, and stream lifecycle behavior.
