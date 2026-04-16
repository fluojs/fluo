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
- **`pnpm verify:release-readiness`**: Validates the packed CLI entrypoints, starter scaffolding, and intended public package manifest dependency ranges without mutating `CHANGELOG.md` or release-readiness summary files by default. In CI-only single-package publish mode, pass `--target-package`, `--target-version`, and `--dist-tag` to enforce intended publish surface membership, semver/dist-tag prerelease alignment, and publish-safe internal `@fluojs/*` dependency shape for the requested package.
- **`pnpm generate:release-readiness-drafts`**: Explicitly refreshes the release-readiness summary artifacts and the draft `CHANGELOG.md` block when maintainers are preparing release notes.
- **`pnpm verify:platform-consistency-governance`**: Enforces structural parity between English and Korean documentation.
- **`pnpm verify:public-export-tsdoc`**: Fails when changed public exports in `packages/*/src` miss the repo-wide TSDoc minimum baseline.
- **`pnpm verify:public-export-tsdoc:baseline`**: Runs the same TSDoc baseline against the full governed `packages/*/src` surface to catch untouched backlog files.
- **Behavioral Contract Check**: Blocks releases if `process.env` is accessed outside of the sanctioned `@fluojs/config` patterns.

### Changelog Standards
Every public release must have a matching entry in the root `CHANGELOG.md` following the *Keep a Changelog* format. GitHub Releases are automatically populated from this content during the deployment phase.

---

## Related Docs
- [Behavioral Contract Policy](./behavioral-contract-policy.md)
- [Public Export TSDoc Baseline](./public-export-tsdoc-baseline.md)
- [NestJS Parity Gaps](./nestjs-parity-gaps.md)
- [Platform Conformance Authoring Checklist](./platform-conformance-authoring-checklist.md)
- [Testing Guide](./testing-guide.md)
