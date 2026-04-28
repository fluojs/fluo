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
- Load configuration from `.env` files and environment variables.
- Merge multiple configuration sources with strict precedence rules.
- Validate your application configuration at startup.
- Access configuration values through a typed `ConfigService`.

## Quick Start

The `ConfigModule` handles loading and validating your configuration during bootstrap.

```typescript
import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: {
        DATABASE_URL: process.env.DATABASE_URL,
      },
      defaults: { PORT: '3000' },
      validate: (config) => {
        if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required');
        return config;
      },
    }),
  ],
})
class AppModule {}
```

Once registered, you can inject `ConfigService` to access your values:

```typescript
import { Inject } from '@fluojs/core';
import { ConfigService } from '@fluojs/config';

class MyService {
  constructor(@Inject(ConfigService) private config: ConfigService) {
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

### Deep Merging
Plain objects are deep-merged by key. Arrays and primitive values from higher-precedence sources completely replace lower-precedence ones.

### Validation
The `validate` function runs after all sources are merged but before the application starts. If it throws, the application bootstrap fails immediately.

### Runtime Access and Reload Cost Model
`ConfigService.get('a.b.c')` resolves dot-path keys by walking each path segment, so lookup cost is proportional to path depth. When `get()`, `getOrThrow()`, or `snapshot()` returns an object-like value, the returned value is a detached clone; clone cost is proportional to the returned subtree size so caller mutations cannot affect the active config snapshot.

`ConfigReloadManager.reload()` serializes reload work. If another reload is requested while the current reload is notifying listeners, the follow-up reload is queued and applied after the active notification finishes; if the active notification fails, the previous snapshot is restored and the queued reload is discarded. The same serialization and rollback contract applies to `createConfigReloader(...).reload()`, including manual reloads queued during watch-triggered notifications.

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

`ConfigReloadManager.reload()` updates the existing `ConfigService` instance so consumers keep their injected service identity while observing the new snapshot. If a reload listener throws, the manager restores the previous snapshot and rethrows the listener error. `createConfigReloader(...).reload()` follows the same listener serialization and rollback behavior for its standalone reloader snapshot.

## Related Packages

- **`@fluojs/runtime`**: Calls `loadConfig` internally during application bootstrap.
- **`@fluojs/validation`**: Can be used within the `validate` function for schema-based validation.

## Example Sources

- `packages/config/src/load.ts`
- `packages/config/src/service.ts`
- `packages/config/src/load.test.ts`
