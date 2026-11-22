---
'@fluojs/mongoose': patch
---

Restore delegated `connection.transaction(...)` session cleanup settlement ordering. The installed Mongoose peer fires `endSession()` from its transaction `finally` without awaiting the returned promise, so after-commit hooks and shutdown `dispose(connection)` could run before the peer-owned cleanup settled. Delegated boundaries now wait for that cleanup settlement before draining hooks and before active-session tracking ends, matching the documented manual-session guarantee without calling `endSession()` a second time or replacing the native delegate.
