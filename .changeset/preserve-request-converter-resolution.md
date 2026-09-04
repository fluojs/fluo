---
"@fluojs/http": patch
---

Preserve registered DTO converter resolution failures while retaining direct construction only for explicitly unregistered converter classes. Request-scoped converters now keep their container-owned lifecycle and disposal behavior during HTTP binding.
