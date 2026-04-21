<!-- packages: @fluojs/runtime, @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: T16 Part 3 source-analysis draft for runtime branching across root, Node, and Web-standard execution surfaces -->

# 10. Runtime Branching: Node vs Web vs Edge

## 10.1 Fluo branches by package surface and adapter seams more than by giant runtime conditionals
By the time you reach Chapter 10, the most important realization is that Fluo's runtime portability is not driven by one giant `if (isNode) ... else if (isEdge) ...` block. The branch points are narrower and more architectural.

Most of the core bootstrap logic in `path:packages/runtime/src/bootstrap.ts:920-1202` is transport-neutral. It compiles module graphs, creates a DI container, registers runtime tokens, resolves lifecycle instances, runs hooks, and builds an application or context shell. None of that code asks whether it is running in Node, on the Web platform, or on an edge runtime.

The actual branching happens at the seams where host-specific capabilities matter. Those seams are visible in three places. First, the package export map decides which helpers are even public on each subpath. Second, transport adapters decide how raw requests and responses become framework objects. Third, shutdown and server orchestration helpers live in Node-only files instead of the root runtime barrel.

This is why the title says "runtime branching" rather than "runtime fork". Fluo does not clone the whole runtime per host. It keeps the common runtime shell centralized, then branches only at explicit surface boundaries.

You can see the philosophy encoded in `path:packages/runtime/src/exports.test.ts:12-79`. The tests insist that the root runtime barrel stay transport-neutral, that Node-only helpers live on `./node`, that Web helpers live on `./web`, and that lower-level adapter seams live on `./internal/...` subpaths.

That means portability in Fluo is governed by package topology as much as by implementation details. The export map is part of the runtime contract.

An implementation-facing summary looks like this:

```text
shared bootstrap shell in root runtime
  + explicit Node subpath for Node-only helpers
  + explicit Web subpath for Request/Response normalization
  + explicit internal seams for adapter-level composition
```

This is the frame for the whole chapter. Node, Web, and Edge are not three independent runtimes. They are three ways of attaching host I/O semantics to one transport-neutral bootstrap core.

## 10.2 The root runtime barrel is intentionally transport-neutral and the export map enforces it
The root public surface is defined in `path:packages/runtime/src/index.ts:1-30`. It exports bootstrap APIs, errors, diagnostics, health helpers, platform contracts, request-transaction helpers, and selected runtime tokens. It does not export Node adapter helpers or Web request-dispatch helpers.

That omission is not accidental. `path:packages/runtime/src/exports.test.ts:13-29` verifies it directly. The root barrel must not expose `dispatchWebRequest`, `createWebRequestResponseFactory`, `createNodeShutdownSignalRegistration`, or `bootstrapHttpAdapterApplication`.

So the root runtime API is curated around portable bootstrap concerns. It exposes what every host can rely on: `FluoFactory`, `fluoFactory`, runtime tokens such as `APPLICATION_LOGGER` and `PLATFORM_SHELL`, and the shared runtime type system.

The package export map in `path:packages/runtime/package.json:27-56` makes that curation enforceable at package-resolution time. It declares explicit subpaths for: `.`, `./node`, `./web`, `./internal`, `./internal/http-adapter`, `./internal/request-response-factory`, and `./internal-node`.

This matters because export maps are stronger than documentation. They prevent accidental use of internal or host-specific files through arbitrary deep imports. The runtime's branching policy is therefore encoded in the package boundary itself.

`path:packages/runtime/src/node/node.test.ts:7-55` reinforces the same rule from the consumer side. The test asserts that the root runtime API does not have `bootstrapNodeApplication`, `createNodeHttpAdapter`, or `runNodeApplication`. Those helpers are only legal from the Node subpath.

`path:packages/runtime/src/exports.test.ts:61-78` also checks that the package export map and `typesVersions` declare the narrowed entrypoints. This is where runtime branching stops being an implementation detail and becomes a stable published contract.

In short, the root runtime barrel answers this question: "What can every runtime share?" Anything host-specific is pushed off that surface by design.

The resulting branch model can be expressed as:

```text
root runtime surface:
  portable bootstrap and contracts only

subpaths:
  host-specific or lower-level transport helpers only
```

That design keeps portability mistakes visible. If application code imports a Node helper, the import path itself already declares the portability cost.

## 10.3 The Node branch packages server lifecycle, retries, compression, and shutdown behind the ./node subpath
The public Node entrypoint is `path:packages/runtime/src/node.ts:1-18`. It re-exports logger factories and selected APIs from `./node/internal-node.js`. The file is tiny, which is itself revealing. The Node branch is mostly a curated façade over a deeper implementation file.

That deeper implementation is `path:packages/runtime/src/node/internal-node.ts:1-421`. Here the runtime finally deals with capabilities that the root runtime cannot assume: Node HTTP/HTTPS servers, sockets, listen retry behavior, compression wiring, and process-signal shutdown helpers.

`NodeHttpApplicationAdapter` at `path:packages/runtime/src/node/internal-node.ts:108-194` is the core Node transport object. It owns a native server, a request/response factory, and a socket set used for drain-aware shutdown. This is far beyond what the root runtime's abstract adapter contract knows.

Its constructor creates the request-response factory, creates an HTTP or HTTPS server depending on `httpsOptions`, and tracks connections so shutdown can later force-close lingering sockets if necessary.

Listening is handled by `listenNodeServerWithRetry()` at `path:packages/runtime/src/node/internal-node.ts:294-320`. This helper retries `EADDRINUSE` failures up to a configured limit. That behavior is explicitly Node-host logic. It belongs on the Node branch, not in the portable bootstrap core.

