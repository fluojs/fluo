---
"@fluojs/openapi": patch
---

Deduplicate generated OpenAPI operations by path and method so explicit descriptors consistently take precedence over discovered sources and operation IDs remain unique.
