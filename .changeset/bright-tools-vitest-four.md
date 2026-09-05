---
'@fluojs/testing': major
---

Require Vitest 4.1.11 or newer within the Vitest 4 release line for the public mock helpers and `@fluojs/testing/vitest` tooling entrypoints.

Migration: Node.js 21 support is removed. Node.js 20 before 20.19.3, Node.js 22 before 22.2.0, and Node.js 27+ are also unsupported. Upgrade to Node.js >=20.19.3 <21 or Node.js >=22.2.0 <27. Upgrade `vitest` from version 3 to `^4.1.11` in workspaces that consume `@fluojs/testing` mock or Vitest tooling surfaces.
