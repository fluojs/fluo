<!-- packages: @fluojs/studio, @fluojs/runtime, @fluojs/cli -->
<!-- project-state: FluoBlog v0 -->

# Chapter 15. Studio: Visual Diagnostics and Observability

This chapter covers the Studio ecosystem, which turns runtime-produced Module Graph snapshots and diagnostic information into a visual form that people can read. Chapter 14 used contract verification to confirm Runtime consistency. This chapter moves to the tools that export, observe, and interpret that internal state.

## Learning Objectives
- Understand the role `@fluojs/studio` plays in architecture diagnostics and observability.
- Generate runtime snapshots through `fluo inspect` and learn the CLI export/delegation flow.
- Learn what the `PlatformShellSnapshot` and `PlatformDiagnosticIssue` contracts contain.
- See how to read graphs, diagnostics, and timing information in the Studio Viewer.
- Analyze an approach for tracking circular dependencies or initialization bottlenecks through snapshots.
- Summarize how to build architecture guards with Studio-owned Mermaid rendering and programmatic snapshot consumption.

## Prerequisites
- Completion of Chapter 14.
- A basic understanding of the fluo module system and Dependency Injection resolution flow.
- Experience using the fluo CLI, including `fluo inspect`.
- Basic familiarity with reading and handling JSON data and web-based visualization tools.

## 15.1 Beyond the Terminal: Why Studio?

As an application grows, its dependency graph becomes too complex to keep in your head. Circular dependencies, Scope mismatches, and Provider resolution failures become harder to trace with terminal logs alone. In a microservice architecture, this complexity multiplies across dozens of independent services, and each service has its own internal Module Graph.

**@fluojs/studio** is fluo's diagnostic layer for managing that complexity. It receives the application's internal state as a file-first snapshot and turns it into a platform map that people can review. In other words, it exposes the DI container's "black box" as a structure you can inspect instead of guessing about it. This transparency is not only for debugging. It lets teams look at the same Module Graph and the same diagnostic output, then keep a shared model of the system architecture.

Unlike heavy APM (Application Performance Monitoring) tools, Studio focuses on **static and bootstrap-time architecture**. It helps you ask "why did this fail to start?" before "why is this slow right now?" Because it analyzes the application before the first request is handled, it can catch structural issues during the pre-flight check stage that runtime monitoring tools often miss. This shift-left approach to diagnostics is a practical foundation for protecting availability in cloud environments.

## 15.2 The Studio Ecosystem

As defined in `packages/studio/README.md`, the inspection and Studio flow is made of three main layers.

1. **Snapshot producer**: The fluo Runtime and platform shell, which compile the Module Graph and produce `PlatformShellSnapshot` data during inspection-safe bootstrap.
2. **CLI exporter/delegator**: The `fluo inspect` command in `@fluojs/cli`, which serializes runtime-produced snapshots as JSON and delegates Mermaid rendering to Studio when `--mermaid` is requested.
3. **Studio contract and viewer**: The `@fluojs/studio` root export, `@fluojs/studio/contracts` subpath, and `@fluojs/studio/viewer` entrypoint, which own snapshot parsing, filtering, graph rendering, and browser viewing.

## 15.3 Generating Snapshots with `fluo inspect`

The main way to interact with Studio is to generate an application snapshot.

```bash
fluo inspect ./src/app.module.ts --json > platform-state.json
```

This command asks the fluo Runtime for an inspection-safe platform snapshot, then the CLI writes that snapshot to JSON. In this mode, the runtime resolves Providers and builds the graph, but it does not start the actual server listener. The resulting JSON contains the following information.
- Every registered component, including modules, controllers, and Providers
- Full dependency mapping
- Health and Readiness status
- Detailed step-by-step Bootstrap timing

Snapshot generation is non-destructive. Unless you specify otherwise through `bootstrapOptions`, it traverses the module tree without running business logic or connecting to external databases. That makes it safe to run `fluo inspect` in CI/CD to verify architecture integrity before deployment. The command also provides a summary that surfaces the main problems directly in the terminal, so it fits both automated scripts and manual debugging sessions.

## 15.4 Understanding the Snapshot Contract

The data exported by the CLI follows the `PlatformShellSnapshot` contract produced by `@fluojs/runtime` and consumed by `packages/studio/src/contracts.ts`. This contract makes sure every producer, including runtime inspection, custom scripts, and external tools, creates data the viewer can interpret reliably.

