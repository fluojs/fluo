---
"@fluojs/platform-express": patch
---

Stop fluo dispatch when native Express middleware ends or destroys the response before calling `next()`.
