---
"@fluojs/platform-cloudflare-workers": major
---

Require the Worker execution context on the concrete adapter `fetch` contract so every supported ingress registers its lifecycle with `waitUntil`.

Migration: Pass Cloudflare Workers' third `ExecutionContext` argument to every direct `CloudflareWorkerHttpApplicationAdapter.fetch(request, env, ctx)` call. Two-argument direct adapter calls no longer type-check.
