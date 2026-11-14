---
"@fluojs/validation": patch
---

Fix `isDtoValidationError` to reject malformed optional issue `field` and `source` values. Valid issues, including all supported metadata sources and omitted optional fields, remain accepted across compatible duplicate package copies.
