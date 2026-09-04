---
"@fluojs/metrics": patch
"@fluojs/runtime": patch
---

Drain queued telemetry scrapes and remove framework-owned platform telemetry from
a shared Registry after its final metrics module registration closes. Delay platform
component shutdown until module teardown, including telemetry scrape draining, completes.
