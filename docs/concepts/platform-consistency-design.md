# platform consistency design

<p><strong><kbd>English</kbd></strong> <a href="./platform-consistency-design.ko.md"><kbd>한국어</kbd></a></p>

The **Platform Consistency Design** is the "spine" of the fluo framework. It defines the universal contract that all official packages—from database drivers to message brokers—must follow to ensure a unified operational experience.

## why this matters

Modern backend ecosystems are often a "Wild West" of inconsistent libraries. One library might use environment variables for config, while another requires a JSON file. One might emit Prometheus metrics, while another only logs to stdout.

This inconsistency leads to **Operational Friction**:
- Developers have to learn a new "way of doing things" for every new package.
- SREs and DevOps teams struggle to build unified monitoring and alerting because every service reports health differently.
- Troubleshooting becomes a nightmare when error formats and diagnostic codes vary wildly across the stack.

fluo eliminates this friction by enforcing a **Shared Conceptual Contract**. Whether you are using `@fluojs/redis`, `@fluojs/prisma`, or a custom internal module, the "shape" of how you configure, monitor, and scale it remains identical.

## core ideas

### the "platform shell" (@fluojs/runtime)
The runtime acts as the orchestrator. It doesn't need to know *what* a package does (e.g., "storing data in Redis"), but it knows *how* to talk to it. Every package must "plug in" to this shell by implementing standard interfaces for:
- **Lifecycle**: How to start and stop gracefully.
- **Health**: Reporting "I am alive."
- **Readiness**: Reporting "I am ready to work."
- **Telemetry**: Exporting metrics and traces in a standardized format.

### resource ownership & accountability
A core principle of our design is **Clear Ownership**.
- If a package creates a resource (like a TCP socket or a file handle), it is 100% responsible for cleaning it up.
- If a user provides a resource to a package (e.g., passing an existing database client), the package **must not** attempt to close it.
This prevents "double-free" errors and hanging connections during shutdown.

### consistent diagnostics
Errors in fluo are not just strings; they are **Actionable Data**. The consistency design mandates that every official package provides:
- **Stable Error Codes**: Machine-readable IDs (e.g., `ERR_KV_CONNECTION_FAILED`).
- **Fix Hints**: Human-readable instructions on how to resolve the issue (e.g., "Check your REDIS_URL in .env").
- **Contextual Metadata**: The specific parameters that caused the failure, allowing for automated troubleshooting.

## shared contract spine

Every platform-facing package aligns with these four pillars:

1. **Config Envelope**: Standardized fields for `enabled`, `id`, `timeout`, and `telemetry`.
2. **State Model**: A predictable state machine: `CREATED` -> `INITIALIZING` -> `READY` -> `STOPPING` -> `STOPPED`.
3. **Common Observability**: Shared labels for metrics (e.g., `service_id`, `environment`) and spans for tracing.
4. **Behavioral Contracts**: Strict rules on how to handle retries, circuit breaking, and backpressure.

## boundaries

- **No Leaky Abstractions**: We don't hide the power of underlying libraries. If you use the Prisma package, you still get the full Prisma API—but wrapped in fluo's operational safety.
- **Explicitness over Magic**: No hidden "auto-discovery" of modules. Everything is explicitly imported and configured in your `AppModule`.
- **Operational Truth**: Health and readiness are treated as **unbiased facts**. If a database is down, the package must report it honestly, even if it means the whole application goes "Unready."

## related docs

- [Architecture Overview](./architecture-overview.md)
- [Lifecycle and Shutdown](./lifecycle-and-shutdown.md)
- [Config and Environments](./config-and-environments.md)
- [Package Surface](../reference/package-surface.md)
