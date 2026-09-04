---
'@fluojs/di': major
---

Seal `Container` child-scope construction behind `createRequestScope()`. `new Container()` continues to create a root container, but direct constructor arguments now fail at runtime and are no longer accepted by the emitted declaration. Replace direct child construction with `parent.createRequestScope()`.
