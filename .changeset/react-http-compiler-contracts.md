---
"@fluojs/react": minor
"@fluojs/http": minor
"@fluojs/cli": minor
---

Extend the existing React typegen workflow with compiler-derived HTTP query
bindings, build-mapped page props, and native form field/saved-data contracts.
Add the type-only `HttpWire<Server, Wire>` converter-input declaration and
authoritative HTTP version-selection provenance.

Generated artifact version 2 includes source/type-only/configuration freshness
and limited JSON decoders. Regenerate older artifacts before enabling typegen
checks in application typecheck and build scripts. Strict generated consumers
must use the registered browser module/props pairs and the existing
`useForm({ action, contract })` path rather than copied DTO interfaces or casts.
