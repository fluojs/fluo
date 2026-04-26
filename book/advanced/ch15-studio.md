<!-- packages: @fluojs/studio, @fluojs/runtime, @fluojs/cli -->
<!-- project-state: FluoBlog v0 -->

# Chapter 15. Studio: Visual Diagnostics and Observability

This chapter covers the Studio ecosystem, which turns runtime-produced Module Graph snapshots, diagnostics, timing data, and inspect reports into artifacts that people can read. Chapter 14 used contract verification to confirm runtime consistency. This chapter moves to the tools that export, store, view, and interpret that internal state.

## Learning Objectives

- Understand the role `@fluojs/studio` plays in architecture diagnostics and observability.
- Generate runtime snapshots, reports, Mermaid diagrams, and timing payloads through `fluo inspect`.
- Distinguish raw JSON output, `--report` artifacts, `--output` files, and `--timing` diagnostics.
- Learn what the `PlatformShellSnapshot` and `PlatformDiagnosticIssue` contracts contain at a learning level.
- See how Studio consumes inspect artifacts, validates them, filters them, and renders graphs.
- Summarize how to build architecture guards with Studio-owned Mermaid rendering and programmatic artifact consumption.

## Prerequisites

- Completion of Chapter 14.
- A basic understanding of the fluo module system and dependency injection resolution flow.
- Experience using the fluo CLI, including `fluo inspect`.
- Basic familiarity with JSON, Mermaid, and browser-based visualization tools.

## 15.1 Beyond the Terminal: Why Studio?

As an application grows, its dependency graph becomes too complex to keep in your head. Circular dependencies, scope mismatches, provider resolution failures, and slow bootstrap phases become harder to trace with terminal logs alone. In a microservice architecture, this complexity multiplies across many independent services, and each service has its own internal Module Graph.

`@fluojs/studio` is fluo's diagnostic layer for managing that complexity. It receives inspect artifacts as files, validates their structure, and turns them into views that teams can review together. In other words, it exposes the DI container's "black box" as a structure you can inspect instead of guessing about it.

Studio focuses on static and bootstrap-time architecture. It helps you ask "why did this fail to start?" before you ask "why is this request slow?" Because inspect data comes from an inspection-safe bootstrap, teams can review graph shape, readiness, diagnostics, and timing before the application starts serving traffic.

## 15.2 The Studio Ecosystem

As defined in `packages/studio/README.md`, the inspection and Studio flow is made of three main layers.

1. **Snapshot producer**: The fluo Runtime and platform shell compile the Module Graph and produce `PlatformShellSnapshot` data during inspection-safe bootstrap.
2. **CLI exporter/delegator**: The `fluo inspect` command serializes runtime-produced data as JSON, wraps it as a report when requested, writes it to artifact paths through `--output`, and delegates Mermaid rendering to Studio when `--mermaid` is requested.
3. **Studio contract and viewer**: The `@fluojs/studio` root export, `@fluojs/studio/contracts` subpath, and `@fluojs/studio/viewer` entrypoint own snapshot parsing, filtering, graph rendering, and browser viewing.

This split matters. Runtime produces truth. The CLI chooses an artifact shape. Studio owns the viewer and Mermaid rendering semantics. The CLI does not duplicate graph rendering logic, and Studio does not need to bootstrap the application itself.

## 15.3 Generating Inspect Artifacts with `fluo inspect`

The main way to interact with Studio is to generate an inspect artifact from your root module.

```bash
fluo inspect ./src/app.module.ts --json > artifacts/inspect-snapshot.json
```

With no explicit output mode, `fluo inspect` defaults to JSON snapshot output. The runtime resolves providers and builds the platform shell through an inspection-safe application context, then the CLI writes the snapshot to stdout. The inspected application is bootstrapped for inspection and then closed. It does not start a server listener.

For CI and support workflows, prefer an explicit artifact path instead of shell redirection.

```bash
fluo inspect ./src/app.module.ts --json --output artifacts/inspect-snapshot.json
```

`--output <path>` writes the selected payload to a file and creates parent directories when needed. This is useful for CI systems that upload `artifacts/` after a failed bootstrap check. It does not make the application writable, and it does not change module graph state beyond the normal bootstrap and close cycle.

Use `--timing` when you need bootstrap timing alongside the snapshot.

```bash
fluo inspect ./src/app.module.ts --json --timing --output artifacts/inspect-with-timing.json
```

Use `--report` when you want a single CI-friendly support artifact with a summary, the full snapshot, diagnostics, and timing.

```bash
fluo inspect ./src/app.module.ts --report --output artifacts/inspect-report.json
```

Use `--mermaid` when you need a text diagram for documentation or review.

```bash
fluo inspect ./src/app.module.ts --mermaid --output artifacts/module-graph.mmd
```

Mermaid rendering is delegated to `@fluojs/studio` through the `renderMermaid(snapshot)` contract. Install Studio in the project that runs the command when you need this output.

