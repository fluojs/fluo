---
"@fluojs/metrics": patch
---

Clarify that `MetricsService` is non-global: modules can inject it by directly importing a `MetricsModule` registration or by importing a module that re-exports `MetricsService`, while unrelated sibling modules do not receive it automatically.
