# platform consistency design

<p><strong><kbd>English</kbd></strong> <a href="./platform-consistency-design.ko.md"><kbd>한국어</kbd></a></p>

This document defines the v1 cross-package platform contract for Konekti. It is the source of truth for how official packages should align around configuration, lifecycle, health/readiness, diagnostics, telemetry, resource ownership, and operational composition without reintroducing reflection, autowiring, or hidden discovery.

### related documentation

- `./architecture-overview.md`
- `./lifecycle-and-shutdown.md`
- `./observability.md`
- `./auth-and-jwt.md`
- `../reference/package-surface.md`
- `../operations/third-party-extension-contract.md`

## document authority

- **status**: draft v1
- **canonical language**: English (`.md`)
- **mirror document**: Korean (`.ko.md`)
- **scope**: official cross-package platform behavior only
- **non-authoritative sources**: issue threads, design chats, exploratory notes, and unpublished package-level intentions

If this document and a package README disagree about cross-package behavior, this document wins until the README is updated. If this document and shipped runtime behavior disagree, the mismatch must be resolved by either updating the implementation or updating this document in the same change set.

## purpose

Konekti already has strong package-level building blocks: explicit DI, standard decorators, bootstrap-time graph validation, runtime-owned startup/shutdown, and increasingly capable first-party integrations. What it still needs is a stable *platform spine* that makes those packages feel coherent when they are used together in a real service.

This document exists to answer the following question consistently across packages:

> What should a Konekti application be able to assume about any official package before it is allowed to participate in application bootstrap, readiness, shutdown, diagnostics, and observability?

The answer in v1 is:

1. every official platform-facing package exposes a consistent configuration and lifecycle contract,
2. every package reports readiness, health, diagnostics, and telemetry through a shared model,
3. the runtime orchestrates the application as a platform shell,
4. packages keep ownership of their own resources and remain explicitly wired,
5. no part of the design relies on reflection, constructor type inference, hidden module discovery, or autowiring.

## problem statement

Without a cross-package platform contract, the framework risks becoming a set of individually good packages that still feel operationally inconsistent:

- Redis may expose ownership and shutdown semantics differently from Prisma or Queue.
- Queue may expose useful runtime status that Event Bus does not.
- Metrics and Studio may consume different shapes of status information.
- Readiness may mean “dependency ping passed” in one package and “fully traffic-safe” in another.
- Diagnostics may be strong at bootstrap for DI and weak for transport/runtime edges.

NestJS often wins by ecosystem familiarity and module habit. Konekti should not attempt to win by copying reflection-based convenience. It should win by making explicitness feel *systematic* rather than *ceremonial*.

## scope

This document applies to cross-package behavior for the following official package families:

- platform shell and orchestration: `@konekti/runtime`
- stateful integrations: `@konekti/redis`, `@konekti/prisma`, `@konekti/drizzle`, `@konekti/mongoose`
- async and distributed work: `@konekti/queue`, `@konekti/event-bus`, `@konekti/microservices`, `@konekti/cron`, `@konekti/cqrs`
- operational surfaces: `@konekti/metrics`, `@konekti/throttler`, `@konekti/terminus`, `@konekti/cache-manager`
- security and auth-adjacent platform surfaces: `@konekti/jwt`, `@konekti/passport`
- tooling and diagnostics surfaces: `@konekti/cli`, `@konekti/studio`

This document may be referenced by `@konekti/http`, `@konekti/graphql`, and other packages when those packages expose operational resources or status, but it does not redefine their handler/runtime semantics.

## non-goals

This design is intentionally **not** trying to do the following:

1. Reintroduce reflection metadata, constructor autowiring, or `@Injectable()`-style implicit DI.
2. Create a universal base class that every package must inherit from.
3. Hide package-specific APIs behind a lowest-common-denominator abstraction.
4. Replace explicit module composition with naming conventions, folder scanning, or “register everything automatically” behavior.
5. Flatten package differences that are semantically meaningful, such as the difference between Redis Pub/Sub and Redis Streams.
6. Turn health/readiness into marketing signals rather than operational truth.
7. Define future feature breadth beyond what is necessary for shared platform behavior.

## glossary

