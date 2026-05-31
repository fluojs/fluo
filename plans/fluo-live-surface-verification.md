# Fluo Live Surface Verification

## TL;DR
> **Summary**: Build a new isolated `examples/live-surface-verification` app that proves fluo through real HTTP, PostgreSQL persistence, Socket.IO, and a React browser UI without changing public package contracts.
> **Deliverables**:
> - Dockerized PostgreSQL DB built from `examples/live-surface-verification/docker/postgres/Dockerfile`
> - fluo backend with health, readiness, persisted message APIs, and Socket.IO gateway
> - React/Vite UI that drives HTTP create/list and Socket.IO connect/echo/broadcast
> - Fast Vitest coverage plus explicit Docker/browser live QA scripts and evidence
> - EN/KO example index updates and README for the new verification example
> **Effort**: Large
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 6 -> Task 8

## Context
### Original Request
The user wants to know whether the work in fluo actually works. They asked for a Dockerfile-based DB setup, broad fluo verification, and a way to confirm Socket.IO through React.

### Interview Summary
No blocking user decision remains. Defaults applied:
- Use PostgreSQL because `@fluojs/drizzle` documents `drizzle-orm/node-postgres` and `pg`.
- Build a new isolated example instead of changing existing examples or public packages.
- Keep Docker/live/browser tests out of default `pnpm test`; expose explicit live scripts.
- Use Playwright for browser QA because the user explicitly asked to verify through React.

### Metis Review (gaps addressed)
- Docker ambiguity resolved as DB-only Dockerfile plus compose-managed DB; backend/frontend run locally for fast iteration and clear logs.
- CI flake risk resolved by keeping Docker/browser checks behind explicit scripts.
- Socket.IO CORS risk resolved with explicit browser origin and token guard in the example.
- Existing examples policy addressed by labeling this as a verification example, not a starter replacement.
- EN/KO docs parity included for example index and example README.

## Work Objectives
### Core Objective
Create a runnable verification example that proves fluo behavior through live user-facing surfaces: HTTP requests, a real PostgreSQL container, Socket.IO events, and a React browser UI.

### Deliverables
- `examples/live-surface-verification/package.json`
- `examples/live-surface-verification/README.md`
- `examples/live-surface-verification/README.ko.md`
- `examples/live-surface-verification/docker/postgres/Dockerfile`
- `examples/live-surface-verification/docker/postgres/init/001-schema.sql`
- `examples/live-surface-verification/docker-compose.yml`
- `examples/live-surface-verification/src/server/**`
- `examples/live-surface-verification/src/client/**`
- `examples/live-surface-verification/src/shared/**`
- `examples/live-surface-verification/tests/**`
- `examples/README.md`
- `examples/README.ko.md`

### Definition of Done (verifiable conditions with commands)
- `pnpm install --frozen-lockfile` exits 0 after dependency changes.
- `pnpm --dir examples/live-surface-verification test` exits 0.
- `pnpm --dir examples/live-surface-verification typecheck` exits 0.
- `pnpm vitest run --project examples examples/live-surface-verification` exits 0 and does not require Docker.
- `pnpm --dir examples/live-surface-verification live:up` starts PostgreSQL and reports healthy.
- `pnpm --dir examples/live-surface-verification live:qa:http` captures successful `curl -i` evidence for health, ready, create, list, malformed input.
- `pnpm --dir examples/live-surface-verification live:qa:browser` captures a Playwright trace/screenshot showing React HTTP and Socket.IO success states.
- `pnpm --dir examples/live-surface-verification live:down` removes containers, volumes, and leaves no bound ports on `15432`, `3300`, or `5174`.

### Must Have
- Implement in an isolated worktree under `.worktrees/live-surface-verification` from `main`.
- Follow existing example adapter-first bootstrap: `FluoFactory.create(AppModule, { adapter: createFastifyAdapter({ port }) })`.
- Use `SocketIoModule.forRoot(...)` and `@WebSocketGateway(...)`, not internal provider factories.
- Use explicit config/env boundary for `DATABASE_URL`, `PORT`, `CLIENT_ORIGIN`, and `SOCKET_TOKEN`.
- Use TDD for every production change: add failing tests first, capture RED output, implement, then capture GREEN output.
- Persist at least one entity in PostgreSQL and prove it survives across HTTP requests.
- Verify browser UI through a real browser, not only happy-dom.
- Capture QA artifacts under `examples/live-surface-verification/evidence/`.

