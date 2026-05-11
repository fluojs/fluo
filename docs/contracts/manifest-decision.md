# Package Manifest Rules

<p><strong><kbd>English</kbd></strong> <a href="./manifest-decision.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current package manifest contract for public `@fluojs/*` workspace packages.

## Required Fields

| Field | Rule | Repo grounding |
| --- | --- | --- |
| `name` | MUST use the published package name, usually under the `@fluojs/*` scope for public workspace packages. | All public workspace manifests under `packages/*/package.json` use scoped names such as `@fluojs/core`, `@fluojs/http`, and `@fluojs/cli`. |
| `description` | MUST describe the package surface in one sentence. | Present in current public manifests such as `packages/core/package.json` and `packages/microservices/package.json`. |
| `version` | MUST exist in every package manifest. | Present across current workspace packages. |
| `private` | MUST be `false` for packages on the intended publish surface. | Current public package manifests set `"private": false`. |
| `license` | MUST be declared. | Current public package manifests use `MIT`. |
| `repository` | MUST include the monorepo URL and the package directory path. | Current manifests set `repository.url` to `https://github.com/fluojs/fluo.git` and `repository.directory` to the package path. |
| `publishConfig.access` | MUST be `public` for intended public packages. | Required by release governance and present in current public manifests. |
| `type` | MUST be `module`. | Current public package manifests set `"type": "module"`. |
| `exports` | MUST declare the public entrypoints. | All current public package manifests define an `exports` map. |
| `main` | MUST point to the dist-built JavaScript root entrypoint. | Current root entrypoints use values such as `./dist/index.js`. |
| `types` | MUST point to the dist-built declaration root entrypoint. | Current root type entrypoints use values such as `./dist/index.d.ts`. |
| `files` | MUST whitelist publishable output. | Current public package manifests publish `dist`, and `@fluojs/cli` also publishes `bin`. |
| `scripts` | MUST include package-local `build`, `typecheck`, and `test` commands. | Current public package manifests define those commands, with `prebuild` cleanup as the common pattern. |

- `bin` is required only for CLI-style packages that publish an executable. `@fluojs/cli` exposes `fluo` through `./bin/fluo.mjs`.
- `engines.node` is used by many Node-bound packages, but it is not universal across every current public package manifest.

## exports Map Rules

| Rule | Required shape | Repo grounding |
| --- | --- | --- |
| Root export | MUST declare `"."` with both `types` and `import` targets. | `packages/core/package.json`, `packages/http/package.json`, and `packages/cli/package.json` follow this shape. |
| Code subpath export | MAY declare additional subpaths when the package intentionally exposes separate JavaScript surfaces. Each code subpath MUST point to dist-built `.js` and `.d.ts` files. | `@fluojs/email` exports `./queue` and `./node`. `@fluojs/microservices` exports transport subpaths such as `./tcp`, `./grpc`, and `./rabbitmq`. |
| Asset-only subpath export | MAY expose a single static asset under `./dist/` when the package README documents the subpath as an asset entrypoint and TypeScript import resolution is not part of that subpath contract. | `@fluojs/studio/viewer` intentionally resolves to `./dist/index.html` so callers can locate the packaged browser viewer with `require.resolve('@fluojs/studio/viewer')`. |
| Dist-only targets | MUST point at files under `./dist/` for published runtime code, declarations, and documented static asset entrypoints. | Current public packages map exports to `./dist/...` outputs. |
| Root manifest alignment | `main` and `types` MUST match the root `exports["."]` targets. | Current public manifests use `main: ./dist/index.js` and `types: ./dist/index.d.ts` when the root export points to the same files. |
| Subpath TypeScript resolution | SHOULD add `typesVersions` when published subpaths need TypeScript path hints beyond the root `types` field. | `@fluojs/email`, `@fluojs/runtime`, and `@fluojs/websockets` define `typesVersions` for published subpaths. |
| Internal surface control | MUST NOT expose undocumented or accidental source paths through the manifest. | Current packages expose explicit public barrels such as `.` or named subpaths, not raw `src/*` paths. |

## Constraints

- Public package manifests on the intended publish surface MUST keep `publishConfig.access` set to `public` and MUST remain listed in `docs/contracts/release-governance.md` and `docs/reference/package-surface.md`.
- Internal `@fluojs/*` dependencies in `dependencies`, `optionalDependencies`, `peerDependencies`, and `devDependencies` MUST use `workspace:^`.
- The manifest MUST describe the published surface, not the source tree. Published file paths point to `dist` output, not `src` input.
- Optional runtime integrations SHOULD stay explicit through peer dependencies or explicit subpaths instead of weakening the root package contract. Current examples include optional peers in `@fluojs/microservices` and the Node-only `@fluojs/email/node` subpath.
- Runtime-specific or integration-only surfaces SHOULD stay out of the root export when the root package is meant to remain portable. Current examples include `@fluojs/email/node`, `@fluojs/email/queue`, and transport subpaths in `@fluojs/microservices`.
- New public exports MUST stay aligned with the public-export TSDoc baseline and the documented package surface.
- Asset-only subpaths MUST stay explicitly documented in the package README and MUST NOT replace code subpaths that need JavaScript and declaration targets.
