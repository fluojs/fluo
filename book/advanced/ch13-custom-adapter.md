<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 13. Custom Adapter Implementation: Building Your Own Transport Layer

## What You Will Learn in This Chapter
- The structure and role of the `HttpApplicationAdapter` interface
- How `listen()` and `close()` manage the server lifecycle
- How to satisfy the `FrameworkRequest` and `FrameworkResponse` contracts
- A practical Fastify-based adapter implementation
- Adapter strategies for serverless and edge environments

## Prerequisites
- Knowledge of the HTTP dispatcher and execution pipeline from Chapters 11 and 12
- Basic familiarity with a concrete HTTP server library such as Node.js `http`, Fastify, or Express

## 13.1 The Adapter: A Bridge Between Framework and Runtime

One of fluo's biggest strengths is runtime neutrality. The adapter pattern is what makes that possible. An adapter converts a platform-specific request object, for example from Node.js, Bun, or Cloudflare Workers, into the `FrameworkRequest` shape that fluo understands, and then converts the dispatch result back into the platform's response object.

Because of adapters, developers can write `Controller` and `Service` logic once and move from Fastify to Bun, or even to AWS Lambda, without rewriting business code.

## 13.2 Understanding the HttpApplicationAdapter Interface

To support a new platform, you implement the `HttpApplicationAdapter` interface.

`packages/http/src/adapter.ts:L68-L93`
```typescript
export interface HttpApplicationAdapter {
  /**
    * Expose the underlying server instance.
   */
  getServer?(): unknown;

  /**
    * Report the adapter's realtime capability.
   */
  getRealtimeCapability?(): HttpAdapterRealtimeCapability;

  /**
    * Start the server and bind the dispatcher.
   */
  listen(dispatcher: Dispatcher): MaybePromise<void>;

  /**
    * Shut the server down safely.
   */
  close(signal?: string): MaybePromise<void>;
}
```

- `listen(dispatcher)`: the key entry point that starts the server and forwards every incoming HTTP request into `dispatcher.dispatch(req, res)`.
- `close(signal)`: called during shutdown to clean up open sockets and resources.

## 13.3 Mapping Requests and Responses: FrameworkRequest and FrameworkResponse

The most important job of an adapter is mapping. fluo runs the full pipeline on top of the `FrameworkRequest` supplied by the adapter, and responses are abstracted through `FrameworkResponse`.

```typescript
// Example mapping done inside an adapter
const fluoRequest: FrameworkRequest = {
  method: rawRequest.method,
  url: rawRequest.url,
  headers: rawRequest.headers,
  body: rawRequest.body,
  query: rawRequest.query,
  params: {}, // Filled in by the dispatcher during route matching
  signal: rawRequest.signal, // AbortSignal integration
};
```

Connecting the `signal` field to the platform's request-abort signal, such as `req.on('close')` in Node.js, is especially important. It is a key tool for preventing wasted work inside the pipeline.

## 13.4 In Practice: Core Fastify Adapter Logic

How does `@fluojs/platform-fastify` implement this interface? Fastify already has a highly optimized routing and plugin system, but the fluo adapter uses it only as a transport layer.

```typescript
// packages/platform-fastify/src/adapter.ts, conceptual code
export class FastifyAdapter implements HttpApplicationAdapter {
  constructor(private instance = fastify()) {}

  async listen(dispatcher: Dispatcher) {
    // Delegate every route to the fluo dispatcher
    this.instance.all('*', async (req, reply) => {
      await dispatcher.dispatch(
        this.mapRequest(req),
        this.mapResponse(reply)
      );
    });
    await this.instance.listen({ port: 3000 });
  }

  async close() {
    await this.instance.close();
  }
}
```

Using Fastify's wildcard handler, `all('*')`, to hand every route over to the fluo dispatcher is a common pattern.

## 13.5 FrameworkResponse and Delegated Response Writing

When the dispatcher finishes processing, it calls methods on `FrameworkResponse` to send the result to the client. The adapter must implement those methods for the target platform.

```typescript
const fluoResponse: FrameworkResponse = {
  get committed() { return reply.sent; },
  setHeader(name, value) { reply.header(name, value); return this; },
  status(code) { reply.status(code); return this; },
  send(body) { reply.send(body); },
};
```

The `committed` property tells fluo whether the response has already been sent. That acts as a guardrail against writing the same response twice.

## 13.6 Adapter Strategy in Serverless Environments

In environments such as AWS Lambda or Cloudflare Workers, `listen()` does not run continuously. Instead, the dispatcher must be triggered by events.

In `packages/platform-cloudflare-workers/src/adapter.ts`, a short-lived adapter is created for each `fetch` event, executes `dispatcher.dispatch`, and returns a `Response` object. In this way, the adapter pattern becomes the bridge between classic server environments and modern edge runtimes.

## 13.7 Reporting Realtime Capability

An adapter can report whether it supports WebSocket or SSE features. It does that through `getRealtimeCapability`.

```typescript
// packages/http/src/adapter.ts:L49-L63
export function createFetchStyleHttpAdapterRealtimeCapability(
  reason: string,
  options: { support?: 'contract-only' | 'supported' } = {}
) {
  return {
    kind: 'fetch-style',
    mode: 'request-upgrade',
    contract: 'raw-websocket-expansion',
    // ...
  };
}
```

