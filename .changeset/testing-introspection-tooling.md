---
'@fluojs/di': minor
'@fluojs/runtime': patch
'@fluojs/platform-nodejs': patch
'@fluojs/platform-express': patch
'@fluojs/platform-fastify': patch
'@fluojs/testing': patch
---

Add an explicit DI container resolution-state introspection seam for framework testing helpers, remove HTTP portability startup-log assertions from global console monkey-patching, cache Vitest workspace alias scans per repository root, and harden testing package documentation and regression coverage.
