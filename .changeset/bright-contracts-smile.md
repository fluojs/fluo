---
"@fluojs/serialization": patch
"@fluojs/validation": patch
---

Avoid installing `Symbol.metadata` during validation and serialization imports, export the public `TransformFunction` type from serialization, and add regression coverage for documented validation and HTTP serialization contracts.
