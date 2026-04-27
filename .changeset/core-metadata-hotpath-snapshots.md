---
"@fluojs/core": patch
---

Reduce module and class DI metadata read-path allocations by returning frozen snapshots that may reuse stable references between metadata writes. Migration caveat: consumers of `@fluojs/core/internal` must treat `getModuleMetadata()`, `getOwnClassDiMetadata()`, `getInheritedClassDiMetadata()`, and `getClassDiMetadata()` results and their collection fields as immutable; `useValue` payload objects and runtime middleware/guard/interceptor instances are not frozen by this change.
