---
"@fluojs/testing": patch
---

Harden testing harness cleanup by closing platform conformance components after validation, diagnostics, and snapshot checks, making `createTestApp().close()` idempotent, and preserving cleanup failures for portability `run()` callbacks that surface a partially bootstrapped app.
