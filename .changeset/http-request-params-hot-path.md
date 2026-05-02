---
"@fluojs/http": patch
---

Reduce dispatcher route-param update overhead by using direct assignment for standard writable request objects while preserving descriptor-based fallback behavior for custom request shapes.