| Term | Meaning in this document |
|---|---|
| **platform shell** | The runtime-owned orchestration layer that validates, starts, monitors, and stops official platform components. |
| **platform component** | A package-owned unit that participates in the platform lifecycle through a shared contract. |
| **resource ownership** | The rule that a package is responsible only for resources it created or explicitly agreed to own. |
| **validation** | Bootstrap-time checks that confirm config shape, dependency availability, supported combinations, and contract safety before start. |
| **health** | Internal liveness and self-integrity of a component. |
| **readiness** | Whether a component is currently safe to receive its intended traffic or workload. |
| **degraded** | A state where a component is still partially functional but does not satisfy its full intended operating contract. |
| **snapshot** | A structured, sanitized status payload exported for diagnostics, CLI inspection, and Studio rendering. |
| **platform contract** | The set of shared behaviors and shapes that all official platform-facing packages must expose. |

## design principles

### 1) explicit over implicit

Composition remains code-driven. Packages may provide helpers, presets, and generators, but not hidden dependency registration.

### 2) one lifecycle model

Every official platform component participates in the same lifecycle state model even if the package-specific work performed in each phase differs.

### 3) operational-first

Readiness, diagnostics, telemetry, and shutdown behavior are part of the package contract, not afterthoughts.

### 4) runtime owns orchestration, packages own resources

The runtime decides ordering and aggregation. Each package decides how to create, validate, observe, and release its own resources.

### 5) stable spine before feature breadth

The shared contract must stabilize before adding more package-specific features. A bigger surface without a shared spine increases operational inconsistency.

### 6) less ceremony through tooling, not magic

Boilerplate reduction should come from generators, presets, codemods, and explicit composition helpers. It must not come from hidden runtime behavior.

## definition of platform consistency

A Konekti user should be able to move from Redis to Queue to Event Bus to Prisma to Metrics and see the same high-level rules:

- how configuration is supplied,
- what is validated before boot,
- what “ready” means,
- what happens on shutdown,
- how to inspect status,
- how component identity appears in telemetry,
- how ownership boundaries are declared,
- and where failures are surfaced.

Platform consistency does **not** require identical APIs. It requires identical *operational expectations*.

## shared contract spine

v1 standardizes a small number of shared cross-package contracts. These contracts should be applied directly or adapted thinly by package-specific modules and providers.

### platform options base

Every platform-facing package should reserve the following option envelope shape, even when some fields are optional or unused by that package:

```ts
interface PlatformOptionsBase {
  id?: string;
  enabled?: boolean;

  readiness?: {
    critical?: boolean;
    timeoutMs?: number;
  };

  shutdown?: {
    timeoutMs?: number;
  };

  diagnostics?: {
    expose?: boolean;
    tags?: Record<string, string>;
  };

  telemetry?: {
    namespace?: string;
    tags?: Record<string, string>;
  };
}
```

#### rules

- `id` defaults to `default` only when the package clearly documents singleton/default behavior.
- `enabled: false` must short-circuit start behavior without producing partial ownership or hidden background loops.
- `readiness.critical` determines whether the component contributes to aggregate application readiness failure.
- `telemetry.namespace` may refine metric/tracing grouping but must not hide the package kind.

### platform component contract

Every platform-facing package should expose or internally adapt to this conceptual contract:

```ts
type PlatformState =
  | 'created'
  | 'validated'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'failed';

interface PlatformComponent {
  id: string;
  kind: string;

  state(): PlatformState;
  validate(): Promise<PlatformValidationResult> | PlatformValidationResult;
  start(): Promise<void>;
  ready(): Promise<PlatformReadinessReport>;
  health(): Promise<PlatformHealthReport>;
  snapshot(): PlatformSnapshot;
  stop(): Promise<void>;
}
```

This is a *contract shape*, not necessarily a required exported type name for every package. A package may expose a higher-level API as long as the runtime can adapt it into this shared model without special-case semantics.

### lifecycle state model

| State | Meaning | Allowed transitions |
|---|---|---|
| `created` | Config/module registered but not yet validated | `validated`, `failed` |
| `validated` | Bootstrap contract checks passed | `starting`, `failed` |
| `starting` | Acquiring resources or starting loops/listeners | `ready`, `degraded`, `failed` |
| `ready` | Fully able to serve intended work | `degraded`, `stopping`, `failed` |
| `degraded` | Partially serving but not at full contract | `ready`, `stopping`, `failed` |
| `stopping` | Releasing resources or draining work | `stopped`, `failed` |
| `stopped` | Shutdown complete | none |
| `failed` | Fatal contract or runtime failure | `stopping`, `stopped` |

#### state invariants

