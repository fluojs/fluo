# @konekti/config

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Reads, merges, validates, and exposes configuration as a typed runtime contract. Not just an `.env` reader.

## See also

- `../../docs/concepts/config-and-environments.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`

## What this package does

`@konekti/config` normalises multiple configuration sources into a single validated dictionary at bootstrap time, then wraps it in a typed accessor (`ConfigService`) that the rest of the app uses.

Sources, in merge order (lowest → highest precedence):

1. `defaults` (inline object)
2. env file (path set by `envFile` option, defaults to `.env`)
3. `process.env`
4. `runtimeOverrides` (inline object)

Validation runs after merging. If validation fails, the app refuses to start.

Merge policy:

- plain object values are **deep merged** by key
- non-object values (including arrays) use source precedence and replace earlier values
- no silent nested subtree loss when only part of a nested object is overridden

## Installation

```bash
npm install @konekti/config
```

## Quick Start

```typescript
import { loadConfig, ConfigService } from '@konekti/config';

const config = loadConfig({
  envFile: '.env',
  defaults: { PORT: '3000' },
  validate: (raw) => {
    if (!raw.DATABASE_URL) throw new Error('DATABASE_URL is required');
    return raw as { PORT: string; DATABASE_URL: string };
  },
});

const service = new ConfigService(config);
service.get('DATABASE_URL');          // returns string | undefined
service.getOrThrow('DATABASE_URL');   // throws if missing
service.getOptional('REDIS_URL');     // deprecated: use get()
service.snapshot();                   // returns a deep-cloned snapshot
```

In practice you use `ConfigModule.forRoot()` from `@konekti/config` inside your root module, which calls `loadConfig()` during bootstrap and registers the resulting `ConfigService` as a provider.

## Key API

### `loadConfig(options)`

| Option | Type | Description |
|---|---|---|
| `envFile` | `string` | Path to the env file to load (defaults to `.env`) |
| `envFilePath` | `string` | Alias for `envFile` |
| `defaults` | `ConfigDictionary` | Lowest-precedence values |
| `cwd` | `string` | Resolve the env file from a custom working directory |
| `processEnv` | `NodeJS.ProcessEnv` | Override the source used instead of the live `process.env` |
| `runtimeOverrides` | `ConfigDictionary` | Highest-precedence values |
| `validate` | `(raw) => T` | Throws on invalid config, returns typed dictionary |
| `watch` | `boolean` | Used by `createConfigReloader(options)` to enable env file watch reloads |
| `isGlobal` | `boolean` | Controls `ConfigModule.forRoot()` global registration (default: `true`) |

### `createConfigReloader(options)`

```typescript
type ConfigReloadReason = 'manual' | 'watch';

type ConfigReloader = {
  current(): ConfigDictionary;
  reload(): ConfigDictionary;
  subscribe(listener: (snapshot: ConfigDictionary, reason: ConfigReloadReason) => void): { unsubscribe(): void };
  subscribeError(listener: (error: unknown, reason: ConfigReloadReason) => void): { unsubscribe(): void };
  close(): void;
};
```

Use `createConfigReloader()` when you need explicit reload hooks. Reload notifications and errors are delivered via `subscribe(...)` and `subscribeError(...)`; no global process event side-effects are used.

When used together with `@konekti/runtime` and `watch: true`, the runtime can apply those validated snapshots to its existing `ConfigService` instance without rebuilding the full application shell.

### `ConfigService`

```typescript
class ConfigService {
  get<T>(key: string): T | undefined
  getOrThrow<T>(key: string): T       // throws if missing
  getOptional<T>(key: string): T | undefined // deprecated: use get()
  snapshot(): ConfigDictionary        // returns deep-cloned normalized values
}
```

### Types

- `ConfigDictionary`
- `ConfigModuleOptions`
- `ConfigLoadOptions`

## Architecture

```
bootstrapApplication(options)
  → loadConfig(options)
      → read defaults + env file + process.env + runtimeOverrides
      → merge in precedence order
      → validate(merged)
      → ConfigDictionary
  → new ConfigService(values)
  → register as bootstrap-level provider

createConfigReloader(options)
  → load + validate snapshot
  → subscribe(listener) / subscribeError(listener)
  → reload() for manual refresh
  → watch env file when `watch: true`
  → close() to stop watching and clear subscriptions
```

`ConfigService` remains intentionally read-only after bootstrap. Dynamic reload is an explicit opt-in flow through `createConfigReloader()`.

That explicit reload path is still config-scoped. Konekti does not treat it as a general code hot reload or HMR mechanism.

## File reading order (for contributors)

1. `src/types.ts` — options and load contracts
2. `src/load.ts` — merge + validate entrypoint
3. `src/service.ts` — typed accessor
4. `src/load.test.ts` — merge/override/validation baseline tests

## Related packages

- **`@konekti/runtime`** — calls `loadConfig()` and registers `ConfigService` as a provider
- **`@konekti/cli`** — shows how generated apps lay out `.env` files

## One-liner mental model

```
@konekti/config = not an env reader, but a bootstrap contract that turns multiple sources into a validated runtime dictionary
```
