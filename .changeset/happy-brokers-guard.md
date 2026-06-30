---
"@fluojs/cli": patch
---

Harden generated broker transport lazy initialization so overlapping first lifecycle calls share one tracked setup, with Studio sidecar auth/privacy and generated test cleanup regressions covered.
