# How the CLI and Studio See an Application

<!-- book:volume=03-internals;chapter=18 -->

[Previous: Building a Reusable Fluo Extension Package](./ch17-extension-package.md) | [Volume 3 Contents](./toc.md) | [Next: Verifying Performance Claims Through Experiments](./ch19-performance-experiments.md)

## The Order Had Not Disappeared; the Observation Target Was Different

An order lookup failed in the operations screen of FluoBlog after it opened its shop. One developer suspected the recording extension from the previous chapter because the problem appeared after importing the new module into `OrdersModule`. Another developer looked at the diagram in Studio and concluded that "the order service is not registered." But that screen showed a static snapshot created the night before, not the DI graph of the application currently running.

In this situation, establishing the source of the observation comes before adding more logs. You need to know which run produced the data, whether bootstrap succeeded, and whether you read a file or connected to a live process. Even within the same Studio screen, different data production paths can answer different questions. Interpreting information the tool does not show as "absent" can lead you to change correct code while leaving the actual error in place.

This chapter preserves the boundary between `src/app.ts` and `src/main.ts` in the same product. The former assembles the application and exports `AppModule`; the latter is the execution boundary that starts the server. Pass `src/app.ts` to CLI inspection. Do not import `src/main.ts` for inspection and start real listeners or consumers a second time. Nor do we assume that `examples/fluo-blog` implements the full order model.

Dividing the questions into three groups makes choosing a tool easier. A static inspect artifact suits "Which routes and platform state were exported?" Node live Studio suits "Which modules currently inject what, and which requests were handled?" For "Why could the module not even bootstrap?", start with compilation failures, stderr, and a small module test. Do not try to answer that last question solely through snapshots produced after a successful bootstrap.

## How Three Packages Divide Observation Responsibilities

The public `runInspectCommand` in `@fluojs/cli` orchestrates command execution. It parses arguments, selects the module path and export, loads the runtime, wraps the result as JSON or a report, and writes files. The public root lazily imports the actual inspect implementation. Merely importing the CLI does not start the application to be inspected.

The runtime is the authority on the actual structure and routes. The inspect implementation creates an adapterless application and obtains its shell through `PLATFORM_SHELL`. It then reads `snapshot()` and the dispatcher's route descriptors to create an inspection snapshot. This is not a tool that imagines a route list by searching TypeScript files for class names with regular expressions. It can therefore reflect dynamic module assembly and the effective paths understood by the actual dispatcher, but module evaluation and bootstrap side effects can also actually occur.

`@fluojs/studio` consumes that data. The public `parseStudioPayload` checks the file format, `applyFilters` changes what is displayed, and `renderMermaid` draws platform dependencies. The browser viewer operates on top of this contract. There is no API such as a `StudioModule` to put in `AppModule.imports`. Installation and execution belong to the CLI sidecar and viewer boundary, not to an application feature module.

Static inspect provides a `PlatformShellSnapshot` and optional compiled `routes`. It includes reported platform components and dependencies, but not the compiled module/provider graph or provider scope metadata available in live mode. Node live mode, in contrast, provides module, provider, controller, and route nodes, along with import, export, ownership, and dependency relationships. The difference lies in the data produced, not in a single rendering option.

## Create the First Artifact with a Safe Inspection-Only Module

Before inspecting the real `src/app.ts`, first establish that bootstrap executes. The following is the **complete `fluo-blog/src/diagnostics/inspect-app.ts` file**. It is an independent experiment that uses only in-memory values and does not replace the shop modules. Explicit tokens, providers, exports, and class injection in this inspection-only module let you observe how far the CLI executes.

```ts
import { Inject, Module } from '@fluojs/core';

const ORDER_INSPECTION_STATE = Symbol('ORDER_INSPECTION_STATE');

interface OrderInspectionState {
  readonly orderId: string;
  readonly status: 'paid';
}

@Module({
  providers: [{
    provide: ORDER_INSPECTION_STATE,
    useValue: { orderId: 'order-42', status: 'paid' } satisfies OrderInspectionState,
  }],
  exports: [ORDER_INSPECTION_STATE],
})
class InspectOrdersModule {}

@Inject(ORDER_INSPECTION_STATE)
class LifecycleProbe {
  constructor(private readonly state: OrderInspectionState) {}

  onModuleInit(): void {
    if (this.state.status !== 'paid') {
      throw new Error('Unexpected inspection fixture state.');
    }
    console.error('INSPECT_PROBE_START');
  }

  onDestroy(): void {
    console.error('INSPECT_PROBE_STOP');
  }
}

@Module({
  imports: [InspectOrdersModule],
  providers: [LifecycleProbe],
})
export class InspectAppModule {}
```

