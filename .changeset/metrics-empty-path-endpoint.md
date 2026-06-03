---
"@fluojs/metrics": patch
---

Ensure `endpointMiddleware` remains bound when `MetricsModule.forRoot({ path: '' })` exposes an empty-string metrics endpoint.
