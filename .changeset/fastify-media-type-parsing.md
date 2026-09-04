---
"@fluojs/platform-fastify": patch
---

Parse only the normalized primary `Content-Type` media type when selecting multipart raw-body handling and JSON string response serialization. Treat `application/json` and structured `+json` suffixes as JSON-compatible so media-type parameters cannot misclassify requests or responses.
