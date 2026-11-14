---
"@fluojs/core": patch
---

Throw `InvariantError` for route metadata missing a method or path while preserving the existing error message. Align `FrameworkService` with the standard class decorator type. Deprecate the internal `defineInjectionMetadata` and `getInjectionSchema` helpers for removal in the next `@fluojs/core` major release, preserving their current exports and runtime behavior.