### Must NOT Have
- Do not change public package APIs in `packages/*`.
- Do not make Docker/Postgres required for root `pnpm test`.
- Do not run `npm publish` or any local publish command.
- Do not use root ambient `process.env` inside package code; the example may read env only at application bootstrap/config boundary.
- Do not add `Co-Authored-By` trailers.
- Do not keep QA processes, containers, tmux sessions, temp dirs, or bound ports alive after verification.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: TDD with Vitest for unit/integration/example checks, Playwright for browser live QA, and curl for HTTP live QA.
- QA policy: Every task has agent-executed scenarios with concrete commands and expected outputs.
- Evidence: `examples/live-surface-verification/evidence/task-{N}-{slug}.*`

## Execution Strategy
### Parallel Execution Waves
Wave 1: Task 1
Wave 2: Tasks 2, 3
Wave 3: Tasks 4, 5
Wave 4: Tasks 6, 7, 8

### Dependency Matrix
| Task | Blocks | Blocked By |
| --- | --- | --- |
| 1 | 2, 3, 4, 5, 6, 7, 8 | none |
| 2 | 4, 6, 8 | 1 |
| 3 | 4, 6, 8 | 1 |
| 4 | 6, 8 | 2, 3 |
| 5 | 7, 8 | 1 |
| 6 | 8 | 4 |
| 7 | 8 | 5 |
| 8 | final verification | 2, 3, 4, 5, 6, 7 |

## TODOs
- [x] 1. Create Isolated Worktree And Example Scaffold

  **What to do**: Create `.worktrees/live-surface-verification` from `main`. Add `examples/live-surface-verification/` with `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.env.example`, empty `src/server`, `src/client`, `src/shared`, `tests`, and `evidence/.gitignore`. Add scripts: `dev:api`, `dev:web`, `test`, `typecheck`, `build`, `live:up`, `live:down`, `live:qa:http`, `live:qa:browser`.
  **Must NOT do**: Do not edit existing examples yet except if needed for workspace compatibility.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4, 5, 6, 7, 8 | Blocked By: none

  **References**:
  - Pattern: `examples/realworld-api/package.json` - private example package script/dependency style.
  - Pattern: `examples/tsconfig.json` - examples typecheck inclusion and workspace path aliases.
  - Pattern: `vite.config.ts` - shared fluo decorators Vite plugin.
  - API/Type: `vitest.config.ts` - root examples project includes `examples/**/*.test.ts`.

  **Acceptance Criteria**:
  - [ ] `git worktree list | grep '.worktrees/live-surface-verification'` exits 0.
  - [ ] `pnpm --dir examples/live-surface-verification typecheck` initially runs and reports only expected missing-source/test failures before implementation.
  - [ ] `pnpm --dir examples/live-surface-verification test` initially runs and reports no tests or expected RED scaffold tests.

  **QA Scenarios**:
  ```txt
  Scenario: Scaffold scripts are addressable
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm --dir examples/live-surface-verification run
    Expected: stdout lists dev:api, dev:web, test, typecheck, build, live:up, live:down, live:qa:http, live:qa:browser.
    Evidence: examples/live-surface-verification/evidence/task-1-scripts.txt

  Scenario: Root test project does not require Docker after scaffold
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm vitest run --project examples examples/live-surface-verification
    Expected: exits 0 or fails only on intentionally RED tests, never on missing Docker.
    Evidence: examples/live-surface-verification/evidence/task-1-examples-project.txt
  ```

  **Commit**: YES | Message: `chore(examples): scaffold live surface verification app` | Files: `examples/live-surface-verification/**`

