---
"@fluojs/platform-fastify": patch
---

Parse only the primary `Content-Type` media type when selecting multipart raw-body handling, so non-multipart request parameters cannot trigger the multipart path.
