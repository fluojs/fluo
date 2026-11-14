---
"@fluojs/http": patch
---

Read only own properties when binding class DTO fields from body, query, path,
and cookie sources. Inherited values now follow the existing missing-field path:
required fields return HTTP 400 with MISSING_FIELD, while Optional fields retain
their constructor-initialized values without invoking converters.