```bash
pnpm add -D @fluojs/studio
```

In non-interactive runs, a missing Studio dependency fails fast with install guidance. Interactive runs may ask for confirmation, but `fluo inspect` does not silently install packages.

## 15.4 Understanding the Snapshot and Report Shapes

The data exported by the CLI follows contracts produced by `@fluojs/runtime` and consumed by Studio. This section explains the learning model. Reference-level field details belong in the contract docs and package README files.

### Raw JSON snapshot

Raw JSON is the smallest Studio input. It is produced by `--json` or by the default inspect mode.

```bash
fluo inspect ./src/app.module.ts --json --output artifacts/inspect-snapshot.json
```

The payload is a `PlatformShellSnapshot`. At a high level, it includes:

- `generatedAt`, the time the snapshot was produced.
- `readiness` and `health`, the platform-level status signals.
- `components`, the modules, controllers, providers, and related platform components in the resolved graph.
- `diagnostics`, the structured issues found while the platform shell was built or inspected.

Studio can load this file directly. It parses the JSON with `parseStudioPayload(rawJson)`, validates the version and schema expectations it supports, then exposes the snapshot to graph, diagnostics, and filtering views.

### Timing envelope

Timing data is opt-in because not every workflow needs bootstrap phase measurement.

```bash
fluo inspect ./src/app.module.ts --json --timing --output artifacts/inspect-with-timing.json
```

With `--json --timing`, the CLI writes an envelope with `snapshot` and `timing` keys. The `timing` value follows `BootstrapTimingDiagnostics`, including a `totalMs` value and a list of phases. Studio can use this data to explain where bootstrap time is spent, such as module graph construction, provider resolution, and lifecycle hooks.

Timing is especially useful when a change does not break startup but makes it noticeably slower. Keeping timing beside the snapshot lets reviewers connect graph shape to bootstrap cost.

### Report artifact

A report is the best artifact for CI triage and support handoff.

```bash
fluo inspect ./src/app.module.ts --report --output artifacts/inspect-report.json
```

The report wraps the runtime-produced snapshot with a stable summary and timing data. Its summary includes counts for components, diagnostics, errors, warnings, health, readiness, and total timing. That lets a CI job or reviewer answer basic questions without parsing the whole graph first.

A report does not replace the raw snapshot. It packages the snapshot with the extra context that support and automation usually need. Studio can still consume the snapshot part, while scripts can read the summary first to decide whether to fail a build or attach the artifact to a ticket.

## 15.5 Using the Studio Viewer

Studio Viewer is a standalone web application. You can run it locally inside the monorepo or use a packaged viewer entry when your install path provides one.

```bash
pnpm --dir packages/studio dev
```

Once the viewer opens, drag and drop an inspect artifact into the browser. A raw `--json` snapshot is the simplest input. A `--json --timing` envelope gives the viewer timing data as well. A `--report` artifact can be used by workflows that keep the report as the canonical CI file and pass its snapshot and timing data to Studio-aware tools.

Internally, Studio uses `parseStudioPayload(rawJson)` before rendering. This keeps the viewer from treating arbitrary JSON as a valid platform graph. After parsing, Studio can apply filters with `applyFilters(snapshot, filter)`, show diagnostics by severity, and render the graph through the same graph ownership model used by the CLI's Mermaid path.

### Key Features of the Viewer

- **Graph View**: Renders the application dependency graph so you can see modules, providers, and dependency edges at a glance.
- **Diagnostics Tab**: Lists `PlatformDiagnosticIssue` entries with severity, message, cause, fix hints, blockers, and docs links when present.
- **Timing View**: Uses `BootstrapTimingDiagnostics` to show total bootstrap time and phase-level cost when timing data is present.
- **Filtering**: Applies query, readiness, and severity filters without mutating the loaded snapshot.
- **Mermaid Export**: Produces text diagrams through Studio-owned `renderMermaid(snapshot)` logic, including internal dependency edges and external dependency nodes.

These features give teams a shared artifact review flow. The CLI exports the file, CI stores it, and Studio turns the same file into a graph, issue list, and timing explanation.

### Visualizing Scopes and Lifecycles

One important role of Studio is making scope and lifecycle problems visible. In complex applications, it is easy to inject a request-scoped provider into a singleton path by mistake, or to introduce a provider that slows startup without making the dependency chain obvious.

The snapshot gives Studio the resolved component graph and diagnostics. Timing data gives it bootstrap phase cost. Together, those artifacts let the viewer explain both structure and startup behavior. A graph can show which component depends on a slow provider, while the timing view can show whether the delay happened during graph construction, instance resolution, or lifecycle hooks.

## 15.6 Scenario: Diagnosing a Provider Deadlock

Assume an application hangs or fails during startup. Instead of relying only on logs, generate a report artifact.

```bash
fluo inspect ./src/app.module.ts --report --output artifacts/deadlock-report.json
```

Then follow the artifact trail.

