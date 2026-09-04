---
'@fluojs/di': patch
---

Validate the whole `Container.override(...)` batch before mutating the graph so a rejected call leaves every earlier provider, cached instance, and disposal ownership unchanged.
