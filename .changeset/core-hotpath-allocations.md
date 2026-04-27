---
'@fluojs/core': minor
---

Reduce repeated metadata read allocations for large dependency graphs by storing immutable snapshots and normalizing legacy injection tokens at decorator creation time.

The `getClassDiMetadata()` and `getOwnClassDiMetadata()` readers now return frozen snapshots, so returned metadata cannot be mutated directly. Stable reference reuse removes hot-path clones when metadata has not changed, and consumers that previously mutated returned metadata must update their code to copy first or use the supported writer path.
