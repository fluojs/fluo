---
"@fluojs/platform-bun": patch
---

Wait for Bun server termination as well as accepted-request drain before `close()` settles and releases adapter state.
