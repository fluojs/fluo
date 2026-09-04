---
"@fluojs/core": major
"@fluojs/config": patch
---

Align module metadata collection types with the frozen read-only snapshots returned at runtime and keep the config
module's provider assembly immutable.

Code that intentionally derives a mutable collection from `getModuleMetadata()` must now copy the snapshot first,
for example with `[...metadata.imports]`, instead of mutating the frozen metadata collection directly.
