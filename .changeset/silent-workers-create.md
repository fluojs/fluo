---
'@fluojs/platform-cloudflare-workers': patch
'@fluojs/cli': patch
---

Unify Cloudflare Workers application creation on `CloudflareWorkerApplicationHost.create(...)` and adapter creation on `CloudflareWorkerHttpApplicationAdapter.create(...)`. Migrate Worker starter output to the host API. Replace the retired Worker bootstrap and entrypoint helpers with the host's fixed-module and `{ fromEnv }` overloads; env-configured hosts require `ready(env)`.
