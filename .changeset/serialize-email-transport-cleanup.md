---
'@fluojs/email': patch
---

Serialize factory-owned email transport cleanup across bootstrap verification failure and application shutdown so each transport closes at most once.