- [x] 2. Add Dockerized PostgreSQL Boundary

  **What to do**: Add `docker/postgres/Dockerfile` using a pinned `postgres:17-alpine` base, copy init SQL into `/docker-entrypoint-initdb.d/`, define app DB/user defaults through compose env, and add `docker-compose.yml` with `postgres` service, healthcheck, named volume, and host port `15432`. Add shell scripts under `scripts/live-up.mjs` and `scripts/live-down.mjs` if package scripts need portable orchestration.
  **Must NOT do**: Do not require Docker for `pnpm test`.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 4, 6, 8 | Blocked By: 1

  **References**:
  - Contract: `docs/contracts/deployment.md` - deployment config and health requirements.
  - API/Type: `packages/drizzle/README.md` - PostgreSQL usage with `drizzle-orm/node-postgres` and `pg`.
  - Risk: repo currently has no Docker convention, so file names and ports must be explicit.

  **Acceptance Criteria**:
  - [ ] `pnpm --dir examples/live-surface-verification live:up` builds the DB image and reaches healthy status.
  - [ ] `docker compose -f examples/live-surface-verification/docker-compose.yml ps` shows `postgres` healthy; when the Docker Compose plugin is unavailable, use the script-detected `docker-compose -f ... ps` fallback and record that in evidence.
  - [ ] `pnpm --dir examples/live-surface-verification live:down` removes the container and volume.

  **QA Scenarios**:
  ```txt
  Scenario: PostgreSQL container becomes healthy
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm --dir examples/live-surface-verification live:up && docker compose -f examples/live-surface-verification/docker-compose.yml ps
    Expected: output contains postgres service with health status healthy.
    Evidence: examples/live-surface-verification/evidence/task-2-db-healthy.txt

  Scenario: Cleanup removes DB resources
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm --dir examples/live-surface-verification live:down && docker ps --filter name=fluo-live-surface --format '{{.Names}}'
    Expected: stdout is empty.
    Evidence: examples/live-surface-verification/evidence/task-2-db-cleanup.txt
  ```

  **Commit**: YES | Message: `build(examples): add live verification postgres stack` | Files: `examples/live-surface-verification/docker/**`, `examples/live-surface-verification/docker-compose.yml`, `examples/live-surface-verification/scripts/**`, `examples/live-surface-verification/package.json`

- [x] 3. Implement Backend Persistence Slice With Tests First

  **What to do**: Write RED Vitest tests for message DTO validation, repository persistence contract, and HTTP e2e-style create/list using `createTestApp({ rootModule })`. Implement server files: `src/server/app.module.ts`, `main.ts`, `config.ts`, `messages/message.dto.ts`, `messages/message.repository.ts`, `messages/messages.service.ts`, `messages/messages.controller.ts`, and `messages/messages.module.ts`. Use `DrizzleModule.forRootAsync(...)` with `pg.Pool`, `drizzle(pool)`, and `dispose: () => pool.end()`. Define SQL schema in init SQL and matching Drizzle table declarations in TypeScript.
  **Must NOT do**: Do not add live Postgres dependency to default tests; use an in-memory fake or injected test repository for fast RED/GREEN tests, and reserve real DB for live QA.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 4, 6, 8 | Blocked By: 1

  **References**:
  - Pattern: `examples/realworld-api/src/users/users.controller.ts` - HTTP controller and DTO boundary.
  - Pattern: `examples/realworld-api/src/app.test.ts` - app-level `createTestApp` request helpers.
  - API/Type: `packages/drizzle/README.md` - `DrizzleModule.forRootAsync(...)`, transaction/dispose contract.
  - Contract: `docs/contracts/testing-guide.md` - fluo TDD ladder and HTTP e2e-style tests.

  **Acceptance Criteria**:
  - [ ] RED evidence exists for `tests/server/messages.test.ts` before implementation.
  - [ ] `pnpm --dir examples/live-surface-verification test -- tests/server/messages.test.ts` passes after implementation.
  - [ ] `pnpm --dir examples/live-surface-verification typecheck` passes for backend files.

  **QA Scenarios**:
  ```txt
  Scenario: HTTP create/list works in fast test app
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm --dir examples/live-surface-verification test -- tests/server/messages.test.ts
    Expected: test id "serves persisted messages through the fluo HTTP request path" passes with POST /messages then GET /messages.
    Evidence: examples/live-surface-verification/evidence/task-3-http-green.txt

  Scenario: malformed message fails validation
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm --dir examples/live-surface-verification test -- tests/server/messages.test.ts
    Expected: test id "rejects malformed message input through the HTTP boundary" passes with HTTP 400.
    Evidence: examples/live-surface-verification/evidence/task-3-validation-green.txt
  ```

  **Commit**: YES | Message: `feat(examples): add live verification http persistence slice` | Files: `examples/live-surface-verification/src/server/**`, `examples/live-surface-verification/src/shared/**`, `examples/live-surface-verification/tests/server/**`, `examples/live-surface-verification/package.json`

