# HTTP Factory Migration

<p><strong><kbd>English</kbd></strong> <a href="./migrate-http-factory.ko.md"><kbd>한국어</kbd></a></p>

## Scope and public imports

This breaking migration makes `FluoFactory.create(AppModule, { adapter })` the
single HTTP application creation implementation. It covers `@fluojs/runtime`,
the optional HTTP adapter listen-target capability, Node shutdown registration,
the Node CLI starters, and consumers of the removed runtime names. It does not
turn DI contexts, microservices, host entrypoints, decorators, or protocol
operations into HTTP application creation.

| Removed public surface | Replacement |
| --- | --- |
| `fluoFactory` from `@fluojs/runtime` | Import `FluoFactory`; its context and microservice static methods retain their distinct behavior. |
| `bootstrapApplication({ rootModule, ...options })` | `FluoFactory.create(rootModule, options)` |
| Factory callers relying on no default security headers | Pass `securityHeaders: false`, or adopt the common default. |
| Retrying `app.listen()` after readiness, adapter, or post-listen setup failure | Create a fresh app; the failed app has entered terminal shutdown. |
| Worker `createCloudflareWorkerAdapter(...)` | `CloudflareWorkerHttpApplicationAdapter.create(...)`, then `FluoFactory.create(AppModule, { adapter })` and `app.listen()`. |
| Worker `bootstrapCloudflareWorkerApplication(...)`, `createCloudflareWorkerEntrypoint(...)`, or `createCloudflareWorkerEnvEntrypoint(...)` | Use `CloudflareWorkerApplicationHost.create(AppModule, options)` for fixed modules, or the same method with `{ fromEnv }` when the first environment chooses configuration. |

The removed names are absent from package root, every export-map subpath,
deployed JavaScript, and emitted declarations. There is no compatibility alias.
`BootstrapApplicationOptions` remains an options type for existing integration
contracts, not a callable alternative. `CreateApplicationOptions` now includes
`logger`, `cors`, `globalPrefix`, `globalPrefixExclude`, `securityHeaders`,
`shutdownRegistration`, and `forceExitTimeoutMs`.

## Canonical recipe

Use a supported Node `>=24 <27` host, install the imported packages, and retain
the application's standard-decorator setup before evaluating `AppModule`.
The fragment assumes an existing registered `AppModule`.

```ts
import { FluoFactory } from '@fluojs/runtime';
import {
  createConsoleApplicationLogger,
  NodeHttpApplicationAdapter,
  createNodeShutdownSignalRegistration,
} from '@fluojs/platform-nodejs';
import { AppModule } from './app.js';

const app = await FluoFactory.create(AppModule, {
  adapter: NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 3000 }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
// For an explicit shutdown instead of a signal:
await app.close('manual');
```

For Fastify or Express, change only the adapter import/configuration: use
`FastifyHttpApplicationAdapter.create(options)` or
`ExpressHttpApplicationAdapter.create(options)`. Add a direct
`@fluojs/platform-nodejs` dependency when importing its logger or signal callback;
do not rely on a transitive platform dependency. Node CLI starters now emit these
direct dependencies and the same Factory recipe. Generated Node mixed starters
still connect/start their owned microservices through instance methods.

For a host-owned lifecycle, omit `shutdownRegistration` and have the host call
`app.close(signal?)`. Factory does not import `process` or Node builtins, invent
signals, or bind sockets on behalf of Fetch hosts. An app can close before listen;
that path never installs signals. An adapterless HTTP shell remains usable for
`app.dispatch()` before close; calling its `listen()` rejects as a usage error
without disposing that shell. For DI-only work use `createApplicationContext`.

Platform bootstrap/run helpers and adapter creation free functions are removed.
Use each platform's public adapter class static `create(options)` method, pass the
result to Factory, and let the host install any shutdown callback.
Body parsing, multipart/compression settings, native middleware, connection
drain, and realtime bindings remain adapter-owned; do not move transport-only
options into Factory.

## Platform startup migration

These are removed historical APIs, not compatibility aliases:

| Platform | Removed entrypoints | Adapter creation |
| --- | --- | --- |
| Fastify | `createFastifyAdapter`, `bootstrapFastifyApplication`, `runFastifyApplication` | `FastifyHttpApplicationAdapter.create(options)` |
| Express | `createExpressAdapter`, `bootstrapExpressApplication`, `runExpressApplication` | `ExpressHttpApplicationAdapter.create(options)` |
| Node | `bootstrapNodeApplication`, `bootstrapNodejsApplication`, `runNodeApplication`, `runNodejsApplication` | `NodeHttpApplicationAdapter.create(options)` |
| Bun | `createBunAdapter`, `bootstrapBunApplication`, `runBunApplication` | `BunHttpApplicationAdapter.create(options)` |
| Deno | `createDenoAdapter`, `bootstrapDenoApplication`, `runDenoApplication` | `DenoHttpApplicationAdapter.create(options)` |

Pass the adapter to Factory. Omit listen when replacing bootstrap-only creation;
explicitly await `app.listen()` when replacing a run call. Replace helper-only
`Bootstrap*ApplicationOptions`, `Run*ApplicationOptions`, and platform signal aliases
with adapter options, `CreateApplicationOptions`, `NodeShutdownSignal`,
`BunShutdownSignal`, or `DenoShutdownSignal`. Static factories return concrete
classes, so their adapter-specific capabilities do not require casts.

