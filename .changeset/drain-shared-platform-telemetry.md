---
"@fluojs/metrics": patch
---

Drain queued telemetry scrapes and remove framework-owned platform telemetry from
a shared Registry after its final metrics module registration closes.
