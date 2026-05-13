# @fluojs/config

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Configuration loading, merging, validation, and typed runtime access for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Key Capabilities](#key-capabilities)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/config
```

## When to Use

Use this package when you need to:
- Load configuration from `.env` files plus an explicit `processEnv` snapshot.
- Merge multiple configuration sources with strict precedence rules.
- Validate your application configuration at startup.
- Access configuration values through a typed `ConfigService`.

## Quick Start

The `ConfigModule` handles loading and validating your configuration during bootstrap.

```typescript
import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
});

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: {
        DATABASE_URL: process.env.DATABASE_URL,
      },
      defaults: { PORT: '3000' },
      schema: EnvSchema,
    }),
  ],
})
class AppModule {}
```

Use `envFilePath` when the env file lives at an absolute or pre-resolved path, or `parse` when you need a custom flat-file parser instead of the default dotenv parser.

Once registered, you can inject `ConfigService` to access your values:

```typescript
import { Inject } from '@fluojs/core';
import { ConfigService } from '@fluojs/config';

@Inject(ConfigService)
class MyService {
  constructor(private readonly config: ConfigService) {
    const port = this.config.get('PORT');
    const dbUrl = this.config.getOrThrow('DATABASE_URL');
  }
}
```

## Key Capabilities

### Source Precedence
Configuration is merged in the following order (highest precedence wins):
1. **Runtime Overrides**: Values passed explicitly via `runtimeOverrides`.
2. **Process Environment Snapshot**: Values passed via the `processEnv` option.
3. **Environment File**: Values from the `.env` file (or custom path).
4. **Defaults**: Values provided in the `defaults` option.

`@fluojs/config` does not scan ambient environment variables automatically. Pass an explicit `processEnv` snapshot at the bootstrap boundary when process-backed values should participate in precedence.

`envFilePath` overrides `envFile`, and `parse` lets callers replace dotenv parsing with a custom parser for flat key/value files. Missing env files are treated as empty input during load; watch mode also observes the parent directory so creating the file later can trigger a reload.

### Deep Merging
Plain objects are deep-merged by key. Arrays and primitive values from higher-precedence sources completely replace lower-precedence ones.

### Validation
The `schema` option accepts a synchronous [Standard Schema](https://standardschema.dev/schema)-compatible validator such as Zod, Valibot, or ArkType. The schema runs after all sources are merged but before the application starts. Its validated `value` becomes the final config snapshot, and reported issues fail bootstrap/load/reload with `INVALID_CONFIG`.

`@fluojs/config` keeps loading and reload APIs synchronous. Async Standard Schema results are rejected with `INVALID_CONFIG`; use a synchronous schema for config validation.

### Runtime Access and Reload Cost Model
`ConfigService.get('a.b.c')` resolves dot-path keys by walking each path segment, so lookup cost is proportional to path depth. When `get()`, `getOrThrow()`, or `snapshot()` returns an object-like value, the returned value is a detached clone; clone cost is proportional to the returned subtree size so caller mutations cannot affect the active config snapshot.

`ConfigReloadManager.reload()` serializes reload work. If another reload is requested while the current reload is notifying listeners, the follow-up reload is queued and applied after the active notification finishes; if the active notification fails, the previous snapshot is restored and the queued reload is discarded. The same serialization and rollback contract applies to `createConfigReloader(...).reload()`, including manual reloads queued during watch-triggered notifications.

Module registration and reloader creation snapshot caller-owned options before storing them. Later mutations to objects passed to `ConfigModule.forRoot(...)`, `ConfigReloadModule.forRoot(...)`, or `createConfigReloader(...)` do not affect bootstrap, manual reloads, or watch reloads. When `ConfigModule.forRoot({ watch: true, ... })` is used, the module starts an env-file watcher during application bootstrap, first aligns the injected `ConfigService` with the watch reloader baseline, and then updates the same injected `ConfigService` instance after successful watch reloads. Pass `onReloadError` when the application needs ownership of automatic watch reload failures from `ConfigModule`. In watch mode, the parent directory is watched for both existing and missing env files, so creating or atomically replacing the env file can trigger reload. Watch reloads compare the final env file content with the last committed watch baseline before reloading, so unchanged saves and change-then-revert bursts do not replace the in-process config snapshot.

`ConfigReloadModule` is the explicit injectable reload layer, not a standalone config source. Pair it with `ConfigModule` or another `ConfigService` provider when callers need `CONFIG_RELOADER` for manual reloads or subscriptions. Watchers created by `ConfigModule` or `ConfigReloadModule` are created only when `watch: true`, and they are closed during module shutdown. Enable `watch: true` on one layer for a given env file: use `ConfigModule` for automatic `ConfigService` updates, or `ConfigReloadModule` when callers need the injected reloader contract for subscriptions/manual reloads.

## Public API

| Class/Helper | Description |
|---|---|
| `ConfigModule` | Module for registering configuration globally or locally. |
| `ConfigReloadModule` | Registers the reload manager and exports the shared `CONFIG_RELOADER` token for dependency injection. |
| `ConfigReloadManager` | Coordinates reloads for the injected `ConfigService`, preserving service identity while replacing snapshots through the reload path. |
| `CONFIG_RELOADER` | Injection token for the shared config reloader contract. |
| `ConfigService` | Read-only service for typed access to configuration values. Snapshot replacement stays inside the config reload path. |
| `loadConfig(options)` | Functional entry point for loading configuration manually. |
| `createConfigReloader(options)` | Creates a reloader for dynamic configuration updates. |

The package also exports option and subscription types such as `ConfigModuleOptions`, `ConfigLoadOptions`, `ConfigReloadSubscription`, and `ConfigReloadReason`.

`ConfigReloadManager.reload()` updates the existing `ConfigService` instance so consumers keep their injected service identity while observing the new snapshot. If a reload listener throws, the manager restores the previous snapshot and rethrows the listener error. `createConfigReloader(...).reload()` follows the same listener serialization and rollback behavior for its standalone reloader snapshot.

## Related Packages

- **`@fluojs/runtime`**: Calls `loadConfig` internally during application bootstrap.
- **Standard Schema validators**: Zod, Valibot, ArkType, and other compatible schema libraries can be passed through the `schema` option.

## Example Sources

- `packages/config/src/load.ts`
- `packages/config/src/service.ts`
- `packages/config/src/load.test.ts`
- `packages/config/src/reload-module.ts`
- `docs/architecture/config-and-environments.md`
- `docs/architecture/dev-reload-architecture.md`
