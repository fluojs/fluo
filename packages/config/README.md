# @konekti/config

Reads, merges, validates, and exposes configuration as a typed runtime contract. Not just an `.env` reader.

## What this package does

`@konekti/config` normalises multiple configuration sources into a single validated dictionary at bootstrap time, then wraps it in a typed accessor (`ConfigService`) that the rest of the app uses.

Sources, in merge order (lowest → highest precedence):

1. `defaults` (inline object)
2. env file (`.env.dev`, `.env.test`, `.env.prod`, depending on mode)
3. `process.env`
4. `runtimeOverrides` (inline object)

Validation runs after merging. If validation fails, the app refuses to start.

## Installation

```bash
npm install @konekti/config
```

## Quick Start

```typescript
import { loadConfig, ConfigService } from '@konekti/config';

const config = loadConfig({
  mode: 'dev',
  defaults: { PORT: '3000' },
  validate: (raw) => {
    if (!raw.DATABASE_URL) throw new Error('DATABASE_URL is required');
    return raw as { PORT: string; DATABASE_URL: string };
  },
});

const service = new ConfigService(config);
service.get('DATABASE_URL');          // throws if missing
service.getOptional('REDIS_URL');     // returns undefined if missing
service.snapshot();                   // returns a copy of all values
```

In practice you use `bootstrapApplication()` from `@konekti/runtime`, which calls `loadConfig()` for you and registers the resulting `ConfigService` as a bootstrap-level provider.

## Key API

### `loadConfig(options)`

| Option | Type | Description |
|---|---|---|
| `mode` | `'dev' \| 'prod' \| 'test'` | Selects the env file to load |
| `defaults` | `ConfigDictionary` | Lowest-precedence values |
| `envFile` | `string` | Override the default `.env.<mode>` file path |
| `cwd` | `string` | Resolve the env file from a custom working directory |
| `processEnv` | `NodeJS.ProcessEnv` | Override the source used instead of the live `process.env` |
| `runtimeOverrides` | `ConfigDictionary` | Highest-precedence values |
| `validate` | `(raw) => T` | Throws on invalid config, returns typed dictionary |

### `ConfigService`

```typescript
class ConfigService {
  get<T>(key: string): T              // required — throws if missing
  getOptional<T>(key: string): T | undefined
  snapshot(): ConfigDictionary        // returns current normalized values copy
}
```

### Types

- `ConfigMode` — `'dev' | 'prod' | 'test'`
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
```

`ConfigService` is intentionally read-only after bootstrap — no dynamic reload, no namespace API.

## File reading order (for contributors)

1. `src/types.ts` — mode, options, and load contracts
2. `src/load.ts` — merge + validate entrypoint
3. `src/service.ts` — typed accessor
4. `src/load.test.ts` — merge/override/validation baseline tests

## Related packages

- **`@konekti/runtime`** — calls `loadConfig()` and registers `ConfigService` as a provider
- **`@konekti/cli`** — shows how generated apps lay out `.env.dev` / `.env.test` / `.env.prod`

## One-liner mental model

```
@konekti/config = not an env reader, but a bootstrap contract that turns multiple sources into a validated runtime dictionary
```