- [x] 4. Add Socket.IO Gateway And Client Contract Tests

  **What to do**: Write RED tests for Socket.IO connect guard, echo ACK, and broadcast event. Implement `src/server/realtime/realtime.gateway.ts` and module wiring using `SocketIoModule.forRoot({ cors, auth, engine })`, `@WebSocketGateway({ path: '/live' })`, and `@OnMessage('message:create')`. Events: `message:created` broadcast after successful persistence, `ping` ACK returns `{ event: 'pong', received }`, guard rejects missing `SOCKET_TOKEN`.
  **Must NOT do**: Do not use internal `SocketIoLifecycleService` directly in example code.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 6, 8 | Blocked By: 2, 3

  **References**:
  - Pattern: `packages/socket.io/README.md` - `SocketIoModule.forRoot(...)`, gateway decorators, guard contracts, CORS defaults.
  - Pattern: `packages/socket.io/src/module.test.ts` - real server/client Socket.IO test style with `socket.io-client`.
  - Contract: `docs/reference/package-surface.md` - Socket.IO supports Node.js server-backed adapters, not Deno/Workers.

  **Acceptance Criteria**:
  - [ ] RED evidence exists for `tests/server/realtime.test.ts` before implementation.
  - [ ] `pnpm --dir examples/live-surface-verification test -- tests/server/realtime.test.ts` passes after implementation.
  - [ ] Missing token connection fails with a clear `Authentication required.` connect error.

  **QA Scenarios**:
  ```txt
  Scenario: Socket.IO authenticated ping succeeds
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm --dir examples/live-surface-verification test -- tests/server/realtime.test.ts
    Expected: test id "acks authenticated ping events through the Socket.IO gateway" passes.
    Evidence: examples/live-surface-verification/evidence/task-4-socket-green.txt

  Scenario: Socket.IO missing token is rejected
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm --dir examples/live-surface-verification test -- tests/server/realtime.test.ts
    Expected: test id "rejects unauthenticated Socket.IO clients" passes.
    Evidence: examples/live-surface-verification/evidence/task-4-socket-auth-green.txt
  ```

  **Commit**: YES | Message: `feat(examples): add live verification socket gateway` | Files: `examples/live-surface-verification/src/server/realtime/**`, `examples/live-surface-verification/tests/server/realtime.test.ts`, `examples/live-surface-verification/package.json`

- [x] 5. Build React/Vite Verification UI With Tests First

  **What to do**: Write RED happy-dom/Vitest tests for rendered initial state, HTTP error state, and Socket.IO status reducer behavior. Implement `src/client/main.tsx`, `App.tsx`, API client, socket client, state reducer, and CSS. UI must show DB status, HTTP create/list status, Socket.IO connection status, last ACK, and broadcast log. Keep it utilitarian and verification-focused; no landing page.
  **Must NOT do**: Do not make marketing hero content. Do not rely on hidden console logs as the observable.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 7, 8 | Blocked By: 1

  **References**:
  - Pattern: `packages/studio/src/app/bootstrap.tsx` - React root bootstrap.
  - Pattern: `packages/studio/src/pages/studio/StudioPage.tsx` - React stateful UI structure.
  - Pattern: `packages/studio/package.json` - React/Vite/happy-dom test dependencies.
  - UI Rule: domain is verification tooling, so use dense utilitarian layout with clear statuses.

  **Acceptance Criteria**:
  - [ ] RED evidence exists for `tests/client/app.test.tsx` before implementation.
  - [ ] `pnpm --dir examples/live-surface-verification test -- tests/client/app.test.tsx` passes after implementation.
  - [ ] UI text fits on desktop and mobile viewport in Playwright screenshots.

  **QA Scenarios**:
  ```txt
  Scenario: React UI renders all verification panels
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm --dir examples/live-surface-verification test -- tests/client/app.test.tsx
    Expected: test id "renders HTTP, database, and Socket.IO verification panels" passes.
    Evidence: examples/live-surface-verification/evidence/task-5-ui-green.txt

  Scenario: React UI exposes HTTP failure state
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm --dir examples/live-surface-verification test -- tests/client/app.test.tsx
    Expected: test id "shows a recoverable HTTP error when the API request fails" passes.
    Evidence: examples/live-surface-verification/evidence/task-5-ui-error-green.txt
  ```

  **Commit**: YES | Message: `feat(examples): add react live verification UI` | Files: `examples/live-surface-verification/src/client/**`, `examples/live-surface-verification/tests/client/**`, `examples/live-surface-verification/package.json`, `examples/live-surface-verification/vite.config.ts`

