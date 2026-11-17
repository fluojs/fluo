# Versioning & Release Rules

<p><strong><kbd>English</kbd></strong> <a href="./release-governance.ko.md"><kbd>한국어</kbd></a></p>

The auth/auth-http separation is additive: previous Passport, HTTP Principal and JwtPrincipal imports and class/error/DI identities remain compatible. Changesets owns new-package versioning. Removing imports, forcing a new strategy signature or narrowing Principal requires separate major approval and migration contracts.

## Stability Tiers

| Tier | Version window | Release rule | Contract level |
| --- | --- | --- | --- |
| Experimental | `0.x` | Public APIs may change in a minor release. Prerelease versions must publish under a non-`latest` dist-tag. | No stable upgrade guarantee. |
| Preview | `0.x` or prerelease builds | Packages are intended for public use, but breaking changes still follow the `0.x` minor-bump rule and require consumer-facing upgrade requirements in `CHANGELOG.md`. | Documented behavior should stay aligned with tests and release notes. |
| Official | `1.0+` | Stable releases publish under `latest`. Breaking changes require a major version bump. | Public API, documented behavior, and release process are treated as stable contracts. |

## Semver Rules

- All public `@fluojs/*` packages follow Semantic Versioning.
- `major` is required for breaking changes in `1.0+`.
- `minor` is used for backward-compatible feature work, and it is also the required bump for breaking changes during `0.x`.
- `patch` is limited to backward-compatible fixes, security fixes, and documentation or tooling updates that preserve documented behavior.
- For public tooling packages, README-documented CLI command, flag, generated starter mode or script, inspect artifact/output mode, and programmatic entrypoint additions are consumer-visible feature work and require `minor` release metadata. `patch` may reference those surfaces only when it fixes or preserves an already documented contract without adding a new caller path.
- Narrowing `engines.node` for an Official package is breaking because it removes a previously supported runtime. The release lane uses the package's previous published `@fluojs/<name>@<version>` manifest tag as its baseline, while `--base-ref` only selects changed candidate manifests. It requires `major` metadata plus either a non-empty `Migration:` paragraph or a structured `Migration Guide` / `Upgrade Guidance` section that explicitly names the removed Node.js support and its replacement Node.js version or range. `0.x` and prerelease Preview packages remain exempt from this Official-tier major rule.
- Prerelease versions are versions with a hyphen suffix. They must publish under a non-`latest` dist-tag such as `next`, `beta`, or `rc`.
- Stable versions without a prerelease suffix must publish under the `latest` dist-tag.
- Intended public package manifests must use `workspace:^` for internal `@fluojs/*` dependencies across dependency, optional dependency, peer dependency, and dev dependency fields.

## Breaking Change Rules

- Treat API shape changes, documented behavior changes, configuration shape changes, bootstrap-order changes, adapter-contract changes, and public package removals as breaking when existing consumer code or configuration must change to keep working.
- Treat a narrower `engines.node` range as breaking when it excludes a Node.js version supported by the previous released manifest.
- In `0.x`, a breaking change may ship only in a minor release, and the release must include consumer-facing upgrade requirements in `CHANGELOG.md`.
- In `1.0+`, a breaking change must ship in a major release.
- Do not classify a change as patch or minor when it changes documented guarantees for lifecycle ordering, shutdown behavior, adapter behavior, readiness behavior, or public CLI and starter contracts.
- Update implementation, tests, and governed docs together when a breaking rule changes.

## Graduation Requirements

A package is ready for `1.0` and the Official tier only when all of the following stay true:

1. The package is an existing workspace package under `packages/*`, remains public, and keeps `publishConfig.access` set to `public`.
2. The package appears in both `docs/reference/package-surface.md` and the `## intended publish surface` list in this document.
3. Public exports satisfy the repository TSDoc baseline, and contract-governing docs keep English and Korean parity.
4. Release verification passes the canonical repository commands: `pnpm build`, `pnpm typecheck`, `pnpm vitest run --project packages --maxWorkers=1`, `pnpm vitest run --project apps --maxWorkers=1`, `pnpm vitest run --project examples --maxWorkers=1`, `pnpm vitest run --project tooling --maxWorkers=1`, `pnpm --dir packages/cli sandbox:matrix`, `pnpm verify:platform-consistency-governance`, and `pnpm verify:release-readiness`.
5. `CHANGELOG.md` keeps the `## [Unreleased]` section, and every `0.x` breaking release documents the consumer-facing upgrade requirements before a stable `1.0+` contract is declared.