Here, stderr is a deliberate observation channel. In an experiment that writes machine-consumed JSON to stdout, a provider that mixes in diagnostics with `console.log` can break the parser. The CLI separates its own runtime diagnostics onto stderr, but it is not an isolation mechanism that automatically sanitizes arbitrary stdout written directly by the application. Reducing import-time output and side effects is also good practice in real application assembly.

Run the following commands in a `fluo-blog` project using Node24 and pnpm10. `@fluojs/cli` and `@fluojs/runtime` must already be installed in the project. Install Studio as a development dependency. These commands are reproduction steps, not logs of successful execution for this manuscript.

```bash
pnpm add -D @fluojs/studio
pnpm exec fluo inspect ./src/diagnostics/inspect-app.ts --export InspectAppModule --report --output artifacts/inspect-probe-report.json
pnpm exec fluo-studio-viewer
```

The inspection command should write `INSPECT_PROBE_START` and `INSPECT_PROBE_STOP` to stderr. The report should contain timing and a snapshot, but routes will be an empty array because this fixture has no controller. An empty platform diagram is also normal because no platform components were registered. Concluding that the provider did not execute because `LifecycleProbe` is missing from the diagram is incorrect. The start/stop signals and the production scope of the static snapshot demonstrate why.

Open the viewer at the HTTP URL it prints. This does not mean opening the package's `dist/index.html` directly as a file. `@fluojs/studio/viewer` is an asset-resolution subpath for resolving the HTML entry file, not a JavaScript module to execute. The public `fluo-studio-viewer` command provides a local HTTP server; load the report file into that page.

In the same experiment, removing `imports` from `InspectAppModule` should make the token required by `LifecycleProbe` unresolvable. Do not expect a successful report in that case. An old report file may still remain, so file existence alone must not determine whether the latest inspection succeeded. Track the new run's exit code, output path, and generation time together.

## When Automating the CLI, the Exit Code Is Data Too

The following is the **complete `fluo-blog/tools/inspect-report.mjs` file**. It runs the inspection-only module, then reads the resulting artifact through Studio's public consumer API. The `.mjs` file itself has no decorators. The target `.ts` file is loaded through the CLI's explicit TypeScript loader boundary.

```js
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInspectCommand } from '@fluojs/cli';
import { applyFilters, parseStudioPayload, renderMermaid } from '@fluojs/studio/contracts';

const artifactPath = 'artifacts/inspect-probe-report.json';
const exitCode = await runInspectCommand([
  './src/diagnostics/inspect-app.ts',
  '--export',
  'InspectAppModule',
  '--report',
  '--output',
  artifactPath,
], {
  cwd: process.cwd(),
  ci: true,
  interactive: false,
});

if (exitCode !== 0) {
  process.exitCode = exitCode;
} else {
  const raw = await readFile(resolve(artifactPath), 'utf8');
  const { payload } = parseStudioPayload(raw);
  if (!payload.report) {
    throw new Error('Expected an inspect report artifact.');
  }
  const report = payload.report;
  const filtered = applyFilters(report.snapshot, {
    query: '',
    readinessStatuses: ['degraded', 'not-ready'],
    severities: ['warning', 'error'],
  });
  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    summary: report.summary,
    visibleComponentCount: filtered.components.length,
    visibleDiagnosticCount: filtered.diagnostics.length,
    routeCount: report.snapshot.routes?.length ?? 0,
    mermaid: renderMermaid(filtered),
  }, null, 2));
}
```

Run it with `node tools/inspect-report.mjs` from the project root. The branch that reads the file only on success is essential. The inspect implementation writes the artifact and then closes the application in `finally`. A shutdown hook failure can make the command fail even when the file already exists. That file can still serve as data from bootstrap time, but it must not be treated as proof that the entire inspection lifecycle succeeded.

