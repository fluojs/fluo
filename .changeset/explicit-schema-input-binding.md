---
"@fluojs/http": minor
"@fluojs/validation": minor
"@fluojs/runtime": minor
---

Add opt-in DTO and route input policies for unknown body fields and non-object
bodies while preserving strict defaults, dangerous-key rejection, and original
request visibility for guards and interceptors.

Add createSchemaDto and StandardSchemaBinder for explicit body/path/query
mappings, transport aliases, repeated-query policies, and typed Standard Schema
output binding. Add parseStandardSchema to preserve transformed/defaulted output
and await asynchronous validators without changing validation-only ValidateClass.
Schema failures, including empty issues arrays, remain explicit failures.

Add a bootstrap binder factory that composes once with the configured default
binder, preserving global converters for ordinary DTOs. Pure application contexts,
native parser behavior, and HEAD policies are unchanged.
