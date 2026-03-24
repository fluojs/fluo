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
- `@konekti/dto-validator`
- `@konekti/http`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/platform-fastify`
- `@konekti/platform-socket.io`
- `@konekti/microservices`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/openapi`
- `@konekti/graphql`
- `@konekti/serializer`
- `@konekti/metrics`
- `@konekti/cron`
- `@konekti/cqrs`
- `@konekti/event-bus`
- `@konekti/websocket`
- `@konekti/queue`
- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/terminus`
- `@konekti/testing`
- `@konekti/cli`

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
- `pnpm verify:release-candidate` updates the `CHANGELOG.md` draft release-candidate entry in `## [Unreleased]`

## release checklist

1. `pnpm verify:release-candidate`
2. confirm docs match the current package surface and bootstrap contract
3. confirm any manifest decision note still matches benchmark evidence
4. confirm release tag has a matching GitHub Release body derived from `CHANGELOG.md`
5. attach `tooling/release/release-candidate-summary.md` to the GitHub Release

## release-candidate gate

`pnpm verify:release-candidate` currently proves:

- package typecheck + build succeed from the monorepo root
- scaffolded starter projects are verified through the packed CLI entrypoint and starter scaffolding exercised by the CLI test suite that runs inside `pnpm verify:release-candidate`
- the `pnpm` starter project path passes `typecheck`, `build`, `test`, and `konekti g repo ...`, while CLI tests separately cover package-manager selection behavior
- generated starter projects expose runtime-owned `/health` + `/ready` and the starter-owned `/health-info/` route
- CLI bins and packed package artifacts work from `dist` output rather than `src`-only execution

The command also writes `tooling/release/release-candidate-summary.md`, and CI publishes that summary as both a workflow summary and an artifact.

The matching CI entry lives at `.github/workflows/release-candidate.yml`.

## GitHub Releases

- tag-based releases use `.github/workflows/github-release.yml`
- each `v*` tag creates a GitHub Release whose body is extracted from the matching `CHANGELOG.md` section
- each GitHub Release uploads `tooling/release/release-candidate-summary.md` as a release asset
