---
'@fluojs/http': patch
'@fluojs/platform-bun': patch
---

Preserve fluo dispatcher semantics while letting the Bun adapter pre-register safe `Bun.serve({ routes })` entries for static and parameter routes. Same-shape parameter routes and unsupported handler shapes now fall back to fetch-only dispatch instead of changing path-param behavior.