- [x] 6. Add Live HTTP QA Script And Evidence Capture

  **What to do**: Add `scripts/live-qa-http.mjs` that asserts Docker DB is healthy, starts the fluo backend on `127.0.0.1:3300`, waits for `/ready`, runs exact `curl -i` commands, writes raw request/response transcripts to evidence, and always shuts down backend. Commands must cover `/health`, `/ready`, `POST /messages`, `GET /messages`, malformed `POST /messages`, and a direct Socket.IO polling/auth failure smoke if practical.
  **Must NOT do**: Do not use `--dry-run`; this must hit the live endpoint.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 8 | Blocked By: 4

  **References**:
  - Pattern: `docs/contracts/deployment.md` - `/health`, `/ready`, explicit adapter port.
  - Pattern: `examples/minimal/src/main.ts` - adapter-first Fastify startup.
  - QA Rule: Manual-QA HTTP channel requires `curl -i` status line, headers, and body evidence.

  **Acceptance Criteria**:
  - [ ] RED evidence exists for the script failing before backend endpoints are implemented or reachable.
  - [ ] `pnpm --dir examples/live-surface-verification live:qa:http` passes after Tasks 2-4.
  - [ ] Evidence files contain `HTTP/1.1 200` for health/ready/list and `HTTP/1.1 201` for create.
  - [ ] Evidence files contain `HTTP/1.1 400` for malformed input.

  **QA Scenarios**:
  ```txt
  Scenario: Live HTTP happy path persists through PostgreSQL
    Tool: HTTP call
    Steps: pnpm --dir examples/live-surface-verification live:up && pnpm --dir examples/live-surface-verification live:qa:http
    Expected: evidence includes POST /messages 201 and GET /messages body containing "from-curl".
    Evidence: examples/live-surface-verification/evidence/task-6-http-live.txt

  Scenario: Live HTTP malformed input returns 400
    Tool: HTTP call
    Steps: pnpm --dir examples/live-surface-verification live:qa:http
    Expected: evidence includes malformed POST response status HTTP/1.1 400 and a validation error body.
    Evidence: examples/live-surface-verification/evidence/task-6-http-live-error.txt
  ```

  **Commit**: YES | Message: `test(examples): add live http verification script` | Files: `examples/live-surface-verification/scripts/live-qa-http.mjs`, `examples/live-surface-verification/package.json`

- [ ] 7. Add Browser QA With Playwright And Screenshot Evidence

  **What to do**: Add `tests/browser/live-ui.spec.ts` and `scripts/live-qa-browser.mjs` or package script that starts DB, backend, and Vite frontend on fixed ports (`15432`, `3300`, `5174`), drives Chromium to `http://127.0.0.1:5174`, creates a message, verifies it appears in HTTP list, connects Socket.IO with token, sends ping, verifies `pong`, triggers message broadcast, captures screenshots and trace, then shuts everything down.
  **Must NOT do**: Do not replace browser verification with happy-dom or CLI output.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 8 | Blocked By: 5

  **References**:
  - Pattern: `packages/studio/vite.config.ts` - Vite app package configuration.
  - Pattern: `packages/studio/src/app/bootstrap.tsx` - React DOM bootstrap.
  - Dependency note: root manifest has no direct Playwright dependency; add it to the example devDependencies and update `pnpm-lock.yaml`.

  **Acceptance Criteria**:
  - [ ] RED evidence exists for browser test failing before UI/server integration is complete.
  - [ ] `pnpm --dir examples/live-surface-verification live:qa:browser` passes after Tasks 4-5.
  - [ ] Screenshot evidence shows visible success statuses for HTTP, PostgreSQL, and Socket.IO.
  - [ ] Cleanup receipt proves no process remains on ports `3300` or `5174`.

  **QA Scenarios**:
  ```txt
  Scenario: Browser verifies HTTP and Socket.IO happy path
    Tool: browser use
    Steps: pnpm --dir examples/live-surface-verification live:qa:browser
    Expected: Playwright assertion passes for visible text "HTTP saved", "DB round-trip ok", and "Socket.IO pong received".
    Evidence: examples/live-surface-verification/evidence/task-7-browser-happy.png

  Scenario: Browser shows authentication failure then recovers
    Tool: browser use
    Steps: pnpm --dir examples/live-surface-verification live:qa:browser -- --auth-recovery
    Expected: screenshot first includes "Socket authentication failed", then after token reset includes "Socket.IO connected".
    Evidence: examples/live-surface-verification/evidence/task-7-browser-auth-recovery.png
  ```

  **Commit**: YES | Message: `test(examples): add browser live verification` | Files: `examples/live-surface-verification/tests/browser/**`, `examples/live-surface-verification/scripts/**`, `examples/live-surface-verification/package.json`, `pnpm-lock.yaml`

