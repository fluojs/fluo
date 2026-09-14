# contributing to fluo

<p align="center">
  <a href="./CONTRIBUTING.md">English</a>
  &nbsp;&middot;&nbsp;
  <a href="./CONTRIBUTING.ko.md">한국어</a>
</p>

fluo is built on standard TypeScript decorators and explicit contract discipline. This guide explains how to set up your environment, verify changes, and follow our maintainer workflows.

## local development setup

fluo uses a monorepo structure managed by `pnpm`.

1. **Prerequisites**: Node.js `>=24.0.0 <27` and `pnpm` for the private development workspace.
2. **Install dependencies**:
   ```sh
   pnpm install
   ```
3. **Build all packages**:
   ```sh
   pnpm build
   ```
4. **Run tests across monorepo**:
   ```sh
   pnpm test
   ```

## verifying before you push

Run the baseline workspace verification before opening or updating a PR:

```sh
pnpm verify
```

This runs `build`, `typecheck`, `lint`, and `test` in sequence. It does not
claim the CI-only Node matrix, artifact transfer provenance, native runtime
lanes, generated-starter browser checks, or aggregate GitHub Actions semantics.
Use `pnpm verify:local` for the exact-head receipt-backed local command plan;
CI remains the authority for those isolated runner dimensions. You can also run
each baseline step individually:

```sh
pnpm build
pnpm typecheck
pnpm lint          # Biome — see biome.json
pnpm test
```

The local receipt is valid only while the worktree remains clean: its identity
includes the Git status digest at startup, every command boundary, and
finalization. Changes that affect package ownership, manifests, source copies,
or build tooling perform a cold workspace `dist` cleanup before the build and
run manifest-selected companion commands. The plan is intentionally
preflight-first; CI still supplies the Node `24.0.0`/`24.x`/`26.x` matrices,
four package shards, two tooling shards, native runtimes, Studio browser, and
aggregate fail-closed semantics.

## documenting public exports

Changed public exports under `packages/*/src` must follow the repo-wide TSDoc minimum baseline.

- Add a source-level summary to every changed exported symbol.
- Add `@param` for each named exported function parameter.
- Add `@returns` for exported functions with a non-`void` return type.
- Use `@throws`, `@example`, and `@remarks` when they clarify caller-visible behavior, entry-point usage, or lifecycle caveats.
- Keep README examples scenario-driven; keep source `@example` blocks short and hover-friendly.

Use the following repo-local references before inventing a new style:

- `packages/graphql/src/dataloader/dataloader.ts`
- `packages/cache-manager/src/decorators.ts`
- `packages/di/src/container.ts`
- [docs/contracts/public-export-tsdoc-baseline.md](docs/contracts/public-export-tsdoc-baseline.md)

`pnpm lint` now includes `pnpm verify:public-export-tsdoc`, which keeps PR-time enforcement scoped to changed package source files.
Use `pnpm verify:public-export-tsdoc:baseline` when you need to audit the full governed `packages/*/src` surface for backlog TSDoc gaps.

Release-readiness verification is now read-only by default:

- `pnpm verify:release-readiness` validates release gates without dirtying the working tree.
- `pnpm generate:release-readiness-drafts` explicitly refreshes `CHANGELOG.md` draft content plus the release-readiness summary artifacts when maintainers want writable outputs.

Changesets are required when a PR affects the public behavior, API surface, package contents, or release metadata of published `@fluojs/*` packages. They are usually not required for docs-only edits, test-only coverage, examples that do not change published behavior, or internal refactors with no consumer-visible impact. When in doubt, explain the release impact in the PR and maintainers can help choose the right semver intent.

## maintainer workflows

### Supervised Release Orchestration

fluo uses a `supervised-auto` policy for releases.

1. **Automation**: Contributors record release intent in `.changeset/*.md`. On `main`, `.github/workflows/release.yml` opens or updates the Version Packages PR and, after that PR is merged, publishes the changed public packages through CI with npm trusted publishing/provenance.
2. **Supervision**: Maintainers review the Version Packages PR, generated package changelogs, package version bumps, and release-readiness evidence before merge. The central supervisor handles final review and cleanup boundaries.
3. **Consistency**: Do not manually tag or publish packages. Do not use the deprecated single-package workflow for releases. Always use the canonical CI-only Changesets flow to maintain the integrity of behavioral contracts and release artifacts.

### CLI sandbox verification

When modifying `@fluojs/cli` or core runtime packages, use the sandbox scripts to verify end-to-end behavior.

Inside `packages/cli/`:
- `pnpm sandbox:create`: Generates a fresh starter app in a temporary directory.
- `pnpm sandbox:matrix`: Runs the representative generated-project smoke suite for the default app, TCP microservice, and mixed starter baselines.
- `pnpm sandbox:verify`: Runs `build`, `typecheck`, and `test` inside the sandbox app.
- `pnpm sandbox:test`: Runs integration tests against the sandbox app.
- `pnpm sandbox:clean`: Removes the sandbox directory.

### example verification

Canonical examples in `examples/` are first-class workspace members and verification targets. They participate in the monorepo dependency graph, TypeScript type-checking, and Vitest test runs.

- **Typecheck**: `pnpm typecheck` includes `tsc -p examples/tsconfig.json --noEmit`. Examples share path-mapped workspace packages, so editor resolution and CI catch type errors in example code.
- **Tests**: `pnpm test` runs `vitest run`, which includes the `examples` project defined in `vitest.config.ts`. Each example has tests in `src/app.test.ts`.
- **Dependencies**: Each example has a `package.json` with `workspace:*` dependencies on `@fluojs/*` packages. Run `pnpm install` after adding or changing example dependencies.

When modifying core packages, verify that examples still pass:

```sh
pnpm vitest run examples/
pnpm typecheck
```

### using worktrees

We recommend using `git worktree` for multi-tasking or resolving issues in isolation.
- Our canonical worktree path is `.worktrees/`.
- `git worktree add -b issue-123 .worktrees/issue-123 origin/main`

## behavioral contracts

fluo maintains strict behavioral contracts. Before opening a PR, ensure you have:
1. Read the affected package `README.md`.
2. Checked [docs/contracts/behavioral-contract-policy.md](docs/contracts/behavioral-contract-policy.md).
3. Updated documentation if runtime behavior or API surface changed.
4. Added regression tests for any contract-affecting changes.

## issue intake

- Use **Bug Report** for reproducible errors in the framework or CLI.
- Use **DX/Maintainability Request** for developer experience improvements or refactoring suggestions.
- Opening an issue before a PR is encouraged when the problem needs discussion, but it is not required for focused fixes, documentation updates, or clearly scoped improvements.
- AI-assisted contributions from tools such as Codex or Claude are welcome. Please keep the PR connected to the original context by linking the issue, discussion, or short problem statement that motivated the change.
- For large feature proposals, open an issue or discussion first so maintainers can align on API shape, behavioral contracts, and release impact before implementation gets too deep.

## PR process

- All PRs should target the `main` branch.
- Follow the structure in `.github/PULL_REQUEST_TEMPLATE.md`.
- Link related issues or discussions when they exist. If there is no issue, summarize the problem and intended outcome in the PR description.
- Include a `.changeset/*.md` file only when the PR has consumer-visible release impact for public `@fluojs/*` packages.
- Run `pnpm verify:local` before pushing and attach its exact-head receipt when
  local verification is required; CI remains required for CI-only dimensions.
