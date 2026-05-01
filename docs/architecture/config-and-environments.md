# Config Schema & Rules

<p><strong><kbd>English</kbd></strong> <a href="./config-and-environments.ko.md"><kbd>한국어</kbd></a></p>

This document defines the configuration source model implemented by `@fluojs/config`, the validation barrier enforced during load and reload, and the repository rule that package code must not read `process.env` directly.

## Config Sources

`packages/config/src/load.ts` merges configuration sources in ascending precedence.

| Precedence | Source | Entry point | Current rule |
| --- | --- | --- | --- |
| 1, lowest | `defaults` | `loadConfig(options)` or `ConfigModule.forRoot(options)` | Base snapshot values. |
| 2 | env file | `envFile` or `envFilePath` | Parsed from the configured file path, defaulting to `<cwd>/.env`. |
| 3 | `processEnv` snapshot | explicit `processEnv` option | Only values passed into the loader participate. Ambient `process.env` is not read automatically. |
| 4, highest | `runtimeOverrides` | explicit `runtimeOverrides` option | Final override layer for explicit runtime values. |

Current merge behavior:

| Case | Rule | Source anchor |
| --- | --- | --- |
| Plain objects in multiple sources | Deep-merged by key. | `packages/config/src/load.ts` |
| Arrays and primitives | Higher-precedence value replaces the lower-precedence value. | `packages/config/src/load.ts`, `packages/config/README.md` |
| Missing env file | Load continues with `{}` for that source. | `packages/config/src/load.ts` |
| `envFilePath` and `envFile` both set | `envFilePath` wins. | `packages/config/src/load.ts`, `packages/config/src/load.test.ts` |
| Undefined entries inside `processEnv` | Removed during sanitization and do not overwrite lower-precedence values. | `packages/config/src/load.ts`, `packages/config/src/load.test.ts` |

## Validation Rules

| Rule | Statement | Source anchor |
| --- | --- | --- |
| Merge before schema validation | The `schema` validator runs after all configured sources are merged. | `packages/config/src/load.ts`, `packages/config/README.md` |
| Fail-fast startup | If `schema` reports issues during initial load, config loading throws `FluoError` with code `INVALID_CONFIG`. | `packages/config/src/load.ts` |
| No partial snapshot | Invalid configuration is rejected as a whole. The load path returns no partial merged result. | `packages/config/src/load.ts` |
| Reload keeps previous snapshot on listener failure | During reload, listener failure restores the previous snapshot. | `packages/config/src/load.ts`, `packages/config/src/reload-module.ts` |
| Watch reload keeps last valid snapshot on validation failure | Watch-mode validation failure reports the error and keeps the current snapshot unchanged. | `packages/config/src/load.ts`, `packages/config/src/load.test.ts`, `docs/architecture/dev-reload-architecture.md` |
| Typed read access | `ConfigService.get(...)` and `getOrThrow(...)` expose read-only access to the normalized snapshot, including dot-path reads. | `packages/config/src/service.ts` |

Minimal schema contract:

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
});

ConfigModule.forRoot({
  envFile: '.env',
  processEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
  },
  defaults: { PORT: '3000' },
  schema: EnvSchema,
});
```

Config schemas must validate synchronously. If a Standard Schema validator returns a `Promise`, config loading fails with `INVALID_CONFIG` instead of awaiting it.

## Access Constraints

| Constraint | Statement | Source anchor |
| --- | --- | --- |
| No direct environment reads in packages | Packages MUST NOT read `process.env` directly. | `docs/contracts/behavioral-contract-policy.md`, `docs/CONTEXT.md` |
| Config entry boundary | Configuration must flow through `@fluojs/config` at the application boundary, then enter package code as explicit parameters or injected services. | `docs/contracts/behavioral-contract-policy.md`, `packages/config/README.md` |
| No ambient process scan | `@fluojs/config` does not scan live `process.env` unless the caller passes an explicit `processEnv` snapshot. | `packages/config/src/load.ts`, `packages/config/src/load.test.ts`, `packages/config/README.md` |
| Package consumption path | Runtime code should consume configuration through injected `ConfigService` or explicit options, not by calling `process.env` from package internals. | `packages/config/src/module.ts`, `packages/config/src/service.ts` |
| Reload activation | In-process config reload is explicit. Watch mode activates only when the caller enables `watch: true`. | `packages/config/src/load.ts`, `docs/architecture/dev-reload-architecture.md` |

Hard constraints:

- Packages MUST NOT read `process.env` directly.
- Configuration MUST flow through `@fluojs/config`.
- Process-backed values belong at the application bootstrap boundary, typically as the explicit `processEnv` snapshot passed into `ConfigModule.forRoot(...)` or `loadConfig(...)`.
- `ConfigService` is the read-only runtime facade. Snapshot replacement stays inside the config reload path.
