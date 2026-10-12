# Migrate from Deno

<p><strong><kbd>English</kbd></strong> <a href="./migrate-from-deno.ko.md"><kbd>한국어</kbd></a></p>

## Status and scope

**Deno support is Deprecated.** `@fluojs/platform-deno`, `@fluojs/websockets/deno`, and the CLI Deno paths receive no new features, performance work, or compatibility with new runtime versions. Critical security and regression fixes are considered case-by-case, with no patch or LTS guarantee. New projects should use the default Node.js + Fastify path, or evaluate Cloudflare Workers for edge deployment.

Existing Deno adapter/WebSocket `2.x` and CLI `3.x` paths and examples remain usable. Removal is planned for the next major of the respective Deno-related packages, tracked in [#3938](https://github.com/fluojs/fluo/issues/3938). The exact last advisory release version is determined by the Changesets release. This document does not name a final version or assert that npm registry deprecation has completed.

The [official announcement on 2026-10-09](https://deno.com/blog/cloudflare) says the Deno runtime will receive monthly bug/security fixes for one year before the team's development ends; it remains open source. Deno Deploy shuts down after six months, while JSR continues operating. Those timelines are not a Fluo patch/LTS promise; the runtime, Deploy, and JSR are separate.

This guide migrates execution hosts and toolchains. Existing HTTP contracts remain in force, and migration does not broaden package-specific support. Read the [package support matrix](../reference/package-surface.md), [bootstrap contract](./bootstrap-paths.md), and [lifecycle contract](../architecture/lifecycle-and-shutdown.md) first. The entrypoints below are fragments using an existing `AppModule`, not whole-application replacements.

## Move to Node.js + Fastify

Use Node.js `>=24.11.0 <27` for the CLI and generated Babel/Vite toolchain; the adapter's runtime-only range is `>=24.0.0 <27`. Create a separate project to compare the default starter and decorator tooling; do not scaffold over your existing application.

```bash
pnpm dlx @fluojs/cli new migrated-api --shape application --transport http --runtime node --platform fastify
```

Keep existing runtime/core/http and feature modules; install `@fluojs/platform-fastify` and `@fluojs/platform-nodejs` in the target application. Fastify is an adapter dependency, so a separate installation is unnecessary unless the application uses Fastify APIs directly.

**Before: managed Deno entrypoint**

```ts
import '@fluojs/core/metadata-preload';
import { DenoHttpApplicationAdapter, createDenoShutdownSignalRegistration } from '@fluojs/platform-deno';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.ts';

const app = await FluoFactory.create(AppModule, {
  adapter: DenoHttpApplicationAdapter.create({ port: 3000 }),
  shutdownRegistration: createDenoShutdownSignalRegistration(),
});
await app.listen();
```

**After: default Node/Fastify entrypoint**

```ts
import '@fluojs/core/metadata-preload';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app';

const parsedPort = Number.parseInt(process.env.PORT ?? '3000', 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 3000;

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({ port }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
```

Factory initializes the application and `app.listen()` opens the listener. The adapter does not read `PORT`; port parsing is application policy. This example preserves the generated starter's parseInt/fallback policy. Keep standard decorator transforms and metadata preload; do not enable `experimentalDecorators`/`emitDecoratorMetadata`. Replace Deno's native TypeScript execution with the generated Vite build boundary, not direct Node TypeScript execution.

## Move to Cloudflare Workers

Use the host-owned path for an edge application that exports an HTTP handler. Workers does not run `Deno.serve` or a Node listener. Do not copy Deno server and signal orchestration unchanged.

**Before: host-owned Deno handler**

```ts
import '@fluojs/core/metadata-preload';
import { DenoHttpApplicationAdapter, createDenoFetchHandler } from '@fluojs/platform-deno';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.ts';

const adapter = DenoHttpApplicationAdapter.create();
const app = await FluoFactory.create(AppModule, { adapter });
const handler = createDenoFetchHandler({ dispatcher: app.dispatcher });
const server = Deno.serve({ port: 3000 }, handler);

try {
  await server.finished;
} finally {
  await app.close();
}
```

In this Before fragment, the host separately owns server stop, signals, and websocket upgrades. `createDenoFetchHandler(...)` neither opens a server nor owns upgrades.

**After: host-owned lazy Workers handler**

```ts
import '@fluojs/core/metadata-preload';
import { CloudflareWorkerApplicationHost } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app';

const worker = CloudflareWorkerApplicationHost.create(AppModule);

export default {
  fetch: worker.fetch,
};
```

This host owns lazy bootstrap, generation replacement, retry, and close/drain recovery. It needs no separate `app.listen()` or process-signal registration. Workers supplies no host shutdown callback to the exported `fetch` handler. Exporting it alone schedules no close. An application trigger outside an active `worker.fetch` invocation may call `await worker.close()`, but awaiting close inside that same request waits for its own drain. Return the response and observe close through `executionContext.waitUntil(worker.close())` or an equivalent mechanism instead. After a successful close, a later request creates a new generation from cached configuration; applications needing terminal behavior must own that state.

When the first Worker `env` must configure singleton bootstrap, use the same `CloudflareWorkerApplicationHost.create({ fromEnv })` overload. The first configuration is cached per host instance; later request environments do not reconfigure singletons. Fixed-module host request bindings arrive through `request.cloudflare.env` and cannot replace bootstrap-time `ConfigModule` inputs. Follow the [Workers API and ownership contract](../../packages/platform-cloudflare-workers/README.md).

## Review permissions, resources, and realtime

| Boundary | Node/Fastify | Workers |
| --- | --- | --- |
| Permissions | Deno `--allow-*` flags do not apply. Configure OS/container permissions, network policy, and secret access separately. | Configure bindings, secrets, and service access in deployment configuration; do not copy Deno permission flags. |
| Environment | Replace entrypoint `Deno.env.get/toObject` with an application-owned `process.env` snapshot and keep services on `ConfigService`. Follow Node env-file/watch contracts. | Use `env` bindings, not a Node `.env` loader or process-wide environment snapshot. |
| Files and storage | Migrate calls such as `Deno.readTextFile` to Node filesystem APIs and verify paths/roots, working directory, and read/write permissions. | Do not assume a general filesystem or Deno KV. Choose storage bindings or an application-owned `StaticAssetSource`, and migrate data separately. |
| TLS | Load Deno PEM strings at the application boundary and pass Node `https` options to Fastify. Omit adapter `https` when a proxy terminates TLS. | The host owns HTTPS endpoints and certificates; do not pass `Deno.serve` `cert/key` options. |
| Shutdown | Node signals require explicit `shutdownRegistration`. Deno helper log/swallow behavior is not the Node helper's failure/timeout exit-status policy. | Host close uses application triggers and bounded drain; it guarantees neither automatic process signals nor terminal isolate shutdown. |
| WebSockets | Replace `DenoWebSocketModule` with `NodeWebSocketModule.forRoot(...)` from `@fluojs/websockets/node`. | Use `CloudflareWorkersWebSocketModule.forRoot(...)` from `@fluojs/websockets/cloudflare-workers` and its native `WebSocketPair` boundary. |

Keep gateway decorators, room contracts, and explicit replies or opt-in event-envelope policy. Recheck runtime lifecycle injection tokens, raw socket/payload types, upgrade-guard request types, backpressure, and disconnect drain against the target runtime contract. Preserve the fetch-style Deno/Workers rejection of `serverBacked`. Socket.IO does not support Workers and has a separate Node/Bun contract. Changing adapters alone does not make database/native drivers, JWT, GraphQL, or other package-specific restrictions portable.

## CLI, configuration, scripts, and lockfiles

The CLI process runs on Node.js `>=24.11.0 <27`. Although the Deno target is Deprecated, existing explicit `--runtime deno --platform deno` values and generated paths are not removed in this phase. Compare the new target with the [starter matrix](../reference/fluo-new-support-matrix.md) and [toolchain matrix](../reference/toolchain-contract-matrix.md).

1. Inventory import maps, `npm:`/URL/JSR imports, and tasks in `deno.json`/`deno.jsonc`; translate them into target `package.json` dependencies and bundler resolution. Do not blindly delete files still used by Deno consumers. Adapt local imports such as `./app.ts` to the selected starter's TypeScript/bundler rules.
2. The CLI detects runtime from platform package dependencies in `package.json`. Once a target manifest has migrated, replace `@fluojs/platform-deno` with the target adapter and align explicit runtime overrides. Do not assume the existing `fluo dev` automatically switches to Node.
3. On Node, use `dev: fluo dev`, `build: fluo build`, `start: fluo start`, and generated Vite/Vitest configuration. Replace Deno's `deno compile --allow-env --allow-net --allow-read=.env --output dist/app src/main.ts` and `./dist/app` scripts with Node build/start. Do not run the old Deno binary as a Node application.
4. Workers generated lifecycle scripts are `dev: fluo dev`, `build: wrangler deploy --dry-run`, `preview: wrangler dev --remote --show-interactive-dev-session=false`, and `deploy: wrangler deploy`; the generated manifest has no `start` script. The Node CLI delegates its Workers commands to Wrangler. `deploy` performs a real deployment. Review entrypoints, compatibility settings, bindings, and secrets in the target Wrangler configuration.
5. `deno.lock` does not replace an npm package-manager lockfile. Generate dependencies and a lockfile with the target package manager and align CI installation/cache behavior. Preserve old lockfiles and deployment artifacts for rollback or remaining Deno users; clean them up separately after validating migration.
6. Migrate Deno test/lint/fmt tasks and permission flags to the target testing/tooling boundary. Preserve the generated non-Deno starter's standard decorator transform, metadata preload, and unit/slice/app/e2e structure. Verify production restart, TLS, raw-body/multipart/SSE, upgrades/rooms/disconnect, and shutdown failures in the target environment before switching traffic.

## Evidence and verification scope

Public APIs and examples derive from the [Fastify](../../packages/platform-fastify/README.md), [Deno](../../packages/platform-deno/README.md), [Workers](../../packages/platform-cloudflare-workers/README.md), and [WebSockets](../../packages/websockets/README.md) contracts. Implementation evidence is in `packages/platform-fastify/src/adapter.ts`, `packages/platform-deno/src/fetch-handler.ts`, `packages/platform-cloudflare-workers/src/adapter.ts`, `packages/cli/src/new/scaffold.ts`, and `packages/cli/src/commands/scripts.ts`. This document is not evidence of deployment or registry status. Actual application migration verification is application-owned.
