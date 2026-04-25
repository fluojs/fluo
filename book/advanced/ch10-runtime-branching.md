<!-- packages: @fluojs/runtime, @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: T16 Part 3 source-analysis draft for runtime branching across root, Node, and Web-standard execution surfaces -->

# Chapter 10. Runtime Branching: Node vs Web vs Edge

This chapter explains how Fluo branches only at package surfaces and adapter seams instead of duplicating the whole runtime for each host. If Chapter 9 defined the runtime shell contract, this chapter shows how that shell shares the same center across Node, Web, and Edge environments.

## Learning Objectives
- Explain why the root runtime surface stays transport-neutral.
- Understand why Node-only features are separated into the `./node` subpath.
- Analyze how the Web-standard `Request` and `Response` seam also covers Edge hosts.
- Summarize how request/response factories keep host differences inside narrow bridges.
- See how export maps and subpath design enforce portability contracts.
- Explain import hygiene principles that make portability cost visible in application code.

## Prerequisites
- Completion of Chapter 8 and Chapter 9.
- Understanding of HTTP adapters and the platform shell role.
- Basic understanding of the differences between Node servers and the Web-standard Request/Response model.

## 10.1 Fluo branches by package surface and adapter seams more than by giant runtime conditionals
The first fact to notice in Chapter 10 is that Fluo's runtime portability is not implemented as one giant `if (isNode) ... else if (isEdge) ...` block. The branch points are much narrower and sit in more architectural locations.

Most of the core bootstrap logic in `path:packages/runtime/src/bootstrap.ts:920-1202` is transport-neutral. It compiles the Module Graph, creates the DI container, registers runtime Tokens, resolves lifecycle instances, runs hooks, and assembles the application/context shell. Nowhere in this code is there a giant conditional asking whether the host is Node, the Web platform, or an Edge runtime.

Instead of detecting the host name, that center assembles already prepared adapters and a platform shell. In the excerpt below, the runtime deals with the Module Graph, Providers, Tokens, and lifecycle order. It does not use Node or Web as conditions.

`path:packages/runtime/src/bootstrap.ts:920-938`
```typescript
export async function bootstrapApplication(options: BootstrapApplicationOptions): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();
  let lifecycleInstances: unknown[] = [];
  let bootstrappedContainer: Container | undefined;
  const hasHttpAdapter = options.adapter !== undefined;
  const adapter = options.adapter ?? {
    async close() {},
    async listen() {},
  };
  const runtimeCleanup: Array<() => void> = [];
  const platformShell = createRuntimePlatformShell(options.platform?.components);
  const timingEnabled = options.diagnostics?.timing === true;
  const timingStart = timingEnabled ? runtimePerformance.now() : 0;
  const timingPhases: BootstrapTimingPhase[] = [];

  try {
    logger.log('Starting fluo application...', 'FluoFactory');
    const runtimeProviders = createRuntimeProviders(options, logger);
```

The branch shown by this excerpt is about adapter presence, not host kind. Because of that, the shared Bootstrap shell can exist before any Node server creation or Web Request normalization happens. The real host differences are pushed out to the edge where the adapter enters.

Actual branching happens only at seams that need host-specific capabilities. Those seams appear in three broad places. First, the package export map decides what is public from each subpath. Second, the transport adapter decides how raw requests and responses become framework objects. Third, shutdown and server orchestration helpers live in Node-only files, not in the root runtime barrel.

That is why the chapter title says "runtime branching," not "runtime fork." Fluo does not duplicate the whole runtime per host. It keeps the shared runtime shell in the center and branches only at explicit surface boundaries.

This philosophy is encoded in `path:packages/runtime/src/exports.test.ts:12-79`. The test enforces that the root runtime barrel must be transport-neutral, Node-only helpers must live under `./node`, Web helpers must live under `./web`, and lower-level adapter seams must live under `./internal/...` subpaths.

The root boundary starts with a deny list. The root barrel must not directly contain dispatch helpers, Web factories, Node shutdown helpers, or adapter Bootstrap helpers.

