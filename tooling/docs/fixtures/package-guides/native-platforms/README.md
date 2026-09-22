# native-platforms fixtures

Runnable composition evidence for the three fetch-style platform package
guides:

- `apps/docs/content/docs/packages/platform-bun.mdx` (`@fluojs/platform-bun`)
- `apps/docs/content/docs/packages/platform-deno.mdx` (`@fluojs/platform-deno`)
- `apps/docs/content/docs/packages/platform-cloudflare-workers.mdx` (`@fluojs/platform-cloudflare-workers`)

Run everything from the repository root with:

```bash
pnpm vitest run --project tooling tooling/docs/fixtures/package-guides/native-platforms --maxWorkers=1
```

## What each package's evidence actually is

| Package | Native evidence | In-Node contract evidence | Honest limits |
| --- | --- | --- | --- |
| `@fluojs/platform-bun` | `bun/bun-native.test.ts` spawns the real Bun 1.4.0 runtime: `Bun.serve()` listener on port `0`, real HTTP fetch, `SIGTERM`-driven graceful close (exit code `0`) observed by a DI `OnApplicationShutdown` hook writing a sentinel file. | `bun/bun-adapter-contract.test.ts` runs the public adapter factory under Node.js: `BUN_ADAPTER_INVALID_OPTION` validation at construction, `BUN_ADAPTER_RUNTIME_UNAVAILABLE` through a full `FluoFactory.create(...)` + `app.listen()`, and `close()` before `listen()`. | No TLS, no websocket binding (owned by `@fluojs/websockets/bun`), no mid-flight drain or 503-ingress assertion over a real socket; those are covered by `packages/platform-bun/src/adapter.test.ts` with a Bun server double. |
| `@fluojs/platform-deno` | `deno/deno-native.test.ts` spawns the real Deno 2.9.7 runtime: `Deno.serve` listener on port `0`, real HTTP fetch, `SIGTERM` graceful close (exit code `0`) observed by a DI `OnApplicationShutdown` hook. | Same file asserts the sentinel body `shutdown signal=SIGTERM`. | No HTTPS (`https.cert`/`key`), no websocket binding (owned by `@fluojs/websockets/deno`), no injected `serve`/`upgradeWebSocket` seam assertions, no mid-flight drain/503; covered by `packages/platform-deno/src/adapter.test.ts` and `fetch-handler.test.ts`. |
| `@fluojs/platform-cloudflare-workers` | None available: no `workerd`/`miniflare`/`wrangler` exists in this environment, so nothing here proves deployed-isolate behavior. | `cloudflare-workers/cloudflare-workers.test.ts` runs the real adapter in the Node vitest runtime with real `Request` objects and a recording `executionContext`: waitUntil lifecycle settling, env attachment at the adapter dispatch boundary, deterministic 503 gating during close, `listen()`-while-draining rejection, lazy-host generation restart (bootstrap hooks rerun), and `fromEnv` factory caching across restarts. | No WebSocketPair upgrade (needs `globalThis.WebSocketPair` or an injected pair factory), no SSE body tracking assertion, no isolate eviction or edge networking claim. Local Web conformance only, matching `src/portability-smoke.test.ts`'s own framing. |

The vitest tests import public package names (`@fluojs/platform-bun`, `@fluojs/platform-deno`,
`@fluojs/platform-cloudflare-workers`), which the workspace vitest config aliases to package
sources. The spawned Bun/Deno fixture apps import the same workspace sources through relative
paths so the children never depend on a concurrent `dist` build and never resolve bare
`@fluojs/*` specifiers from an unrelated `node_modules` ancestry (Bun otherwise falls back to
its global install cache, which is not a worktree-head guarantee).

## Commands and results

Environment: macOS arm64 (Darwin 27.2.0), Node v24.20.0, bun 1.4.0, deno 2.9.7, pnpm 10.4.1.
Checkout: worktree `/Users/ayden/Documents/fluo/.worktrees/docs-foundation`, head `e0c73126e`
(`fix(deps): resolve 60 open Dependabot alerts with patched version floors (#3816)`).

