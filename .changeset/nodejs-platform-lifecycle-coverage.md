---
"@fluojs/platform-nodejs": patch
"@fluojs/runtime": patch
---

Harden the Node.js platform contract by validating lifecycle retry/shutdown options, preserving `x-correlation-id` as the request ID fallback on Node-backed requests, and documenting package-local coverage for listen retry and keep-alive shutdown behavior.