`path:packages/runtime/src/exports.test.ts:13-30`
```typescript
it('keeps the root barrel transport-neutral', () => {
  expect(runtime).not.toHaveProperty('parseMultipart');
  expect(runtime).not.toHaveProperty('dispatchWebRequest');
  expect(runtime).not.toHaveProperty('createWebRequestResponseFactory');
  expect(runtime).not.toHaveProperty('createNodeShutdownSignalRegistration');
  expect(runtime).not.toHaveProperty('bootstrapHttpAdapterApplication');
});

it('keeps only bootstrap-scoped operational helpers on the runtime root barrel', () => {
  expect(runtime.createHealthModule).toBeTypeOf('function');
  expect(runtime.fluoFactory).toBe(runtime.FluoFactory);
  expect(runtime).not.toHaveProperty('createConsoleApplicationLogger');
  expect(runtime).not.toHaveProperty('createJsonApplicationLogger');
  expect(runtime).toHaveProperty('APPLICATION_LOGGER');
  expect(runtime).toHaveProperty('PLATFORM_SHELL');
  expect(runtime).not.toHaveProperty('MetricsModule');
  expect(runtime).not.toHaveProperty('TerminusModule');
});
```

The same file also checks where transport helpers must live instead. Because of this pair of tests, the root and subpath boundary remains an executable contract, not just a documentation promise.

In other words, portability in Fluo is not only an implementation detail. Package topology itself is part of the runtime contract.

From an implementation perspective, the model looks like this.

```text
shared bootstrap shell in root runtime
  + explicit Node subpath for Node-only helpers
  + explicit Web subpath for Request/Response normalization
  + explicit internal seams for adapter-level composition
```

This frame is the background for the whole chapter. Node, Web, and Edge are not three independent runtimes. They are three ways to attach different host I/O semantics to one transport-neutral Bootstrap core.

## 10.2 The root runtime barrel is intentionally transport-neutral and the export map enforces it
The root public surface is defined in `path:packages/runtime/src/index.ts:1-30`. It exports the Bootstrap API, errors, diagnostics, health helpers, platform contracts, request transaction helpers, and selected runtime Tokens. It does not export Node adapter helpers or Web request dispatch helpers.

The actual shape of the root barrel is small and selective. It exposes only `bootstrap`, health, error, platform types, request transaction, Tokens, and shared types.

`path:packages/runtime/src/index.ts:1-30`
```typescript
export * from './abort.js';
export * from './bootstrap.js';
export * from './health/diagnostics.js';
export * from './errors.js';
export * from './health/health.js';
export type {
  MultipartOptions,
  MultipartRequestLike,
  MultipartResult,
  UploadedFile,
} from './multipart.js';
export type {
  PersistencePlatformStatusSnapshot,
  PlatformCheckResult,
  PlatformComponent,
  PlatformComponentInput,
  PlatformComponentRegistration,
  PlatformDiagnosticIssue,
  PlatformHealthReport,
  PlatformOptionsBase,
  PlatformReadinessReport,
  PlatformShell,
  PlatformShellSnapshot,
  PlatformSnapshot,
  PlatformState,
  PlatformValidationResult,
} from './platform-contract.js';
export * from './request-transaction.js';
export { APPLICATION_LOGGER, PLATFORM_SHELL } from './tokens.js';
export * from './types.js';
```

This list contains no Node server helpers or Web dispatch helpers. A reader looking at the root API can already see that the shared Bootstrap contract and host-specific helpers have different boundaries.

That omission is not accidental. `path:packages/runtime/src/exports.test.ts:13-29` verifies it directly. The root barrel must not contain `dispatchWebRequest`, `createWebRequestResponseFactory`, `createNodeShutdownSignalRegistration`, or `bootstrapHttpAdapterApplication`.

So the root runtime API is curated around portable Bootstrap concerns. It exposes only what every host can share. Runtime Tokens such as `FluoFactory`, `fluoFactory`, `APPLICATION_LOGGER`, and `PLATFORM_SHELL`, along with the shared runtime type system, belong here.

