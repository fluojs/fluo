# Dev Reload Architecture

<p><strong><kbd>English</kbd></strong> <a href="./dev-reload-architecture.ko.md"><kbd>한국어</kbd></a></p>

## Reload Strategies

| Change class | Active mechanism in this repository | Runtime effect | Source anchor |
| --- | --- | --- | --- |
| Source code changes in generated Node starters | The default generated `dev` script is `fluo dev`, which runs through the fluo-owned restart runner unless `--raw-watch` or `FLUO_DEV_RAW_WATCH=1` selects native Node watch mode. The official Node React/Vite starter delegates transformed client-graph `.tsx`/CSS updates to Vite. | Ordinary Node source/config changes restart the child; React changes follow the graph ownership table below. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Source code changes in generated Bun starters | The default generated `dev` script is `fluo dev`, which defaults to Bun's native watch loop (`bun --watch src/main.ts`). `fluo dev --runner fluo` restores the fluo-owned restart runner. | The Bun runtime owns watch/reload by default, reducing Node-supervised dev processes while preserving an explicit fluo restart fallback. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Source code changes in generated Deno starters | The default generated `dev` script is `fluo dev`, which defaults to Deno's native watch loop (`deno run --watch --allow-env --allow-net --allow-read=.env src/main.ts`). Broad env access preserves every application-owned key consumed through the generated `Deno.env.toObject()` snapshot; signal listeners require no separate Deno permission. `fluo dev --runner fluo` restores the fluo-owned restart runner with the same env, network, and narrow .env read permissions. | The Deno runtime owns watch/reload by default, reducing Node-supervised dev processes while preserving an explicit fluo restart fallback. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Source code changes in generated Workers starters | The default generated `dev` script is `fluo dev`, which defaults to Wrangler's native dev loop (`wrangler dev --show-interactive-dev-session=false`). `fluo dev --runner fluo` restores the fluo-owned restart runner. | Wrangler owns watch/reload by default, reducing the fluo Node supervisor boundary while preserving an explicit fluo restart fallback. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Configuration file changes with config reload enabled | `ConfigModule.forRoot({ watch: true, ... })` owns the one injectable `CONFIG_RELOADER` and activates its watcher during `onApplicationBootstrap()`. `ConfigReloadManager.create(...)` is the separate standalone manager. The watcher skips reload when final ordered env-file content matches the last committed watch baseline. | The existing `ConfigService` snapshot is replaced in process after content changes and validation succeeds. | `packages/config/src/load.ts`, `packages/config/src/module.ts` |
| Manual config refresh | `ConfigReloader.reload()` triggers the same reload path without file-system watch mode. | Callers can request a new validated snapshot explicitly. | `packages/config/src/load.ts:770-785` |

The repository distinguishes host-owned restarts for general code, scoped HMR in the official Node React/Vite starter, and validated config snapshot replacement.

For the **official Node React starter**, Vite transforms browser-owned `.tsx` and CSS,
delivers Fast Refresh/CSS updates through the development gateway's WebSocket, and supplies
the refresh preamble before hydration. The supervisor skips the Vite-transformed
client graph; HTTP page handlers load current SSR modules after DTO validation.
Incompatible React exports or hook signatures can remount/reload and lose local state.
The gateway owns the public port and WebSocket while a fresh Fastify app uses an
ephemeral listener for each server generation. A server-only edit closes HTTP
admission, drains the previous app within its shutdown bound, and starts a new
graph without replacing the browser document or its long-lived resources.
HTTP requests during the gap receive 503 and `Retry-After: 1`; the browser shows
an unavailable notice and removes it on readiness. Failed bootstrap leaves the
gateway and watchers alive for a corrective save. App shutdown failure is terminal.
Native Node raw watch is a process-restart escape hatch on macOS/Windows; Linux continues
using the fluo runner. Bun, Deno and Workers retain their existing native-watch choices,
without a React Fast Refresh claim. `ConfigModule.forRoot({ watch: true })` can separately replace a validated
env-file snapshot in process; invalid updates keep the last valid snapshot. A config/build
code edit that triggers the CLI watcher still restarts the child rather than hot-swapping
application modules. [The React product contract](../contracts/react-fullstack-product.md)
assigns scoped React/CSS updates to #3876 and general server/shared/config restart,
drain and recovery policy to #3877. Universal module hot swap or
universal state preservation is not promised.

| React change class | Graph ownership and effect |
| --- | --- |
| Client-only component/CSS | Vite client transform owns the file, but the bootstrap SSR import graph does not: Fast Refresh/CSS HMR, without app restart. |
| Server handler/service | Bootstrap SSR graph or unclaimed `src` file, with no client transform: serialize app shutdown and fresh bootstrap behind the stable gateway; browser document and WebSocket stay. |
| SSR/client shared dependency | Both graphs claim the file: restart the app generation, then issue one reasoned document reload after readiness to avoid mixed versions. Incompatible React boundaries cannot promise state retention. |
| Mixed save | If any file needs a stronger action, choose app restart or full child restart over client-only HMR. |
| Vite/module-graph config, `.env`, project configuration | Watched config outside `src` replaces the child/Vite graph and reloads client connections as needed. A fresh document request after readiness restores browser resources if an old in-flight load was interrupted by the process boundary; same-document retention is not promised here. A bootstrap failure keeps the supervisor watcher alive; a corrective edit retries. `ConfigModule.forRoot({ watch: true })` instead validates and rolls back an in-process snapshot, not this process/bootstrap contract. |

