---
'@fluojs/validation': patch
---

Restore missing-value short-circuiting so `@IsNotEmpty()` skips `null` and `undefined` unless `@IsDefined()` owns requiredness, and `@IsOptional()` bypasses `@ValidateIf()` predicates for missing fields.