The report's `summary` has seven fields: component count, diagnostic count, error count, warning count, health status, readiness status, and total timing. The consumer parser also checks that the summary agrees with the snapshot and timing. This is why you should not simply `JSON.parse` the report and assert an arbitrary type to obtain the numbers displayed on screen. Treating an incorrectly assembled report as valid can make warnings appear to have vanished.

Output post-filter counts under separate names. `applyFilters` selects which components and diagnostics are displayed without modifying the original. Hiding a warning component with a filter does not change the original aggregate readiness to `ready`. Replacing the original report's `snapshot` with a filtered snapshot and exporting it with the existing summary can fail consistency validation. Keep display data separate from the original evidence.

`--json` and `--format json` select the same output mode. `--timing` adds timing alongside the snapshot, and `--report` creates a summary envelope suitable for support requests. `--mermaid` requires the Studio renderer. JSON inspection alone is no reason to add a Studio runtime module to the application. In automation, a missing required optional package should cause failure with installation guidance; do not expect the tool to quietly run a package manager and change the environment.

## How the Questions Change in the Real Product

Once you understand the inspection-only experiment, you can change the command target to `./src/app.ts`. If that assembly initializes a database and job consumers, however, inspect can encounter those boundaries too. If you need a diagnostic configuration without external connections, the application must provide it through explicit module assembly. Do not assume inspect has an arbitrary `--no-side-effects` option.

The product has one DB registration: `BlogDatabaseModule` in the existing `src/database/blog-database.module.ts`. Preserve its async global registration, which injects `AppSettings`, rather than adding a different DB wrapper alongside it for diagnostics. The fixture above is a separate graph with no DB provider at all, so it does not conflict with that contract. Even when inspecting the real product, do not call `PaymentLedger.prepare/record` to create a charge merely to check state. Inspection and transaction execution are different tasks.

```bash
pnpm exec fluo inspect ./src/app.ts --json --output artifacts/product-snapshot.json
pnpm exec fluo inspect ./src/app.ts --report --output artifacts/product-report.json
```

In the product snapshot's `routes`, check which controller and handler `/orders/:id` maps to. A descriptor's `params` are parameter **names**, such as `id`, not order numbers. The `kind` may be `http` for ordinary HTTP or `react-page` for a React page, and the contract also preserves arbitrary string kinds. This list is a projection obtained from the authoritative dispatcher, but the projection itself does not perform route matching or conflict detection again.

When controllers or handlers share names, do not connect nodes using display labels alone. A normalized route's `graphNodeId` is the explicit key linking it to a live graph node. Consumers that reimplement the tool's internal node ID string rules can select the wrong service when those rules change or names collide. Leave defaults for fields omitted from older artifacts to the Studio parser as well.

A static report alone cannot support the claim that "this customer's request called the order service." The existence of a static route is different from the success of a particular HTTP request. Whether the order is `paid`, whether the customer is authorized to view it, and whether the response is 403 or 200 must be verified at the request layer. Use the same account and JWT subject values carried forward from Volume 1; do not bypass authentication or create a new customer ID for diagnostics.

## Connecting to a Live Application

In a Node development environment, use `pnpm exec fluo dev --studio`. The CLI starts a local sidecar and prints a URL containing a token. It passes explicit Studio configuration to the child process before the app imports the runtime. The runtime source does not read environment variables directly and independently decide to enable observation. This early injection boundary prevents combining it with an arbitrary native watcher.

Live Studio requires Fluo's own Node restart runner. Its contract rejects combinations with `--raw-watch`, `--runner native`, or `FLUO_DEV_RUNNER=native`. Do not describe Bun, Deno, and Workers as already having the same live bridge. Their alternative is a static/report artifact produced under a supported configuration. This is another reason the book fixes its execution baseline at Node24.

Reproduce the behavior based on state rather than guessed delays. Open the token URL and, after the connection state becomes `connected`, request `/orders/order-42` using the existing test account. Find the request's method/path and request ID, then correlate them with the route, handler, and status code. If a code edit triggers a restart, distinguish `restarting` from the new run's snapshot. Do not read the old request list as requests handled by the new process.

