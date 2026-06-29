---
'@fluojs/metrics': patch
---

Harden platform telemetry scrapes so missing platform-shell registration uses container presence checks, registered shell resolution failures still surface, and component ids or kinds containing separator-like text keep distinct Prometheus series.
