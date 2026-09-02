---
"@fluojs/platform-cloudflare-workers": minor
---

Add `createCloudflareWorkerEnvEntrypoint(...)` for lazy Worker bootstrapping from the first explicit environment. The factory can select the root module and final bootstrap options before registration, then reuses the configured application per isolate.
