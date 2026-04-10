# @fluojs/config

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Configuration loading, merging, validation, and typed runtime access for fluo applications.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Key Capabilities](#key-capabilities)
- [Public API Overview](#public-api-overview)
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
2. **Process Environment**: Values from `process.env`.
3. **Environment File**: Values from the `.env` file (or custom path).
4. **Defaults**: Values provided in the `defaults` option.

### Deep Merging
Plain objects are deep-merged by key. Arrays and primitive values from higher-precedence sources completely replace lower-precedence ones.

### Validation
The `validate` function runs after all sources are merged but before the application starts. If it throws, the application bootstrap fails immediately.

## Public API Overview

| Class/Helper | Description |
|---|---|
| `ConfigModule` | Module for registering configuration globally or locally. |
| `ConfigService` | Service for typed access to configuration values. |
| `loadConfig(options)` | Functional entry point for loading configuration manually. |
| `createConfigReloader(options)` | Creates a reloader for dynamic configuration updates. |

## Related Packages

- **`@fluojs/runtime`**: Calls `loadConfig` internally during application bootstrap.
- **`@fluojs/validation`**: Can be used within the `validate` function for schema-based validation.

## Example Sources

- `packages/config/src/load.ts`
- `packages/config/src/service.ts`
- `packages/config/src/load.test.ts`