## Release Metadata Contract

The canonical release workflow publishes on Node `24.x`, never Node 26. Its release job first requires the shared `extended` verification profile on the exact checked-out release commit; an earlier scheduled result cannot satisfy this dependency. Profile-specific execution task and expanded-job counts follow the [canonical Node.js Support table](../reference/node-support.md#support-matrix); scoped PRs select checks by affected scope. Full PR retains full verification on the locked primary Node 24, four package shards and one four-starter smoke task with fresh runtime-local builds on each of exact `24.11.0` and locked Node 26, and the existing native, packed-consumer and docs gates. Full secondary static/tooling/apps/examples/browser coverage moves from every PR to the scheduled and pre-publish extended profile. This changes PR assurance, not supported package engine ranges. Exact `24.0.0` remains a required built-runtime exercise without a workspace install or Babel. Local and remote verification share the Linux/arm64 task catalog and provenance-bound artifacts. See [support and migration](../reference/node-support.md); #3679 continues to reconcile the coordinated Node migration release.

Changesets (`.changeset/*.md`) is the canonical release metadata tool. Contributors record semver intent and changelog text in committed changeset files at PR time; the Changesets GitHub Action consumes those files to version packages, generate changelogs, and publish to npm. Package-level changelogs are generated automatically, and the root `CHANGELOG.md` remains available for repo-wide narrative. GitHub Releases are created automatically by the Changesets action.

Each changeset must include:

1. Affected package names, using the published `@fluojs/*` package name.
2. Semver intent per package, one of `major`, `minor`, or `patch`.
3. A summary describing the change for consumers and release reviewers.

Release reviewers must compare `.changeset/*.md`, generated package `CHANGELOG.md` sections, affected package `README.md` contracts, and changed package `engines.node` ranges against the previous published manifest tag before accepting semver metadata. If an Official package narrows `engines.node`, the changeset must be `major` and include either a non-empty `Migration:` paragraph or a structured `Migration Guide` / `Upgrade Guidance` section that explicitly connects removed Node.js support to a replacement Node.js version or range; `verify:changeset-release-lane` enforces that requirement. After Changesets consumes pending metadata, generated major version deltas remain valid only when their generated `CHANGELOG.md` section includes `### Major Changes` and consumer migration guidance. If a `@fluojs/cli` entry says it adds, exposes, supports, introduces, enables, or provides a public CLI, starter, inspect, or programmatic surface documented in the README, the entry must be `minor`; patch metadata must be corrected before the Version Packages PR is merged.

Packages that are not listed in a changeset are not versioned or published for that release. Downstream dependent packages are evaluated through Changesets' internal dependency graph; dependent version bumps are computed automatically during versioning.

The release workflow in `.github/workflows/release.yml` is triggered automatically on pushes to `main`. When pending changesets exist, the Changesets action opens a "Version Packages" PR that bumps versions, updates changelogs, and removes consumed changesets. Merging that PR triggers the publish step, which publishes affected packages to npm with token-backed npm authentication and provenance, then creates scoped git tags and GitHub Releases. The publish step passes the same `secrets.NPM_TOKEN` value as both `NPM_TOKEN` for the Changesets action and `NODE_AUTH_TOKEN` for the npm user config path generated by `actions/setup-node`.

`main` is the single stable release lane. Pull requests targeting `main` and the release workflow both run the changeset lane gate; `.github/workflows/release.yml` runs `pnpm verify:release-readiness` against the checked-out `main` commit, then runs `pnpm verify:changeset-release-lane -- --lane=stable --base-ref=${{ github.event.before }}` before the Changesets action can create or publish a Version Packages PR. The stable gate accepts `patch`, `minor`, and `major` changesets and generated package version deltas, while still validating release metadata shape; for each changed manifest, it compares `engines.node` with the package's previous published tag and requires `major` metadata plus `Migration:` guidance for Official-package narrowing. Patch, minor, and major stable releases all publish through the canonical `main` Changesets GitHub Actions workflow under the stable dist-tag policy.

PRs carrying `major` changesets require explicit maintainer approval and consumer-facing migration notes before merge. Do not downgrade semver intent to avoid that approval path; if a change is breaking under the rules above, keep the `major` changeset and document the migration impact.

Prerelease workflow uses Changesets prerelease mode (`changeset pre enter <tag>`). Enter prerelease mode on a dedicated branch when needed; exit with `changeset pre exit` before stable releases.

## Production Input Declarations

**Scope and ownership.** Consumer-visible Changeset requirements cover repository inputs that generate shipped files or are read at runtime, as well as files directly included in a tarball. [`tooling/governance/package-production-inputs.json`](../../tooling/governance/package-production-inputs.json) owns the internal declaration; this section owns its trust and maintenance contract. Each public package and producer names an `owner` responsible for reviewing input completeness. Initial ownership follows `@ayden94` in `.github/CODEOWNERS`. Introducing this internal contract alone changes no package runtime/API/publish configuration or version.

**Declaration format.** The closed version `1` data type contains `packages`, `producers`, `manifests`, and `nonProduction`. Packages declare production inputs and nonshipping scopes; producers declare public consumers, transitive build/generation/runtime-reader inputs, and executable/configuration definitions. Include root/tooling/sibling consumers. Paths are repository-relative exact files or directory prefixes ending in `/`; globs, parent traversal, duplicates, and missing paths are rejected. A directory input's explicit `excludeTests` rule applies only to `.test.*` modules and optional `excludeTestFixtures` to `.test-fixture.*` modules; `excludeDirectories` accepts only existing literal directory prefixes under that input. A `nonProduction` rule with `testsOnly: true` is limited to those same test modules.

**Order and failures.** The shared [`package-production-inputs.mjs`](../../tooling/governance/package-production-inputs.mjs) validator reads Git objects at the actual issue head and comparison base. Declared production inputs are checked before package boundaries or test/fixture/Markdown names. An individual production input or another producer's input overrides directory/test exclusions and `nonProduction`. Consumer impact also preserves packed dist/bin/assets, manifest/runtime metadata, package-root README/LICENSE, and starter/templates. Changes without valid nonshipping evidence remain conservatively consumer-visible. Missing/invalid declarations, public-package inventory mismatch, read failures, unsupported packaging evidence, and stale definitions cannot authorize exclusions; governance rejects them with a nonzero exit.

**Maintenance and limits.** Structural checks do not prove arbitrary program-input completeness or non-dependence. Package/build owners must declare and review the exact paths or sufficient directory scopes actually read by new readers, copies, imports, computed paths, or directory discovery. Absence of string matches, test names, absence of external files, and the declaration itself are not such proofs. Freshness uses SHA-256 of actual executable/configuration bytes and a meaningful command/runtime-layout projection of root/workspace manifests. New manifests or changed production commands/lifecycle connections and producer/config definitions require refreshed evidence and owner review. Payload, package-version, and dependency-version values alone do not require resnapshotting every producer definition.

Deleting or narrowing existing inputs, producers, consumers, or definitions must not erase release impact. The classifier retains comparison-base evidence, and governance rejects removals/narrowing when a valid previous declaration exists. An old base without the new declaration is not evidence of nonshipping. Successful structural bootstrap validation does not exempt an old-base diff. When that exclusion is needed, formally re-preflight against a new main with valid declarations after merge; do not change an active lane's pinned base or engine merely to bypass Changeset checks.

Optional `definitionScopes` name literal directory prefixes reserved for executable/configuration definitions. A newly tracked file there fails validation without its actual digest entry. The current workflow-definition inventory uses such a scope. Keep payload and version data in `inputs`, outside these definition snapshot scopes.

**Execution evidence.** Planning executes neither builds nor arbitrary declaration code. The existing `pnpm verify:platform-consistency-governance` invokes the same validator.

```bash
node tooling/governance/package-production-inputs.mjs
pnpm verify:platform-consistency-governance
```

[`package-production-inputs.test.ts`](../../tooling/governance/package-production-inputs.test.ts) covers structure, paths, inventory, freshness, production precedence, and historical input retention; [`verify-platform-consistency-governance.test.ts`](../../tooling/governance/verify-platform-consistency-governance.test.ts) exercises rejection propagation through the real runner. CLI Git/worktree regressions check genuine nonshipping tests in the actual monorepo alongside base-existing computed root/sibling consumers, built output from test-looking inputs, and Changeset transitions. Update a new reader together with its inputs and evidence; excluding a production input merely because it is outside `files` or named `.test.mjs` is incorrect.

## Deno deprecation advisory and registry metadata

Deno support is Removed: `@fluojs/platform-deno`, `@fluojs/websockets/deno`, and the CLI Deno targets are deleted from the active workspace under [#3938](https://github.com/fluojs/fluo/issues/3938), and `@fluojs/platform-deno` is removed from the publish catalog below. Its README URLs remain as archive notices; prior implementation remains in Git history and npm tarballs. Follow the [canonical migration guide](../getting-started/migrate-from-deno.md).

Phase 1 provided a backward-compatible deprecation advisory; the final published `@fluojs/platform-deno` release is `2.0.2`. At the pre-removal source revision, WebSockets and CLI were `2.0.3` and `4.0.1`; those workspace versions alone do not establish which release executed the advisory. Phase 2 removes the Deno surfaces and requires **MAJOR** Changesets for `@fluojs/websockets` and `@fluojs/cli` (WebSockets 3 and CLI 5), because public subpaths, starter inputs, and lifecycle execution contracts are removed. Neither shared package is deprecated as a whole.

The phase-1 canonical release workflow ran `node tooling/release/deprecate-platform-deno.mjs` after the Changesets action. The helper applied npm deprecation metadata to `@fluojs/platform-deno@*` only once the public npm `latest` version and description matched the advisory workspace manifest; a mismatch returned `pending-advisory-release` without writing metadata. Before a write, it verified that the canonical migration guide was publicly reachable through its raw GitHub URL, and it used `NODE_AUTH_TOKEN` from the existing `secrets.NPM_TOKEN`, never a local publish path.

The phase-1 canonical Changesets workflow included a one-time npm deprecation helper after publication. It was designed to check the actual advisory version, public migration guide, and every published version including prereleases. A separate npm registry observation on 2026-11-03 confirmed deprecation metadata on all 18 versions. That observation proves the resulting registry state, not which workflow or actor performed the write. With that state confirmed, phase 2 removes the completed one-time helper and release step. No local publish or unpublish is introduced.

## intended publish surface

`@fluojs/diagnostics` is a Preview (`0.x`) portable contract package. Its shared declaration ownership and reader APIs preserve existing public imports and version-1 artifacts; filters, transport, lifecycle and feature status policy remain with their existing packages.

- `@fluojs/diagnostics`
- `@fluojs/auth`
- `@fluojs/auth-http`
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
- `@fluojs/i18n`
- `@fluojs/jwt`
- `@fluojs/metrics`
- `@fluojs/microservices`
- `@fluojs/mongoose`
- `@fluojs/notifications`
- `@fluojs/openapi`
- `@fluojs/passport`
- `@fluojs/persistence`
- `@fluojs/platform-bun`
- `@fluojs/platform-cloudflare-workers`
- `@fluojs/platform-express`
- `@fluojs/platform-fastify`
- `@fluojs/platform-nextjs`
- `@fluojs/platform-nodejs`
- `@fluojs/prisma`
- `@fluojs/queue`
- `@fluojs/react`
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
- `@fluojs/vite`
- `@fluojs/websockets`

## Enforcement

Run these commands when versioning rules, release-governing docs, or intended publish surface packages change:

```bash
pnpm build
pnpm typecheck
pnpm vitest run --project packages --maxWorkers=1
pnpm vitest run --project apps --maxWorkers=1
pnpm vitest run --project examples --maxWorkers=1
pnpm vitest run --project tooling --maxWorkers=1
pnpm --dir packages/cli sandbox:matrix
pnpm verify:public-export-tsdoc
pnpm verify:platform-consistency-governance
pnpm verify:release-readiness
pnpm verify:changeset-release-lane -- --lane=stable
pnpm generate:release-readiness-drafts
pnpm changeset status --since=main
```

- `pnpm verify:platform-consistency-governance` checks heading parity and governed documentation consistency.
- `pnpm verify:release-readiness` reuses the canonical build, typecheck, split Vitest, sandbox, package-surface sync, and publish-safety checks.
- `pnpm verify:changeset-release-lane -- --lane=stable --base-ref=<ref>` validates pending changesets and generated package version deltas in PR CI and again before the Changesets action can create or publish a stable Version Packages PR.
- `pnpm verify:public-export-tsdoc` enforces the public export documentation baseline used by governed packages.
- `pnpm generate:release-readiness-drafts` refreshes draft release-readiness summary artifacts and the draft release block in `CHANGELOG.md` when maintainers prepare notes.
- `pnpm changeset status --since=main` previews the packages and semver buckets Changesets will version before the Version Packages PR is merged.
