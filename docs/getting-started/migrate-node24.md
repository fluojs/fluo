# Upcoming Node 24 Release Migration

<p><strong><kbd>English</kbd></strong> <a href="./migrate-node24.ko.md"><kbd>한국어</kbd></a></p>

## Release preparation status

This guide prepares consumers for the coordinated release in #3679, part of #3169.
It does not announce an npm release or a documentation deployment. The maintainer
owns the actual release and publication of these migration documents. Run the
package-upgrade examples only after the maintainer makes the release available.

The current public manifest set contains 42 packages. All 41 stable (`1.0+`)
packages have explicit `major` Changeset intent. `@fluojs/react@0.1.0` has `minor`
intent for `0.2.0`, stays on `0.x`, and is not graduating to `1.0`. These are
per-package bumps, not one shared version number. Pending feature and fix notes,
including the listener, Vite compatibility, Vitest peer, and generated-starter
changes, contribute to one next Changesets release per package.

Follow this order: **Node everywhere first, Fluo packages second, moved imports
third**, then configuration and toolchain adjustments.

## 1. Upgrade Node everywhere

Move local development, CI runners, container build and runtime stages, and
production hosts to Node.js `>=24.0.0 <27` before installing the new Fluo packages.
Use latest Node 24 LTS for the normal development and production path. Node 20
and Node 22 support is removed; all versions below 24 and Node 27+ are unsupported.
This is a support-policy decision, not a claim that a new dependency requires
Node 24.

- Update version-manager pins, CI `node-version`, and application `engines.node`.
  Verify `node --version` in each environment, not only in the interactive shell.
- Replace images such as `node:20-slim` or `node:22-slim` with `node:24-slim` in
  **both** container stages. Rebuild images and reinstall dependencies and native
  addons under the new runtime. Do not bypass the migration with `--ignore-engines`.
- Keep the lockfile, refresh it under Node 24 when updating dependencies, and use
  the refreshed lockfile for frozen CI installs.
- Exact Node `24.0.0`, latest `24.x`, and latest `26.x` are distinct verification
  targets. Test those targets if your application advertises the full range.
  Latest Node `24.x` owns Fluo release automation; Node 26 is never a publish runtime.

The eight engine omissions below remain intentional. Bun, Deno, and Cloudflare
Workers deployments keep their native runtime metadata and deployment commands.
Upgrade Node-hosted CLI/build tooling separately; Workers' starter Node engine
describes local CLI/Wrangler tooling, not the deployed isolate.

## 2. Upgrade the Fluo package set together

Inventory direct dependencies and development dependencies with
`pnpm list --depth 0`. After publication, select each installed package's
coordinated version from the Changesets-generated release notes, including
platform adapters and optional integrations. Do not leave a direct dependency on
an old major while assuming dependency propagation migrates its contract.

For example, an application using the runtime, config, and raw Node adapter
would update those packages and its installed tooling as follows:

```bash
pnpm add @fluojs/runtime@^3 @fluojs/config@^2 @fluojs/platform-nodejs@^2
pnpm add -D @fluojs/cli@^3 @fluojs/testing@^3 @fluojs/vite@^2
```

This is not the complete package set for every application. Include its direct
`@fluojs/core`, `@fluojs/di`, `@fluojs/http`, adapters, and integrations at their
own coordinated majors. Update an installed global CLI separately if you use one.
Read each package's retained feature and breaking-change notes as well as this
program guide; the guide does not replace unrelated migrations.

React consumers select the `0.2` line explicitly:

```bash
pnpm add @fluojs/react@^0.2.0
```

Do not request React `1.0` or infer graduation from other packages' major bumps.
The pending Vite patch notes and CLI minor notes are retained, but aggregate with
this coordinated major intent; they do not schedule a second release.

## 3. Replace moved Node imports

Install `@fluojs/platform-nodejs` as a direct dependency wherever your application
or integration imports its Node helpers, then update source, tests, and tooling:

| Removed import | Replacement |
| --- | --- |
| `@fluojs/runtime/node` | `@fluojs/platform-nodejs` |
| `@fluojs/runtime/internal-node` | `@fluojs/platform-nodejs/internal` |

```ts
import {
  createNodeHttpAdapter,
  runNodeApplication,
} from '@fluojs/platform-nodejs';
```

The moved symbols retain their names; no compatibility shim remains at the old
paths. This includes Node listeners, filesystem assets, loggers, compression,
and process-signal helpers. Integration authors using the former internal Node
seam must move to the platform-owned internal seam, not a private source path.
Express and Fastify now consume that same platform-owned boundary.
Portable bootstrap imports stay on `@fluojs/runtime`; fetch-style helpers stay on
`@fluojs/runtime/web`. The custom HTTP method and body-bearing `QUERY` additions
use the final Node 24 support range, not the earlier listener-only Node 20/22 floor.

