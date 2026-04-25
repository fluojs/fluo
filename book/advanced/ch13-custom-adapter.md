<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 13. Custom Adapter Implementation: Building Your Own Transport Layer

This chapter explains the adapter contract and implementation standards you need when extending fluo's HTTP Runtime to a new platform. Chapter 12 covered the inside of the request processing chain. Here, we move to the transport layer that connects that chain to a real server.

## Learning Objectives
- Understand the responsibility `HttpApplicationAdapter` owns between the framework and the Runtime.
- Learn how `listen()` and `close()` connect to the server lifecycle.
- Practice mapping strategies for `FrameworkRequest` and `FrameworkResponse`.
- Analyze which boundaries fluo owns in the Fastify adapter implementation.
- Compare adapter design differences in serverless and edge environments.
- Summarize the No-op adapter for tests and custom Runtime extension points.

## Prerequisites
- Complete Chapters 11 and 12.
- Basic understanding of Node.js HTTP servers or server libraries such as Fastify and Express.
- Basic understanding of fluo's interface-based Runtime abstraction.

## 13.1 Adapter: The Bridge Between Framework and Runtime

One of Fluo's important strengths is Runtime neutrality. The adapter pattern is the key element that makes this possible. An adapter converts the request object from a specific platform, such as Node.js, Bun, or Cloudflare Workers, into a `FrameworkRequest` that Fluo can understand, then returns the dispatcher's execution result to the platform's response object.

Because the adapter owns this boundary, developers can write `Controller` or `Service` logic once, then move the same application code from Fastify to Bun, or to AWS Lambda, depending on performance requirements.

## 13.2 Analyzing the HttpApplicationAdapter Interface

To create an adapter that supports a new platform, you must implement the `HttpApplicationAdapter` interface.

`packages/http/src/adapter.ts:L68-L93`
```typescript
export interface HttpApplicationAdapter {
  /**
   * Exposes the underlying server instance.
   */
  getServer?(): unknown;

  /**
   * Reports the adapter's realtime communication capability.
   */
  getRealtimeCapability?(): HttpAdapterRealtimeCapability;

  /**
   * Starts the server and binds the dispatcher.
   */
  listen(dispatcher: Dispatcher): MaybePromise<void>;

  /**
   * Shuts the server down safely.
   */
  close(signal?: string): MaybePromise<void>;
}
```

- `listen(dispatcher)`: The key point that starts the server and forwards every incoming HTTP request to `dispatcher.dispatch(req, res)`.
- `close(signal)`: Called when the Runtime shuts down to clean up open sockets and resources.

## 13.3 Request and Response Mapping: FrameworkRequest and FrameworkResponse

The adapter's most important job is mapping. Fluo runs every pipeline from the `FrameworkRequest` provided by the adapter, and the response is abstracted as `FrameworkResponse`.

```typescript
// Example mapping performed inside an adapter
const fluoRequest: FrameworkRequest = {
  method: rawRequest.method,
  url: rawRequest.url,
  headers: rawRequest.headers,
  body: rawRequest.body,
  query: rawRequest.query,
  params: {}, // Filled by the dispatcher during route matching
  signal: rawRequest.signal, // AbortSignal integration
};
```

The `signal` property must be connected to the platform's request abort signal, such as `req.on('close')` in Node.js. This connection is the key mechanism that stops the pipeline from continuing work that is no longer needed.

## 13.4 In Practice: Analyzing the Core Fastify Adapter Logic

How does the `@fluojs/platform-fastify` package implement this interface? Fastify already has a highly optimized routing and plugin system, but the Fluo adapter uses it only as the transport layer.

