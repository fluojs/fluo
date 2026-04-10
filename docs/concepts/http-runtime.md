# http runtime

<p><strong><kbd>English</kbd></strong> <a href="./http-runtime.ko.md"><kbd>한국어</kbd></a></p>

fluo provides a high-performance **HTTP Runtime Facade** that abstracts away the complexities of underlying web servers (like Fastify, Bun, or Cloudflare Workers) while providing a strict, phase-based request lifecycle.

## why this matters

In many frameworks, the "request journey" is a black box. Middleware, filters, guards, and interceptors often overlap in confusing ways, making it hard to answer simple questions:
- "Where should I put my authentication logic?"
- "Why isn't my validation error being caught by my global filter?"
- "Is my response already serialized before it hits the logger?"

fluo eliminates this ambiguity with an **Explicit Execution Sequence**. By defining a clear, one-way journey for every request, we ensure that security, validation, and observability are handled consistently across your entire API.

## core ideas

### runtime abstraction (the facade)
Your business logic should not depend on whether you're running on Node.js with Fastify or on a serverless Edge function.
- **Unified Context**: fluo wraps the raw request/response objects in a `fluoContext`.
- **Platform Agnostic**: You write your controllers and services once; the platform adapter (e.g., `@fluojs/platform-fastify`) handles the translation to the specific server engine.

### materialization gate
fluo treats incoming HTTP data (body, query, params) as **untrusted raw input**.
- **The Gatekeeper**: Data is "materialized" into typed TypeScript classes using decorators like `@FromBody()`.
- **Validation-First**: Before your controller handler is ever called, this materialized data is validated against your defined schemas. If validation fails, the request is rejected with a clear 400 error, saving your business logic from dealing with corrupt data.

### the interceptor "onion"
fluo uses an "onion" model for request processing. Each phase (Middleware -> Guard -> Interceptor) wraps the next, allowing you to execute logic both **before** and **after** the handler. This is perfect for logging, performance timing, and response transformation.

## execution sequence

1. **Platform Adapter**: Receives the raw byte stream from the network.
2. **Context Initialization**: Creates the `fluoContext`.
3. **Global Middleware**: Handles raw cross-cutting concerns (e.g., CORS, Compression).
4. **Route Discovery**: Matches the URL path to a specific Controller method.
5. **Guard Check**: The authorization boundary. If a guard returns `false`, the journey ends with a 403.
6. **Interceptor (Pre-Handler)**: Executes logic right before the data is processed.
7. **Input Materialization & Validation**: Raw JSON becomes a typed, validated class instance.
8. **Controller Handler**: Your business logic executes.
9. **Interceptor (Post-Handler)**: Transforms the result (e.g., wrapping it in a `{ data: ... }` object).
10. **Response Serialization**: Converts the result back to JSON or the requested format.
11. **Final Write**: The platform adapter sends the response back to the client.

## boundaries

- **No Raw Access**: You are discouraged from touching `req` or `res` directly. Use the `fluoContext` to maintain platform portability.
- **Contract-Based Responses**: Return values from controllers are automatically serialized based on the `@Produces()` or `@HttpCode()` metadata.
- **Exception Boundary**: Uncaught errors in any phase are caught by the **Global Exception Filter**, which ensures the client receives a standardized error response instead of a raw stack trace.

## related docs

- [Architecture Overview](./architecture-overview.md)
- [Decorators and Metadata](./decorators-and-metadata.md)
- [DI and Modules](./di-and-modules.md)
- [HTTP Package README](../../packages/http/README.md)
