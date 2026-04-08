# package folder structure

<p><strong><kbd>English</kbd></strong> <a href="./package-folder-structure.ko.md"><kbd>한국어</kbd></a></p>

This reference defines the standard folder structure for packages within the Konekti monorepo. Every package in `packages/` should follow these conventions for consistency and maintainability.

## standard root files

The following files should be located directly under the `src/` directory:

| file | responsibility |
| --- | --- |
| **`index.ts`** | Public API entry point. Reserved for re-exports only; no implementation code here. |
| **`module.ts`** | Runtime module definition and provider registration. |
| **`service.ts`** | Primary service for low-complexity packages. |
| **`types.ts`** | Publicly exported types and interfaces. |
| **`tokens.ts`** | Dependency injection tokens (symbols or constants). |
| **`errors.ts`** | Package-specific exception classes. |
| **`status.ts`** | Health indicators and readiness checks. |

## reserved folder names

If a package requires multiple files for a specific responsibility, use the following reserved folder names:

### `decorators/`
User-facing decorators and metadata readers.
- *Examples*: `@konekti/serialization`, `@konekti/validation`.

### `transports/`
Pluggable transport implementations for cross-protocol support.
- *Examples*: `@konekti/microservices` (Kafka, RabbitMQ, etc.).

### `stores/`
Pluggable storage backends.
- *Examples*: `@konekti/cache-manager` (Memory, Redis).

### `adapters/`
Bridges between third-party libraries and internal interfaces.
- *Examples*: `@konekti/cli`, `@konekti/passport`.

### `node/` / `web/`
Platform-specific code used to separate Node.js-only logic from web-standard logic.
- *Examples*: `@konekti/runtime`, `@konekti/websockets`.

### `internal/`
Framework-private implementation details. These files **must not** be re-exported from `index.ts`.

## placement decision tree

```text
Where should a new file go?
│
├─ Is it part of the public API?
│  ├─ YES → Does it match a root file (index, module, types, etc.)?
│  │        ├─ YES → Place in src/ root.
│  │        └─ NO  → Check reserved folder names.
│  └─ NO  → Place in internal/.
│
├─ Are there already 2+ files with this responsibility?
│  ├─ YES → Create or use the corresponding folder.
│  └─ NO  → Keep in src/ root until complexity grows.
```

## immutable rules

1.  **Stable Public API**: Moving a file within `src/` must not change the `index.ts` re-export signature.
2.  **Test Proximity**: Test files (`*.test.ts`) must reside in the same folder as the implementation they cover.
3.  **Snapshots**: `__snapshots__` directories remain co-located with their respective tests.
4.  **No Single-File Folders**: Do not create a folder if it will only contain one file.

---

For a complete list of packages, see [package-surface.md](./package-surface.md).
