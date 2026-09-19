---
"@fluojs/cqrs": major
---

Remove CQRS handler option arrays, Symbol bus tokens, manual metadata helpers, the direct status snapshot helper, and `DuplicateEventHandlerError`. Register handlers and sagas once in business-module providers, then inject lifecycle bus service classes directly.
