---
"@fluojs/redis": patch
---

Harden Redis lifecycle timeout validation and shutdown fallback handling so invalid timeout values fail fast and disconnect fallback only rethrows when the client remains open.
