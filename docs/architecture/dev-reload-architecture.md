# Dev Reload Architecture

<p><strong><kbd>English</kbd></strong> <a href="./dev-reload-architecture.ko.md"><kbd>한국어</kbd></a></p>

## Reload Strategies

| Change class | Active mechanism in this repository | Runtime effect | Source anchor |
| --- | --- | --- | --- |
| Source code changes in generated Node starters | The default generated `dev` script is `fluo dev`, which runs through the fluo-owned restart runner unless `--raw-watch` or `FLUO_DEV_RAW_WATCH=1` selects native Node watch mode. | The host process is restarted after debounced content changes. fluo receives a fresh bootstrap instead of an in-process code swap contract. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Source code changes in generated Bun starters | The default generated `dev` script is `fluo dev`, which defaults to Bun's native watch loop (`bun --watch src/main.ts`). `fluo dev --runner fluo` restores the fluo-owned restart runner. | The Bun runtime owns watch/reload by default, reducing Node-supervised dev processes while preserving an explicit fluo restart fallback. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Source code changes in generated Deno starters | The default generated `dev` script is `fluo dev`, which defaults to Deno's native watch loop (`deno run --watch --allow-env=PORT --allow-net --allow-signal src/main.ts`). The scoped env grant matches the generated entrypoint's `PORT` read, and signal access supports managed shutdown listeners. `fluo dev --runner fluo` restores the fluo-owned restart runner with the same permissions. | The Deno runtime owns watch/reload by default, reducing Node-supervised dev processes while preserving an explicit fluo restart fallback. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Source code changes in generated Workers starters | The default generated `dev` script is `fluo dev`, which defaults to Wrangler's native dev loop (`wrangler dev --show-interactive-dev-session=false`). `fluo dev --runner fluo` restores the fluo-owned restart runner. | Wrangler owns watch/reload by default, reducing the fluo Node supervisor boundary while preserving an explicit fluo restart fallback. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Configuration file changes with config reload enabled | `createConfigReloader(...)` can watch the configured env file when `watch: true`, `ConfigModule.forRoot({ watch: true, ... })` activates that watcher during `onApplicationBootstrap()`, and `ConfigReloadModule` activates the injectable reload-layer watcher during the same lifecycle phase. The watcher skips reload when final env file content matches the last committed watch baseline. | The `ConfigService` snapshot is replaced in process after content changes and validation succeeds. | `packages/config/src/load.ts:661-770`, `packages/config/src/module.ts:15-59`, `packages/config/src/reload-module.ts:84-125` |
| Manual config refresh | `ConfigReloader.reload()` triggers the same reload path without file-system watch mode. | Callers can request a new validated snapshot explicitly. | `packages/config/src/load.ts:754-769` |

The repository exposes two reload families only: host-owned restart flows for code, and config snapshot replacement for watched configuration inputs.

## Constraints

| Constraint | Factual statement | Source anchor |
| --- | --- | --- |
| No documented HMR contract | The shipped lifecycle runner performs full-process restart-on-watch for generated application source changes and still exposes runtime-native Node watch as an escape hatch. No public runtime contract performs partial module replacement for TypeScript source files. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Watch scope for config reload | `startReloaderWatcher(...)` watches the env file's parent directory for both existing and missing env files; env-file existence does not select between a file and directory watch target. It returns no watcher when `watch` is disabled, no env-file path is resolved, or the parent directory does not exist. | `packages/config/src/load.ts:661-703` |
| Config watch content dedupe | Watch-triggered reloads compare env file content to the last committed watch baseline before applying reload, so unchanged saves and change-then-revert bursts do not notify reload listeners. | `packages/config/src/load.ts:686-700`, `packages/config/src/load.test.ts:848-891` |
| Registration-time option snapshot | `ConfigModule.forRoot(...)` and `ConfigReloadModule.forRoot(...)` capture their options synchronously during module registration, while `createConfigReloader(...)` captures them when the reloader is created. Config dictionaries, `processEnv`, and the Standard Schema descriptor are detached before bootstrap or later reloads can observe caller mutations; callable values retain the references captured at that boundary. | `packages/config/src/options.ts:42-80`, `packages/config/src/module.ts:85-109`, `packages/config/src/reload-module.ts:131-150`, `packages/config/src/load.ts:739-752`, `packages/config/src/module.test.ts:123-139`, `packages/config/src/reload-module.test.ts:135-160`, `packages/config/src/load.test.ts:613-684` |
| Validation barrier | If a watched config update fails validation, reload error listeners are notified and the current snapshot remains unchanged. | `packages/config/src/load.ts:606-624`, `packages/config/src/load.ts:686-700`, `packages/config/src/load.test.ts:795-846` |
| Last valid snapshot guarantee | The watch-mode test keeps `PORT=4000` after an invalid update, then advances to `PORT=4300` only after a valid replacement arrives. | `packages/config/src/load.test.ts:795-846` |
| Activation point | Manual `ConfigReloadManager.reload()` lazily creates the reloader on first use. `onApplicationBootstrap()` eagerly creates it only when `options.watch` is true. | `packages/config/src/reload-module.ts:57-101` |
| Rollback on listener failure | When reload listeners throw during snapshot replacement, `replaceConfigServiceSnapshotUnchecked(...)` restores the previous snapshot. | `packages/config/src/reload-module.ts:103-115`, `packages/config/src/reload-module.test.ts:201-229` |
| Shutdown cleanup | `ConfigReloadManager.onModuleDestroy()` closes the watcher and clears listeners during shutdown. | `packages/config/src/reload-module.ts:69-94` |
| Production boundary | The inspected repository sources document config reload as an available mechanism, but they do not declare automatic production enablement. Watch activation remains an explicit `watch: true` choice at the application boundary. | `packages/config/src/module.ts`, `packages/config/src/reload-module.ts`, `packages/config/src/load.ts` |

This architecture keeps application-code reload outside the runtime contract. Runtime-managed reload is limited to validated configuration snapshots that flow through `@fluojs/config`.

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