The framework can use this information to decide whether to enable modules that require realtime features, such as a Socket.IO integration, or to warn the developer when support is missing.

## 13.8 The No-op Adapter: Testing and Custom Runtimes

`createNoopHttpApplicationAdapter()` is useful when you want to verify lifecycle and bootstrap behavior without starting a real network server.

```typescript
// packages/http/src/adapter.ts:L100-L110
export function createNoopHttpApplicationAdapter(): HttpApplicationAdapter {
  return {
    async close() {},
    getRealtimeCapability() {
      return createUnsupportedHttpAdapterRealtimeCapability('No-op');
    },
    async listen() {},
  };
}
```

This adapter is used in CI to test framework integrity with almost no overhead, and it is also useful when building unusual runtimes that call `dispatch` manually.

## 13.9 Adapter Authoring Cautions: Error Propagation

Network errors or body-parsing failures that happen inside the adapter should either be represented appropriately in `FrameworkRequest` before dispatch or handled at the adapter boundary if they cannot be expressed cleanly. If a fatal failure occurs during dispatch and the response can no longer be written through the normal path, the adapter should act as the last line of defense and return a 500 response using the host platform's native tools.

## 13.10 Adapter Evolution: HTTP/3 and QUIC Support

fluo's adapter structure is designed to absorb changes in the transport layer. Even if the underlying server library upgrades to HTTP/3, upper-layer business logic does not need to change as long as the adapter continues to honor the `FrameworkRequest` and `FrameworkResponse` contracts. That is real platform independence.

## 13.11 Collaboration Between Adapters and Binders

Once the adapter passes a request into the dispatcher, the dispatcher uses a binder internally to turn request data into DTO inputs. `DefaultBinder` walks the fields filled by the adapter on `FrameworkRequest` and extracts the values it needs.

```typescript
// packages/http/src/adapters/binding.ts:L32-L62
function readSourceValue(request: FrameworkRequest, source: MetadataSource, ...) {
  switch (source) {
    case 'path': return request.params[key];
    case 'query': return request.query[key];
    case 'header': return request.headers[key];
    case 'body': return request.body[key];
    // ...
  }
}
```

When authoring a custom adapter, you can even customize the binder if the platform has unusual data sources, such as property-based session data, and expose them cleanly to DTO binding.

## 13.12 Exercise: A Tiny HTTP Adapter Skeleton

For learning purposes, here is a minimal adapter built on the Node.js `http` module. The example shows how an adapter converts a native request into `FrameworkRequest` and maps the dispatch result back into the native response.

```typescript
import * as http from 'http';
import { Dispatcher, FrameworkRequest, FrameworkResponse, HttpApplicationAdapter } from '@fluojs/http';

export class TinyNodeAdapter implements HttpApplicationAdapter {
  private server = http.createServer();

  async listen(dispatcher: Dispatcher) {
    this.server.on('request', async (req, res) => {
      // 1. Request mapping: convert Node.js IncomingMessage into FrameworkRequest
      const frameworkReq = this.mapRequest(req);
      
      // 2. Response mapping: convert Node.js ServerResponse into FrameworkResponse
      const frameworkRes = this.mapResponse(res);
      
      // 3. Run the dispatcher: start fluo's core pipeline
      try {
        await dispatcher.dispatch(frameworkReq, frameworkRes);
      } catch (err) {
        // Last line of defense: handle fatal errors that escaped dispatcher handling
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      }
    });
    
    return new Promise((resolve) => {
      this.server.listen(8080, () => resolve());
    });
  }

  async close() {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private mapRequest(req: http.IncomingMessage): FrameworkRequest {
    return {
      method: req.method || 'GET',
      url: req.url || '/',
      headers: req.headers as Record<string, string>,
      body: (req as any).body, // A real implementation needs body parsing
      query: {}, // URL parsing required
      params: {},
      signal: new AbortController().signal, // In practice, wire this to req.on('close')
    };
  }

  private mapResponse(res: http.ServerResponse): FrameworkResponse {
    return {
      get committed() { return res.headersSent; },
      setHeader(name, value) { res.setHeader(name, value); return this; },
      status(code) { res.statusCode = code; return this; },
      send(body) { res.end(body); },
    };
  }
}
```

This skeleton is simple, but it contains the core mechanics of an adapter. A production adapter such as `FastifyAdapter` adds richer buffering, multipart handling, compression, and protocol-level optimizations such as HTTP/2 support.

## 13.13 Summary

- Adapters translate platform APIs into fluo's standard contracts.
- `HttpApplicationAdapter` manages framework startup and shutdown.
- Mapping `FrameworkRequest` and `FrameworkResponse` is the core of adapter authoring.
- Cooperation with the binder completes the request-data pipeline.
- In high-performance systems, integrating `AbortSignal` is essential for efficient cleanup.
- Realtime capability reporting is an important compatibility contract across ecosystem modules.

## 13.14 Next Chapter Preview

That closes Part 4 on HTTP pipeline internals. The next part moves into testing and diagnostics, where we look closely at portability verification, conformance, and the tooling that keeps behavior consistent across runtimes.

---
<!-- lines: 271 -->
