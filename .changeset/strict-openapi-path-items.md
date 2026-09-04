---
'@fluojs/openapi': major
---

Reject unsupported handler methods and transformed Path Item keys instead of emitting invalid OpenAPI 3.1 documents.

Migration: Before upgrading, replace `ALL` or custom handler descriptors with supported HTTP method descriptors or exclude them from OpenAPI input. Remove nonstandard Path Item keys such as `all` and `query` from `documentTransform`; retain only standard operations, fixed fields, and `x-*` extensions.
