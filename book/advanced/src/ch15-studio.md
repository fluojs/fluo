<!-- packages: @fluojs/studio, @fluojs/runtime, @fluojs/cli -->
<!-- project-state: FluoBlog v0 -->

# Chapter 15. Studio — 시각적 진단과 관찰성

## What You Will Learn in This Chapter
- The role of `@fluojs/studio` in the development lifecycle
- Generating and parsing platform snapshots with `fluo inspect`
- Understanding the `PlatformShellSnapshot` and `PlatformDiagnosticIssue` contracts
- Using the Studio Viewer for dependency graph visualization
- Troubleshooting initialization bottlenecks and provider-diagnostic scenarios

## Prerequisites
- Familiarity with the Fluo module system and dependency injection
- Understanding of the Fluo CLI commands
- Basic knowledge of JSON and web-based visualization tools

## 15.1 Beyond the Terminal: Why Studio?

As applications grow, the dependency graph can become too complex to keep in one's head. Circular dependencies, scope mismatches, and failed provider resolutions become harder to track through terminal logs alone.

**@fluojs/studio** is Fluo's answer to this complexity. It is a file-first, shared platform snapshot viewer designed to provide a visual and actionable overview of your application's internal state. It transforms the "black box" of the DI container into a transparent, visual map.

Unlike heavy APM (Application Performance Monitoring) tools, Studio focuses on the **static and bootstrap-time architecture**, helping you find "why it didn't start" rather than just "why it is slow now."

## 15.2 The Studio Ecosystem

Studio is composed of three primary layers, as defined in `packages/studio/README.md`:

1. **Producer**: The `fluo inspect` command (part of `@fluojs/cli`) which crawls the module graph and emits a JSON snapshot.
2. **Contracts**: The `@fluojs/studio/contracts` subpath, providing the schema and validation logic for snapshots and timing data.
3. **Viewer**: The `@fluojs/studio/viewer` package, a React/Vite-based web interface for loading and exploring these snapshots.

## 15.3 Generating Snapshots with `fluo inspect`

The primary way to interact with Studio is by generating a snapshot of your application.

```bash
fluo inspect ./src/app.module.ts --json > platform-state.json
```

This command invokes the Fluo runtime in a special "inspection mode" where providers are resolved and the graph is built, but the actual server doesn't start listening. The resulting JSON contains:
- Every registered component (Module, Controller, Provider)
- Full dependency mapping
- Health and readiness status
- Detailed bootstrap timing per phase

The snapshot process is non-destructive; it safely traverses the module tree without executing business logic or connecting to external databases unless explicitly configured to do so via `bootstrapOptions`. This allows `fluo inspect` to be used safely in CI/CD environments to verify architectural integrity before deployment. The command also supports various output formats, including a human-readable summary that highlights critical issues directly in the terminal, making it a versatile tool for both automated scripts and manual debugging sessions.

## 15.4 Understanding the Snapshot Contract

The data emitted by the CLI follows the `PlatformShellSnapshot` contract defined in `packages/studio/src/contracts.ts`. This contract ensures that any producer (CLI, custom script, or external tool) generates data that the Viewer can reliably interpret.

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

By adhering to this strict interface, the Studio ecosystem allows for the creation of third-party producers. For example, a custom testing harness could emit a `PlatformShellSnapshot` to visualize the state of a test environment, or a specialized monitoring agent could periodically generate snapshots to track the evolution of an application's architecture over time. This standard-first approach ensures that the visualization tools remain decoupled from the underlying data source, providing maximum flexibility for developers.

### PlatformDiagnosticIssue: The Heart of Troubleshooting

Each diagnostic issue provides actionable metadata to help you fix configuration errors. The `fixHint` and `docsUrl` fields are particularly valuable for guided troubleshooting.

```typescript
export interface PlatformDiagnosticIssue {
  code: string;           // e.g., "FL0042"
  severity: 'error' | 'warning' | 'info';
  componentId: string;    // Which component failed
  message: string;        // Human-readable description
  cause?: string;         // Root cause analysis
  fixHint?: string;       // Explicit suggestion: "Add @Injectable() to X"
  dependsOn?: string[];   // Which blockers prevent resolution
  docsUrl?: string;       // Link to detailed guide
}
```

Diagnostics are not just error messages; they are structured data points that can be used to drive automated recovery workflows. For instance, a CI bot could parse the `PlatformDiagnosticIssue` to automatically suggest code changes or to block a PR that introduces a circular dependency. The `code` field is a unique identifier that maps to a specific section in the Fluo documentation, ensuring that developers always have access to the latest best practices and troubleshooting guides. This level of integration between the framework and its documentation is a key part of the Fluo experience.

## 15.5 Using the Studio Viewer

The Studio Viewer is a standalone web application. You can run it locally within the monorepo or use the published version.

```bash
pnpm --dir packages/studio dev
```

Once opened, you simply drag and drop your `platform-state.json` file into the browser. The `parseStudioPayload` helper validates the file against our internal versioning and schema rules before rendering.

### Key Features of the Viewer

