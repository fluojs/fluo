# Quick Start Foundation - Verification Receipt

Scope: real-surface verification backing `apps/docs/content/docs/getting-started/quick-start.mdx` in the `docs-foundation` worktree. The chapter's commands were executed exactly as written; this receipt records environment, commands, exit codes, observed output, and unexecuted scope.

## Environment

- Date: 2026-09-21
- Host: macOS (darwin arm64, Apple M4 Pro)
- Node: `v24.20.0`
- pnpm: `10.4.1`
- Sandbox root: `/tmp/fluo-quickstart-evidence` (outside the repository workspace)
- Repository evidence base: worktree branch `docs-foundation`, head `e0c73126e` at verification start

## Published vs workspace evidence split

- Executed against published npm packages: CLI and all generated-app dependencies below.
- Read from workspace source only (not executed): `packages/runtime/src/health/health.ts` (`/ready` `starting`/`unavailable` 503 states), `packages/runtime/src/bootstrap.ts` (startup/shutdown sequence), `packages/cli/src/new/scaffold.ts` (generated file bodies, scripts, port parser), `packages/cli/src/new/prompt.ts` (non-interactive defaults).
- No claim is made about npm registry releases newer than the versions listed.

## Commands and results

### 1. CLI version check

```
pnpm dlx @fluojs/cli@3.0.2 --version
```

- Exit: 0
- stdout: `3.0.2`
- npm `dist-tags.latest` for `@fluojs/cli`: `3.0.2` (via `npm view @fluojs/cli version dist-tags --json`)

### 2. Scaffold the application

```
pnpm dlx @fluojs/cli@3.0.2 new quick-start-app --shape application --transport http --runtime node --platform fastify --package-manager pnpm
```

- Exit: 0
- Non-interactive run (`CI=true`, no TTY). Cold run downloads the CLI (+14 packages); a repeat run completed in ~3s from cache.
- Observed completion (tail):

```
Installing dependencies with pnpm...
Packages: +233
...
Done in 2s using pnpm v10.4.1
Done.
Next steps:
  cd ./quick-start-app
  pnpm dev  # runs fluo dev
```

- pnpm 10 warning observed and documented as harmless: `Ignored build scripts: esbuild.`

### 3. Resolved registry versions (exact)

dependencies:

- `@fluojs/config` `2.0.1`
- `@fluojs/core` `2.1.1`
- `@fluojs/di` `3.1.1`
- `@fluojs/http` `3.1.2`
- `@fluojs/platform-fastify` `2.0.3`
- `@fluojs/platform-nodejs` `2.0.1`
- `@fluojs/runtime` `3.1.1`
- `@fluojs/validation` `2.1.1`

devDependencies:

- `@fluojs/cli` `3.0.2`
- `@fluojs/testing` `3.0.2`
- `@fluojs/vite` `2.0.1`
- `@vitest/coverage-v8` `4.1.11`
- `tsx` `4.23.15`
- `typescript` `6.0.3`
- `vite` `8.3.0`
- `vitest` `4.1.11`

Generated `package.json` declares caret ranges; the manifest's `"@fluojs/http": "^3.1.1"` and `"@fluojs/platform-fastify": "^2.0.2"` resolved to `3.1.2` / `2.0.3` at install time. `engines`: `node >=24.0.0 <27`.

### 4. Test suite

```
pnpm test
```

- Exit: 0, duration ~1.5s (tests 394ms)
- Output:

```
 Test Files  6 passed (6)
      Tests  7 passed (7)
```

Files: `src/app.test.ts`, `src/greeting/greeting.slice.test.ts`, `src/greeting/greeting.controller.test.ts`, `src/greeting/greeting.repo.test.ts`, `src/greeting/greeting.service.test.ts`, `test/app.e2e.test.ts`.

### 5. Dev server HTTP smoke

```
pnpm dev   # background session, default port 3000
```

Startup log (observed):