- `validate()` must not create long-lived resource ownership as a side effect.
- `start()` must be idempotent or explicitly reject duplicate calls in a deterministic way.
- `stop()` must be idempotent.
- `snapshot()` must be callable safely even when the component is degraded or failed.
- A component may report `degraded` only if its package documentation defines what degraded means for that package.

## validation model

Validation happens before traffic acceptance and before background loops are treated as running.

### validation must cover

- config shape and required fields
- unsupported option combinations
- missing required dependencies
- unsafe ownership combinations
- transport capability mismatches
- scope or lifecycle constraints visible at bootstrap
- naming/id collisions for platform components

### validation must not do

- silently start background work
- create orphan resources without ownership tracking
- swallow failures and continue as if the component were fully supported

### validation result shape

```ts
interface PlatformValidationResult {
  ok: boolean;
  issues: PlatformDiagnosticIssue[];
  warnings?: PlatformDiagnosticIssue[];
}
```

## health and readiness model

Health and readiness are related but not interchangeable.

### health answers

> Is the component internally alive and structurally intact?

Examples:

- Redis component has a live client and can perform a cheap integrity check.
- Queue worker loop is still active and not permanently crashed.
- Metrics endpoint registry is still mounted and able to render output.

### readiness answers

> Is the component currently safe to receive the work it is supposed to handle?

Examples:

- Prisma may be healthy as a process component but not ready if the datasource is unavailable.
- Event Bus may be healthy locally but degraded if the configured external transport is disconnected.
- Queue may be healthy but not ready if enqueue succeeds while worker startup has failed for a critical queue role.

### readiness report shape

```ts
interface PlatformReadinessReport {
  status: 'ready' | 'not-ready' | 'degraded';
  critical: boolean;
  reason?: string;
  checks?: Array<{
    name: string;
    status: 'pass' | 'fail' | 'degraded';
    message?: string;
  }>;
}
```

### health report shape

```ts
interface PlatformHealthReport {
  status: 'healthy' | 'unhealthy' | 'degraded';
  reason?: string;
  checks?: Array<{
    name: string;
    status: 'pass' | 'fail' | 'degraded';
    message?: string;
  }>;
}
```

### degraded semantics

Packages must document degraded conditions explicitly. v1 allows degraded states for situations like:

- partial transport connectivity,
- optional non-critical dependency loss,
- local-only fallback after external integration loss,
- non-blocking observability feature loss.

Packages must **not** report degraded when they are actually non-functional for their declared critical workload.

## diagnostics contract

Diagnostics are a first-class platform API. The same issue model should be usable for bootstrap validation, CLI inspection, Studio rendering, and runtime troubleshooting.

```ts
interface PlatformDiagnosticIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  componentId: string;
  message: string;
  cause?: string;
  fixHint?: string;
  dependsOn?: string[];
  docsUrl?: string;
}
```

### issue code rules

- codes should be stable and machine-filterable
- codes should start with package or domain prefix, e.g. `REDIS_`, `QUEUE_`, `PLATFORM_`, `AUTH_`
- fix hints should be concise and action-oriented
- `dependsOn` should expose upstream component causes when known

### required diagnostic categories

- config invalid
- missing dependency
- unsupported combination
- ownership mismatch
- startup failure
- readiness failure
- degraded fallback active
- shutdown timeout

### example

```json
{
  "code": "QUEUE_DEPENDENCY_NOT_READY",
  "severity": "error",
  "componentId": "queue.default",
  "message": "Queue startup requires a ready Redis component.",
  "cause": "redis.default readiness check failed during bootstrap.",
  "fixHint": "Verify Redis connectivity or mark the queue as disabled for this environment.",
  "dependsOn": ["redis.default"]
}
```

## telemetry contract

Telemetry should make platform behavior comparable across packages.

### common labels

- `component_id`
- `component_kind`
- `operation`
- `result`
- `env`
- `instance`

### common lifecycle metrics

- `konekti_component_start_duration_seconds`
- `konekti_component_ready`
- `konekti_component_health`
- `konekti_component_failures_total`
- `konekti_component_stop_duration_seconds`

### tracing and events

Packages that emit tracing spans or structured lifecycle events should align on names such as:

- `platform.validate`
- `platform.start`
- `platform.ready`
- `platform.stop`

Package-specific operations may extend this namespace, for example:

- `redis.connect`
- `queue.enqueue`
- `event_bus.publish`
- `prisma.transaction`

### telemetry rules

