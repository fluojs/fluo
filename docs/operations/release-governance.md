# release governance

<p><strong><kbd>English</kbd></strong> <a href="./release-governance.ko.md"><kbd>한국어</kbd></a></p>


This file describes the current public release and governance expectations for Konekti.

## stability contract

- `0.x`: public API is still stabilizing; breaking changes are allowed in minor releases and must include migration notes.
- `1.0+`: public contract is stable; breaking changes require a major version bump and a published migration guide.

### `1.0` graduation criteria

`1.0` is only cut when all of the following are true:

- stable public API surface is documented and validated against `docs/reference/package-surface.md`
- migration guides exist for every breaking change introduced during `0.x`
- full test coverage for public package contracts exists across unit/integration/CLI smoke checks and passes in CI
- release and support policy is publicly documented (changelog + GitHub Releases + release governance docs)

## intended publish surface

These packages are the current intended public release surface for the 0.x line:

- `@konekti/core`
- `@konekti/config`
- `@konekti/validation`
- `@konekti/http`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/platform-fastify`
- `@konekti/platform-express`
- `@konekti/platform-socket.io`
- `@konekti/microservices`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/openapi`
- `@konekti/graphql`
- `@konekti/serialization`
- `@konekti/cache-manager`
- `@konekti/metrics`
- `@konekti/cron`
- `@konekti/cqrs`
- `@konekti/event-bus`
- `@konekti/websocket`
- `@konekti/queue`
- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/mongoose`
- `@konekti/terminus`
- `@konekti/testing`
- `@konekti/throttler`
- `@konekti/cli`
- `@konekti/studio`

## support and promotion policy

Support-tier terminology (`official`, `preview`, `experimental`) is defined in `../reference/glossary-and-mental-model.md`.

Promoting a runtime, adapter, or integration to a stronger support tier requires:

- complete documentation and examples
- full test coverage and CI validation
- dedicated troubleshooting guidance

Additional runtimes or integrations are not public guarantees unless they are explicitly documented in package READMEs or governance docs. Current official runtime support is limited to Node.js. Bun and fetch-style adapters remain in **preview**.

The public bootstrap contract remains package-first: `pnpm add -g @konekti/cli` followed by `konekti new`, and the release surface is the published `@konekti/*` package family only.

This package list must stay identical to `../reference/package-surface.md`.

Toolchain workspaces under `tooling/` remain internal support artifacts unless a future issue explicitly promotes one into the public package surface.

## versioning policy

- semver for public packages
- minor releases preserve generated starter commands, toolchain config shapes, and the documented canonical CLI bootstrap contract
- major releases may require app updates when a public contract moves; those releases must ship migration notes in the same window
- coordinated workspace releases happen when public package contracts move together
- internal workspace version bumps follow the public release train but are not public API promises on their own

## current extension boundary

- framework-owned metadata categories are the only documented public metadata contract today
- third-party decorator/metadata extension beyond those framework-owned categories is not a supported public guarantee yet

## changelog and deprecation policy

- every public release should capture package-level changes and migration notes
- deprecations must be announced before removal unless the package is still explicitly experimental/preview
- docs and scaffold output should be updated in the same release window as surface changes
- root `CHANGELOG.md` is the public source of release history and follows Keep a Changelog structure
- `pnpm verify:release-readiness` updates the `CHANGELOG.md` draft release-readiness entry in `## [Unreleased]`

## release checklist

1. `pnpm verify:release-readiness`
2. `pnpm verify:platform-consistency-governance`
3. confirm docs match the current package surface and bootstrap contract
4. confirm any manifest decision note still matches benchmark evidence
5. confirm release tag has a matching GitHub Release body derived from `CHANGELOG.md`
6. attach `tooling/release/release-readiness-summary.md` to the GitHub Release

## release-readiness gate

`pnpm verify:release-readiness` currently proves:

- package typecheck + build succeed from the monorepo root
- scaffolded starter projects are verified through the packed CLI entrypoint and starter scaffolding exercised by the CLI test suite that runs inside `pnpm verify:release-readiness`
- the `pnpm` starter project path passes `typecheck`, `build`, `test`, and `konekti g repo ...`, while CLI tests separately cover package-manager selection behavior
- generated starter projects expose runtime-owned `/health` + `/ready` and the starter-owned `/health-info/` route
- CLI bins and packed package artifacts work from `dist` output rather than `src`-only execution

The command also writes `tooling/release/release-readiness-summary.md`.

### PR CI automation

`.github/workflows/ci.yml` runs on every pull request targeting `main` and on every push to `main`, with event-specific verification scope and safety fallbacks:

- Pull requests first run `tooling/ci/detect-pr-verification-scope.mjs` to resolve scope.
  - If the detector can prove a package-only change safely, PR `build` + `typecheck` run on changed packages plus reverse dependents, and PR `test` runs Vitest on the same affected workspace directories.
  - If scope safety cannot be proven (for example docs/governance/public-surface changes, tooling/workflow changes, root config changes, merge-base/diff uncertainty), CI falls back to full-repo `build`, `typecheck`, and `test`.
  - PRs can explicitly force full verification with the `ci:full-verify` label or `CI_FORCE_FULL_VERIFY=1`.
- Pushes to `main` keep full-repo `build`, `typecheck`, `lint`, and `test`, and additionally run `pnpm verify:release-readiness`, then require a release-grade aggregate gate.

This keeps narrow PR feedback fast while preserving governance safeguards and release-readiness guarantees on `main` release-oriented flows.

`pnpm verify:platform-consistency-governance` enforces the platform consistency governance guardrails:

- SSOT mirror structure checks for `.md` / `.ko.md` document pairs.
- Contract-governing doc changes must include companion updates (docs index, CI/tooling enforcement, regression-test evidence).
- Package README alignment/conformance claims must be backed by harness tests (`createPlatformConformanceHarness(...)`).

## GitHub Releases

- tag-based releases are managed by maintainers through repository release operations
- each `v*` tag creates a GitHub Release whose body is extracted from the matching `CHANGELOG.md` section
- each GitHub Release should include `tooling/release/release-readiness-summary.md` as a release asset when available
