# error responses

<p><strong><kbd>English</kbd></strong> <a href="./error-responses.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the canonical error envelope and exposure policy across the HTTP runtime.

See also:

- `./http-runtime.md`
- `./auth-and-jwt.md`
- `../../packages/http/README.md`

## canonical error envelope

Successful responses stay plain-object-first. Errors use the canonical envelope:

```ts
type ErrorResponse = {
  error: {
    code: string;
    status: number;
    message: string;
    requestId?: string;
    details?: Array<{
      field?: string;
      source?: 'path' | 'query' | 'header' | 'cookie' | 'body';
      code: string;
      message: string;
    }>;
    meta?: Record<string, unknown>;
  };
};
```

## default status mapping

- binding and validation -> `400`
- authentication -> `401`
- authorization -> `403`
- not found -> `404`
- conflict -> `409`
- uncaught internal -> `500`

## package boundary

- transport-agnostic error contracts belong with the core layer
- HTTP status-aware exceptions belong with `@konekti/http`
- guards, resolvers, and runtime seams translate package-local or transport-agnostic failures into the HTTP exception family

## exposure policy

Safe by default:

- validation field paths
- client-safe validation messages
- request ID
- coarse auth failure category

Not safe by default:

- stack traces
- internal cause chains
- raw DB/ORM error payloads
- JWT verification internals
- secret/config values

## request correlation

Canonical error responses surface `requestId` when the runtime context has one. That same ID should be the public correlation key across logs, traces, and metrics.
