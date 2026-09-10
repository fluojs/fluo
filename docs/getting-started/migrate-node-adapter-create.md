# Node Adapter Creation Migration

<p><strong><kbd>English</kbd></strong> <a href="./migrate-node-adapter-create.ko.md"><kbd>한국어</kbd></a></p>

## Scope

This API-breaking change consolidates duplicate `@fluojs/platform-nodejs` adapter creation APIs into `create(options)` on the existing `NodeHttpApplicationAdapter` class. The supported Node.js range remains `>=24.0.0 <27`; the [Node README](../../packages/platform-nodejs/README.md) owns the package API. Other runtimes and Express/Fastify server implementations are not combined.

## Imports and calls

| Removed surface | Replacement |
| --- | --- |
| Root `createNodejsAdapter(options)` | Root `NodeHttpApplicationAdapter.create(options)` |
| Root or `/internal` `createNodeHttpAdapter(options, compression, multipart)` | `NodeHttpApplicationAdapter.create({ ...options, compression, multipart })` |
| Root `NodejsAdapterOptions` | `NodeHttpAdapterOptions` |
| Root type-only `NodejsHttpApplicationAdapter` | `NodeHttpApplicationAdapter` |

Both free functions are deleted, including their implementations, not just exports. No permanent aliases remain on any public subpath, shipped JavaScript, or `.d.ts`. Ordinary applications import the package root. First-party integrations using `/internal` import the same class and options type, not a separate class. When moving positional factory arguments into the object, use the spread order above so the later `compression` and `multipart` values take precedence.

## Canonical recipe

This is bootstrap code for an installed application, not a repository example. It requires `@fluojs/platform-nodejs`, `@fluojs/runtime`, and an authored `AppModule`; prepare the module's standard decorator build/metadata configuration first.

```typescript
import { NodeHttpApplicationAdapter, type NodeHttpAdapterOptions } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const options: NodeHttpAdapterOptions = {
  host: '127.0.0.1',
  port: 3000,
  compression: true,
  maxBodySize: 1_048_576,
  multipart: { maxTotalSize: 2_097_152 },
  shutdownTimeoutMs: 10_000,
};
const adapter = NodeHttpApplicationAdapter.create(options);
const app = await FluoFactory.create(AppModule, { adapter });
await app.listen();

// When the host requests shutdown:
await app.close();
```

## Preserved behavior

- `create` validates the port and body cap and constructs the concrete adapter. `port` is an integer in `0..65535`, defaults to `3000`, and does not read `process.env.PORT`. `0` allocates an ephemeral port during `listen()`; inspect it afterwards with `getListenTarget()` / `getServer().address()`.
- `maxBodySize` is a non-negative integer byte count, defaulting to `1_048_576`. Omitted multipart `maxTotalSize` inherits the effective `maxBodySize`. An explicit total may be lower or higher than the body cap; `0` is preserved. Limit overflow produces `413` at the listener. Multipart file/count/field limits and buffered/streaming selection enter through the same `multipart` object.
- `compression` defaults to `false`. When `true`, full responses can use negotiated gzip, but range responses are not recompressed, preserving identity bytes, `206`/`416`, and range metadata.
- `http` and `https` accept their respective Node server construction options; supplying both throws before server creation. `rawBody` defaults to `false`; multipart raw-body exclusion remains.
- Retry defaults are `retryDelayMs: 150` and `retryLimit: 20`; the adapter drain default is `shutdownTimeoutMs: 10_000`. All are non-negative integers, and invalid values throw during creation. The adapter instance owns its listener and sockets; `close()` handles idle connections and bounded drain.
- Existing public positional constructor order, subclassing, DI class tokens, `instanceof`, and instance `listen`/`close`/server access remain. The static return type is now the concrete `NodeHttpApplicationAdapter`, not a narrowed portable interface. The existing low-level constructor compatibility path does not become private, and instance state does not move to static state.
- Node/Nodejs bootstrap/run helpers, loggers, filesystem, and signal APIs are not removed by this issue. Bootstrap/run helpers use the same static creation implementation while retaining their lifecycle and signal ownership. `forceExitTimeoutMs` bounds run-helper signal completion, not adapter drain.

## CLI and existing applications

`fluo new --shape application --transport http --runtime node --platform nodejs` uses the static adapter and Factory above, and explicitly emits `createConsoleApplicationLogger()` and `shutdownRegistration: createNodeShutdownSignalRegistration()`. Existing projects are not rewritten; migrate their imports and calls using the table above. Factory applies default security headers, keeps CORS and prefix opt-in, and leaves shutdown with the host when the signal callback is omitted. When migrating from `runNodejsApplication`, preserve required middleware and logging, and pass this callback for Node signal-driven shutdown. Factory registers it after listen and unregisters it during close. Applications retaining the existing run helper keep their behavior. Follow the [HTTP Factory migration](./migrate-http-factory.md) for shared defaults and error/cleanup policy.

## Evidence and release impact

- Actual creation and validation: static `create` in `packages/platform-nodejs/src/node/internal-node.ts`; both dedicated factories and their single-caller port/body resolvers are deleted.
- Lower-level implementation performs adapter instance work. The constructor uses `createNodeServer`, `createNodeRequestResponseFactory`, and `NodeListenLifecycle`; `listen`/`close` use instance lifecycle state. These are not forwarding adapter-creation wrappers. Existing request/compression plumbing remains necessary for the raw Node constructor and Express/Fastify internal-seam consumers.
- Runtime regressions: `packages/platform-nodejs/src/adapter-create.test.ts`, `src/index.test.ts`, `src/lifecycle.test.ts`, and `src/lifecycle.integration.test.ts`.
- Published consumer regressions: `packages/platform-nodejs/src/published-declaration-surface.test.ts` and `src/node-adapter-consumer.test-fixture.ts` check root/internal type imports, static options/return types, constructors, JavaScript exports, and class identity.
- CLI regression: `packages/cli/src/new/scaffold.test.ts`. Docs enforcement companion: `tooling/governance/node-adapter-creation.test.ts`.
- The consumer audit includes CLI, runtime, GraphQL, OpenAPI, Socket.IO, and WebSockets tests; package READMEs; website Docs; and EN/KO `book/03-internals/ch13-node-adapters`, `book/intermediate/ch21-express-node`, and `book/advanced/ch10-runtime-branching`. Historical changelogs remain records of their releases and are not rewritten.

```bash
pnpm --filter '@fluojs/platform-nodejs...' build
pnpm --filter '@fluojs/platform-nodejs' typecheck
pnpm --filter '@fluojs/platform-nodejs' test
pnpm verify:platform-consistency-governance
pnpm verify:docs
```

The API removal and generated starter bootstrap ownership change carry platform-nodejs and CLI patch Changesets at the maintainer's explicit request. The patch classification does not remove the migration requirements or preserve the deleted APIs. HTTP/runtime README consumer updates also carry patch metadata for shipped README alignment without changing those packages' runtime behavior. Other Docs/Book and other-package test-only edits do not independently change a shipped API. The command list is a verification procedure, not an execution receipt.