The package export map in `path:packages/runtime/package.json:27-56` enforces this curation at the package resolution stage. The explicit subpaths are `.`, `./node`, `./web`, `./internal`, `./internal/http-adapter`, `./internal/request-response-factory`, and `./internal-node`.

The JSON export map repeats the same boundaries. The root entrypoint, Node, Web, and internal seams are each declared as independent package subpaths.

`path:packages/runtime/package.json:27-56`
```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./node": {
    "types": "./dist/node.d.ts",
    "import": "./dist/node.js"
  },
  "./web": {
    "types": "./dist/web.d.ts",
    "import": "./dist/web.js"
  },
  "./internal": {
    "types": "./dist/internal.d.ts",
    "import": "./dist/internal.js"
  },
  "./internal/http-adapter": {
    "types": "./dist/internal-http-adapter.d.ts",
    "import": "./dist/internal-http-adapter.js"
  },
  "./internal/request-response-factory": {
    "types": "./dist/internal-request-response-factory.d.ts",
    "import": "./dist/internal-request-response-factory.js"
  },
  "./internal-node": {
    "types": "./dist/internal-node.d.ts",
    "import": "./dist/internal-node.js"
  }
}
```

This excerpt shows that the package manager and TypeScript resolver see the same surface boundaries. The root, Node, Web, and internal seams do not get mixed into one barrel. The import path exposes cost and intent.

This matters because an export map is stronger than documentation. It prevents arbitrary deep imports from pulling in internal files or host-specific files. The runtime branching policy is encoded in the package boundary itself.

`path:packages/runtime/src/node/node.test.ts:7-55` strengthens the same rule from the consumer's perspective. The test asserts that the root runtime API must not contain `bootstrapNodeApplication`, `createNodeHttpAdapter`, or `runNodeApplication`. Those helpers are legal only from the Node subpath.

`path:packages/runtime/src/exports.test.ts:61-78` also checks whether the package export map and `typesVersions` declare this narrowed entrypoint. This is exactly where runtime branching becomes a stable published contract instead of an implementation detail.

The test reads package.json and confirms that its declarations include the narrowed subpaths. In particular, `internal-node` is separately pinned in `typesVersions` too.

`path:packages/runtime/src/exports.test.ts:61-78`
```typescript
it('declares the narrowed package export map', () => {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, unknown>;
    typesVersions?: Record<string, Record<string, string[]>>;
  };

  expect(packageJson.exports).toHaveProperty('./node');
  expect(packageJson.exports).toHaveProperty('./web');
  expect(packageJson.exports).toHaveProperty('./internal');
  expect(packageJson.exports).toHaveProperty('./internal/http-adapter');
  expect(packageJson.exports).toHaveProperty('./internal/request-response-factory');
  expect(packageJson.exports).toHaveProperty('./internal-node');
  expect(packageJson.typesVersions?.['*']).toMatchObject({
    'internal-node': ['./dist/internal-node.d.ts'],
  });
```

So the export map is not just distribution configuration. It is a verified boundary that separates the root, public Node/Web subpaths, and lower-level internal seams.

In short, the root runtime barrel answers this question: "What can every Runtime share?" Anything host-specific is deliberately pushed outside that surface.

The resulting branch model looks like this.

```text
root runtime surface:
  portable bootstrap and contracts only

subpaths:
  host-specific or lower-level transport helpers only
```

This design makes portability mistakes visible. If application code imports a Node helper, the import path itself already declares the portability cost.

## 10.3 The Node branch packages server lifecycle, retries, compression, and shutdown behind the ./node subpath
The public Node entrypoint is `path:packages/runtime/src/node.ts:1-18`. This file re-exports only logger factories and part of the API from `./node/internal-node.js`. The fact that the file is very small is meaningful. The Node branch is closer to a curated façade over a deeper implementation file.

The Node public subpath does not open the whole internal file directly. As shown below, it exposes loggers and selected Node application helpers only.

