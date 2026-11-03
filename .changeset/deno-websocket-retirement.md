---
'@fluojs/websockets': major
---

Remove the `@fluojs/websockets/deno` export, declarations, Deno runtime binding, and dependency on `@fluojs/platform-deno` in the next major. Deno's final supported line is `2.x`. The package itself, runtime-neutral root, and Node.js, Bun, and Cloudflare Workers bindings remain supported.

Migrate Deno gateways to `@fluojs/websockets/node` or `@fluojs/websockets/cloudflare-workers`:

- Replace `DenoWebSocketModule.forRoot(...)` with `NodeWebSocketModule.forRoot(...)` or `CloudflareWorkersWebSocketModule.forRoot(...)` from the corresponding subpath.
- Replace injected `DenoWebSocketGatewayLifecycleService` tokens with the selected runtime's lifecycle service token.
- Select a supported HTTP adapter and update native socket types and runtime-specific option/guard projections. Node guards receive `IncomingMessage`; Workers guards receive a Web-standard `Request`. Keep shared gateway decorators and contracts imported from `@fluojs/websockets`.

See the [Deno migration guide](https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-from-deno.md). Historical implementations remain available in Git history and published `2.x` tarballs; the removed subpath has no compatibility export.