```typescript
// packages/platform-fastify/src/adapter.ts (conceptual code)
export class FastifyAdapter implements HttpApplicationAdapter {
  constructor(private instance = fastify()) {}

  async listen(dispatcher: Dispatcher) {
    // Delegate every route to the Fluo dispatcher
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

Using Fastify's wildcard handler, `all('*')`, to hand control of every route to the Fluo dispatcher is the typical pattern.

## 13.5 FrameworkResponse and Delegated Response Writing

After the dispatcher finishes processing, it calls methods on the `FrameworkResponse` interface to send the result to the client. The adapter must implement these methods for the platform.

```typescript
const fluoResponse: FrameworkResponse = {
  get committed() { return reply.sent; },
  setHeader(name, value) { reply.header(name, value); return this; },
  status(code) { reply.status(code); return this; },
  send(body) { reply.send(body); },
};
```

The `committed` property tells whether the response has already been sent. It is the safeguard that prevents the dispatcher from writing a duplicate response.

## 13.6 Adapter Strategy in Serverless Environments

In environments such as AWS Lambda or Cloudflare Workers, the `listen()` method does not run continuously. Instead, the dispatcher must be called whenever an event arrives.

In `packages/platform-cloudflare-workers/src/adapter.ts`, a short-lived adapter is created whenever a `fetch` event occurs. It runs `dispatcher.dispatch`, converts the response to a `Response` object, and returns it. In this way, the adapter pattern connects traditional server environments and modern edge runtimes through the same contract.

## 13.7 Reporting Realtime Capability

An adapter can tell the framework whether it supports WebSocket or SSE. This report is made through `getRealtimeCapability`.

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

The framework uses this information to decide whether to enable modules that need realtime features, such as a Socket.IO integration, or to show warnings.

## 13.8 No-op Adapter: Tests and Custom Runtimes

`createNoopHttpApplicationAdapter()` is useful when verifying the framework lifecycle and Bootstrap process without starting a real network server.

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

This adapter is used in CI to test framework integrity without network overhead, or when building a special Runtime that calls `dispatch` manually.

## 13.9 Adapter Authoring Cautions: Error Propagation

Network errors or body parsing errors that occur inside the adapter should be placed into `FrameworkRequest` appropriately before they reach the dispatcher. If they cannot be handled at that level, an adapter-level exception handler should take over. If a fatal error occurs during dispatcher execution and the response can no longer be written, the adapter serves as the last line of defense by returning a 500 error with the platform's native features.

## 13.10 Adapter Evolution: HTTP/3 and QUIC Support

Fluo's adapter structure responds flexibly to transport layer changes. Even if the underlying server library is upgraded to support HTTP/3, upper-level business logic does not change as long as the adapter preserves the `FrameworkRequest` and `FrameworkResponse` contracts. That is the practical standard for platform independence.

## 13.11 Collaboration Between Adapters and the Binder

When the adapter passes a request to the dispatcher, the dispatcher internally uses the binder to convert request data into a DTO. `DefaultBinder` scans each field in the `FrameworkRequest` filled by the adapter and extracts the needed values.

```typescript
// packages/http/src/adapters/binding.ts (pseudocode)
function readSourceValue(request: FrameworkRequest, source: MetadataSource) {
  switch (source) {
    case 'path': return request.params[key];
    case 'query': return request.query[key];
    case 'header': return request.headers[key];
    case 'body': return request.body[key];
  }
}
```

When creating a custom adapter, if the platform has a special data source, such as property-based session information, you can customize the binder and bind it transparently to DTOs.

## 13.12 Exercise: A Tiny HTTP Adapter Skeleton

For learning purposes, let's write the simplest adapter structure that uses Node.js's built-in `http` module. This example shows the flow where the adapter converts a native request into `FrameworkRequest`, then returns the dispatcher's result through the native response.

```typescript
import * as http from 'http';
import { Dispatcher, FrameworkRequest, FrameworkResponse, HttpApplicationAdapter } from '@fluojs/http';

export class TinyNodeAdapter implements HttpApplicationAdapter {
  private server = http.createServer();

  async listen(dispatcher: Dispatcher) {
    this.server.on('request', async (req, res) => {
      // 1. Request mapping: convert Node.js IncomingMessage to FrameworkRequest
      const frameworkReq = this.mapRequest(req);
      
      // 2. Response mapping: convert Node.js ServerResponse to FrameworkResponse
      const frameworkRes = this.mapResponse(res);
      
      // 3. Dispatcher execution: start fluo's core pipeline
      try {
        await dispatcher.dispatch(frameworkReq, frameworkRes);
      } catch (err) {
        // Last line of defense: handle fatal errors not handled inside the dispatcher
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
      body: (req as any).body, // A real implementation needs body parsing logic
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

This skeleton is simple, but it includes every core mechanism of an adapter. A real production adapter, such as `FastifyAdapter`, adds more precise buffering, multipart handling, compression, and protocol optimization logic such as HTTP/2.

## 13.13 Summary

- Adapters convert a specific platform's API into Fluo's standard contract.
- `HttpApplicationAdapter` manages framework startup and shutdown.
- `FrameworkRequest/Response` mapping is the core of adapter implementation.
- Cooperation with the binder completes the pipeline where data flows.
- In high-performance systems, resource cleanup optimization through AbortSignal integration is essential.
- Realtime communication capability reporting is an important contract that guarantees compatibility across ecosystem modules.

## 13.14 Next Chapter Preview

This closes Part 4, HTTP Pipeline Internals. In the next part, we go deeper into integration strategies with the database layer responsible for data persistence. We will look at the boundaries where ORMs such as Prisma and Drizzle meet Fluo.

---
