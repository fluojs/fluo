---
"@fluojs/cli": patch
---

Harden CLI Studio dev-runner contracts by rejecting native/raw-watch Studio combinations, preventing sidecar heartbeat timers from starting on listen failures, and routing fallback update-check prompts through injected IO streams.