### PlatformShellSnapshot Structure

```typescript
export interface PlatformShellSnapshot {
  generatedAt: string;
  readiness: { status: 'ready' | 'not-ready' | 'degraded'; critical: boolean };
  health: { status: 'healthy' | 'unhealthy' | 'degraded' };
  components: PlatformComponent[];
  diagnostics: PlatformDiagnosticIssue[];
}
```

This strict interface allows the Studio ecosystem to accept third-party producers. For example, a custom test harness can export a `PlatformShellSnapshot` to visualize the state of a test environment, and a separate monitoring agent can create periodic snapshots to track changes in application architecture. The standards-first approach keeps Studio's visualization and rendering tools decoupled from the underlying data source, and it keeps producers, CLI export, and viewers loosely coupled.

### PlatformDiagnosticIssue: The Heart of Troubleshooting

Each diagnostic issue provides actionable metadata needed to fix a configuration error. The `fixHint` and `docsUrl` fields are especially important clues in a guided troubleshooting flow.

```typescript
export interface PlatformDiagnosticIssue {
  code: string;           // Example: "FL0042"
  severity: 'error' | 'warning' | 'info';
  componentId: string;    // Failed component
  message: string;        // Human-readable description
  cause?: string;         // Root cause analysis
  fixHint?: string;       // Explicit suggestion: "Add @Inject(TOKEN) to X"
  dependsOn?: string[];   // Blockers preventing resolution
  docsUrl?: string;       // Link to the detailed guide
}
```

Diagnostics are not simple error strings. They are structured data that automated recovery workflows can read. For example, a CI bot can parse `PlatformDiagnosticIssue` to suggest code changes or block a PR that introduces a circular dependency. The `code` field is a unique identifier that maps to a specific section of the fluo documentation. That connection keeps errors, fix hints, and docs moving from the same baseline.

## 15.5 Using the Studio Viewer

Studio Viewer is a standalone web application. You can run it locally inside the monorepo or use a published version.

```bash
pnpm --dir packages/studio dev
```

Once the viewer opens, drag and drop the `platform-state.json` file into the browser. Internally, the `parseStudioPayload` helper immediately validates the file against version and schema rules before rendering.

Studio is designed as an independent web application so it stays lightweight and lets you explore application architecture with low overhead. Built on React and Vite, it responds quickly to snapshot loading and filtering. Instead of reading terminal logs alone, it gives you a dedicated environment for reviewing the Module Graph and diagnostics on the same screen.

The viewer also includes a "Snapshot Manager" for organizing and searching multiple snapshots. It is useful when you need to track how application architecture changes over time. You can tag each snapshot with metadata such as commit hash, environment (dev, staging, prod), and author, leaving a history of platform structure changes. This context matters for root cause analysis and for checking the consistency of architecture decisions.

### Key Features of the Viewer

- **Graph View**: Renders the application as a Mermaid-based dependency diagram. You can see at a glance which service depends on which repository. Nodes are color-coded to distinguish different module types, such as Core, Platform, and Application.
- **Diagnostics Tab**: Lists every `PlatformDiagnosticIssue` entry. You can group by severity and filter by component, which makes it easier to trace the cause of a specific failure.
- **Timing Tab**: Visualizes the Bootstrap sequence and shows how many milliseconds each phase took, such as Module Graph construction, instance resolution, and lifecycle hooks. This tab helps identify the "long poles" during application startup.
- **The Timeline View**: Shows a hierarchical representation of the Bootstrap process, letting you see which modules initialized in parallel and which initialized sequentially.
- **The Dependency Trace**: Lets you click any node to trace the full dependency path and highlight potential failure points or unnecessary complexity.
- **Provider Details**: Shows metadata for the selected Provider, including injection Token, implementation type (class, factory, or value), and resolved dependencies.
- **Module Breakdown**: A tab that shows each module's exports and imports, helping you confirm whether the encapsulation strategy is being preserved.

The viewer uses the `applyFilters` logic from `@fluojs/studio` to provide real-time search across the full platform state. When you type a keyword into the search bar, it filters components and diagnostic issues at the same time and immediately highlights matches in both the graph nodes and the issue list. This feedback loop is especially useful when exploring large monorepos with hundreds of modules or more.

