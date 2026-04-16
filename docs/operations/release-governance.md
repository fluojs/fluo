# Release Governance

<p>
  <strong>English</strong> | <a href="./release-governance.ko.md">한국어</a>
</p>

This document defines the release standards, stability contracts, and versioning policies for the fluo ecosystem. It ensures that framework updates are predictable, breaking changes are communicated, and public-facing packages maintain high quality.

## When this document matters

- **Version Planning**: When determining the impact of a code change on package versioning (Semver).
- **Package Promotion**: When graduating a package from an experimental or preview state to official support.
- **CI/CD Configuration**: When updating automated gates that enforce behavioral contracts or release readiness.
- **Changelog Authoring**: During release cycles to ensure accurate communication of shifts in framework behavior.

---

## Stability Contract

fluo uses a tiered stability model to communicate the maturity of its packages.

| Tier | Stability | Description |
| :--- | :--- | :--- |
| **Official** | Stable | Fully documented, production-ready, and covered by extensive integration tests. |
| **Preview** | Functional | Functionally complete but may have undocumented edge cases or limited real-world examples. |
| **Experimental** | Unstable | Early-stage development. APIs are subject to change without prior notice or migration guides. |

### Graduation to 1.0
A package graduates to `1.0` (Stable) only when:
1.  **Documentation**: The public API surface is fully documented in both English and Korean.
2.  **Verification**: Full test coverage (Unit, Integration, and CLI Sandbox) passes in CI.
3.  **Migration Path**: Clear migration guides exist for all major `0.x` breaking changes.
4.  **LTS Policy**: A Long-Term Support and security patch policy is defined for the package.

---

## Versioning Policy

fluo follows strict **Semantic Versioning (Semver)**.

- **Major (`X.0.0`)**: Significant breaking changes, architectural shifts, or removal of deprecated APIs.
- **Minor (`0.X.0`)**: New features, non-breaking enhancements, or significant internal refactorings that preserve documented behavior.
- **Patch (`0.0.X`)**: Bug fixes, security patches, and documentation improvements.

### 0.x Phase (Pre-Stable)
During the `0.x` phase, the **Minor** version is used for breaking changes. Every breaking change in a `0.x` minor release MUST be accompanied by a migration note in the `CHANGELOG.md`.

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

---

## Release Process & Enforcement

Governance is enforced through automated gates and manual checklists.

### CI/CD Enforcement
- **`pnpm verify:release-readiness`**: Validates the packed CLI entrypoints, starter scaffolding, and intended public package manifest dependency ranges without mutating `CHANGELOG.md` or release-readiness summary files by default. Its canonical release gate reuses the split workspace Vitest model from main-branch CI (`pnpm vitest run --project packages`, `apps`, `examples`, and `tooling`) so release readiness does not silently regress to a monolithic `pnpm test` path. In CI-only single-package publish mode, pass `--target-package`, `--target-version`, and `--dist-tag` to enforce intended publish surface membership, semver/dist-tag prerelease alignment, and publish-safe internal `@fluojs/*` dependency shape for the requested package.
- **`.github/workflows/release-single-package.yml`**: Manual GitHub Actions entrypoint for trusted single-package npm publishing. It accepts `package_name`, `package_version`, `dist_tag`, and `release_prerelease`, runs the canonical `pnpm verify:release-readiness --target-package --target-version --dist-tag` gate, then creates the git tag and GitHub Release only after npm publish succeeds.
- **Supervised Release Orchestration**: Releases follow a `supervised-auto` policy. While the CI workflow automates the publish and tag creation, the central supervisor handles final review, merge, and cleanup boundaries to ensure repository consistency.
- **`pnpm generate:release-readiness-drafts`**: Explicitly refreshes the release-readiness summary artifacts and the draft `CHANGELOG.md` block when maintainers are preparing release notes.

---

## Single-Package Release Operator Flow

Maintainers should follow this runbook for publishing individual packages to npm.

### 1. Pre-flight Preparation
Before triggering the CI workflow, ensure the following:
- The package version in its `package.json` is updated and matches your intended release.
- A matching version section exists in the root `CHANGELOG.md`.
- Run `pnpm verify:release-readiness` locally to catch obvious gate failures.

### 2. Triggering the Workflow
Navigate to **Actions** > **Release single package** in GitHub and click **Run workflow**.

| Input | Description | Example |
| :--- | :--- | :--- |
| `package_name` | The full name of the package. | `@fluojs/cli` |
| `package_version` | The exact version in `package.json`. | `0.1.0` |
| `dist_tag` | npm distribution tag. | `latest` (stable) or `next` |
| `release_prerelease` | Must be `true` if version contains a hyphen. | `false` |

### 3. Execution & Stop Points
The workflow executes the following steps sequentially:
1. **Validation**: Runs `pnpm verify:release-readiness` with the provided inputs. Fails if the package is not in the intended publish surface or if versioning/tags are inconsistent.
2. **Publish**: Publishes to npm via OIDC (provenance enabled). **If this fails, the workflow stops.**
3. **Tagging**: Creates and pushes a git tag (e.g., `@fluojs/cli@0.1.0`).
4. **GitHub Release**: Generates a release with the current-run release summary artifact and changelog notes.

### 4. Rollback & Retry
- **Publish Failure**: Fix the underlying issue (e.g., build error, manifest range) and retry the workflow with the same version.
- **Tag/Release Failure**: If the package is already on npm but the tag/release failed, manually create the tag or rerun the workflow (ensure `pnpm publish` handles "already published" gracefully or skip it if allowed).

---

## Related Docs

- [Behavioral Contract Policy](./behavioral-contract-policy.md)
- [Public Export TSDoc Baseline](./public-export-tsdoc-baseline.md)
- [NestJS Parity Gaps](./nestjs-parity-gaps.md)
- [Platform Conformance Authoring Checklist](./platform-conformance-authoring-checklist.md)
- [Testing Guide](./testing-guide.md)
