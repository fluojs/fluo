---
"@fluojs/openapi": major
---

Align `@fluojs/openapi` with the Node.js range its mandatory `@fluojs/runtime` dependency already required. The manifest now declares `engines.node >=20.19.3 <21 || >=22.2.0 <27` instead of the previously advertised `>=20.0.0`, which never matched the effective dependency floor because the root entrypoint imports `defineModule` from `@fluojs/runtime`.

Migration: Node.js 21 support is removed, as is Node.js 20 below 20.19.3, Node.js 22 below 22.2.0, and Node.js 27 or newer. Upgrade to Node.js >=20.19.3 <21 or Node.js >=22.2.0 <27 before installing this version. Those runtimes were already outside the effective support boundary through `@fluojs/runtime` and now fall outside the declared range as well, so installing on them may surface an incompatibility diagnostic or be rejected outright depending on the package-manager client and its engine-checking configuration. The OpenAPI API surface, generated document output, and runtime behavior are unchanged.