When you select a module or component, you can focus on a specific subgraph. Studio dims unrelated nodes and highlights the selected item's direct dependencies and dependents. This "focus mode" matters when checking the blast radius of changes to a core utility or shared repository. Interactive filtering also supports complex queries such as "show every request-scoped Provider that depends on a singleton database connection." That helps you find potential Scope mismatches before they appear as runtime errors. You can also export the "focus mode" result as a standalone diagram for an architecture decision record (ADR) or peer review.

The graph also supports color coding by readiness status. `degraded` nodes are shown in orange, and `not-ready` nodes are shown in red. Operators can narrow down the root cause of a cluster-wide failure without first scanning tens of thousands of log lines. The Graph View rendering engine is optimized to handle thousands of nodes with canvas-based virtualization, and it is designed to respond to zoom and pan gestures even in complex enterprise graphs. This performance comes from separating the layout calculation, which runs once when the snapshot loads, from the interactive rendering loop.

The viewer's "Snapshot History" feature lets you load multiple snapshots and compare them side by side. It is useful when tracking how a dependency graph grows over time or when checking whether a refactor actually simplified application structure. The comparison engine highlights added, removed, and modified dependencies to show the delta of an architecture change. Each comparison also includes summaries of Bootstrap timing and status changes, so you can review structure changes together with performance and reliability changes.

### Visualizing Scopes and Lifecycles

One important role of Studio is visualizing Provider Scope. In complex applications, it is easy to inject a Request-scoped Provider into a Singleton-scoped Provider by mistake, creating runtime errors or memory leaks.

Studio clearly marks these Scope mismatches in the component detail view. When you select a component, you can see the resolved Scope and potential violations in the dependency chain. The visualization engine highlights inheritance and injection paths to show where a Scope boundary has been crossed. This feature works from `PlatformComponent.details` metadata, which contains the raw Scope Tokens resolved by the DI container.

The viewer also provides a "Lifecycle Trace" for each component, showing when it was instantiated and when hooks such as `onModuleInit` and `onApplicationBootstrap` ran. This is useful when debugging initialization order problems that are hard to see from code alone. Clicking a graph node lets you drill down into telemetry data and inspect precise timestamps for each lifecycle phase in the fluo Runtime environment.

Telemetry data is collected through the `BootstrapTimingDiagnostics` interface. When fluo Runtime starts, it records the start and end time of every lifecycle hook. Studio's Timing Tab parses those intervals and shows them as a flame chart or a sequential list. This trace is not a static record. It is the actual execution path taken by the framework's internal dispatcher. By analyzing it, you can find the Provider causing a "deadlock" or slow startup even when it sits deep in the dependency graph.

```typescript
// packages/studio/src/contracts.ts (contract reference)
export interface BootstrapTimingDiagnostics {
  version: 1;
  totalMs: number;
  phases: {
    name: string;
    durationMs: number;
    details?: string;
  }[];
}
```

This data lets you identify the exact Provider delaying the Bootstrap process. If module initialization takes 500 ms, Studio can help you see whether it is waiting for a database connection or running an expensive calculation. In advanced scenarios, you can compare two snapshots to show how a configuration change affected total Bootstrap performance, producing the "telemetry diff" needed for performance regression testing.

Beyond timing, Studio can visualize the memory footprint of multiple modules during the Bootstrap phase. When integrated with the Runtime's internal profiling hooks, the Timing Tab can show heap allocation for each component and identify modules that use excessive resources during startup. This is especially meaningful in edge runtimes, where resources are limited and efficient initialization is important for reducing cold start latency. Memory visualization also includes a "Heuristic Impact Score" that suggests possible optimizations for high-memory modules.

You can also use the Timing Tab to identify "Initialization Hotspots." These are Providers that take a long time to initialize but do not necessarily depend on many components. Such Providers are often good optimization candidates because they can be refactored into independent units of work. Studio presents these hotspots as a "ranked list" ordered by contribution to total Bootstrap time.

## 15.6 Scenario: Diagnosing a Provider Deadlock

Assume an application hangs during startup. When you inspect its snapshot in Studio, you may find a "Circular Dependency" error in the Diagnostics Tab.

1. **Identify**: Studio marks the problematic component in red by using the `not-ready` state mapped through CSS `classDef`.
2. **Analyze**: The `dependsOn` field shows the cycle: `ServiceA -> ServiceB -> ServiceA`.
3. **Fix**: The `fixHint` may suggest using `forwardRef()` or refactoring common logic into a third service.