1. **Check the summary**: Read `summary.errorCount`, `summary.warningCount`, `summary.readinessStatus`, and `summary.timingTotalMs` to understand the failure shape.
2. **Open the snapshot in Studio**: Use the viewer to inspect the graph and diagnostics. The Diagnostics tab shows structured issues, including `dependsOn`, `cause`, and `fixHint` when available.
3. **Render a diagram if needed**: Use `fluo inspect --mermaid --output artifacts/deadlock-graph.mmd` when an architecture review needs a text diagram in a PR or decision record.
4. **Keep the artifact**: Attach the report to CI logs or a support ticket so another developer can reproduce the same inspection view.

This workflow is more repeatable than copying terminal output into chat. The report keeps summary, snapshot, diagnostics, and timing together. Studio then turns those facts into a graph and issue list that reviewers can inspect without bootstrapping the app themselves.

## 15.7 Consuming Inspect Artifacts Programmatically

If you are building custom CI/CD tooling, you can use `@fluojs/studio` helpers such as `parseStudioPayload`, `applyFilters`, and `renderMermaid` to parse and validate inspect artifacts programmatically.

```typescript
import { applyFilters, parseStudioPayload, renderMermaid } from '@fluojs/studio';
import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync('artifacts/inspect-with-timing.json', 'utf8');
const { payload } = parseStudioPayload(raw);

if (payload.snapshot) {
  const errors = applyFilters(payload.snapshot, {
    query: '',
    readinessStatuses: [],
    severities: ['error'],
  });

  if (errors.diagnostics.length > 0) {
    writeFileSync('artifacts/module-graph.mmd', renderMermaid(payload.snapshot));
    throw new Error('Inspect diagnostics include errors. See artifacts/module-graph.mmd.');
  }
}
```

This pattern keeps architecture checks close to the same artifacts humans inspect. A CI job can fail on severe diagnostics, upload the report JSON, and attach a Mermaid graph to a review comment. The important boundary stays clear: runtime produces the snapshot, CLI exports the artifact, and Studio parses, filters, and renders it.

## 15.8 Mermaid Export for Documentation

Studio owns the snapshot-to-Mermaid contract through `renderMermaid(snapshot)`. The CLI delegates `fluo inspect --mermaid` to that helper when Studio is resolvable from the project running the command.

```bash
fluo inspect ./src/app.module.ts --mermaid --output docs/generated/module-graph.mmd
```

Mermaid output is useful for architecture decision records, README diagrams, and review threads. Because it is text, normal version control can show graph changes over time. That reduces drift between architecture diagrams and the actual Module Graph.

Mermaid is not the same artifact as a raw snapshot or report. It is a rendered view of the graph. Keep raw JSON or report artifacts when you need diagnostics, readiness, health, timing, or machine-readable details. Keep Mermaid when you need a diagram that readers can scan quickly.

### Studio as an Architecture Guard

Studio artifacts can become architecture guards inside CI/CD pipelines. A guard can run `fluo inspect --report --output artifacts/inspect-report.json`, parse the report, and fail when diagnostics include errors. Another guard can call `renderMermaid(snapshot)` and publish a diagram whenever the graph changes.

This approach catches architecture regressions before they reach production. It also gives reviewers the same evidence every time: the report for machine-readable facts, the Studio viewer for exploration, and Mermaid for discussion.

### Future Directions: Live Studio

The current Studio workflow is file-first. That is intentional. Files are easy to store in CI, attach to support tickets, and compare in reviews. The same contracts could later support live or streaming diagnostics, but this chapter treats artifacts as the stable learning path.

A future live workflow would not remove the need for inspect artifacts. Teams still need reproducible evidence for CI, support, and governance. File-first reports give that evidence today.

## 15.9 Why Heading Parity Matters

The fluo book keeps English and Korean chapter pairs aligned by heading structure. This is not just a formatting concern. It gives maintainers a stable baseline for checking that translated technical sections were not lost during editing.

Chapter 15 is especially sensitive because Studio diagnostics and inspect artifacts often point readers back to documentation. When the English and Korean files keep the same heading levels and section order, links, reviews, and future sync checks stay easier to reason about.

When you update this chapter, update both language files together. If you add a section about a new artifact or viewer behavior in one file, add the matching section in the other file during the same change.

## Summary

Studio transforms runtime inspection data into a shared diagnostic workflow. `fluo inspect` produces raw JSON snapshots, timing envelopes, CI-friendly reports, and Studio-rendered Mermaid diagrams. `--output` turns those payloads into stable artifacts that CI and support workflows can keep.

The boundary is clear. Runtime produces platform truth, the CLI exports or delegates it, and Studio consumes, filters, views, and renders it. That makes Studio useful for local debugging, architecture reviews, CI gates, and support handoffs without changing application behavior.

When a complex configuration problem appears, keep a Studio-first workflow: generate an inspect artifact, keep the report when you need a handoff, open the snapshot in Studio when you need to explore, and use Mermaid when you need a reviewable diagram.
