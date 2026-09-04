---
"@fluojs/microservices": major
---

Propagate outbound gRPC writer errors instead of discarding them.

`GrpcMicroserviceTransport` previously ignored the error passed to `writer.error(err)` on outbound `clientStream()` and `bidiStream()` calls and closed the request half with `end()`. The remote peer read that as a successful end-of-stream, so a failed local producer still produced a completed RPC: `clientStream()` resolved its `result` promise with the server's success response and `bidiStream()` readers observed a clean completion. The caller's error was lost entirely.

Outbound writers now abort the call. fluo calls the call-level `destroy(err)` path, falling back to `cancel()` and finally `end()` for runtimes that expose neither, so the remote peer observes a failed RPC. The caller's original error — not the transport-level cancellation status that follows the abort — rejects the `clientStream()` result promise and surfaces on the `bidiStream()` reader. Repeated `writer.error()` calls, and an `end()` that follows one, are ignored so the call is aborted once and the first reported cause wins.

Migration: code that called `writer.error()` on an outbound gRPC `clientStream()` or `bidiStream()` and then awaited the result promise or iterated the reader previously observed success. Those call sites now observe the reported error and must handle a rejected promise or a throwing reader. Server-side handlers that treated the resulting clean EOF as a complete request stream now receive an aborted call and must handle that failure. Callers that want the previous end-of-stream semantics should call `writer.end()` instead of `writer.error()`. Inbound server-stream and bidi-stream writer behavior is unchanged.
