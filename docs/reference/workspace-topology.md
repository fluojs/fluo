# workspace topology

<p><strong><kbd>English</kbd></strong> <a href="./workspace-topology.ko.md"><kbd>한국어</kbd></a></p>

This document captures the current repo topology and which areas are public product surface versus internal implementation support.

## top-level structure

```text
konekti/
├── README.md
├── docs/
├── packages/
├── tooling/
├── .github/
└── package.json / pnpm-workspace.yaml / tsconfig.tools.json
```

## public workspaces

The following workspaces map to public package surfaces:

- `packages/core`
- `packages/config`
- `packages/di`
- `packages/http`
- `packages/runtime`
- `packages/testing`
- `packages/dto-validator`
- `packages/jwt`
- `packages/passport`
- `packages/openapi`
- `packages/metrics`
- `packages/redis`
- `packages/prisma`
- `packages/drizzle`
- `packages/cli`

## internal workspaces and support directories

- `tooling/babel`
- `tooling/tsconfig`
- `tooling/vite`
- `tooling/vitest`
- `tooling/release`

These directories support development, packaging, and verification. They are not automatically part of the generated app surface.

## contributor mental model

- `docs/` -> cross-package current truth
- `packages/*/README*.md` -> package-local truth
- `tooling/` -> internal support contracts and verification helpers
- GitHub Issues -> active planning and backlog

## non-goals

- preserving legacy package names that no longer exist in the real workspace
- documenting hypothetical future workspaces as if they already ship

## related docs

- `./package-surface.md`
- `./toolchain-contract-matrix.md`
- `../documentation-model.md`
