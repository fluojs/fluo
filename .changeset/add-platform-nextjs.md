---
"@fluojs/platform-nextjs": major
---

Release the initial stable 1.0.0 decorator-first Next.js platform for `FluoFactory.create()`, supporting
App Router Route Handlers and streaming Pages Router API Routes on Next.js 16.x
(peer `>=16.0.0 <17`), Node.js `>=24.0.0 <27`, and `@fluojs/runtime`
`>=3.0.0 <4`. Packaged decorator compiler integration uses Turbopack only;
webpack and Edge Runtime are outside the support contract.

`createNextAppRouterHandler()` returns one method-keyed handler record
(`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`) that route modules
destructure directly into named App Router exports.

Both router facades load the backend lazily on the first request. Application
code owns Fluo bootstrap and close; Next.js owns the HTTP server and process
lifecycle. The adapter exposes no raw WebSocket upgrade seam and does not
extend Next.js routing with additional HTTP methods. Hybrid App/Pages Router
server bundles each own a lazy Fluo application rather than sharing one
process-wide singleton.

Pages requests propagate client disconnects through Fluo's request signal, stop
waiting on a disconnected lazy request without cancelling shared startup, and
cancel pending response reads. Demand-driven input preserves raw bytes and
delivers HTTP 413 before draining the remaining upload without closing the
host-owned socket.

Migration: Existing Next.js applications must use Next.js 16.x and Node.js
`>=24.0.0 <27`, install Fluo runtime 3.x, configure `withFluoNextBackend()`,
and connect one App Router or Pages Router catch-all to their Fluo backend.
This is the package's first stable release; it does not provide compatibility
with Next.js 15, Node.js 20/22, webpack, or Edge Runtime.
