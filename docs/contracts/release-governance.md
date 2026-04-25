# Versioning & Release Rules

<p><strong><kbd>English</kbd></strong> <a href="./release-governance.ko.md"><kbd>한국어</kbd></a></p>

## Stability Tiers

| Tier | Version window | Release rule | Contract level |
| --- | --- | --- | --- |
| Experimental | `0.x` | Public APIs may change in a minor release. Prerelease versions must publish under a non-`latest` dist-tag. | No stable upgrade guarantee. |
| Preview | `0.x` or prerelease builds | Packages are intended for public use, but breaking changes still follow the `0.x` minor-bump rule and require migration notes in `CHANGELOG.md`. | Documented behavior should stay aligned with tests and release notes. |
| Official | `1.0+` | Stable releases publish under `latest`. Breaking changes require a major version bump. | Public API, documented behavior, and release process are treated as stable contracts. |

## Semver Rules

- All public `@fluojs/*` packages follow Semantic Versioning.
- `major` is required for breaking changes in `1.0+`.
- `minor` is used for backward-compatible feature work, and it is also the required bump for breaking changes during `0.x`.
- `patch` is limited to backward-compatible fixes, security fixes, and documentation or tooling updates that preserve documented behavior.
- Prerelease versions are versions with a hyphen suffix. They must publish under a non-`latest` dist-tag such as `next`, `beta`, or `rc`.
- Stable versions without a prerelease suffix must publish under the `latest` dist-tag.
- Intended public package manifests must use `workspace:^` for internal `@fluojs/*` dependencies across dependency, optional dependency, peer dependency, and dev dependency fields.

## Breaking Change Rules

- Treat API shape changes, documented behavior changes, configuration shape changes, bootstrap-order changes, adapter-contract changes, and public package removals as breaking when existing consumer code or configuration must change to keep working.
- In `0.x`, a breaking change may ship only in a minor release, and the release must include a migration note in `CHANGELOG.md`.
- In `1.0+`, a breaking change must ship in a major release.
- Do not classify a change as patch or minor when it changes documented guarantees for lifecycle ordering, shutdown behavior, adapter behavior, readiness behavior, or public CLI and starter contracts.
- Update implementation, tests, and governed docs together when a breaking rule changes.

## Graduation Requirements

A package is ready for `1.0` and the Official tier only when all of the following stay true:

1. The package is an existing workspace package under `packages/*`, remains public, and keeps `publishConfig.access` set to `public`.
2. The package appears in both `docs/reference/package-surface.md` and the `## intended publish surface` list in this document.
3. Public exports satisfy the repository TSDoc baseline, and contract-governing docs keep English and Korean parity.
4. Release verification passes the canonical repository commands: `pnpm build`, `pnpm typecheck`, `pnpm vitest run --project packages`, `pnpm vitest run --project apps`, `pnpm vitest run --project examples`, `pnpm vitest run --project tooling`, `pnpm --dir packages/cli sandbox:matrix`, `pnpm verify:platform-consistency-governance`, and `pnpm verify:release-readiness`.
5. `CHANGELOG.md` keeps the `## [Unreleased]` section, and every `0.x` breaking release includes migration notes before a stable `1.0+` contract is declared.

## Release Metadata Contract

Committed release-intent records are the canonical long-term machine input for release preparation. The root `CHANGELOG.md` remains the human-facing narrative, and GitHub Releases are generated artifacts produced by the supervised CI-only flow.

Each release intent entry must include these fields:

1. Package name, using the published `@fluojs/*` package name.
2. Semver intent, one of `major`, `minor`, `patch`, or `none` when the package has no release.
3. Prerelease or stable intent, including the expected dist-tag when a package is released.
4. Summary, written for maintainers and release reviewers.
5. Migration note when the semver intent is breaking for the package's stability tier.
6. Affected-package rationale, explaining why the package is included in the release set or why it is excluded.

Every package in a release preparation run must use one disposition:

- `release`: publish this package through the supervised CI-only release workflow after release-readiness passes.
- `no-release`: do not publish this package in the current release set, while preserving the rationale in the release-intent record.
- `downstream-evaluate`: review this package because upstream changes may affect it, but do not treat the disposition as automatic downstream publishing.

Package-scoped notes and release-intent records are required for releases prepared after this work lands. `1.0.0-beta.2` is the first enforced fixture/candidate version; releases at or before `1.0.0-beta.1` stay legacy-compatible.


## Migration Assessment: Changesets and Beachball

