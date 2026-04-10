# lifecycle and shutdown

<p><strong><kbd>English</kbd></strong> <a href="./lifecycle-and-shutdown.ko.md"><kbd>한국어</kbd></a></p>

fluo provides a rigorous, deterministic **Application Lifecycle** that governs how your service starts, signals health, and gracefully exits. This lifecycle ensures that your application is never in a "half-alive" state.

## why this matters

In modern cloud-native environments (Kubernetes, AWS, etc.), the way an application starts and stops is as important as how it handles requests.
- **The Startup Race**: If your app starts accepting traffic before the database connection is ready, you'll see a spike of 500 errors.
- **The "Dirty" Shutdown**: If you kill a process while it's still writing to a database, you risk data corruption.
- **Zombie Resources**: Failing to close Redis clients or message broker connections can lead to resource exhaustion over time.

fluo eliminates these risks by providing a **Structured Lifecycle Contract**. Every module and provider in your application can participate in this contract, ensuring that dependencies are initialized and destroyed in the correct order.

## core ideas

### atomic bootstrap
Bootstrap is an "all-or-nothing" operation.
1. **Config Validation**: If `.env` is wrong, we stop.
2. **Module Compilation**: If the DI graph is broken, we stop.
3. **Provider Initialization**: If a database connection fails during `onModuleInit`, we stop.

fluo ensures that a process only stays alive if it is **fully functional**.

### readiness vs. liveness
fluo distinguishes between being "alive" (the process is running) and being "ready" (the process can handle traffic).
- **Liveness**: Managed by the runtime engine.
- **Readiness**: Only signaled after `onApplicationBootstrap` has successfully completed across all modules. This is the signal for load balancers to start routing traffic to the instance.

### graceful shutdown sequence
When a `SIGTERM` or `SIGINT` is received, fluo begins a coordinated retreat:
1. **Stop Ingestion**: The HTTP server stops accepting new connections immediately.
2. **Request Draining**: Active requests are given a grace period (configurable) to finish.
3. **Reverse-Order Teardown**: Shutdown hooks (`onModuleDestroy`, `beforeApplicationShutdown`) are executed in the **exact reverse order** of their initialization. If Module A depends on Module B, Module A is destroyed *first* to ensure Module B's resources are still available during A's cleanup.

## lifecycle hooks

- **`onModuleInit`**: Logic that must run as soon as a module's providers are instantiated (e.g., establishing a socket connection).
- **`onApplicationBootstrap`**: Logic that runs once the *entire* application graph is ready (e.g., starting a background cron job).
- **`onModuleDestroy`**: Cleanup logic for a specific module.
- **`beforeApplicationShutdown`**: The final chance to perform cleanup before the process exits.

## boundaries

- **Dependency-Aware**: You never have to worry about the order of cleanup. fluo calculates the correct sequence based on your `@Inject()` metadata.
- **Timeout Protection**: If a shutdown hook takes too long (e.g., a hanging database query), fluo will eventually force-exit to prevent "zombie" processes from blocking deployments.
- **Idempotency**: Lifecycle hooks are guaranteed to run exactly once per application instance.

## related docs

- [Architecture Overview](./architecture-overview.md)
- [Dev Reload Architecture](./dev-reload-architecture.md)
- [Config and Environments](./config-and-environments.md)
- [Runtime Package README](../../packages/runtime/README.md)