- [ ] 8. Document And Wire Example Discovery

  **What to do**: Write `README.md` and `README.ko.md` with exact setup, scripts, ports, env vars, expected evidence files, troubleshooting, cleanup, and scope note that Docker/live checks are explicit. Update `examples/README.md` and `examples/README.ko.md` to include the new verification example as a separate verification target, not as a default starter. Add `.changeset/*.md` only if any public `@fluojs/*` package changes were made; if changes are limited to examples/docs, do not add a changeset.
  **Must NOT do**: Do not claim the example is part of `fluo new` starter matrix unless CLI scaffolding is changed.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: final verification | Blocked By: 6, 7

  **References**:
  - Pattern: `examples/README.md` and `examples/README.ko.md` - examples index tone and structure.
  - Contract: `docs/CONTEXT.md` - package responsibility context.
  - Governance: `.codex/skills/fluo-release-operations/SKILL.md` - changesets only for public package impact.
  - Governance: `.codex/skills/fluo-docs-governance/SKILL.md` - EN/KO parity expectation.

  **Acceptance Criteria**:
  - [ ] English and Korean README files describe identical commands and scope.
  - [ ] `pnpm docs:sync-check` passes if docs tooling covers touched docs.
  - [ ] `grep -R "live-surface-verification" examples/README.md examples/README.ko.md` finds the new example in both locales.

  **QA Scenarios**:
  ```txt
  Scenario: README commands are executable as written
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && pnpm --dir examples/live-surface-verification live:up && pnpm --dir examples/live-surface-verification live:qa:http && pnpm --dir examples/live-surface-verification live:down
    Expected: commands exit 0 and cleanup receipt exists.
    Evidence: examples/live-surface-verification/evidence/task-8-readme-commands.txt

  Scenario: EN/KO index parity includes verification example
    Tool: bash
    Steps: cd .worktrees/live-surface-verification && grep -n "live-surface-verification" examples/README.md examples/README.ko.md
    Expected: both files contain one entry for the verification example.
    Evidence: examples/live-surface-verification/evidence/task-8-index-parity.txt
  ```

  **Commit**: YES | Message: `docs(examples): document live surface verification` | Files: `examples/live-surface-verification/README.md`, `examples/live-surface-verification/README.ko.md`, `examples/README.md`, `examples/README.ko.md`, optional `.changeset/*.md`

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
> ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
- [ ] F1. Plan Compliance Audit
  - Run `git diff --stat main...HEAD`.
  - Confirm all source changes live under `.worktrees/live-surface-verification`.
  - Confirm no public `packages/*` API changed unless a changeset exists.
- [ ] F2. Code Quality Review
  - Run `pnpm --dir examples/live-surface-verification typecheck`.
  - Run `pnpm --dir examples/live-surface-verification test`.
  - Run `pnpm vitest run --project examples examples/live-surface-verification`.
  - Run `pnpm lint` if docs/example changes touch linted paths.
- [ ] F3. Real Manual QA
  - Run `pnpm --dir examples/live-surface-verification live:up`.
  - Run `pnpm --dir examples/live-surface-verification live:qa:http`.
  - Run `pnpm --dir examples/live-surface-verification live:qa:browser`.
  - Run `pnpm --dir examples/live-surface-verification live:down`.
  - Record cleanup receipts: `docker ps --filter name=fluo-live-surface --format '{{.Names}}'`, `lsof -i :15432 -i :3300 -i :5174`.
- [ ] F4. Scope Fidelity Check
  - Verify default root/examples tests do not require Docker.
  - Verify README says live checks are explicit.
  - Verify Socket.IO browser CORS/auth values match `.env.example`.
  - Spawn `codex-ultrawork-reviewer` with plan, diff, and evidence; fix every finding until unconditional approval.

## Commit Strategy
- Use one commit per task after its tests and QA pass.
- Conventional commit format only.
- Do not commit automatically unless the user explicitly approves. Stage changes and present draft commit list if approval is absent.
- No `Co-Authored-By` trailers.
- If public `@fluojs/*` package behavior changes despite the plan, add an appropriate `.changeset/*.md` in the same commit.

## Success Criteria
- The user can run one documented example to verify fluo through a Dockerized DB, live HTTP, Socket.IO, and React browser UI.
- Fast repository tests remain Docker-free.
- Live QA produces concrete artifacts in `examples/live-surface-verification/evidence/`.
- All ports/processes/containers from QA are cleaned up and receipts are captured.
- Reviewer approval is unconditional before declaring implementation complete.