- component labels must not leak secrets
- IDs must be stable enough to correlate but not environment-sensitive in unsafe ways
- package-specific metrics may exist, but common labels must remain present where relevant
- packages should prefer low-cardinality labels by default

## resource ownership rules

Resource ownership is a core platform contract because shutdown correctness depends on it.

### hard rules

1. A package may stop only resources it created or explicitly agreed to own.
2. Caller-provided clients/handles must remain caller-owned unless the API clearly opts into transfer of ownership.
3. Ownership boundaries must be represented in diagnostics and snapshots when operationally relevant.
4. Shared resources must have one explicit owning component and any number of non-owning consumers.
5. `stop()` must be safe to call after partial `start()` failure.
6. Shutdown timeouts must surface as diagnostics, not disappear silently.

### examples

- `@konekti/redis` may own a client it creates from config, but not a raw client injected by the caller unless the package explicitly documents ownership transfer.
- `RedisEventBusTransport` may clean up its own subscriptions and listeners without calling `quit()` on caller-owned Redis clients.
- `MetricsModule` may own an internally created registry or share a caller-supplied registry without claiming ownership over external metrics.

## package integration model

v1 uses a **platform shell + explicit adapters** model.

### platform shell responsibilities

The runtime-owned shell is responsible for:

- collecting platform components from explicit package registrations,
- validating component identity and dependency edges,
- ordering startup and shutdown,
- aggregating readiness and health,
- exporting diagnostics and snapshots,
- serving as the common source for CLI inspection and Studio visualization.

### package adapter responsibilities

Each package is responsible for:

- exposing or adapting its package runtime into the shared platform contract,
- keeping package-specific APIs intact,
- translating package state into shared snapshot and diagnostic formats,
- preserving explicit resource ownership.

### dependency wiring model

Cross-package dependencies must be explicit. Examples:

- Queue depends on Redis.
- A Redis-backed throttler store depends on Redis.
- Prisma-backed auth token or account-linking policy storage depends on Prisma.
- Event Bus with external Redis transport depends on a Redis component.
- Studio depends on the runtime’s exported snapshot schema, not on package-specific bespoke data structures.

No dependency may be inferred from folder structure, naming conventions, or constructor type reflection.

## startup and shutdown sequencing

### startup sequence

1. construct explicit module graph
2. validate DI/module graph
3. collect platform components
4. validate platform component configs and dependency edges
5. topologically order components by explicit dependencies
6. start components in order
7. poll readiness for critical components
8. expose aggregate status to runtime and diagnostics surfaces

### shutdown sequence

1. mark application stopping
2. stop accepting new traffic/work where applicable
3. drain or reject in-flight work according to package semantics
4. stop platform components in reverse dependency order
5. record timeout or cleanup failures as diagnostics
6. mark application stopped

Packages may document package-specific drain behavior, but the ordering contract remains shared.

## shared snapshot schema

```ts
interface PlatformSnapshot {
  id: string;
  kind: string;
  state: PlatformState;
  readiness: {
    status: 'ready' | 'not-ready' | 'degraded';
    critical: boolean;
    reason?: string;
  };
  health: {
    status: 'healthy' | 'unhealthy' | 'degraded';
    reason?: string;
  };
  dependencies: string[];
  telemetry: {
    namespace: string;
    tags: Record<string, string>;
  };
  ownership: {
    ownsResources: boolean;
    externallyManaged: boolean;
  };
  details: Record<string, unknown>;
}
```

### snapshot rules

- `details` must be sanitized and stable enough for tooling consumption
- package-specific fields belong in `details`, not at the top level
- secrets, raw credentials, access tokens, or PII must never appear in snapshots

## package-family mapping

### runtime

`@konekti/runtime` is the platform shell entry point. It should aggregate component snapshots, publish readiness/health, and export a single stable status view to CLI and Studio.

### stateful integrations

`@konekti/redis`, `@konekti/prisma`, `@konekti/drizzle`, and `@konekti/mongoose` must prioritize:

- explicit ownership,
- deterministic connect/disconnect,
- clear readiness behavior,
- stable transaction/connection diagnostics.

### async and distributed work

`@konekti/queue`, `@konekti/event-bus`, `@konekti/microservices`, `@konekti/cron`, and `@konekti/cqrs` must prioritize:

- explicit dependency edges,
- clear degraded semantics,
- deterministic drain/stop behavior,
- visibility into pending work, handlers, consumers, and failure paths.

### operational surfaces