Content digests suppress unchanged saves, reconcile missed Vite changes, and treat
atomic replacement or removal as a change. `--runner native`, raw watch and
non-React starters retain their existing process boundary.

## Constraints

| Constraint | Factual statement | Source anchor |
| --- | --- | --- |
| Scoped HMR contract | Only the generated Node React/Vite client graph uses Fast Refresh/CSS HMR. Server-only React edits replace the app generation; other Node sources and the native-watch escape hatch retain process restarts. No general runtime TypeScript hot swap is provided. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Watch scope for config reload | `startReloaderWatcher(...)` watches the env file's parent directory for both existing and missing env files; env-file existence does not select between a file and directory watch target. It returns no watcher when `watch` is disabled, no env-file path is resolved, or the parent directory does not exist. | `packages/config/src/load.ts:663-713` |
| Config watch content dedupe | Watch-triggered reloads compare env file content to the last committed watch baseline before applying reload, so unchanged saves and change-then-revert bursts do not notify reload listeners. | `packages/config/src/load.ts:688-711`, `packages/config/src/load.test.ts:893-930` |
| Registration-time option snapshot | `ConfigModule.forRoot(...)` captures the shared service, reloader, and ordered env-file options synchronously during registration, while `ConfigReloadManager.create(...)` captures standalone options when created. Config dictionaries, `processEnv`, and the Standard Schema descriptor are detached before bootstrap or later reloads can observe caller mutations; callable values retain the references captured at that boundary. | `packages/config/src/options.ts`, `packages/config/src/module.ts`, `packages/config/src/module.test.ts`, `packages/config/src/reload-module.test.ts` |
| Validation barrier | If a watched config update fails validation, reload error listeners are notified and the current snapshot remains unchanged. | `packages/config/src/load.ts:608-626`, `packages/config/src/load.ts:688-711`, `packages/config/src/load.test.ts:795-846` |
| Last valid snapshot guarantee | The watch-mode test keeps `PORT=4000` after an invalid update, then advances to `PORT=4300` only after a valid replacement arrives. | `packages/config/src/load.test.ts:795-846` |
| Activation point | The `CONFIG_RELOADER` exported by `ConfigModule` lazily creates its reloader on the first manual `reload()`. `onApplicationBootstrap()` eagerly creates it only when `options.watch` is true and the manager has not been shut down. | `packages/config/src/module.ts` |
| Rollback on listener failure | When reload listeners throw during snapshot replacement, `replaceConfigServiceSnapshotUnchecked(...)` restores the previous snapshot. | `packages/config/src/module.ts`, `packages/config/src/reload-module.test.ts` |
| Shutdown cleanup | `ConfigReloadManager.onModuleDestroy()` closes the watcher and clears listeners during shutdown. | `packages/config/src/module.ts` |
| Terminal shutdown | Manager shutdown is terminal. After `close()` or `onModuleDestroy()`, `reload()`, `subscribe()`, and `subscribeError()` throw `InvariantError`, `onApplicationBootstrap()` is a no-op, and no replacement reloader or watcher is created. | `packages/config/src/module.ts`, `packages/config/src/reload-module.test.ts` |
| Production boundary | The inspected repository sources document config reload as an available mechanism, but they do not declare automatic production enablement. Watch activation remains an explicit `watch: true` choice at the application boundary. | `packages/config/src/module.ts`, `packages/config/src/load.ts` |

This architecture keeps generic application-code reload outside the runtime contract. The generated Node React development host owns its scoped Vite integration; runtime-managed snapshot reload remains limited to validated `@fluojs/config` configuration.

## CLI Lifecycle Output Contract

- Default lifecycle output forwards child `stdout`/`stderr` without fluo lifecycle UI; app-log-only output applies when the fluo runner owns the process boundary.
- `--reporter pretty` is opt-in for fluo lifecycle UI and `app │` prefixed child output.
- `--verbose` or `FLUO_VERBOSE=1` is opt-in for raw runtime/tooling watcher output on fluo-owned runner paths; runtime-native Bun, Deno, and Workers watch loops may emit their own tooling output by default.
- Node restart notices are suppressed by default and only shown in opt-in modes.
- Node dev commands use the fluo-owned restart boundary by default. Bun, Deno, and Workers dev commands default to runtime-native watch loops; use `--runner fluo` when app-log-only output, color preservation, and restart clear/header behavior must come from the fluo restart runner.

## Related Docs

- [Package Architecture Reference](./architecture-overview.md)
- [Config and Environments](./config-and-environments.md)
- [Lifecycle & Shutdown Guarantees](./lifecycle-and-shutdown.md)
- [CLI README](../../packages/cli/README.md)
