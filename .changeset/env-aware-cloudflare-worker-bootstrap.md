---
"@fluojs/platform-cloudflare-workers": minor
---

Add `createCloudflareWorkerEnvEntrypoint(...)` for lazy Worker bootstrapping from the first explicit environment. The factory selects and caches the root module and final bootstrap options once per isolate; each application generation, including a successful-close restart, uses that first-environment configuration without rerunning the factory.
