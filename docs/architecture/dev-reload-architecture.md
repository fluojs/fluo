# Dev Reload Architecture

<p><strong><kbd>English</kbd></strong> <a href="./dev-reload-architecture.ko.md"><kbd>한국어</kbd></a></p>

## Reload Strategies

| Change class | Active mechanism in this repository | Runtime effect | Source anchor |
| --- | --- | --- | --- |
| Source code changes in generated Node starters | The default generated `dev` script is `fluo dev`, which runs through the fluo-owned restart runner unless `--raw-watch` or `FLUO_DEV_RAW_WATCH=1` selects native Node watch mode. | The host process is restarted after debounced content changes. fluo receives a fresh bootstrap instead of an in-process code swap contract. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Source code changes in generated Bun starters | The default generated `dev` script is `fluo dev`, which runs through the same fluo-owned restart runner and spawns `bun src/main.ts` for each app child. | The Bun app process is restarted after debounced content changes with the same terminal clear/header/app-log contract as Node. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Source code changes in generated Deno starters | The default generated `dev` script is `fluo dev`, which runs through the same fluo-owned restart runner and spawns `deno run --allow-env --allow-net src/main.ts` for each app child. | The Deno app process is restarted after debounced content changes with the same terminal clear/header/app-log contract as Node. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Source code changes in generated Workers starters | The default generated `dev` script is `fluo dev`, which runs through the same fluo-owned restart runner and spawns `wrangler dev --show-interactive-dev-session=false` for each app child. | The Workers preview process is restarted after debounced content changes with the same terminal clear/header/app-log contract as Node. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Configuration file changes with config reload enabled | `createConfigReloader(...)` can watch the configured env file when `watch: true`, and `ConfigReloadModule` activates that watcher during `onApplicationBootstrap()`. The watcher skips reload when final env file content matches the last committed watch baseline. | The `ConfigService` snapshot is replaced in process after content changes and validation succeeds. | `packages/config/src/load.ts`, `packages/config/src/reload-module.ts` |
| Manual config refresh | `ConfigReloader.reload()` triggers the same reload path without file-system watch mode. | Callers can request a new validated snapshot explicitly. | `packages/config/src/load.ts:251-267` |

The repository exposes two reload families only: host-owned restart flows for code, and config snapshot replacement for watched configuration inputs.

## Constraints

| Constraint | Factual statement | Source anchor |
| --- | --- | --- |
| No documented HMR contract | The shipped lifecycle runner performs full-process restart-on-watch for generated application source changes and still exposes runtime-native Node watch as an escape hatch. No public runtime contract performs partial module replacement for TypeScript source files. | `packages/cli/src/commands/scripts.ts`, `packages/cli/src/dev-runner/node-restart-runner.ts` |
| Watch scope for config reload | `startReloaderWatcher(...)` watches the normalized env file path, or its parent directory when the env file is missing at startup, and returns no watcher when `watch` is disabled or no watch target exists. | `packages/config/src/load.ts` |
| Config watch content dedupe | Watch-triggered reloads compare env file content to the last committed watch baseline before applying reload, so unchanged saves and change-then-revert bursts do not notify reload listeners. | `packages/config/src/load.ts`, `packages/config/src/load.test.ts` |
| Validation barrier | If a watched config update fails validation, reload error listeners are notified and the current snapshot remains unchanged. | `packages/config/src/load.ts:197-202`, `packages/config/src/load.test.ts:321-379` |
| Last valid snapshot guarantee | The watch-mode test keeps `PORT=4000` after an invalid update, then advances to `PORT=4300` only after a valid replacement arrives. | `packages/config/src/load.test.ts:365-373` |
| Activation point | `ConfigReloadManager` creates the reloader lazily and only during `onApplicationBootstrap()` when `options.watch` is true. | `packages/config/src/reload-module.ts:80-97` |
| Rollback on listener failure | When reload listeners throw during snapshot replacement, `replaceConfigServiceSnapshot(...)` is rolled back to the previous snapshot. | `packages/config/src/reload-module.ts:99-117` |
| Shutdown cleanup | `ConfigReloadManager.onModuleDestroy()` closes the watcher and clears listeners during shutdown. | `packages/config/src/reload-module.ts:88-90` |
| Production boundary | The inspected repository sources document config reload as an available mechanism, but they do not declare automatic production enablement. Watch activation remains an explicit `watch: true` choice at the application boundary. | `packages/config/src/reload-module.ts:80-86`, `packages/config/src/load.ts:193-204` |

This architecture keeps application-code reload outside the runtime contract. Runtime-managed reload is limited to validated configuration snapshots that flow through `@fluojs/config`.

## CLI Lifecycle Output Contract

- Default `fluo dev` and `fluo start` output is app logs only (application `stdout`/`stderr`).
- `--reporter pretty` is opt-in for fluo lifecycle UI and `app │` prefixed child output.
- `--verbose` or `FLUO_VERBOSE=1` is opt-in for raw runtime/tooling watcher output.
- Node restart notices are suppressed by default and only shown in opt-in modes.
- Node, Bun, Deno, and Workers dev commands use the fluo-owned restart boundary by default so app-log-only output, color preservation, and restart clear/header behavior stay consistent across runtimes.

## Related Docs

- [Package Architecture Reference](./architecture-overview.md)
- [Config and Environments](./config-and-environments.md)
- [Lifecycle & Shutdown Guarantees](./lifecycle-and-shutdown.md)
- [CLI README](../../packages/cli/README.md)
