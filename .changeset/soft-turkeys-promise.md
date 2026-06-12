---
"@fluojs/discord": patch
---

Serialize Discord startup and shutdown transport lifecycle transitions so shutdown drains in-flight factory-owned transport creation and closes owned resources exactly once.
