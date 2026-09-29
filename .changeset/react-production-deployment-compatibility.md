---
'@fluojs/react': minor
'@fluojs/http': patch
'@fluojs/cli': patch
---

Require v2 React navigation payloads and build identity for production navigation; derive the identity from the complete Vite manifest and asset base. The generated React starter serves hashed same-origin assets and offers explicit recovery across deployments.

Consumers of the previous v1 negotiation must pass the manifest-derived `navigationBuildId` to `ReactModule.forRoot(...)` and `ReactClientRouterProvider`, update their Accept handling to `v=2`, and deploy retained old-build assets before switching the manifest. Old v1 tabs use document fallback; no automatic reload or cross-origin CDN support is implied.
