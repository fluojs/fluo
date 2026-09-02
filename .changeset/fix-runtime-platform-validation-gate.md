---
'@fluojs/runtime': patch
---

Stop platform startup when a component validation result reports `ok: false`, retaining a stable diagnostic when the component provides no issues.