```
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [InstanceLoader] ConfigModuleImpl dependencies initialized
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [InstanceLoader] GreetingModule dependencies initialized
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [InstanceLoader] HealthModule dependencies initialized
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [InstanceLoader] AppModule dependencies initialized
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [RoutesResolver] GreetingController {/greeting}
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [RouterExplorer] Mapped {/greeting, GET} route
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [RoutesResolver] HealthController {/}
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [RouterExplorer] Mapped {/health, GET} route
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [RouterExplorer] Mapped {/ready, GET} route
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [FluoApplication] fluo application successfully started.
[fluo] 57697 - 9/21/2026, 6:34:04 PM LOG [FluoFactory] Listening on http://[::1]:3000
```

HTTP probes (curl, status + body):

| Request | Status | Body |
| --- | --- | --- |
| `GET /health` | 200 | `{"status":"ok"}` |
| `GET /ready` | 200 | `{"status":"ready"}` |
| `GET /greeting/` | 200 | `{"message":"Hello from fluo","framework":"fluo","project":"quick-start-app"}` |
| `GET /greeting` (no slash) | 200 (same body) | - |
| `GET /nope` | 404 | `{"error":{"code":"NOT_FOUND","message":"No handler registered for GET /nope.","status":404}}` |

Stopped with SIGINT (Ctrl+C); process exited cleanly.

### 6. Production build

```
pnpm build
```

- Exit: 0
- Output (tail):

```
vite v8.3.0  building ssr environment for production...
✓ 7 modules transformed.
dist/main.js  21.46 kB │ gzip: 3.11 kB
✓ built in 121ms
```

### 7. Production start

```
pnpm start
```

- Exit: 0 (after SIGINT); same startup log sequence as dev; `Listening on http://[::1]:3000`
- Probes after start: `GET /health` -> 200 `{"status":"ok"}`; `GET /greeting` -> 200 greeting body

### 8. PORT override

```
PORT=3100 pnpm start
```

- Observed: `Listening on http://[::1]:3100`; `GET http://localhost:3100/health` -> 200 `{"status":"ok"}`

## Source-evidenced (not executed) claims in the chapter

- `/ready` answers `503 {"status":"starting"}` before bootstrap marks readiness and `503 {"status":"unavailable"}` when a readiness check fails: `packages/runtime/src/health/health.ts` (route implementation). A 53-sample race loop during boot on port 3200 only observed connection-refused then `200 ready`; boot completed too fast to catch the 503 window.
- `PORT` parse policy `Number.parseInt(..., 10)` with `3000` fallback for non-finite results: generated `src/main.ts` body in `packages/cli/src/new/scaffold.ts` (`createMainFile`) and the `scaffold.test.ts` port assertions.
- Lifecycle `NODE_ENV` defaulting (`development` for dev, `production` for build/start): canonical contract `docs/getting-started/quick-start.md` and generated project README text in `scaffold.ts`.
- Shutdown via `SIGINT`/`SIGTERM` through the registered Node shutdown callback: `docs/getting-started/bootstrap-paths.md` and `packages/platform-nodejs` helpers (exit was clean under Ctrl+C, but per-state hook ordering was not individually observed).

## Toolchain notes for reproducing

- pnpm 10 prompts interactively for build-script approval when stdout is a TTY; run scaffold commands with `CI=true` and without a TTY, or answer the prompt (no selection needed for this starter).
- The sandbox rule from `packages/cli/scripts/local-test-env.mjs` applies: generated projects must live outside the repository workspace (`/tmp/fluo-quickstart-evidence` used here).

## Post-review editorial corrections (2026-09-21)

Applied after lead review of the first chapter draft; none change the executed evidence:

- The chapter intro no longer claims every shown command was executed. The global install command `pnpm add -g @fluojs/cli` was not executed; verification ran through pinned `pnpm dlx @fluojs/cli@3.0.2`.
- Shown project name `my-backend` normalized against the verified `quick-start-app`. The greeting `project` field is the only name-dependent output: `createGreetingRepoFile` in `packages/cli/src/new/scaffold.ts` writes the literal project name into the generated `GreetingRepo`.
- The `engines` range `>=24.0.0 <27` is described as the supported runtime range; hard refusal outside the range depends on engine-strict configuration and is no longer implied as universal.
- `pnpm dlx` described accurately as temporary download-and-run, not a "no-install runner".
- The `Ignored build scripts: esbuild` warning is scoped to this chapter's environment (pnpm 10.4.1, this starter) instead of a universal harmless claim.
