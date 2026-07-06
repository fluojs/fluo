---
'@fluojs/event-bus': major
---

Fail EventBus bootstrap when discovered handler targets cannot be resolved, and limit factory-provider handler discovery to explicit class-token handlers so unrelated singleton factories are not invoked during readiness wiring.
