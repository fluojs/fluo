---
"@fluojs/mongoose": patch
---

Accept callable Mongoose connections that return the observer's monitored client from `getClient()`, preserving the connection receiver and strict native rollback confirmation.
