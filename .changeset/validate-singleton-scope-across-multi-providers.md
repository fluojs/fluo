---
"@fluojs/di": minor
---

Validate singleton dependency scopes across multi-provider registrations.

A singleton that injects a multi token whose contributions include a request-scoped provider now fails with `ScopeMismatchError` before any provider factory or constructor runs, instead of materializing part of the contribution set and then failing with `RequestScopeResolutionError`. The same traversal now covers alias (`useExisting`) chains that target a multi token.
