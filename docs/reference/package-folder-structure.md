# package folder structure

<p><strong><kbd>English</kbd></strong> <a href="./package-folder-structure.ko.md"><kbd>한국어</kbd></a></p>

Reference layout for `packages/*/src` and the roles reserved by repository convention.

## canonical tree

```text
src/
├── index.ts
├── module.ts
├── service.ts
├── types.ts
├── tokens.ts
├── errors.ts
├── status.ts
├── decorators/
├── transports/
├── stores/
├── adapters/
├── node/
├── web/
└── internal/
```

## path roles

| path | role |
| --- | --- |
| `src/index.ts` | Public export surface only; keep implementation out of the entrypoint. |
| `src/module.ts` | Module definition, provider registration, and package wiring. |
| `src/service.ts` | Primary service entry for low-complexity packages. |
| `src/types.ts` | Public types and interfaces. |
| `src/tokens.ts` | DI tokens and related constants. |
| `src/errors.ts` | Package-specific exceptions and error types. |
| `src/status.ts` | Health, readiness, or package status helpers. |
| `src/decorators/` | User-facing decorators and decorator helpers. |
| `src/transports/` | Transport-specific implementations for protocol variants. |
| `src/stores/` | Storage backend implementations. |
| `src/adapters/` | Bridges between third-party APIs and fluo contracts. |
| `src/node/` | Node-only runtime code. |
| `src/web/` | Web-standard or edge-safe runtime code. |
| `src/internal/` | Private implementation details that must not be re-exported publicly. |

## placement rules

| condition | placement |
| --- | --- |
| Public API file matches a reserved root filename | Keep it in `src/` root. |
| Public API responsibility needs multiple files | Use the matching reserved folder. |
| Implementation is private to the package | Place it in `src/internal/`. |
| Responsibility currently has one small file only | Keep it in root until the group grows. |
| Code is runtime-specific | Split it into `src/node/` or `src/web/`. |
| Test or snapshot support files | Keep them next to the implementation they cover. |

## constraints

- Moving files inside `src/` must not change the public re-export contract from `index.ts`.
- Do not create single-file folders without a clear grouping need.
- Root package entrypoints must not eagerly import runtime-specific Node builtins; keep those dependencies in `src/node/` or behind lazy resolution inside the runtime-specific execution path.
- Shared public type files such as `src/types.ts` must stay runtime-neutral when a package also ships Bun, Deno, Workers, or other non-Node subpaths; put Node socket/request types in `src/node/*-types.ts` and re-export them from the Node subpath.
- `__snapshots__/` stays next to the tests it supports.
- Use [package-surface.md](./package-surface.md) for the canonical package inventory.
