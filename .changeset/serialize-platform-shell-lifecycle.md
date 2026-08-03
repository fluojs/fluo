---
'@fluojs/runtime': patch
---

Serialize PlatformShell lifecycle transitions so overlapping start or stop calls share in-flight work and shutdown waits for an active startup before cleaning up components.