## 4. Preserve portable configuration boundaries

Do not add `engines.node` to these eight public package roots merely to match
their neighbors:

`@fluojs/config`, `@fluojs/email`, `@fluojs/i18n`, `@fluojs/platform-bun`,
`@fluojs/platform-cloudflare-workers`, `@fluojs/platform-deno`, `@fluojs/react`,
and `@fluojs/runtime`.

Config's in-memory load, merge, validation, clone, and service access remain
portable. Pass application-owned maps and explicitly opt out of env files on
portable hosts:

```ts
import { loadConfig } from '@fluojs/config';

const config = loadConfig({
  envFilePaths: [],
  defaults: { PORT: 3000 },
  processEnv: { PORT: '8080' },
  runtimeOverrides: {},
});
```

Config does not read ambient environment variables automatically. Supply a
snapshot at the application boundary. `loadConfig({})` and
`ConfigModule.forRoot()` still select the default `<cwd>/.env`; that is not an
in-memory-only call. Explicit env files, default `.env` loading, and `watch: true`
are Node-only features supported on `>=24.0.0 <27`.

The existing lazy `process.getBuiltinModule(...)` capability boundary raises
`CONFIG_RUNTIME_UNAVAILABLE` when the host cannot provide the Node builtins.
Use in-memory options or run the feature on Node. This guard is not a Node
version comparison and does not reject portable root imports.

## 5. Migrate the Vite and testing toolchain

Existing generated projects are **not** rewritten when you upgrade the CLI.
For projects adopting the new non-Deno generated baseline, update these together:

```bash
pnpm add -D vite@^8.2.2 vitest@^4.1.11 @vitest/coverage-v8@^4.1.11
```

The workspace verifies Vite `8.2.2` and Vitest `4.1.11`. The published
`@fluojs/vite` peer remains `vite >=6.2.0`; that broad peer contract is not a claim
that generated projects remain on Vite 6. `@fluojs/testing` changes its required
Vitest peer from the previous Vitest 3 line to `^4.1.11`. Upgrade consumers of its
mock helpers and `@fluojs/testing/vitest`, and keep `@babel/core` installed in the
consuming workspace.

1. In ESM Vite configs, migrate `build.rollupOptions` to
   `build.rolldownOptions`, reviewing the application's input, output, and external
   options against Rolldown. Existing Node starters also change the server target
   from `node20` to `node24`, set `engines.node` to `>=24.0.0 <27`, and update
   `@types/node` to `^24.0.0`.
2. Keep `fluoDecoratorsPlugin()` from `@fluojs/vite` for application `.ts`
   decorators before Rolldown/Oxc. Keep `fluoBabelDecoratorsPlugin()` from
   `@fluojs/testing/vitest` as the separate testing transform.
3. Remove the generated Babel `ignore` entry for `src/**/*.test.ts` from your
   existing Babel config. The testing plugin must be allowed to transform
   decorators declared inside tests; the application plugin still skips tests.
4. Keep the Babel decorator proposal setting `version: '2023-11'` and the
   TypeScript preset. Do not enable `experimentalDecorators` or
   `emitDecoratorMetadata`, or replace Babel with direct Oxc/esbuild decorator
   processing. React SSR keeps decorated declarations in `.ts` and JSX in `.tsx`.
5. Preserve Bun/Deno/Workers native build and deployment commands. The Deno
   starter retains its Deno-native toolchain rather than this Vite/Vitest baseline.

## 6. Verify the migrated application

Refresh the lockfile, then run the application's install, build, typecheck, and
tests under Node 24. Exercise the real HTTP listener, startup/shutdown, and any
microservice transports you use. Run driver-specific Drizzle query and migration
tests where applicable. For React SSR, verify the first page, production assets,
and warning-free hydration. Check that tests containing decorated classes execute
through the Babel testing plugin.

Review peer/engine diagnostics and resolve them rather than suppressing them.
An application that cannot yet migrate must stay on its existing release line;
this program does not backport the new boundaries or Node floor to old majors.

## Maintainer release boundary

Changesets remains the only version/changelog generator. The release-preparation
checks are:

```bash
pnpm verify
pnpm verify:docs
pnpm verify:platform-consistency-governance
pnpm verify:release-readiness
pnpm verify:changeset-release-lane -- --lane=stable --base-ref=main
pnpm changeset status --since=main
```

Major intent and migration preparation are approved for this implementation.
Actual publication remains maintainer-owned on `main` through
`.github/workflows/release.yml` and the reviewed Version Packages PR. A passing
local check is not evidence of registry publication or document deployment.
#3169 remains the umbrella until the maintainer-run release.

See [Node.js Support](../reference/node-support.md),
[Toolchain Contract Matrix](../reference/toolchain-contract-matrix.md), and
[Release Governance](../contracts/release-governance.md).