1. First run (before fixes): `2 failed | 2 passed (4)` / `2 failed | 9 passed (10)`.
   - Deno child never started: the fixture app used bare `@fluojs/core`/`@fluojs/http`
     imports, which Deno requires to be declared package.json dependencies
     (`error: Import "@fluojs/http" not a dependency`). Fixed by importing all workspace
     sources through relative paths in both spawned apps.
   - Workers env assertion read `context.request.cloudflare?.env` inside a handler and got
     `null` — see the discrepancy below; the fixture was rewritten to assert the
     attachment at the adapter dispatch boundary instead.
2. Second run: `Test Files 4 passed (4)`, `Tests 10 passed (10)`, exit `0` (~2.0s).
3. Third run (stability repeat, same command): `Test Files 4 passed (4)`,
   `Tests 10 passed (10)`, exit `0` (~2.1s).

Diagnostic checks with no failures: `lsp_diagnostics` over
`tooling/docs/fixtures/package-guides/native-platforms` (7 files, 0 diagnostics).

## Known discrepancies found while sourcing the guides

1. **`app.getHttpDispatcher()` does not exist.**
   `packages/platform-bun/README.md` (EN/KO) and
   `apps/docs/content/docs/guides/runtime-adapters.mdx` tell readers to pass
   `app.getHttpDispatcher()` to `createBunFetchHandler(...)`. No such method exists in
   `packages/runtime/src` (`Application` exposes `readonly dispatcher`). The guides written
   by this workstream use `app.dispatcher`. The stale references are owned by the lead and
   left untouched.
2. **`request.cloudflare` never reaches middleware or handlers through the real dispatcher.**
   `CloudflareWorkerHttpApplicationAdapter.fetch` attaches
   `frameworkRequest.cloudflare = { env, executionContext }` at its dispatch boundary
   (`packages/platform-cloudflare-workers/src/adapter.ts`,
   `createRequestResponseFactory`), and the owning README documents handler-level access
   (`context.request.cloudflare?.env`, including a complete example). However
   `createDispatchRequest` in `packages/http/src/dispatch/dispatcher.ts` rebuilds the
   framework request from a fixed property allowlist (cookies, headers, query, body,
   connection, headRouting, method, params, path, raw, rawBody, requestId, isAborted,
   signal, url, files, principal, native-route handoff) and drops `cloudflare`.
   Reproduced with the real dispatcher: a module middleware observed exactly the allowlist
   keys and `request.cloudflare === undefined`; the owning package's own test passes only
   because it dispatches through a minimal fake dispatcher that receives the pre-clone
   object. Runtime code is outside this workstream's write scope, so the fixture asserts
   the adapter-boundary contract and this file records the gap. Affected claims:
   `packages/platform-cloudflare-workers/README.md` (Behavior Notes + the
   `WorkerBindingsModule` example) and the handler example in
   `apps/docs/content/docs/guides/runtime-adapters.mdx`. The package guide written here
   documents the attachment boundary and flags handler-level reads as pending the owner's
   fix.

## Unexecuted scope

- No Cloudflare Workers isolate (`workerd`) execution, no `wrangler dev`/deploy, no real
  `WebSocketPair` upgrade, no D1/KV binding integration.
- No Bun/Deno HTTPS/TLS listeners, no websocket gateway traffic on any of the three
  platforms (realtime bindings belong to the `@fluojs/websockets` workstream's guides).
- No multipart streaming or raw-body capture assertions on real sockets; shared-parser
  behavior is covered by the packages' own suites and the shared portability harness
  (`packages/testing/src/portability/web-runtime-adapter-portability.test.ts`).
- No signal-registration rollback or `AggregateError` assertions under native runtimes;
  those are package-test seams with injected hosts.

See `evidence.json` for the machine-readable per-package mapping.
