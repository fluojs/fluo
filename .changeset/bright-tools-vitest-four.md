---
'@fluojs/testing': major
'@fluojs/vite': patch
---

Require Vitest 4.1.11 or newer within the Vitest 4 release line for the public mock helpers and `@fluojs/testing/vitest` tooling entrypoints.

Update the Vite plugin documentation to describe the workspace Vite 8.2.2/Rolldown verification gate while preserving the published `vite >=6.2.0` peer contract.

Migration: Node.js 20 and Node.js 22 support is removed; all Node.js versions below 24 and Node.js 27+ are unsupported. Upgrade local development, CI, container build/runtime stages, and production to Node.js >=24.0.0 <27 before installing this coordinated release. Upgrade `vitest` from version 3 to `^4.1.11` in workspaces that consume `@fluojs/testing` mock or Vitest tooling surfaces.