`path:packages/runtime/src/node.ts:1-18`
```typescript
export * from './logging/json-logger.js';
export * from './logging/logger.js';
export {
  bootstrapNodeApplication,
  createNodeHttpAdapter,
  NodeHttpApplicationAdapter,
  createNodeShutdownSignalRegistration,
  defaultNodeShutdownSignals,
  registerShutdownSignals,
  runNodeApplication,
} from './node/internal-node.js';
export type {
  BootstrapNodeApplicationOptions,
  CorsInput,
  NodeApplicationSignal,
  NodeHttpAdapterOptions,
  RunNodeApplicationOptions,
} from './node/internal-node.js';
```

This façade answers a different question than the root boundary. The root exports what every host can share. `./node` exports only the helpers that code choosing a Node host may use.

The real implementation lives in `path:packages/runtime/src/node/internal-node.ts:1-421`. Only here does the runtime directly handle capabilities that the root runtime cannot assume. Node HTTP/HTTPS servers, sockets, listen retry behavior, compression wiring, and process-signal shutdown helpers all live in this file.

`NodeHttpApplicationAdapter` in `path:packages/runtime/src/node/internal-node.ts:108-194` is the core Node transport object. This adapter owns the native server, the request/response factory, and the socket set used for drain-aware shutdown. Those details are outside what the root runtime's abstract adapter contract can know.

The constructor creates the request-response factory, creates an HTTP or HTTPS server depending on `httpsOptions`, and tracks connections so lingering sockets can be force-closed later.

`path:packages/runtime/src/node/internal-node.ts:108-129`
```typescript
export class NodeHttpApplicationAdapter implements HttpApplicationAdapter {
  private readonly server: NodeServer;
  private dispatcher?: Dispatcher;
  private readonly requestResponseFactory: RequestResponseFactory<
    import('node:http').IncomingMessage,
    import('node:http').ServerResponse,
    MutableFrameworkResponse
  >;
  private readonly sockets = new Set<Socket>();

  constructor(
    private readonly port: number,
    private readonly host: string | undefined,
    private readonly retryDelayMs = 150,
    private readonly retryLimit = 20,
    private readonly compression = false,
    private readonly httpsOptions: HttpsServerOptions | undefined,
    private readonly multipartOptions?: MultipartOptions,
    private readonly maxBodySize = 1 * 1024 * 1024,
    private readonly preserveRawBody = false,
    private readonly shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  ) {
```

The following constructor body actually performs Node server creation and socket tracking. This second excerpt shows that the request/response factory, HTTP/HTTPS server selection, and connection set management all belong inside the Node branch.

`path:packages/runtime/src/node/internal-node.ts:130-145`
```typescript
    this.requestResponseFactory = createNodeRequestResponseFactory(
      compression,
      multipartOptions,
      maxBodySize,
      preserveRawBody,
    );
    this.server = createNodeServer(this.httpsOptions, (request, response) => {
      void this.handleRequest(request, response);
    });
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => {
        this.sockets.delete(socket);
      });
    });
  }
```

These two excerpts show why the Node branch needs its own subpath. `node:http`, `node:https`, socket sets, and server lifecycle are concrete capabilities that Web-standard hosts cannot share.

Listening is handled by `listenNodeServerWithRetry()` in `path:packages/runtime/src/node/internal-node.ts:294-320`. This helper retries `EADDRINUSE` errors up to the configured limit. That behavior is clearly Node-host logic. It belongs in the Node branch, not in the portable Bootstrap core.

`path:packages/runtime/src/node/internal-node.ts:294-320`
```typescript
function listenNodeServerWithRetry(server: NodeServer, options: NodeListenRetryOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tryListen = (attempt: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening);

        if (error.code === 'EADDRINUSE' && attempt < options.retryLimit) {
          scheduleNodeListenRetry(server, attempt, options.retryDelayMs, tryListen);
          return;
        }

        reject(error);
      };

      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host: options.host, port: options.port });
    };

    tryListen(0);
  });
}
```

The branch condition here is not a whole-runtime host choice. It is a Node server bind failure. Operational Node-only decisions stay inside `./node`, and the shared Bootstrap path does not need to know the retry policy.

