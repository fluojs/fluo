---
'@fluojs/i18n': patch
---

Correct the 2.0 migration rationale: the optional `@fluojs/i18n/http` subpath uses `@fluojs/http`'s `RequestContext` boundary, while the root entry point remains framework-agnostic. Upgrading `@fluojs/i18n` does not require `ResponseFormatter` migration work.
