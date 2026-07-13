---
'@fluojs/metrics': patch
---

Release shared Registry telemetry scrape wrappers on application shutdown and restore the original `metrics()` function after the last metrics module closes.
