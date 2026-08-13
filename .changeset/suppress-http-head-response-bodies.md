---
"@fluojs/http": patch
"@fluojs/testing": patch
---

Suppress framework-managed response bodies for `HEAD` requests while preserving selected status and headers across successful, canonical JSON error, negotiated error, and `406` outcomes.

Extend the shared HTTP adapter portability assertion to cover successful and canonical JSON `HEAD` responses across supported network and fetch-style adapters.
