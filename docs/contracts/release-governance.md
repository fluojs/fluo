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

Changesets (`.changeset/*.md`) is the canonical release metadata tool. Contributors record semver intent and changelog text in committed changeset files at PR time; the Changesets GitHub Action consumes those files to version packages, generate changelogs, and publish to npm. Package-level changelogs are generated automatically, and the root `CHANGELOG.md` remains available for repo-wide narrative. GitHub Releases are created automatically by the Changesets action.

Each changeset must include:

1. Affected package names, using the published `@fluojs/*` package name.
2. Semver intent per package, one of `major`, `minor`, or `patch`.
3. A summary describing the change for consumers and release reviewers.

Packages that are not listed in a changeset are not versioned or published for that release. Downstream dependent packages are evaluated through Changesets' internal dependency graph; dependent version bumps are computed automatically during versioning.

The release workflow is triggered automatically on pushes to `main`. When pending changesets exist, the Changesets action opens a "Version Packages" PR that bumps versions, updates changelogs, and removes consumed changesets. Merging that PR triggers the publish step, which publishes affected packages to npm with OIDC provenance and creates scoped git tags and GitHub Releases.

Prerelease workflow uses Changesets prerelease mode (`changeset pre enter <tag>`). Enter prerelease mode on a dedicated branch when needed; exit with `changeset pre exit` before stable releases.

Legacy `tooling/release/intents/*.json` records are retained for historical reference but are no longer required for new releases.


## Migration Assessment: Changesets and Beachball

Changesets has been adopted as the primary release automation tool. It replaces the previous repo-local JSON intent model with a standard contributor-authored changeset workflow. The `.github/workflows/release.yml` handles versioning, publishing, and GitHub Release creation automatically.

The previous single-package manual dispatch workflow is deprecated. The new workflow publishes all packages with pending changesets when the Version Packages PR is merged, while preserving CI-only, OIDC-provenanced, `main`-branch publishing.

Beachball remains a valid comparison point but is not adopted. The evaluation criteria below are preserved for future reference if Changesets proves unsuitable:

1. **Packages per release**: Changesets handles multiple packages per release automatically.
2. **Downstream evaluation frequency**: Changesets computes and bumps dependent packages automatically during versioning.
3. **Intent maintenance cost**: Changeset files are authored at PR time by contributors, reducing maintainer release-time work.
4. **Generated package changelog need**: Changesets generates per-package changelogs automatically.
5. **CI-only compatibility**: The new `.github/workflows/release.yml` maintains CI-only publish with OIDC provenance.

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
pnpm changeset status --since=main
```

- `pnpm verify:platform-consistency-governance` checks heading parity and governed documentation consistency.
- `pnpm verify:release-readiness` reuses the canonical build, typecheck, split Vitest, sandbox, package-surface sync, and publish-safety checks.
- `pnpm verify:public-export-tsdoc` enforces the public export documentation baseline used by governed packages.
- `pnpm generate:release-readiness-drafts` refreshes draft release-readiness summary artifacts and the draft release block in `CHANGELOG.md` when maintainers prepare notes.
- `pnpm changeset status --since=main` previews the packages and semver buckets Changesets will version before the Version Packages PR is merged.