A `depends_on` line in the diagram represents a DI dependency, not a function call trace. Recent request flow likewise provides correlation between a request and its route/handler. How many times `OrdersService` called the inventory store, or which internal SQL line consumed time, lies beyond this MVP; it does not provide a full method call trace. Those questions require separate service instrumentation or database evidence.

Understand the local boundary precisely as well. The sidecar binds to `127.0.0.1`, ingestion and browser state/SSE APIs require a token, and CORS is disabled by default. Sensitive fields such as request bodies and headers are rejected by live event validation. This does not automatically make URLs and error messages free of all secrets. The product must keep credentials out of query strings and error messages. Do not recast this tool as a public production operations dashboard.

## A Contract Experiment That Deliberately Supplies Bad Data

Checking only that a diagram renders misses the purpose of consumer validation. The following is the **complete `fluo-blog/tools/check-report.mjs` file**. It reads the artifact created earlier and checks the mechanical properties the public parser and filters must preserve. It does not modify the original file or make external deliveries when run.

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyFilters, parseStudioPayload, renderMermaid } from '@fluojs/studio/contracts';

const raw = await readFile('artifacts/inspect-probe-report.json', 'utf8');
const { payload } = parseStudioPayload(raw);
assert.ok(payload.report);
const report = payload.report;
const before = JSON.stringify(report.snapshot);
const filtered = applyFilters(report.snapshot, {
  query: 'missing-component',
  readinessStatuses: [],
  severities: [],
});
assert.equal(JSON.stringify(report.snapshot), before);
assert.equal(
  renderMermaid(filtered),
  renderMermaid(JSON.parse(JSON.stringify(filtered))),
);

const inconsistent = JSON.parse(raw);
inconsistent.summary.componentCount += 1;
assert.throws(() => parseStudioPayload(JSON.stringify(inconsistent)));

const invalidPhase = JSON.parse(raw);
invalidPhase.timing.phases.push({ name: 'read_orders', durationMs: 1 });
assert.throws(() => parseStudioPayload(JSON.stringify(invalidPhase)));
console.log('REPORT_CONTRACT_OK');
```

The expected outcomes are successful parsing of the valid report, preservation of the original after filtering, identical Mermaid after a serialization round trip, and rejection of both mutated inputs. Although `read_orders` may sound reasonable, it is not a public bootstrap timing phase. The allowed names are `bootstrap_module`, `register_runtime_tokens`, `resolve_lifecycle_instances`, `run_bootstrap_lifecycle`, and `create_dispatcher`. Quietly mixing application work durations into framework timing fields changes the meaning of the data.

The CLI should also reject specifying the input module's own path as `--output`. The source contains protection for both a direct reference to the same file and a symlink pointing to that file. Do not broaden this into a claim of a general filesystem transaction that prevents every possible file alias or race with external changes. The important operational habit is to separate source files from the artifacts directory and record the inspection exit code too.

Startup failure, shutdown failure, an invalid summary, and a stale snapshot are different events. Distinguishing their evidence lets you move to the right layer when investigating an order incident rather than suspecting the extension package first. The next chapter applies the same principle to timing numbers. A statement that enabling a cache made something faster must explain what was measured and what was excluded.

## Source References and Verification Scope

- [CLI README](../../packages/cli/README.md), [public inspect entry point](../../packages/cli/src/public-inspect.ts), [inspection implementation](../../packages/cli/src/commands/inspect.ts): loader, adapterless bootstrap, output, close, and exit codes.
- [Output path protection](../../packages/cli/src/commands/output-path-safety.ts), [CLI tests](../../packages/cli/src/cli.test.ts): inspection arguments and artifact boundaries.
- [Studio README](../../packages/studio/README.md), [public exports](../../packages/studio/src/index.ts), [consumer contract](../../packages/studio/src/contracts.ts): static versus live data, parsing, normalization, filtering, and rendering.
- [Studio contract tests](../../packages/studio/src/contracts.test.ts), [live contract tests](../../packages/studio/src/live-contracts.test.ts): report consistency and event validation.
- [CLI sidecar shutdown tests](../../packages/cli/src/studio/sidecar-shutdown.test.ts): local ingestion and shutdown boundaries.

This chapter provides execution experiments checked against the current public APIs and source. It does not claim that the new inspection fixture, viewer, or live session was actually run and passed here. In particular, no inspection connected to real order data or external infrastructure was performed.
