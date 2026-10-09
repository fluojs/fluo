---
"@fluojs/platform-express": patch
---

Defer Express response stream facade creation until first access while preserving eager native header snapshots, mutable facade identity, ordered cookies, and stream lifecycle behavior.