`@konekti/metrics`, `@konekti/throttler`, `@konekti/terminus`, and `@konekti/cache-manager` must prioritize:

- consistent telemetry tags,
- readiness semantics that match actual traffic behavior,
- standardized status output,
- no silent mismatch between runtime status and exposed operational endpoints.

### auth and policy surfaces

`@konekti/jwt` and `@konekti/passport` must prioritize:

- policy boundary clarity,
- storage/dependency readiness visibility,
- consistent diagnostics for auth misconfiguration,
- explicit ownership of framework-provided versus application-owned policy pieces.

### tooling surfaces

`@konekti/cli` and `@konekti/studio` must consume the shared snapshot and diagnostic model rather than defining separate package-specific inspection formats.

## package-specific application rules

### `@konekti/redis`

- must report whether the client is internally created or externally supplied
- must expose connection/readiness state clearly
- should surface ping latency or connection health detail without leaking credentials
- must document whether `lazyConnect` affects readiness behavior

### `@konekti/prisma` / `@konekti/drizzle`

- must distinguish client/process health from transaction-readiness concerns
- should expose whether ALS-backed transaction context is enabled
- should surface strict/fallback transaction mode in snapshot details
- must not obscure whether the framework or caller owns disposal

### `@konekti/mongoose`

- should surface connection state and session strategy
- must document that application code still owns explicit `{ session }` propagation where required

### `@konekti/queue`

- must report worker discovery count, worker readiness, pending failures, and DLQ status where observable
- must mark singleton-only worker constraints clearly in diagnostics
- should expose whether enqueue is available even if worker startup is degraded

### `@konekti/event-bus`

- must distinguish local-only operation from transport-backed operation
- should surface subscribed event types, transport connectivity, and waiting mode
- must document non-goals such as no durability, replay, wildcard matching, or ordering guarantee

### `@konekti/microservices`

- must expose transport kind and transport capability limits
- should emit clear diagnostics for unsupported patterns such as request/reply on Redis Pub/Sub
- must surface readiness in terms of listener/consumer availability, not just object construction
- should make unary-only gRPC support visible in docs and diagnostics where relevant

### `@konekti/metrics`

- must report isolated versus shared registry mode
- should align lifecycle metrics with the common schema
- must keep default labels low-cardinality unless the caller opts out explicitly

### `@konekti/throttler`

- must expose store kind and readiness impact of backing stores
- should distinguish local fallback from distributed-store operation if the package ever supports both at runtime

### `@konekti/terminus`

- should consume shared readiness and health semantics rather than inventing separate ones
- must avoid reporting aggregate application readiness in a way that contradicts the platform shell

### `@konekti/cache-manager`

- should expose store type and ownership mode
- must align cache availability semantics with readiness only when cache is part of a declared critical path

### `@konekti/jwt` / `@konekti/passport`

- must separate framework-owned primitives from application-owned policy
- should surface strategy registration, refresh token backing dependencies, and preset readiness clearly
- must not imply that application login/session policy has been standardized when it has not

### `@konekti/studio` / `@konekti/cli`

- should consume the shared diagnostic and snapshot schemas directly
- must not become the only place where package status is understandable
- should present component dependency chains and fix hints as first-class concepts

## examples

### example: conceptual component adapter

```ts
class RedisPlatformComponent implements PlatformComponent {
  readonly id = 'redis.default';
  readonly kind = 'redis';

  private currentState: PlatformState = 'created';

  state(): PlatformState {
    return this.currentState;
  }

  validate(): PlatformValidationResult {
    // validate config, ownership mode, and dependency assumptions
    this.currentState = 'validated';
    return { ok: true, issues: [] };
  }

  async start(): Promise<void> {
    this.currentState = 'starting';
    // create or attach client, then connect if owned
    this.currentState = 'ready';
  }

  async ready(): Promise<PlatformReadinessReport> {
    return { status: 'ready', critical: true };
  }

  async health(): Promise<PlatformHealthReport> {
    return { status: 'healthy' };
  }

  snapshot(): PlatformSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      state: this.currentState,
      readiness: { status: 'ready', critical: true },
      health: { status: 'healthy' },
      dependencies: [],
      telemetry: { namespace: 'redis', tags: {} },
      ownership: { ownsResources: true, externallyManaged: false },
      details: { mode: 'owned-client' },
    };
  }

  async stop(): Promise<void> {
    this.currentState = 'stopping';
    // quit owned client if needed
    this.currentState = 'stopped';
  }
}
```

