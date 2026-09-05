# Node.js Support

<p><strong><kbd>English</kbd></strong> <a href="./node-support.ko.md"><kbd>한국어</kbd></a></p>

## Support matrix

The private root workspace and 34 Node-bound public packages declare `engines.node: ">=24.0.0 <27"`. Adopting Node 24 LTS is a lifecycle and support-policy decision, not a claim that a dependency or a new runtime API requires Node 24. Node 20 and Node 22 are no longer supported by this major release.

| Runtime | CI verification | Release role |
| --- | --- | --- |
| Exact Node `24.0.0` | Frozen install, full `pnpm verify`, generated starter sandbox matrix | Minimum supported floor, not the release runtime |
| Latest Node `24.x` | Frozen install, canonical `pnpm verify`, `pnpm verify:docs`, generated starter sandbox matrix | Canonical development and Changesets release runtime |
| Latest Node `26.x` | Frozen install, full `pnpm verify`, generated starter sandbox matrix | Forward verification only; never publish |
| Bun, Deno, Cloudflare Workers | Their existing independent adapter/native-runtime lanes | Runtime-native deployment contracts |

The `node-support` job in `.github/workflows/ci.yml` is required by the aggregate `verify` gate. Every matrix entry runs the full build, typecheck, lint, and test suite through `pnpm verify`; the focused `test:node-floor` command remains available for local checks, not as a substitute for full CI verification. It covers manifest classification, all scaffold profiles, config env-file/watch behavior, the published portable runtime import, Node HTTP listeners, adapter portability, and the existing Vite compatibility seam. CI does not substitute a later 24.x patch for the exact 24.0.0 claim.

## Portable package boundaries

These eight public roots intentionally omit `engines.node`: `@fluojs/config`, `@fluojs/email`, `@fluojs/i18n`, `@fluojs/platform-bun`, `@fluojs/platform-cloudflare-workers`, `@fluojs/platform-deno`, `@fluojs/react`, and `@fluojs/runtime`. Do not restore engines merely to match neighboring manifests.

Package-wide Node metadata is not a claim about every conditional export or runtime-native adapter. Existing Bun, Deno, and Workers behavior remains governed by each package's README. Config's in-memory root stays portable; env-file/default `.env` loading and watch mode are Node-only features supported on `>=24.0.0 <27`. Their existing capability guard still raises `CONFIG_RUNTIME_UNAVAILABLE` when the host cannot supply the builtin boundary. There is no new Node version check at import or feature invocation.

Generated Node HTTP (Fastify, Express, raw Node), mixed, all seven microservice transports, and React SSR + Fastify starters declare the same engine range, build for `node24`, and use `@types/node@^24.0.0`. Bun and Deno engines and native build/start commands remain unchanged. Workers' existing Node engine describes local CLI/Wrangler tooling, not the deployed isolate.

## Migration

1. Before upgrading affected packages, replace Node 20/22 local installations, CI runners, and deployment hosts with latest Node 24 LTS. Use `>=24.0.0 <27` for the application's `engines.node`; do not use `--ignore-engines` as a migration.
2. Replace container base images such as `node:20-slim` with `node:24-slim` in both build and runtime stages. Rebuild the image and reinstall dependencies, including native addons, under the new runtime.
3. Existing generated Node projects are not rewritten by upgrading the CLI. Update their Vite server build target from `node20` to `node24` and their Node typings to `@types/node@^24.0.0`; refresh the lockfile with the project's selected package manager.
4. Run the application's install, build, typecheck, and tests on Node 24. Check its HTTP listener and microservice startup/shutdown, or the first React page and hydration when applicable. Keep exact `24.0.0` and latest `26.x` checks if the application advertises this complete range.
5. For non-Node deployments, retain native engine metadata and deployment commands. Upgrade only Node-hosted developer tooling. Pass explicit in-memory config maps on portable hosts instead of assuming Node env-file/watch support.

This change includes major Changesets for narrowed public Node support, including config's Node-only feature support. #3679 reconciles the coordinated release; package versions are not changed here and publishing remains exclusive to the canonical GitHub Actions Changesets workflow.
