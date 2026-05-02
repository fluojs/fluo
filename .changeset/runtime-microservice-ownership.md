---
"@fluojs/runtime": minor
---

Harden runtime microservice ownership by cascading parent application shutdown to connected microservices, rolling back started children when `startAllMicroservices()` fails, and preserving original microservice bootstrap errors when cleanup also fails.

The root `@fluojs/runtime` entrypoint no longer exports `renderRuntimeDiagnosticsMermaid`; Mermaid rendering is Studio-owned, so consumers that need Mermaid output should migrate to the Studio contract path and call `renderMermaid(snapshot)` from `@fluojs/studio/contracts`.
