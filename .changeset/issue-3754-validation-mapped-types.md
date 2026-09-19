---
"@fluojs/validation": major
"@fluojs/openapi": minor
"@fluojs/cli": minor
---

Make `@fluojs/validation/mapped-types` the only public import path for
`PickType`, `OmitType`, `PartialType`, and `IntersectionType`. The validation
root no longer exports runtime or declaration aliases.

**Breaking migration:** replace every mapped helper import from
`@fluojs/validation`, `@nestjs/mapped-types`, or mapped bindings from
`@nestjs/swagger` with `@fluojs/validation/mapped-types`. The Nest migration
CLI performs that named-import rewrite while preserving aliases and type-only
bindings, leaving unsupported import forms for manual review.

OpenAPI now projects combined numeric bounds (`Min`/`Max`), string-length, and
array-size constraints using the strongest bounds, intersects and dedupes
`IsIn` with `IsEnum` (emitting `{ not: {} }` for disjoint constraints),
composes distinct `ValidateNested` targets deterministically with `allOf`, and
gives `ValidateNested(..., { each: true })` array-schema precedence.
Regenerate and review committed OpenAPI schema snapshots after upgrading;
generated schemas may change even though validation traversal and validator
issue contracts are preserved.
