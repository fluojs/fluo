# Node.js minimum-version recommendation (2026-08-23)

## Decision

Adopt **Node.js 24 LTS** as Fluo's next Node runtime baseline.

- Move the private root workspace and release automation to the latest patched Node 24.x immediately.
- For the next public-package major, start with `engines.node: ">=24.0.0 <25"` on packages that already declare a Node engine and on generated Node projects.
- Expand the public range to `">=24.0.0 <27"` only after the full suite passes on Node 26 and CI retains a Node 26 compatibility job.
- Do not add `engines.node` to the six packages that intentionally omit it without first resolving their runtime contract.
- Do not use Node 22.14 as the floor. Nothing in Fluo or its current dependency graph requires a 22.14 API.

This is a product-lifecycle recommendation, not a dependency requirement. Current dependencies permit older Node releases, but selecting Node 24 avoids paying for a coordinated major migration to a Node line that reaches end of life on 2027-04-30.

## Why Node 24

| Candidate | What it represents | Remaining support from 2026-08-23 | Verdict |
| --- | --- | ---: | --- |
| Node 22.12 | `require(esm)` enabled by default and import attributes/JSON modules stabilized | About 8 months, EOL 2027-04-30 | Best technical 22.x boundary, but too short-lived for a repository-wide major |
| Node 22.14 | Adds selected module, process, SQLite, TypeScript-eval, and test-runner APIs | Same 22.x EOL | Reject as a baseline because Fluo does not use those additions |
| Latest Node 22.x | Latest security and maintenance fixes within 22.x | Same 22.x EOL | Use only as a maintenance CI/runtime pin, never as a manifest minimum |
| Node 24.x | Active LTS on the decision date, EOL 2028-04-30 | About 20 months | Recommended next-major floor |

Primary Node sources:

