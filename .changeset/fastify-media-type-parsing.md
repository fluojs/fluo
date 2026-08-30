---
"@fluojs/platform-fastify": patch
---

Parse only the primary `Content-Type` media type when selecting multipart raw-body handling and JSON string response serialization, so media-type parameters cannot misclassify requests or responses.