- Move the former second Fastify/Express multipart argument to `options.multipart`.
  Keep TLS, raw-body, body limits, native middleware, and drain settings on adapters.
  Move CORS, prefix, application middleware, security headers, and logger to Factory.
- Supply `createNodeShutdownSignalRegistration(signals?)` for Node/Fastify/Express,
  `createBunShutdownSignalRegistration(signals?)` for Bun, or
  `createDenoShutdownSignalRegistration(signals?)` for Deno as `shutdownRegistration`.
  Omit that callback for the host-owned behavior formerly selected by `shutdownSignals: false`.
- Direct Bun adapters default `shutdownTimeoutMs` to 10 seconds. Select
  `shutdownTimeoutMs: 30_000` to preserve the former managed run's default drain.
  To preserve an old `forceExitTimeoutMs: t`, set both adapter `shutdownTimeoutMs: t`
  and Factory `forceExitTimeoutMs: t`; these are now independent bounds.
  Node-family drain defaults to 10 seconds and signal completion to 30 seconds.
  Deno drain defaults to 10 seconds, and `hostname` continues to override `host`.
- Retain standalone Bun/Deno fetch handlers and Workers/Next.js host bridges;
  do not replace them with managed starters that open sockets.

## Defaults, order, and failures

- Factory copies the caller middleware array and orders configured CORS →
  configured prefix/exclusions → default security headers → caller middleware.
  Module middleware follows route matching. CORS and prefix default off;
  security headers default on and accept `false` to opt out.
- `logger` defaults to the portable console logger. The exact supplied object
  is registered as `APPLICATION_LOGGER`; use the Node console or JSON logger
  explicitly when that output format is required.
- Creation runs graph compilation, runtime token registration, singleton
  lifecycle resolution, both startup hook passes, platform start, and dispatcher
  construction. Creation failure attempts all acquired cleanup, including the
  supplied adapter with `bootstrap-failed`, and preserves the initiating error.
- Listen awaits readiness, adapter startup, startup diagnostics, and optional
  host shutdown registration. Failure at any of these stages attempts close
  before rejecting with the original failure, including when cleanup logging
  throws. Overlapping listeners share that result. A close racing startup waits
  for the admitted startup, prevents a late ready transition, and cleans once.
- Close closes admission synchronously, waits for admitted startup, and attempts
  signal unregistration once. It then closes children and runs the existing
  runtime cleanup/hook/adapter/container phases. Concurrent closes share failures.
  An unregistration error is retained for future calls; it never skips resource
  cleanup and aggregates with an independent teardown error. `state = 'closed'`
  means runtime resources closed, not that host signal cleanup succeeded.
- Node registration rolls back partially installed handlers and attempts every
  signal removal even after an earlier removal fails. A custom registration owns
  rollback before returning its unregister callback. Node signal completion uses
  the existing `30_000` ms default, logs failure, and sets `process.exitCode`; it
  never invokes `process.exit()`. Adapter drain bounds remain separate.

The [lifecycle owner](../architecture/lifecycle-and-shutdown.md) retains the exact
hook order and incomplete-phase retry rules. HTTP startup failure is now terminal;
DI context and microservice cleanup contracts have not been collapsed into it.

## Resolution, dispatch, and identity

`app.get(token)` infers `Promise<T>` for `PublicToken<T>` and preserves class-token
inference, explicit generics, DI instance identity, and constructor compatibility.
It rejects after close begins, rechecks admission after asynchronous resolution,
and cannot return a provider obtained across shutdown. Prefer `app.dispatch(...)`
for ordinary HTTP dispatch: it rejects new work from close start without cancelling
already admitted requests.

`app.container` and `app.dispatcher` remain low-level integration surfaces with
their original identities. Direct use bypasses the app wrapper gate until the
container's own disposal boundary; it is not an equivalent normal request path.
No instance `listen`, `close`, `send`, or `publish` operation becomes static.

## Implementation and verification evidence

`FluoFactory.create` owns the actual HTTP creation body in
`packages/runtime/src/bootstrap.ts`; the dedicated free-function implementation
and alias are deleted. Private lifecycle/provider/token stages are still shared
by `create` and `createApplicationContext`. `bootstrapModule` remains the existing
lower-level graph seam consumed by those methods and the testing module builder.
The retained `http-adapter-shared.ts` integration functions serve Workers and
Next.js hosted lifecycles; they are not a renamed public
runtime HTTP creation alternative.

Automated evidence lives in `factory-lifecycle.test.ts`,
`factory-public-types.test.ts`, `application.test.ts`,
`portable-runtime-boundary.test.ts`, Node `factory-signals.test.ts`, and CLI
`factory-scaffold.test.ts`. The lifecycle machine contract, its negative
regressions, and discoverability index are updated together.

Build dependency closures before package checks, then run focused runtime/Node/CLI
tests, `pnpm verify:docs`, and `pnpm verify:platform-consistency-governance`.
The implementation receipt records actual commands and exit codes; these
instructions alone do not claim published-release or external-host verification.

All Changesets use patch intent at the maintainer's explicit request. This
classification does not remove the migration requirements for the breaking
runtime/Node/CLI/testing changes described above.
Upgrade `@fluojs/cron` with `@fluojs/runtime`; its mandatory Runtime dependency
is retained without changing the scheduling contract.
The optional HTTP capability is additive. Other package README edits only migrate
the removed runtime imports and have no independent behavior change; their patch
entries account for the README files shipped in package tarballs. Book and Docs
companions are not independently published `@fluojs/*` API changes.