### example: snapshot payload

```json
{
  "id": "queue.default",
  "kind": "queue",
  "state": "degraded",
  "readiness": {
    "status": "degraded",
    "critical": true,
    "reason": "Worker startup partially failed; enqueue remains available."
  },
  "health": {
    "status": "degraded",
    "reason": "One of three workers failed to start."
  },
  "dependencies": ["redis.default"],
  "telemetry": {
    "namespace": "queue",
    "tags": {
      "env": "production"
    }
  },
  "ownership": {
    "ownsResources": true,
    "externallyManaged": false
  },
  "details": {
    "workersDiscovered": 3,
    "workersReady": 2,
    "deadLetterEnabled": true
  }
}
```

## rollout phases

### P0 — define the spine

Deliverables:

- shared lifecycle states
- shared readiness/health semantics
- shared diagnostic schema
- shared telemetry labels
- shared snapshot schema
- package authoring checklist

Acceptance:

- runtime can aggregate heterogeneous platform components without package-specific branching for the common fields
- Studio and CLI can render the same top-level snapshot model

### P1 — align stateful integrations

Priority packages:

- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/mongoose`

Acceptance:

- ownership and readiness semantics are explicit and documented
- shutdown behavior is deterministic and test-covered

### P2 — align async and distributed work

Priority packages:

- `@konekti/queue`
- `@konekti/event-bus`
- `@konekti/microservices`
- `@konekti/cron`
- `@konekti/cqrs`

Acceptance:

- dependency edges are explicit
- degraded states are documented where supported
- diagnostics cover partial startup and transport mismatch cases

### P3 — align operational surfaces

Priority packages:

- `@konekti/metrics`
- `@konekti/throttler`
- `@konekti/terminus`
- `@konekti/cache-manager`
- `@konekti/jwt`
- `@konekti/passport`

Acceptance:

- telemetry labels are consistent
- readiness exported by operational endpoints matches the shared contract

### P4 — tooling convergence

Priority packages:

- `@konekti/cli`
- `@konekti/studio`

Acceptance:

- tooling consumes the shared snapshot and diagnostic schema directly
- no package requires a private one-off visualization path to be understood operationally

## governance and update rules

This document is intended to be long-lived. It must evolve with shipped cross-package behavior.

### update this document when

- a new official platform-facing package is introduced
- a package begins participating in readiness/health aggregation
- lifecycle state semantics change
- snapshot or diagnostic schema changes
- ownership rules change
- Studio or CLI changes the expected status export contract

### required companion updates

When this document changes materially, the same change set should also update:

- affected package README files
- `docs/README.md` / `docs/README.ko.md` if discoverability changes
- test coverage for the changed platform contract
- any tooling schema docs that consume snapshots or diagnostic issues

### change discipline

- English file first, Korean mirror second
- do not leave the Korean mirror structurally stale
- future work that is not yet shipped belongs in issues, not as normative requirements hidden in this document
- resolved behavior should not remain described as tentative if it is already shipped

## anti-patterns

The following are incompatible with this design:

1. **reflection-based autowiring**
   - constructor type inference used as hidden dependency metadata

2. **hidden discovery**
   - package registration by naming convention, folder layout, or side-effect import

3. **ownership ambiguity**
   - a package closes caller-owned resources without explicit agreement

4. **status dishonesty**
   - reporting `ready` when only object construction succeeded but traffic-safe behavior is not guaranteed

5. **tool-specific truth**
   - Studio or CLI requiring a separate private data model that diverges from runtime snapshots

6. **silent downgrade**
   - falling back to reduced behavior without emitting a degraded status or diagnostic issue

## acceptance checklist for official packages

Before a package claims platform consistency alignment, it should be able to answer “yes” to all of the following:

- Does it expose explicit config with bootstrap validation?
- Does it have a deterministic start and stop path?
- Can it explain readiness separately from health?
- Can it emit structured diagnostics with fix hints?
- Can it export a sanitized snapshot?
- Does it declare dependency and ownership semantics clearly?
- Does it align with shared telemetry labels and lifecycle events?
- Can CLI and Studio consume its status without package-specific interpretation logic?

## final rule

Konekti should reduce ceremony through better tooling and stronger composition helpers, but it must never trade away explicitness, ownership clarity, and fail-fast validation in order to imitate shorter reflection-driven frameworks. Platform consistency in v1 is successful only if official packages become easier to operate *without becoming harder to reason about*.