Shutdown is handled by `closeNodeServerWithDrain()` at `path:packages/runtime/src/node/internal-node.ts:335-368`. The function closes the server, closes idle connections, and force-closes sockets after a timeout if the drain window is exceeded. Again, this is host-specific operational logic isolated from the root runtime.

`createNodeHttpAdapter()` at `path:packages/runtime/src/node/internal-node.ts:240-253` packages those Node concerns into a portable `HttpApplicationAdapter` implementation. `bootstrapNodeApplication()` at `path:packages/runtime/src/node/internal-node.ts:255-264` then feeds that adapter into the shared HTTP bootstrap path. `runNodeApplication()` at `path:packages/runtime/src/node/internal-node.ts:266-277` adds shutdown-signal registration on top.

The tests explain the intended public contract. `path:packages/runtime/src/node/node.test.ts:14-48` shows that the adapter defaults to port `3000` rather than reading `process.env.PORT` implicitly. That is another explicitness choice. Node-specific convenience does not get to smuggle ambient process configuration into the runtime without opt-in.

The same file at `path:packages/runtime/src/node/node.test.ts:50-54` verifies that Node compression internals remain hidden from the public Node subpath. Even within the Node branch, Fluo distinguishes supported public helpers from low-level implementation details.

So the Node branch can be drawn like this:

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

The important architectural point is not just that Node gets special helpers. It is that Node gets them without contaminating the portable root runtime surface.

## 10.4 The Web and Edge branch reuse the Web-standard Request/Response seam instead of inventing separate runtimes
The Web branch lives in `path:packages/runtime/src/web.ts:1-606`. Its purpose is not to reimplement bootstrap. Its purpose is to normalize native Web `Request` and `Response` semantics into Fluo's framework request/response contract.

The key public APIs are `createWebRequestResponseFactory()` at `path:packages/runtime/src/web.ts:246-274` and `dispatchWebRequest()` at `path:packages/runtime/src/web.ts:282-297`. These are the Web-standard equivalents of the Node adapter path.

`createWebFrameworkRequest()` at `path:packages/runtime/src/web.ts:309-...` performs the actual normalization. It parses URL data, headers, cookies, body content, multipart payloads, and optional raw body retention. `MutableWebFrameworkResponse` and `WebResponseStream` implement the response side, including SSE-friendly streaming semantics.

The tests in `path:packages/runtime/src/web.test.ts:7-146` show exactly what this branch promises. It translates a native `Request` into the framework request shape, serializes framework errors into native `Response` objects, supports SSE streaming, and rejects oversized streaming request bodies before reading unlimited bytes.

That last property is especially important for Edge-style hosts. Edge runtimes generally expose the Web-standard `Request`/`Response` API rather than Node sockets. Fluo can target them through the same Web-standard normalization seam, without inventing an entirely separate edge bootstrap system.

This is why the chapter title says `Node vs Web vs Edge`, even though the runtime package does not contain a dedicated `edge.ts` file. The Edge branch is conceptually a specialization of the Web-standard path. If the host gives you Web `Request` and `Response` semantics, the runtime's Web seam is the branch you attach to.

The branch model therefore looks like this:

```text
Node host:
  raw server + socket lifecycle -> Node adapter

Web-standard host:
  Request/Response + AbortSignal -> Web request/response factory

Edge host:
  usually enters through the same Web-standard seam
```

What changes is the transport edge. What stays the same is the shared dispatcher and higher runtime shell above it.

That is the portability win. Fluo does not need one dispatcher for Node and another for Edge. It only needs one normalization seam per raw transport family.

## 10.5 Shared request/response factories are the narrow bridge that keeps higher runtime behavior identical across hosts
The file that makes the whole branching story click is `path:packages/runtime/src/adapters/request-response-factory.ts:1-63`. This is the host-agnostic bridge between raw I/O and the framework dispatcher.

The `RequestResponseFactory` interface asks for only five things. Create a framework request from the raw request. Create an abort signal from the raw response or host primitive. Create a framework response. Resolve a request id. Write an error response.

`dispatchWithRequestResponseFactory()` then does the rest. It creates the framework response, derives the abort signal, creates the framework request, throws if the dispatcher is not ready, dispatches the request, auto-sends an empty response if nothing was committed, and on failure writes a normalized error response unless the signal already aborted or the response is already committed.

This helper is the real anti-duplication seam of runtime branching. Node and Web branches do not each re-implement dispatcher invocation, empty-response fallback, or error-serialization flow. They only supply different factories.

You can see this symmetry directly. Node's `createNodeRequestResponseFactory()` is defined at `path:packages/runtime/src/node/internal-node.ts:196-238`. Web's `createWebRequestResponseFactory()` is defined at `path:packages/runtime/src/web.ts:246-274`. Both return the same interface. Both are later consumed by `dispatchWithRequestResponseFactory()`.

That means host-specific divergence is narrow and explicit. The higher-level runtime behavior remains identical:

```text
host-specific factory
  -> dispatchWithRequestResponseFactory()
  -> shared dispatcher behavior
  -> shared commit fallback
  -> shared error handling shape
```

Once this seam exists, the rest of the runtime can stay remarkably stable. `bootstrapApplication()` does not care whether the final host is Node or an Edge worker. It only cares whether a compatible adapter or dispatch seam exists.

This also explains the export boundaries from earlier in the chapter. The root barrel can remain portable because the truly host-specific code lives below the request/response factory line.

The final lesson of Chapter 10 is therefore broader than import hygiene. Fluo's runtime branching works because the framework branches late, at narrow transport seams, after most of bootstrap has already become host-agnostic. Node gets server lifecycle helpers. Web and Edge hosts get Request/Response normalization helpers. But above those seams, the module graph, container, lifecycle hooks, platform shell, and dispatcher model stay the same.

That is the internal portability contract. Not "one runtime per host", but "one shared runtime shell with explicit host adapters at the edge."




































