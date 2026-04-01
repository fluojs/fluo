# toolchain contract matrix

<p><strong><kbd>English</kbd></strong> <a href="./toolchain-contract-matrix.ko.md"><kbd>한국어</kbd></a></p>


This matrix locks the public toolchain contract for generated apps and release-readiness examples.

| Surface | Status | Contract |
| --- | --- | --- |
| `tsconfig.json` in generated apps | `generated (stable)` | Bundler module resolution, `strict: true`, declarations enabled, `rootDir: src`, Node types only |
| `tsconfig.build.json` in generated apps | `generated (stable)` | Extends the main config, emits declarations and JS to `dist`, excludes `src/**/*.test.ts` |
| `babel.config.cjs` in generated apps | `generated (stable)` | `@babel/preset-typescript` plus the decorators plugin with `{ version: '2023-11' }` |
| `vitest.config.ts` in generated apps | `generated (stable)` | Node test environment, `src/**/*.test.ts`, uses the Konekti decorators plugin |
| Generated dev dependencies | `public contract` | `@babel/cli ^7.26.4`, `@babel/core ^7.26.10`, `@babel/plugin-proposal-decorators ^7.28.0`, `@babel/preset-typescript ^7.27.1`, `@types/babel__core ^7.20.5`, `@types/node ^22.13.10`, `tsx ^4.20.4`, `typescript ^5.8.2`, `vite ^6.2.1`, `vitest ^3.0.8` |
| Generated package scripts | `public contract` | `dev`, `build`, `typecheck`, `test`, `test:watch` keep the current single-app command shape |
| `@konekti/cli` prompt flow | `public contract` | Canonical path is `pnpm add -g @konekti/cli` then `konekti new` |
| Workspace root TypeScript / Vite / Vitest wiring | `internal-only` | Root repo config files support package development and are not copied into generated apps |
| Packed tarball local-bootstrap path | `internal-only` | `.konekti/packages/*` is testing support for release-readiness verification only |

## unsupported or narrower-guarantee combinations

- `esbuild` instead of Babel for generated apps — unsupported today because the decorators transform and generated build contract are verified only with Babel.
- `Jest` instead of Vitest for generated apps — unsupported today because the starter test harness and release-readiness gate are built around Vitest.

## official-example contract

- The generated starter and the release-readiness scaffold tests pin the same TypeScript/Babel/Vite/Vitest versions listed above.
- Official examples are expected to use the same config shapes as generated apps unless a guide explicitly marks a file as `internal-only`.

## runtime and manifest parity notes

- Runtime support tiers and bootstrap-policy changes are documented in `../operations/release-governance.md`.
- The shared Babel decorators transform contract is the product contract.
- Runtime helper reads remain the semantic source of truth.
- Compile-time manifest generation may become an optimization later, but it must not change observable framework semantics.
- Benchmark gains without semantic parity are not sufficient for manifest adoption.

## current public packaging stance

- `tooling/*` workspaces remain internal-only support packages
- the current public bootstrap contract stays package-first through `@konekti/cli`
- no additional public toolchain package surface is promised today

## naming and generation conventions

The Konekti CLI uses consistent suffix rules and a granular generation philosophy.

### naming conventions

Generated files follow these suffix patterns:

- **Controllers**: `user.controller.ts`
- **Services**: `user.service.ts`
- **Repositories**: `user.repo.ts`
- **Request DTOs**: `user.request.dto.ts`
- **Response DTOs**: `user.response.dto.ts`

### generator philosophy

- **Granularity**: Use individual generators to build components.
- **Explicit DTOs**: Request and response DTOs are managed via separate schematics.
- **Simplicity**: Complex monolithic generators are avoided in favor of explicit composition.

### package manager selection

The scaffold auto-detects the active package manager by default. This behavior can be overridden using the `--package-manager` flag during `konekti new`.
