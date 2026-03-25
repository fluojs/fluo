# config and environments

<p><strong><kbd>English</kbd></strong> <a href="./config-and-environments.ko.md"><kbd>한국어</kbd></a></p>

This guide outlines the configuration management implemented across `@konekti/config`, the runtime bootstrap process, and package integrations.

### related documentation

- `../../packages/config/README.md`
- `./lifecycle-and-shutdown.md`
- `./dev-reload-architecture.md`
- `../getting-started/bootstrap-paths.md`

## responsibilities

- **`@konekti/config`**: Handles configuration loading, precedence, validation, and typed access.
- **Bootstrap**: Consumes pre-loaded configurations instead of re-reading environment variables.
- **Integrations**: Should use typed configuration providers rather than direct environment access.

## core configuration principles

- **Explicit File Selection**: Specify the env file path directly via `envFile` (or alias `envFilePath`), or use the `.env` default.
- **Deterministic Precedence**: One clear order for configuration resolution.
- **Early Validation**: Configuration is validated at application startup.
- **Typed Access**: Configurations are accessed via `ConfigService`.

## environments and files

The env file path is controlled by the `envFile` option (or alias `envFilePath`) passed to `ConfigModule.forRoot()` or `loadConfig()`. It defaults to `.env` when omitted. There is no automatic file selection based on a mode name — callers decide which file to load at bootstrap time.

## precedence and merging

The configuration resolution order is deterministic:

1.  **Runtime Overrides**: Passed directly during bootstrap.
2.  **Process Environment**: Standard system environment variables.
3.  **Env File**: Loaded from the path set by `envFile` / `envFilePath` (defaults to `.env`).
4.  **Default Values**: Hardcoded fallback values.

### merge behavior

- **Objects**: Plain objects are deep-merged across all sources.
- **Primitives and Arrays**: These follow the precedence order and replace existing values.
- **Safety**: Nested overrides must not inadvertently remove neighboring keys.

## validation and security

- **Fail-fast**: Invalid configurations prevent the application from starting.
- **Coercion**: Types are coerced once during the bootstrap phase.
- **Secrets**: Follow the standard precedence model but are never included in logs or error messages.

## usage recommendations

Use `ConfigService` for general application configuration. For complex integrations, prefer the typed configuration providers provided by those specific packages.

## reload behavior

`@konekti/config` keeps reload explicit.

- `loadConfig()` still resolves one validated snapshot during bootstrap.
- `createConfigReloader()` is the opt-in path for watching and reloading env-backed config.
- Reload support is config-specific; it does not imply general code hot reload.

When `@konekti/runtime` uses `watch: true`, it can subscribe to `createConfigReloader()` and apply validated snapshots to the existing `ConfigService` instance without rebuilding the whole application shell.

Runtime only applies snapshots that have already passed config validation. If runtime-side reload handling fails, the previous snapshot remains active.
