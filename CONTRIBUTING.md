# contributing to fluo

fluo is built on standard TypeScript decorators and explicit contract discipline. This guide explains how to set up your environment, verify changes, and follow our maintainer workflows.

## local development setup

fluo uses a monorepo structure managed by `pnpm`.

1. **Prerequisites**: Node.js 20+ and `pnpm`.
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

Run the single verify command before opening or updating a PR:

```sh
pnpm verify
```

This runs `build`, `typecheck`, `lint`, and `test` in sequence — the same checks CI performs. You can also run each step individually:

```sh
pnpm build
pnpm typecheck
pnpm lint          # Biome — see biome.json
pnpm test
```

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
- [docs/operations/public-export-tsdoc-baseline.md](docs/operations/public-export-tsdoc-baseline.md)

`pnpm lint` now includes `pnpm verify:public-export-tsdoc`, which keeps PR-time enforcement scoped to changed package source files.
Use `pnpm verify:public-export-tsdoc:baseline` when you need to audit the full governed `packages/*/src` surface for backlog TSDoc gaps.

Release-readiness verification is now read-only by default:

- `pnpm verify:release-readiness` validates release gates without dirtying the working tree.
- `pnpm generate:release-readiness-drafts` explicitly refreshes `CHANGELOG.md` draft content plus the release-readiness summary artifacts when maintainers want writable outputs.

## maintainer workflows

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
2. Checked [docs/operations/behavioral-contract-policy.md](docs/operations/behavioral-contract-policy.md).
3. Updated documentation if runtime behavior or API surface changed.
4. Added regression tests for any contract-affecting changes.

## issue intake

- Use **Bug Report** for reproducible errors in the framework or CLI.
- Use **DX/Maintainability Request** for developer experience improvements or refactoring suggestions.
- For feature requests, start with an issue to discuss the design before implementation.

## PR process

- All PRs should target the `main` branch.
- Follow the structure in `.github/PULL_REQUEST_TEMPLATE.md`.
- Ensure all CI checks pass locally before pushing — run `pnpm verify`.