Deadlock scenarios often happen when domain modules are coupled too tightly. Studio visualizes cross-module dependencies and reveals multi-layer circular paths that may not be obvious from source code alone. By analyzing the full cycle path, you can find structural fixes such as introducing event-driven communication patterns or moving shared state into a dedicated Provider. This proactive analysis reduces common runtime failures and helps keep the platform stable as system complexity grows. It also prompts teams to revisit domain boundaries and design a more modular, loosely coupled structure.

## 15.7 Programmatic Consumption of Snapshots

If you are building custom CI/CD tooling, you can use `@fluojs/studio` libraries such as `parseStudioPayload` and `applyFilters` to parse and validate snapshots programmatically. This lets you place architecture checks directly into the development workflow.

```typescript
// packages/studio/src/contracts.test.ts (logic flow reference)
import { parseStudioPayload, applyFilters } from '@fluojs/studio';
import { readFileSync } from 'node:fs';

const raw = readFileSync('platform-state.json', 'utf8');
const { payload } = parseStudioPayload(raw);

if (payload.snapshot) {
  const errors = applyFilters(payload.snapshot, {
    query: '',
    readinessStatuses: [],
    severities: ['error']
  });
  
  if (errors.diagnostics.length > 0) {
    console.error('The platform has critical problems!');
  }
}
```

This programmatic approach becomes the foundation for "Architecture as Code" in the fluo ecosystem. You can define custom rules such as "no controller may depend directly on a repository" and enforce them by running a simple script against the generated snapshot. Because it uses the fully resolved Module Graph and each component's Runtime context, it sees more than traditional linting. It can catch complex architecture issues that static analysis tools cannot see.

Programmatic APIs also let you create custom reports and visualizations based on application architecture. You can build dashboards that track the system's "Module Depth" or tools that automatically generate dependency documentation for a team. `@fluojs/studio` lets you read architecture data and handle it in actionable forms, so internal tooling and external integrations can work from the same snapshot contract.

## 15.8 Mermaid Export for Documentation

Studio owns the snapshot-to-Mermaid contract through the `renderMermaid(snapshot)` helper. The CLI can delegate `fluo inspect --mermaid` to that helper, and automation can call it directly from `@fluojs/studio` or `@fluojs/studio/contracts`. You can keep current architecture documentation in `README.md` or Notion pages without drawing diagrams by hand. Mermaid's text-based format lets standard version control tools track architecture changes and leaves a clear history of how the system structure has evolved.

The export tool performs escaping and node hashing so it can generate valid Mermaid syntax even when component IDs contain special characters. This automation reduces drift between architecture diagrams and the actual implementation, creating a flow close to "Documentation as Code." If you integrate Mermaid export into the build process, documentation can also update automatically whenever a new version of the platform is released. That reduces manual work for maintainers and lets teams discuss the latest architecture map.

The `renderMermaid` helper supports multiple configuration options so you can adjust the layout and appearance of the generated diagram. You can show only specific module groups, highlight specific component types, or apply custom styles to nodes. This flexibility makes Mermaid export useful for both high-level overviews and detailed technical diagrams. By treating architecture documentation as a first-class part of the development workflow, `@fluojs/studio` helps platform operations become more transparent and sustainable.

### Studio as an Architecture Guard

Studio snapshots can go beyond interactive tooling and become Architecture Guards inside CI/CD pipelines. By analyzing `PlatformShellSnapshot` programmatically, you can enforce rules that are hard to check with a Linter alone. This catches architecture regressions before they reach production. These guards act as automated quality gates and confirm that changes follow the team's architecture standards.

For example, you can write a script that fails the build when a service in the `billing` module depends on a repository from the `inventory` module, preserving strict domain isolation. A "Policy as Code" approach using fluo's transparent metadata gives large TypeScript projects practical governance. The same guard can monitor a module's "coupling coefficient" and alert the team when a module starts becoming too entangled with the rest of the system. Data-driven architecture reviews help decide when to refactor or split modules, keeping the codebase small and maintainable as the platform grows.

