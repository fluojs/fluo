---
"@fluojs/mongoose": patch
---

Fix the English and Korean manual-session README examples to use a concrete native connection and narrow ambient sessions to native ClientSession values. The examples now compile with Mongoose public types, preserve active session identity, and reject incompatible sessions before executing a query.