Shutdown is handled by `closeNodeServerWithDrain()` in `path:packages/runtime/src/node/internal-node.ts:335-368`. That function closes the server, closes idle connections, and force-closes sockets if the drain timeout is exceeded. This is another piece of host-specific operational logic separated from the root runtime.

`createNodeHttpAdapter()` in `path:packages/runtime/src/node/internal-node.ts:240-253` wraps these Node concerns as a portable `HttpApplicationAdapter` implementation. `bootstrapNodeApplication()` in `path:packages/runtime/src/node/internal-node.ts:255-264` injects that adapter into the shared HTTP Bootstrap path. `runNodeApplication()` in `path:packages/runtime/src/node/internal-node.ts:266-277` adds shutdown-signal registration on top.

`path:packages/runtime/src/node/internal-node.ts:240-264`
```typescript
export function createNodeHttpAdapter(options: NodeHttpAdapterOptions = {}, compression = false, multipartOptions?: MultipartOptions): HttpApplicationAdapter {
  return new NodeHttpApplicationAdapter(
    resolveNodePort(options.port),
    options.host,
    options.retryDelayMs,
    options.retryLimit,
    compression,
    options.https,
    multipartOptions,
    options.maxBodySize,
    options.rawBody,
    options.shutdownTimeoutMs,
  );
}

export async function bootstrapNodeApplication(
  rootModule: ModuleType,
  options: BootstrapNodeApplicationOptions,
): Promise<Application> {
  return bootstrapHttpAdapterApplication(
    rootModule,
    options,
    createNodeHttpAdapter(options, options.compression ?? false, options.multipart),
  );
}
```

This excerpt narrows a 38-line source flow to adapter creation and Bootstrap handoff. The shutdown signal wiring in `runNodeApplication()` remains traceable through the citation later in the same nearby range. For this discussion, it is enough to see the boundary where Node concerns pass into the shared HTTP Bootstrap path.

The tests explain the intended public contract. `path:packages/runtime/src/node/node.test.ts:14-48` shows that the adapter's default port is `3000`, not `process.env.PORT`. This is also an explicitness choice. It prevents Node-specific convenience from silently pulling in ambient process configuration.

`path:packages/runtime/src/node/node.test.ts:14-30`
```typescript
it('uses the runtime default port instead of process.env.PORT', async () => {
  const previousPort = process.env.PORT;
  process.env.PORT = '4321';

  try {
    const adapter = publicNodeApi.createNodeHttpAdapter() as NodeHttpApplicationAdapter;

    expect(adapter.getListenTarget().url).toBe('http://localhost:3000');
    await adapter.close();
  } finally {
    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});
```

This test fixes two facts at once: the Node branch can see Node environment variables, and yet its default value is not tied to ambient process state. Portability cost is visible in the import path, but runtime defaults do not implicitly lean on host globals.

`path:packages/runtime/src/node/node.test.ts:50-54` in the same file verifies that Node compression internals are not exposed from the public Node subpath. Even inside the Node branch, Fluo separates supported public helpers from low-level implementation details. This short assertion reaches the same conclusion as the `node.ts` façade excerpt from another angle, so it remains citation-only instead of being repeated as another code block.

The Node branch can be drawn like this.

```text
./node public surface
  -> createNodeHttpAdapter()
  -> bootstrapNodeApplication()
  -> runNodeApplication()
  -> logger + shutdown helpers

internally
  -> native server creation
  -> request/response normalization
  -> listen retry
  -> drain-aware shutdown
  -> optional compression wiring
```

The important architecture point is not merely that Node has special helpers. It is that those helpers are provided without polluting the root runtime surface.

## 10.4 The Web and Edge branch reuse the Web-standard Request/Response seam instead of inventing separate runtimes
The Web branch lives in `path:packages/runtime/src/web.ts:1-606`. Its role is not to reimplement Bootstrap. Its role is to normalize native Web `Request` and `Response` semantics into Fluo's framework request/response contract.

The core public APIs are `createWebRequestResponseFactory()` in `path:packages/runtime/src/web.ts:246-274` and `dispatchWebRequest()` in `path:packages/runtime/src/web.ts:282-297`. This is the Web-standard branch corresponding to the Node adapter path.

