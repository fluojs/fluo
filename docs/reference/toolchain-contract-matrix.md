# toolchain contract matrix

<p><strong><kbd>English</kbd></strong> <a href="./toolchain-contract-matrix.ko.md"><kbd>한국어</kbd></a></p>

## generated app baseline

| surface | contract | version / notes |
| --- | --- | --- |
| **TypeScript** | `v6.0+` | `strict: true`, `experimentalDecorators: false`, `module: esnext`, generated configs avoid deprecated `baseUrl` aliasing |
| **Babel** | `v7.26+` | Root workspace pins `@babel/core` `^7.26.10` and `@babel/plugin-proposal-decorators` `^7.28.0` with `{ version: '2023-11' }`. |
| **Vite** | `v6.2+` | Root workspace pins `vite` `^6.2.1` for dev bundling and build orchestration. |
| **Vitest** | `v3.0+` | Root workspace pins `vitest` `^3.0.8`; package-local configs commonly use `^3.2.4`. |
| **Node.js** | `v20+` | Minimum supported runtime baseline declared by the root workspace and published package manifests for Node-based adapters. Bun, Deno, and Cloudflare Workers adapters intentionally omit `engines.node` so their package metadata matches their non-Node runtime contracts. |

## CLI & scaffolding contracts

| goal | command | output contract |
| --- | --- | --- |
| **Project Creation (default HTTP)** | `fluo new my-app` | Generates the compatibility-baseline starter: a single-package Node.js + Fastify HTTP app. |
| **Project Creation (explicit HTTP)** | `fluo new my-app --shape application --transport http --runtime node --platform fastify` | Resolves to the same generated output as the default HTTP starter. |
| **Project Creation (microservice)** | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` | Generates the runnable single-package TCP microservice starter. `--transport redis-streams`, `--transport nats`, `--transport kafka`, `--transport rabbitmq`, `--transport mqtt`, and `--transport grpc` scaffold the other shipped starter variants with transport-specific dependency/env/proto wiring. Broader packages such as `@fluojs/redis` remain post-scaffold integration choices instead of extra `fluo new --transport` values. |
| **Project Creation (mixed)** | `fluo new my-app --shape mixed --transport tcp --runtime node --platform fastify` | Generates the mixed single-package starter: one Fastify HTTP app with an attached TCP microservice. |
| **Interactive wizard** | `fluo new` in a TTY | Resolves onto the same shape-first schema as the non-interactive flags path: project name, shape, tooling preset, package manager, install choice, and git choice. |
| **Resource Generation** | `fluo g <type>` | Produces consistent naming suffixes (`.service.ts`, `.controller.ts`). Request DTOs may target an explicit feature directory with `fluo g req users CreateUser`. |
| **Diagnostics (JSON)** | `fluo inspect <module-path> --json` | Exports runtime-produced graph, readiness, health, and diagnostics snapshot data in JSON format. JSON is also the default output mode when no output mode is selected. `--timing` may be combined with `--json` to include bootstrap timing diagnostics next to the snapshot. |
| **Diagnostics (timing)** | `fluo inspect <module-path> --timing --output artifacts/inspect-timing.json` | Writes standalone bootstrap timing diagnostics as a JSON artifact. Without `--output`, the same timing JSON is written to stdout. |
| **Diagnostics report** | `fluo inspect <module-path> --report --output artifacts/inspect-report.json` | Writes a CI/support triage JSON report containing a stable summary, the runtime-produced snapshot, diagnostics, and bootstrap timing. `--output <path>` is an explicit artifact path and does not make inspection own application writes. |
| **Diagnostics (Mermaid)** | `fluo inspect <module-path> --mermaid` | Delegates snapshot-to-Mermaid rendering to the optional `@fluojs/studio` contract. The CLI loads Studio's renderer, writes the Mermaid text to stdout or `--output <path>`, and does not own graph rendering semantics. |

## inspect artifact output contract

`fluo inspect` supports exactly one primary artifact output mode at a time: `--json`, `--mermaid`, `--report`, or standalone `--timing`. `--output <path>` writes the selected payload to the requested path, creating parent directories when needed, and omits terminal output for that payload. Without `--output`, the selected payload is written to stdout so shell redirection remains valid for CI artifacts.

| mode | payload | artifact contract |
| --- | --- | --- |
| `--json` | `PlatformShellSnapshot` JSON produced by the runtime platform shell. | Stable machine-readable snapshot for Studio, scripts, and support triage. With `--timing`, the payload becomes `{ snapshot, timing }`, where `timing` is versioned bootstrap timing diagnostics. |
| `--timing` | Versioned bootstrap timing diagnostics JSON. | Standalone timing artifact for profiling bootstrap work without carrying the full snapshot. `--timing --output <path>` writes that timing JSON to the requested artifact path. |
| `--mermaid` | Mermaid graph text rendered by `@fluojs/studio` from the runtime snapshot. | Requires `@fluojs/studio` to be resolvable from the inspected project or CLI package. Non-interactive runs fail fast with install guidance when Studio is missing. |
| `--report` | Versioned JSON report with `summary`, `snapshot`, `timing`, and `generatedAt`. | Intended for CI/support artifacts such as `artifacts/inspect-report.json`. The summary includes component, diagnostic, warning, error, readiness, health, and timing totals. |

`--timing` records bootstrap timing diagnostics either as a standalone timing JSON artifact or next to JSON/report workflows. It is not valid with `--mermaid`, because Mermaid rendering remains a Studio-owned snapshot rendering contract rather than a timing artifact format.

## naming conventions (CLI output)

| type | suffix | example |
| --- | --- | --- |
| **Controller** | `.controller.ts` | `users.controller.ts` |
| **Service** | `.service.ts` | `users.service.ts` |
| **Repository** | `.repo.ts` | `users.repo.ts` |
| **DTO (Input)** | `.request.dto.ts` | `users/create-user.request.dto.ts` from `fluo g req users CreateUser` |
| **DTO (Output)** | `.response.dto.ts` | `user.response.dto.ts` |

## build configuration

| stage | tool | contract |
| --- | --- | --- |
| **Transform** | Babel | Applies the Stage 3 decorator transform through `@babel/plugin-proposal-decorators` with `{ version: '2023-11' }`. |
| **Bundle** | Vite | Bundles generated applications for the selected runtime. |
| **Validate** | Vitest | Runs tests against the same decorator configuration. |
| **Constraint** | Replacement tools | Replacing this chain, for example with direct `esbuild` decorator handling, is outside the documented support contract. |

## related reference

- [package-surface.md](./package-surface.md)