- **The Graph View**: Renders your application as a Mermaid-powered dependency diagram. You can see which services depend on which repositories at a glance.
- **The Diagnostics Tab**: Lists all `PlatformDiagnosticIssue` entries. It groups them by severity and allows you to filter by component.
- **The Timing Tab**: Visualizes the bootstrap sequence, showing exactly how many milliseconds each phase (Module Graph Build, Instance Resolution, Lifecycle Hooks) took.

The viewer utilizes the `applyFilters` logic from `@fluojs/studio` to provide real-time search across the entire platform state. When a developer types into the search bar, the viewer filters both components and diagnostics, highlighting matches in the graph and the issues list simultaneously. This interactive feedback loop is essential for exploring large-scale monorepos where the module count can easily exceed hundreds of entries.

Developers can focus on specific sub-graphs by selecting a module or a component. Studio will automatically dim unrelated nodes and highlight the direct dependencies and dependents of the selected item. This "focus mode" is crucial when trying to understand the blast radius of a proposed change in a core utility or a shared repository. Interactive filtering also supports complex queries, such as "show all request-scoped providers that depend on a singleton database connection," which helps identify potential scope-mismatch vulnerabilities before they manifest as runtime errors.

The graph also supports color-coding based on the readiness status. Nodes marked with `degraded` appear orange, while `not-ready` nodes are red. This immediate visual feedback allows operators to quickly locate the root cause of a cluster-wide failure without reading through thousands of lines of logs. The Graph View's rendering engine is optimized to handle thousands of nodes by utilizing canvas-based virtualization, ensuring that even the most complex enterprise graphs remain responsive to zoom and pan gestures.

The Viewer also includes a "Snapshot History" feature, allowing you to load multiple snapshots and compare them side-by-side. This is particularly useful for tracking how the dependency graph grows over time or for verifying that a refactoring effort successfully simplified the application's structure. The comparison engine highlights added, removed, and modified dependencies, providing a clear delta of the architectural changes.

### Visualizing Scopes and Lifecycles

One of the most powerful aspects of Studio is its ability to visualize provider scopes. In complex applications, it's easy to accidentally inject a Request-scoped provider into a Singleton-scoped one, leading to runtime errors or memory leaks.

Studio flags these scope mismatches in the component details view. By selecting a component, you can see its resolved scope and any potential violations in its dependency chain. The visualization engine highlights the path of inheritance and injection, making it obvious where a scope boundary has been crossed. This is powered by the `PlatformComponent.details` metadata which contains the raw scope tokens resolved by the DI container.

The viewer also provides a "Lifecycle Trace" for each component, showing when it was instantiated and when its various hooks (`onModuleInit`, `onApplicationBootstrap`, etc.) were executed. This is invaluable for debugging initialization order issues that are otherwise invisible in the code. By clicking on a node in the graph, you can drill down into its telemetry data, viewing precise timestamps for every phase of its lifecycle within the Fluo runtime environment.

The telemetry data is collected via the `BootstrapTimingDiagnostics` interface. When the Fluo runtime starts, it records the entry and exit time for every lifecycle hook. Studio's Timing Tab parses these durations and presents them as a flame chart or a sequential list. These traces are not just static records; they represent the actual execution path taken by the framework's internal dispatcher. By analyzing these traces, developers can pinpoint the exact provider that is causing a "deadlock" or a slow startup, even if the issue is buried deep within the dependency graph.

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

This data allows you to identify exactly which provider is slowing down your startup process. If a module initialization takes 500ms, you can use Studio to see if it's waiting on a database connection or performing an expensive computation. In advanced scenarios, Studio can even compare two different snapshots to show how a configuration change affected the overall bootstrap performance, providing a "telemetry diff" that is essential for performance regression testing.

In addition to timing, Studio can also visualize the memory footprint of different modules during the bootstrap phase. By integrating with the runtime's internal profiling hooks, the Timing Tab can display the heap allocation for each component, helping you identify modules that are consuming excessive resources during startup. This is particularly important for edge runtimes where memory is a scarce resource and efficient initialization is key to minimizing cold start latency.

## 15.6 Scenario: Diagnosing a Provider Deadlock

Imagine your application hangs during startup. By inspecting the snapshot in Studio, you might find a "Circular Dependency" error in the Diagnostics tab.

1. **Identify**: Studio marks the offending components in red using the `not-ready` status mapped to a CSS `classDef`.
2. **Analyze**: The `dependsOn` field shows the cycle: `ServiceA -> ServiceB -> ServiceA`.
3. **Fix**: Use the `fixHint` which might suggest using `forwardRef()` or refactoring the shared logic into a third service.

The deadlock scenario is often a symptom of tight coupling between domain modules. Studio helps you visualize these cross-module dependencies, often revealing that a circular path exists through multiple layers of the application that weren't immediately obvious in the source code. By analyzing the entire path of the cycle, you can often identify a more architectural solution, such as introducing an event-driven communication pattern or moving shared state into a dedicated provider.

## 15.7 Programmatic Consumption of Snapshots

If you are building custom CI/CD tooling, you can use `@fluojs/studio` as a library to parse and validate snapshots using `parseStudioPayload` and `applyFilters`. This allows you to integrate architectural checks directly into your development workflow.

