---
"@fluojs/di": patch
"@fluojs/testing": patch
---

Harden DI request-scope lifecycle and introspection ownership by recursively disposing nested request scopes from their owners, returning read-only introspection state, and keeping testing cache adoption on controlled container-owned APIs.
