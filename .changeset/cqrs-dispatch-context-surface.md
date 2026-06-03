---
'@fluojs/cqrs': patch
---

Align the CQRS source and generated declaration surface with the documented runtime-agnostic dispatch context contract by keeping `CqrsDispatchContext` opaque, ignoring caller-shaped topology internals unless CQRS created the context, and keeping low-level provider assembly behind `CqrsModule.forRoot(...)`.
