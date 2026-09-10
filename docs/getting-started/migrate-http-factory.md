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
  createNodejsAdapter,
  createNodeShutdownSignalRegistration,
} from '@fluojs/platform-nodejs';
import { AppModule } from './app.js';

const app = await FluoFactory.create(AppModule, {
  adapter: createNodejsAdapter({ host: '127.0.0.1', port: 3000 }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
// For an explicit shutdown instead of a signal:
await app.close('manual');
```

For Fastify or Express, change only the adapter import/configuration. Add a direct
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

Existing platform bootstrap/run helpers and their not-yet-migrated consumers,
including host-specific CLI recipes, remain available until their platform
migrations. They use Factory for HTTP creation rather than a second application
implementation. Their transport options and host shutdown policies are retained.
Body parsing, multipart/compression settings, native middleware, connection
drain, and realtime bindings remain adapter-owned; do not move transport-only
options into Factory.

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
The retained `http-adapter-shared.ts` integration functions serve Node, Fastify,
Express, Bun, Deno, Workers, and Next.js helpers; they are not a renamed public
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

The Changeset carries major intent for breaking runtime/Node/CLI/testing behavior.
Upgrade `@fluojs/cron` with `@fluojs/runtime`: its mandatory Runtime dependency
requires a coordinated major under the stable release rule, without changing
the scheduling contract.
The optional HTTP capability is additive. Other package README edits only migrate
the removed runtime imports and have no independent behavior change; their patch
entries account for the README files shipped in package tarballs. Book and Docs
companions are not independently published `@fluojs/*` API changes.
