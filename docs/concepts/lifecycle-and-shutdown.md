# lifecycle and shutdown

<p><strong><kbd>English</kbd></strong> <a href="./lifecycle-and-shutdown.ko.md"><kbd>한국어</kbd></a></p>

This guide describes the application lifecycle, covering bootstrap, readiness, and shutdown processes.

### related documentation

- `./config-and-environments.md`
- `./dev-reload-architecture.md`
- `./transactions.md`
- `../../packages/runtime/README.md`

## lifecycle phases

The application lifecycle consists of several distinct phases:

1.  **Configuration Loading**: Reading environment and configuration data.
2.  **Module Graph Compilation**: Building the internal application structure.
3.  **Provider and Container Creation**: Instantiating dependency injection containers.
4.  **Initialization Hooks**: Executing provider and module initialization logic.
5.  **Infrastructure Connection**: Establishing connections to external services (e.g., databases).
6.  **Transport Binding**: Binding the HTTP adapter and starting listeners.
7.  **Ready State**: The application is fully initialized and accepting requests.

## bootstrap guarantees

- **Validation**: Invalid configurations cause the application to fail before binding to a port.
- **Graph Integrity**: Errors in the module or provider graph are caught at startup.
- **Atomicity**: Infrastructure failures prevent the application from entering a partially started state.
- **Readiness**: An "app ready" signal ensures the transport is fully prepared for incoming requests.
- **Health Checks**: `/health` (liveness) and `/ready` (readiness) are managed as separate concerns.

## lifecycle hooks

The runtime manages the following standard hook sequence:

- `onModuleInit`
- `onApplicationBootstrap`
- `onModuleDestroy`
- `onApplicationShutdown`

In dev mode with `watch: true`, runtime can also apply validated config reloads between bootstrap and shutdown. That path does not rebuild the module graph or replace the application shell. It updates the runtime-owned config snapshot and then notifies runtime-managed reload participants.

## shutdown sequence

Konekti follows a structured shutdown process:

1.  **Stop Ingestion**: Cease accepting new requests.
2.  **Signal Capture**: Record the shutdown signal.
3.  **Draining**: Wait for in-flight requests to complete.
4.  **Hooks**: Execute destroy and shutdown hooks.
5.  **Cleanup**: Disconnect infrastructure clients.
6.  **Observability**: Flush logs and traces if necessary.
7.  **Exit**: Terminate the process.

## request draining policy

- New requests are rejected during the shutdown phase.
- In-flight requests are allowed a bounded period to finish.
- Forced termination occurs if requests do not drain within the timeout window.
- Request-scoped cleanup must be handled safely within a `finally` block.

The default drain window in the Node adapter is 10 seconds. You can customize this using the `shutdownTimeoutMs` option in `bootstrapNodeApplication()` or `runNodeApplication()`.

## integration notes

- ORM clients should be integrated into the provider lifecycle.
- Active transactions must be resolved or cleaned up before the database disconnects.
- Runtime-owned adapters are responsible for mapping request abort or close signals to the internal framework model.