Actual normalization is handled by `createWebFrameworkRequest()` in `path:packages/runtime/src/web.ts:309-...`. It handles URLs, headers, cookies, body content, multipart payloads, and optional raw body retention. On the response side, `MutableWebFrameworkResponse` and `WebResponseStream` implement SSE-friendly streaming semantics too.

The tests in `path:packages/runtime/src/web.test.ts:7-146` show exactly what this branch promises. It translates native `Request` into the framework request shape, serializes framework errors into native `Response`, supports SSE streaming, and rejects oversized streaming request bodies before reading without limit.

That last property is especially important on Edge-style hosts. Edge runtimes usually provide Web-standard `Request`/`Response` APIs instead of Node sockets. Fluo can support those hosts through this same Web-standard normalization seam. There is no need to create a separate Edge Bootstrap system.

That is why the chapter title is `Node vs Web vs Edge`. The runtime package does not contain a dedicated `edge.ts` file, but conceptually the Edge branch is a specialization of the Web-standard path. If the host gives Web `Request` and `Response` semantics, the runtime attaches through this Web seam.

The branch model is therefore:

```text
Node host:
  raw server + socket lifecycle -> Node adapter

Web-standard host:
  Request/Response + AbortSignal -> Web request/response factory

Edge host:
  usually enters through the same Web-standard seam
```

What changes is the transport edge. The shared dispatcher and the higher runtime shell above it remain the same.

This is the core portability benefit. Fluo does not need one dispatcher for Node and another for Edge. One normalization seam per raw transport family is enough.

## 10.5 Shared request/response factories are the narrow bridge that keeps higher runtime behavior identical across hosts
The file that makes the whole branching structure easy to understand is `path:packages/runtime/src/adapters/request-response-factory.ts:1-63`. This file is the host-agnostic bridge between raw I/O and the framework dispatcher.

The `RequestResponseFactory` interface requires only five things: create a framework request from a raw request, create an abort signal from a raw response or host primitive, create a framework response, resolve the request id, and write an error response.

Above that interface, `dispatchWithRequestResponseFactory()` handles the rest. It creates the framework response, obtains the abort signal, creates the framework request, throws if the dispatcher is not ready, dispatches the request, automatically sends an empty response if nothing was committed, and on failure writes a normalized error response unless the signal has already aborted or the response has already been committed.

This helper is the real anti-duplication seam for runtime branching. The Node branch and Web branch do not each implement dispatcher invocation, empty-response fallback, and error serialization flow. They only provide different factories.

The symmetry is visible in the source. Node's `createNodeRequestResponseFactory()` lives in `path:packages/runtime/src/node/internal-node.ts:196-238`, and Web's `createWebRequestResponseFactory()` lives in `path:packages/runtime/src/web.ts:246-274`. Both return the same interface, and both are then consumed by `dispatchWithRequestResponseFactory()`.

So host-specific divergence is narrow and explicit. Higher-level runtime behavior remains identical above it.

```text
host-specific factory
  -> dispatchWithRequestResponseFactory()
  -> shared dispatcher behavior
  -> shared commit fallback
  -> shared error handling shape
```

Because this seam exists, the rest of the runtime can remain surprisingly stable. `bootstrapApplication()` does not care whether the final host is Node or an Edge worker. It only cares that a compatible adapter or dispatch seam exists.

This also explains the export boundary seen earlier. Because the truly host-specific code lives below the request/response factory, the root barrel can stay portable.

The final conclusion of Chapter 10 is therefore broader than import hygiene. Fluo's runtime branching works because the framework makes most of Bootstrap host-agnostic, then branches only at a narrow transport seam very late. Node receives server lifecycle helpers. Web and Edge hosts receive Request/Response normalization helpers. Above that seam, however, the Module Graph, container, lifecycle hooks, platform shell, and dispatcher model are the same.

That is the internal portability contract. It is not "one runtime per host." It is "one shared runtime shell with explicit host adapters at the edges."
