---
'@fluojs/cli': major
---

Require an explicit platform selection before the NestJS bootstrap codemod creates an HTTP adapter.

Migration: `fluo migrate <path> --apply` now preserves adapter-unknown NestJS bootstraps and reports a required warning. To migrate an Express bootstrap, install `@fluojs/platform-express` and `express`, then run `fluo migrate <path> --apply --platform express`.
