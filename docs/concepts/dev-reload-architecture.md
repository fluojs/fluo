# dev reload architecture

<p><strong><kbd>English</kbd></strong> <a href="./dev-reload-architecture.ko.md"><kbd>한국어</kbd></a></p>

fluo strictly separates development-time changes into two distinct paths: **full process restarts** for source code and **in-process reloads** for configuration. This distinction is a deliberate architectural choice to ensure maximum reliability without sacrificing developer velocity.

## why this matters

Modern backend development demands a "live" feel where changes are reflected instantly. However, traditional "hot module replacement" (HMR) or simple "file-watching restarts" often blur the lines between **stateless logic** and **stateful infrastructure**.

If a database connection or a network socket is left hanging during a partial reload, the application enters an undefined state—leading to "phantom bugs" that disappear after a manual restart. fluo eliminates this class of errors by enforcing a clear boundary: code is logic, and logic requires a clean slate.

## core ideas

### the "clean slate" principle (code changes)
The default development runner (`@fluojs/cli`) watches your entire source tree. When any `.ts` file changes:
1. The runner sends a `SIGTERM` to the current process.
2. The application executes its [graceful shutdown sequence](./lifecycle-and-shutdown.md), closing database pools and finishing active requests.
3. The runner spawns a entirely new process.

This ensures that the dependency graph is rebuilt from scratch using the latest TC39 standard decorators, and that no stale memory or "zombie" connections persist. We prioritize **absolute correctness** over the marginal speed gains of risky HMR.

### the "live tune" path (config changes)
Configuration updates—such as editing an `.env` file or a JSON config—follow a different path. Because configuration is designed to be **dynamic data** rather than **static logic**, fluo can apply these changes without killing the process.

This allows developers to:
- Toggle feature flags instantly.
- Adjust log levels without losing the current debug context.
- Update API keys or secrets and verify the integration immediately.

## ownership boundaries

### runner orchestration
The **CLI** (`@fluojs/cli`) acts as the "supervisor." It owns the file watcher and the process lifecycle. It doesn't know *what* the code does, only that it has changed and needs a fresh environment.

### config snapshot production
The **Config Package** (`@fluojs/config`) is responsible for "observing" the environment. It merges file-based configuration with environment variables to produce an immutable **Config Snapshot**. When a file changes, it produces a *new* snapshot and validates it against your defined schema.

### runtime application
The **Runtime** (`@fluojs/runtime`) acts as the "consumer." It hosts the `ConfigService` which acts as a stable reference. When a new valid snapshot arrives from the Config Package, the `ConfigService` updates its internal state and triggers "reload hooks" for any services that need to react to the new data (e.g., updating a cache TTL).

## boundaries

- **Statelessness Required**: For in-process reloads to work reliably, services consuming the `ConfigService` must not "bake" config values into local private variables during their constructor. They should always query the service or subscribe to updates.
- **Validation Barrier**: A new config snapshot is **never** applied if it fails validation. The application will continue running on the "last known good" configuration, and the CLI will report the validation error in the console.
- **Development-Only**: While the architecture supports it, in-process reloading is typically disabled in production to maintain the "immutable infrastructure" pattern where a new config means a new deployment.

## related docs

- [Architecture Overview](./architecture-overview.md)
- [Config and Environments](./config-and-environments.md)
- [Lifecycle and Shutdown](./lifecycle-and-shutdown.md)
- [CLI README](../../packages/cli/README.md)