- [Node 22.12.0 release](https://nodejs.org/en/blog/release/v22.12.0)
- [Node 22.14.0 release](https://nodejs.org/en/blog/release/v22.14.0)
- [Node 24.0.0 release](https://nodejs.org/en/blog/release/v24.0.0)
- [Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)

The detailed capability and lifecycle comparison is in [node-version-candidates-2026-08-23.md](./node-version-candidates-2026-08-23.md).

## Dependency result

No current direct runtime dependency or development tool creates a floor at Node 22.14, a later 22.x patch, or Node 24.

| Dependency in the committed graph | Role | Relevant Node requirement | Effect on the decision |
| --- | --- | --- | --- |
| `fastify@5.8.5` | Bundled runtime dependency of `@fluojs/platform-fastify` | Node 20+ | Does not require 22.14 or 24 |
| `mongoose@9.7.2` override | Optional consumer peer used in repository verification | `>=20.19.0` | Strongest observed 20.x runtime floor, but not a 22.x floor |
| `@prisma/client@7.5.0` resolved for verification | Optional consumer peer | `^20.19 || ^22.12 || >=24.0` | Makes 22.12, not 22.14, the relevant 22.x ecosystem boundary |
| `bullmq@5.81.1` | Bundled runtime dependency of `@fluojs/queue` | `>=12.22.0` | No constraint on the candidate choice |
| `ioredis@5.10.0` / `5.11.1` | Peer/runtime integration | `>=12.22.0` | No constraint on the candidate choice |
| `typescript@6.0.2` | Maintainer toolchain | `>=14.17` | No consumer runtime constraint |
| `vite@6.4.3` / `vitest@3.2.7` | Maintainer and generated-project tooling | `^18.0.0 || ^20.0.0 || >=22.0.0` | No 22.14 or 24 constraint |
| `tsx@4.23.1` | CLI/development tool | `>=18.0.0` | No constraint on the candidate choice |

Repository evidence is recorded in `pnpm-lock.yaml` and the package manifests. The source-by-source dependency table is in [node-floor-dependency-research.md](../reference/node-floor-dependency-research.md).

## Current repository state

The root workspace currently advertises `>=20.19.3 <21 || >=22.2.0 <27` (`package.json:5-7`), while every CI and release setup-node step still uses Node 20 (`.github/workflows/ci.yml:26-306`, `.github/workflows/release.yml:28-30`). The declared multi-major range is therefore broader than the automated version matrix.

The 42 public package manifests currently divide into:

| Manifest state | Count | Evidence |
| --- | ---: | --- |
| `>=20.0.0` | 29 | `packages/*/package.json` |
| `>=20.16.0` | 1 | `packages/config/package.json:19-21` |
| `>=20.19.3 <21 || >=22.2.0 <27` | 6 | `graphql`, `platform-nodejs`, `runtime`, `platform-fastify`, `testing`, `platform-express` manifests |
| No `engines.node` | 6 | `email`, `i18n`, `platform-bun`, `platform-cloudflare-workers`, `platform-deno`, `react` manifests |

The omitted engine is intentional repository vocabulary, not missing metadata: `docs/contracts/manifest-decision.md:25-26` states that `engines.node` is not universal. The generated Node-listener range is also duplicated in `packages/cli/src/new/scaffold.ts:43` and `tooling/governance/verify-platform-consistency-governance.test.ts:40`.

One versioning exception matters: 41 packages are stable 1.x/2.x packages, while `@fluojs/react` is currently `0.1.0` (`packages/react/package.json:11`). Because React already omits `engines.node`, it is outside the recommended engine-only migration unless its runtime contract changes separately.

## Scope policy

Use one baseline for **Node-bound execution**, not one manifest field for every runtime.

### Apply the Node 24 floor

In the next public major, update the packages that already publish `engines.node`, subject to the mixed-runtime review below. Update generated Node HTTP, mixed Node, microservice, and React+Fastify projects at the same time.

This keeps existing package classification stable while replacing the obsolete Node 20 floor. It also avoids introducing a new Node-only contract into packages whose manifests intentionally omit one.

### Preserve engine omissions

Do not add a Node engine solely for consistency to:

- `@fluojs/platform-bun`
- `@fluojs/platform-deno`
- `@fluojs/platform-cloudflare-workers`
- `@fluojs/react`
- `@fluojs/email`
- `@fluojs/i18n`

The first four have explicit non-Node or runtime-neutral responsibilities. Email exposes Node behavior through a subpath, and i18n is intentionally runtime-neutral. A package-wide `engines.node` cannot express a subpath-only requirement.

### Review mixed-runtime packages before publishing

`@fluojs/runtime` is the main contract risk. It declares a package-wide Node engine while exporting both `@fluojs/runtime/node` and `@fluojs/runtime/web` (`packages/runtime/package.json:20-55`), and Bun, Deno, Workers, React, and Email depend on its package root. `@fluojs/config` similarly publishes a Node engine although its in-memory path is runtime-neutral and only env-file/watch behavior needs Node (`packages/config/package.json:19-46`).

Before raising either package to Node 24, choose explicitly between:

1. Keeping the current package-wide Node contract and documenting that non-Node hosts may consume portable subpaths despite npm engine metadata.
2. Moving Node-only behavior to a package boundary that can truthfully own `engines.node`, then removing the engine from the portable package.

This architectural choice should not be hidden inside the engine-version Changeset. Subpath-specific engine enforcement is not available in `package.json`, and a compatibility shim would make the contract less truthful.

## Exact ranges

### Immediate maintainer toolchain

Use the latest patched Node 24.x in CI and release automation. For the private root workspace, `>=24.0.0 <25` is the truthful initial range because it matches the first validated major line.

### Public next-major baseline

Use `>=24.0.0 <25` until minimum and latest Node 24 jobs pass. After adding and passing a Node 26 compatibility job, use the intended release range:

```json
{
  "engines": {
    "node": ">=24.0.0 <27"
  }
}
```

Do not use `latest 24.x` or an exact patched release in `engines.node`. The minimum expresses API compatibility; deployments and CI should continuously select the latest security-patched 24.x.

## CI and release matrix

| Job | Version | Purpose |
| --- | --- | --- |
| Minimum floor | Exact `24.0.0` | Install, build, typecheck, and focused package tests at the advertised minimum |
| Canonical verification | Latest `24.x` | Run `pnpm verify` and release-readiness checks on the supported LTS line |
| Forward compatibility | Latest `26.x` | Required before advertising `<27`; retain after release |
| Release | Latest `24.x` | Keep publishing on the LTS line, not the Current line |
| Runtime portability | Native Bun, Deno, Workers jobs | Preserve non-Node contracts independently of `engines.node` |

The new major should not test Node 22 as a supported consumer runtime. The previous published major remains available to Node 22 users, but a separate maintenance branch or release lane should exist only if maintainers deliberately adopt one.

## Semver and Changesets

Raising an existing public package engine excludes working consumers and is a breaking contract change. All 36 packages that currently declare an engine are stable 1.x/2.x packages, so each affected package requires explicit `major` intent under `docs/contracts/release-governance.md:11-16`.

- Do not rely only on Changesets' internal dependency propagation for this migration. A dependent package that effectively requires the new Node floor needs explicit release intent and migration text.
- Major Changesets require maintainer approval and consumer-facing migration notes (`docs/contracts/release-governance.md:58-60`).
- Reconcile the existing `.changeset/support-custom-http-route-methods.md` before adding the Node 24 Changeset. It already assigns major releases to six listener-connected packages for the current `>=20.19.3 <21 || >=22.2.0 <27` contract.
- Do not add a Changeset for this research document. Add release metadata only when manifests or published behavior change.

The consumer migration order should be explicit:

1. Upgrade production, local development, CI, and container images to the latest Node 24.x.
2. Refresh the package-manager lockfile and verify native dependencies on Node 24.
3. Upgrade to the new Fluo package majors.
4. Regenerate or manually update Node-based starters.
5. Run application integration tests before deployment.

## Rollout plan

1. **Toolchain first, no consumer break:** move CI and release jobs to latest Node 24.x; add exact 24.0.0 and latest 26.x compatibility jobs.
2. **Resolve mixed-runtime metadata:** make an explicit decision for `@fluojs/runtime` and `@fluojs/config`; verify Bun, Deno, Workers, React, and Email dependency paths.
3. **Prepare the public major:** change affected manifests, CLI starter constants, governance tests, READMEs, package-surface docs, toolchain matrix, and website EN/KO companions together.
4. **Record release intent:** add explicit major Changesets and migration notes, then obtain required maintainer approval.
5. **Validate before merge:** run the version matrix, `pnpm verify`, `pnpm verify:docs`, `pnpm verify:release-readiness`, and `pnpm changeset status --since=main`.
6. **Publish only through GitHub Actions:** let the canonical Changesets release workflow create and publish the Version Packages PR; do not publish locally.

## Final recommendation

If Fluo is prepared to pay the major-version cost now, choose **Node 24**, not 22.14 or a later 22.x patch. Move maintainer infrastructure immediately, then release the consumer floor only after the mixed-runtime package decision and CI matrix are complete.

If maintainers are not ready for that coordinated major, keep the current public engines temporarily but still move CI/release execution off EOL Node 20. Do not spend a major release on Node 22 in late 2026; its remaining support window is too short.
