---
"@fluojs/passport": major
---

Fix refresh-token module provider ownership, preserve cookie authentication error classifications, and support configured cookie TTL defaults. Document the refresh principal shape and Passport.js bridge request and shutdown boundaries.

Migration: Move constructor dependencies of a class passed to `RefreshTokenModule.forRoot(...)` into an application-owned module that exports them, then pass that module through `RefreshTokenModule.forRoot(service, { imports: [DependenciesModule] })`. Do not re-register the service class in the importing module's `providers`; `RefreshTokenModule` owns it and exports `REFRESH_TOKEN_SERVICE`. String and symbol service tokens may be visible through imported module exports, global exports, or bootstrap runtime providers.
For the companion Node support change, Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release.