The current repo-local intent model remains the approved release metadata path. It keeps the release decision inside committed JSON records, requires explicit package dispositions, and treats `downstream-evaluate` as a review decision rather than an automatic publish trigger. This matches the supervised CI-only workflow because `.github/workflows/release-single-package.yml` still publishes exactly one requested package from `refs/heads/main` after release-readiness passes.

Changesets is a useful comparison point because it records contributor-authored semver intent and changelog text in committed files, then consumes those records during version and publish steps. Beachball is a useful comparison point because it records PR-reviewed change files, validates their presence, computes version bumps, generates changelogs, and can publish packages. Neither tool is approved here until its workflow can preserve fluo's release contract without adding local publish paths or broadening the single-package CI boundary.

Go/no-go criteria for any future migration proposal:

1. **Packages per release**: migration is only worth reconsidering if normal releases routinely include multiple `@fluojs/*` packages and the current single-package intent records become harder to review than generated release files.
2. **Downstream evaluation frequency**: migration must show how often `downstream-evaluate` decisions occur and must keep them as human review gates, not automatic dependent-package releases.
3. **Intent maintenance cost**: migration must prove that generated or tool-managed change files reduce maintainer work compared with repo-local intent JSON, without hiding package rationale from review.
4. **Generated package changelog need**: migration must wait until maintainers need package-level changelogs beyond the root `CHANGELOG.md` narrative and generated GitHub Release notes.
5. **CI-only single-package compatibility**: migration must keep main-only workflow dispatch, release-readiness preflight, OIDC npm publish, tag creation, and GitHub Release generation inside `.github/workflows/release-single-package.yml`, with no local `npm publish` replacement.

Recommendation: defer migration. Do not install Changesets, Beachball, or another release automation dependency until package-aware release notes and release intent gates complete at least one real release cycle and the criteria above show that migration would reduce risk instead of expanding the release surface.

## intended publish surface

- `@fluojs/cache-manager`
- `@fluojs/cli`
- `@fluojs/config`
- `@fluojs/core`
- `@fluojs/cqrs`
- `@fluojs/cron`
- `@fluojs/email`
- `@fluojs/discord`
- `@fluojs/di`
- `@fluojs/drizzle`
- `@fluojs/event-bus`
- `@fluojs/graphql`
- `@fluojs/http`
- `@fluojs/jwt`
- `@fluojs/metrics`
- `@fluojs/microservices`
- `@fluojs/mongoose`
- `@fluojs/notifications`
- `@fluojs/openapi`
- `@fluojs/passport`
- `@fluojs/platform-bun`
- `@fluojs/platform-cloudflare-workers`
- `@fluojs/platform-deno`
- `@fluojs/platform-express`
- `@fluojs/platform-fastify`
- `@fluojs/platform-nodejs`
- `@fluojs/prisma`
- `@fluojs/queue`
- `@fluojs/redis`
- `@fluojs/runtime`
- `@fluojs/serialization`
- `@fluojs/slack`
- `@fluojs/socket.io`
- `@fluojs/studio`
- `@fluojs/terminus`
- `@fluojs/testing`
- `@fluojs/throttler`
- `@fluojs/validation`
- `@fluojs/websockets`

## Enforcement

Run these commands when versioning rules, release-governing docs, or intended publish surface packages change:

```bash
pnpm build
pnpm typecheck
pnpm vitest run --project packages
pnpm vitest run --project apps
pnpm vitest run --project examples
pnpm vitest run --project tooling
pnpm --dir packages/cli sandbox:matrix
pnpm verify:public-export-tsdoc
pnpm verify:platform-consistency-governance
pnpm verify:release-readiness
pnpm generate:release-readiness-drafts
pnpm verify:release-readiness --target-package @fluojs/cli --target-version 0.1.0 --dist-tag latest
```

- `pnpm verify:platform-consistency-governance` checks heading parity and governed documentation consistency.
- `pnpm verify:release-readiness` reuses the canonical build, typecheck, split Vitest, sandbox, package-surface sync, and publish-safety checks.
- `pnpm verify:public-export-tsdoc` enforces the public export documentation baseline used by governed packages.
- `pnpm generate:release-readiness-drafts` refreshes draft release-readiness summary artifacts and the draft release block in `CHANGELOG.md` when maintainers prepare notes.
- `pnpm verify:release-readiness --target-package ... --target-version ... --dist-tag ...` is the single-package publish preflight used by `.github/workflows/release-single-package.yml`.
