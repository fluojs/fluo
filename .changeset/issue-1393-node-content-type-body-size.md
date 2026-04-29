---
"@fluojs/platform-nodejs": patch
"@fluojs/runtime": patch
---

Fix the raw Node adapter to recognize mixed-case JSON and multipart content types, and fail fast when `maxBodySize` is configured with a non-numeric value instead of byte-count input.
