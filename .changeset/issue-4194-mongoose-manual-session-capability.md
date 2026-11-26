---
'@fluojs/mongoose': patch
---

Reject incomplete manual sessions before starting a native transaction or running the callback when `transaction()` or `requestTransaction()` requires after-commit support. End the acquired session once when possible and preserve the existing Result rollback capability error when both options require unsupported methods.
