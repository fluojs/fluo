---
"@fluojs/cache-manager": major
---

Align `@fluojs/cache-manager` with the Node.js range its mandatory `@fluojs/runtime` dependency already required. The manifest now declares `engines.node >=20.19.3 <21 || >=22.2.0 <27` instead of the previously advertised `>=20.0.0`, which never matched the effective dependency floor.

Consumers on Node.js 20.0.0-20.19.2, Node 21, Node 22 before 22.2.0, or Node 27+ must upgrade to a supported Node.js release before installing this version; those runtimes were already unsupported through `@fluojs/runtime` and now fall outside the declared support range, so installing on them may surface an incompatibility diagnostic or be rejected outright depending on the package-manager client and its engine-checking configuration. The cache-manager API surface and runtime behavior are unchanged.
