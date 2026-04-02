# contributing to konekti

Konekti is built on standard TypeScript decorators and explicit contract discipline. This guide explains how to set up your environment, verify changes, and follow our maintainer workflows.

## local development setup

Konekti uses a monorepo structure managed by `pnpm`.

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

## maintainer workflows

### CLI sandbox verification

When modifying `@konekti/cli` or core runtime packages, use the sandbox scripts to verify end-to-end behavior.

Inside `packages/cli/`:
- `pnpm sandbox:create`: Generates a fresh starter app in a temporary directory.
- `pnpm sandbox:verify`: Runs `build`, `typecheck`, and `test` inside the sandbox app.
- `pnpm sandbox:test`: Runs integration tests against the sandbox app.
- `pnpm sandbox:clean`: Removes the sandbox directory.

### example verification

Canonical examples in `examples/` are first-class workspace members and verification targets. They participate in the monorepo dependency graph, TypeScript type-checking, and Vitest test runs.

- **Typecheck**: `pnpm typecheck` includes `tsc -p examples/tsconfig.json --noEmit`. Examples share path-mapped workspace packages, so editor resolution and CI catch type errors in example code.
- **Tests**: `pnpm test` runs `vitest run`, which includes the `examples` project defined in `vitest.config.ts`. Each example has tests in `src/app.test.ts`.
- **Dependencies**: Each example has a `package.json` with `workspace:*` dependencies on `@konekti/*` packages. Run `pnpm install` after adding or changing example dependencies.

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

Konekti maintains strict behavioral contracts. Before opening a PR, ensure you have:
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
- Ensure all CI checks (lint, build, test) pass locally before pushing.
