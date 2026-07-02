---
"@fluojs/di": major
"@fluojs/testing": patch
---

Harden DI request-scope lifecycle and introspection ownership by recursively disposing nested request scopes from their owners, returning read-only introspection state, and keeping testing cache adoption on controlled container-owned APIs.

Migration note: callers that used `inspectResolutionState()` as a mutable escape hatch must stop mutating returned registration/cache maps or normalized provider records. Framework-owned tooling should use the returned `cacheOwner` helpers for controlled cache adoption instead of writing to the maps directly.
