---
"@fluojs/mongoose": patch
---

Race Mongoose request transaction session acquisition and delegated `connection.transaction(...)` startup against request aborts, and reject new manual/request transaction boundaries once application shutdown begins.