```typescript
// packages/studio/src/contracts.test.ts (logic walkthrough)
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
    console.error('Platform has critical issues!');
  }
}
```

This programmatic access is the foundation for "Architecture as Code" in the Fluo ecosystem. You can define custom rules, such as "no controller should depend directly on a repository," and enforce them using a simple script that runs against the generated snapshot. This approach is much more powerful than traditional linting, as it has access to the fully resolved module graph and can understand the runtime context of every component.

## 15.8 Mermaid Export for Documentation

Studio allows you to export the visual graph as Mermaid text using the `renderMermaid(snapshot)` helper. This is incredibly useful for maintaining up-to-date architecture documentation in your `README.md` or Notion pages without manual drawing.

The exporter is smart enough to handle escaping and node hashing, ensuring that the generated Mermaid syntax is always valid even if your component IDs contain special characters. This automation ensures that your architectural diagrams are never out of sync with your actual implementation, fulfilling the promise of "Documentation as Code."

### Studio as an Architecture Guard

Beyond interactive use, Studio snapshots can be integrated into your CI/CD pipeline as architecture guards. By analyzing the `PlatformShellSnapshot` programmatically, you can enforce rules that are difficult to check with linters alone.

For example, you could write a script that fails the build if any service from the `billing` module depends on a repository from the `inventory` module, ensuring strict domain isolation. This "Policy as Code" approach, powered by Fluo's transparent metadata, brings a new level of governance to large-scale TypeScript projects. You can even use these guards to monitor the "coupling coefficient" of your modules, alerting the team if a module starts to become too interconnected with other parts of the system.

### Future Directions: Live Studio


The current version of Studio is file-first, relying on snapshots. However, the underlying contracts are designed to support live updates. Future iterations of the Fluo runtime may expose a diagnostic socket that allows Studio to connect to a running process.

This would enable real-time visualization of request flows, dynamic provider swapping for debugging, and instant feedback on configuration changes without a full restart. The `PlatformReadinessStatus` can then transition from a static record to a live heartbeat, providing immediate visibility into the health of a distributed system. We are also exploring the possibility of using these live snapshots to drive dynamic scaling decisions, allowing the platform to adjust its resource allocation based on the observed load and health of individual modules.

By investing in the Studio ecosystem today, we are paving the way for a more interactive and responsive development experience in the future. The separation between "static analysis" and "runtime monitoring" will continue to blur as Studio evolves into a central hub for platform observability.

## 15.9 Why Line-by-Line Consistency Matters

In the Fluo project, we maintain a strict policy where English and Korean documentation must have identical headings. This isn't just for aesthetics; it allows our CI/CD pipelines to perform automated diffing to ensure that no technical section is missed during translation.

Every heading in this file corresponds exactly to a section in the Korean version. This consistency is also vital for the Studio diagnostics themselves. Since Studio issues are often mapped to documentation URLs, having a stable and synchronized heading structure allows the framework to provide precise links to both English and Korean readers.

Whether you are looking up an error code or reading about a specific visualization feature, you can be confident that the information is in the same place in every language version of the book. This commitment to linguistic symmetry ensures that global contributors can collaborate on the same technical foundations without friction. It also simplifies the maintenance of our cross-language search index, ensuring that developers can find the answers they need regardless of their preferred language.

## Summary

Studio transforms the "black box" of the DI container into a transparent, visual map. By leveraging snapshots, diagnostics, and timing data, you can move from guessing why a dependency failed to seeing the exact blocker and its suggested fix.

Effective diagnostics also shorten the feedback loop for new developers. Instead of teaching every nuance of the module graph, you can point them to the Studio viewer to explore the system on their own. Moreover, Studio’s ability to export to Mermaid ensures that your documentation remains a living part of your codebase.

As the ecosystem matures, we expect more tooling to build on top of these standard snapshots, further enhancing the observability of Fluo applications across different environments and organizational scales. Building high-performance backends requires a deep understanding of how that code is organized and how its pieces interact. Studio provides that missing link between source code and runtime behavior.

By standardizing the snapshot format, we allow for a variety of visualization tools to coexist. One team might prefer the Mermaid-based graph, while another might develop a 3D dependency explorer or a real-time monitor that overlays live metrics onto the static graph. The goal of Studio is not just to show you what you have, but to guide you toward better architectural decisions. Explicit dependency management, clear component boundaries, and observable lifecycles are the hallmarks of a well-designed Fluo application.

Visualizing your system is the first step toward mastering its complexity. In a world of microservices and complex monorepos, having a clear and accurate map of your dependencies is an essential asset for any engineering team. Studio is your companion in this journey, ensuring that your architecture remains sound as your application scales to meet new challenges.

As you move forward, keep the "Studio-first" mindset in your diagnostics workflow. Whenever you hit a complex configuration issue, reach for `fluo inspect` and let the visual data guide your troubleshooting. In the final part of this series, we will look at how to extend the Fluo ecosystem itself by creating custom packages and contributing back to the framework.

---
<!-- lines: 258 -->