Architecture Guards also provide a way to enforce "standards compliance" across different teams and projects. By sharing a common set of diagnostic rules, every Fluo application in an organization can follow the same baseline. This consistency reduces friction when moving between projects and improves quality and reliability across the platform ecosystem. In the long term, these automated checks become a cultural mechanism that places architecture rigor directly into the engineering process.

### Future Directions: Live Studio

The current version of Studio uses a file-first approach based on snapshots. The underlying contracts, however, are designed to allow live updates. Future fluo Runtime versions may expose a diagnostic socket so Studio can connect to a running process.

If this approach lands, it could enable real-time visualization of request flows, dynamic Provider replacement for debugging, and configuration change feedback without a full restart. `PlatformReadinessStatus` would move from a static record to a live heartbeat, providing immediate visibility into distributed system state. The project is also exploring the possibility of using live snapshots to make dynamic scaling decisions and let the platform adjust resource allocation based on observed load and individual module state. This real-time interaction would expand Studio from a diagnostic tool into a central hub for platform management and observability, narrowing the gap between development and operations.

The move toward "Live Studio" also opens new possibilities for collaborative debugging. When multiple developers connect to the same live diagnostic stream, they can share a common view of platform state while solving complex problems together. This shared context matters in distributed teams and complex monorepos where one person cannot easily hold the whole system in view. Turning diagnostics into an interactive shared review experience also shortens the feedback loop for Fluo developers. Studio's future is not limited to observing the platform. It points toward participating in platform evolution and management in real time.

Investing in the Studio ecosystem today prepares for a more interactive and responsive development experience later. As Studio evolves into the central hub for platform observability, the boundary between static analysis and runtime monitoring will become lower. This direction aligns with fluo's principle of providing practical tools for building and managing complex systems.

## 15.9 Why Line-by-Line Consistency Matters

The fluo project follows a strict policy that English and Korean documents must keep the same Heading structure. This is not just a formatting concern. It gives CI/CD pipelines a stable baseline for automated diffs that verify technical sections were not lost during translation.

Every heading in this file exactly matches the sections in the English version. This consistency also matters for Studio diagnostics. Studio issues often map to documentation URLs, so the framework needs a stable and synchronized Heading structure to provide accurate links for both English and Korean readers.

When looking up an error code or reading about a specific visualization feature, the information should appear in the same place across every language version of the book. This linguistic symmetry helps global contributors collaborate from the same technical foundation. It also simplifies multilingual search index maintenance, letting developers find the answers they need regardless of their preferred language. Maintaining strict alignment is also accessibility work because it helps developers from all backgrounds understand the TypeScript platform from the same baseline. This linguistic rigor matches fluo's technical philosophy as well. Every aspect should be explicit, standards-compliant, and platform-neutral.

## Summary

Studio transforms the DI container's "black box" into a transparent visual map. By using snapshots, diagnostics, and timing data, you can stop guessing why a dependency failed and directly inspect the exact blockers and suggested fixes.

Effective diagnostics also shorten the feedback loop for new developers. Before explaining every detail of the Module Graph, you can let them explore the system directly through the Studio Viewer. Mermaid export keeps documentation as a living part of the codebase and reduces architecture diagrams that drift away from the real implementation.

As the ecosystem matures, more tools will be built on these standard snapshots, improving observability for fluo applications across different environments and organization sizes. Building high-performance backends requires efficient code, but it also requires understanding how that code interacts. Studio provides the key link between source code and runtime behavior.

Standardizing the snapshot format lets many visualization tools coexist. One team may prefer Mermaid-based graphs, while another may build a 3D dependency explorer or a monitor that overlays live metrics on a static graph. Studio's goal is not only to show the current state, but also to help teams make better architecture decisions. Explicit dependency management, clear component boundaries, and observable lifecycles are marks of a well-designed fluo application. These principles matter more as applications grow, helping teams reduce technical debt while keeping a fast pace.

Visualizing a system is the first step in managing complexity. In microservice and complex monorepo environments, a clear and accurate dependency map is a major asset for engineering teams. Studio shows where the architecture starts to strain as the application expands to meet new requirements. Architecture matters as much as code, and Studio makes that importance reviewable.

In diagnostic workflows, it is useful to keep a "Studio-first" mindset. Whenever you hit a complex configuration problem, run `fluo inspect` and use visual data to narrow the problem scope. In the final part of this series, we will look at extending the fluo ecosystem itself by creating custom packages and contributing to the framework.
