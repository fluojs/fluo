---
"@fluojs/serialization": patch
---

Preserve opaque and self-serializing values in `serialize()`: built-ins created in another realm (such as through `node:vm`), `ReadableStream` and `Blob` values, and undecorated class instances with a callable `toJSON()` now pass through unchanged instead of being flattened to `{}`. Classes with serialization metadata keep metadata-driven shaping even when they define `toJSON()`.
