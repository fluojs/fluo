# fluo new support matrix

<p><strong><kbd>English</kbd></strong> <a href="./fluo-new-support-matrix.ko.md"><kbd>한국어</kbd></a></p>

Use this page to distinguish what `fluo new` scaffolds today from the broader runtime and adapter ecosystem that fluo documents elsewhere.

## current starter coverage vs broader ecosystem support

| surface | status today | what is wired into `fluo new` | where to go next |
| --- | --- | --- | --- |
| **Application starter** | **Scaffolded now** | Node.js + Fastify + HTTP via `fluo new my-app` or `--shape application --transport http --runtime node --platform fastify` | This is the default starter baseline today. |
| **Microservice starter** | **Scaffolded now** | Node.js + no HTTP platform + TCP via `--shape microservice --transport tcp --runtime node --platform none` | Additional transport families are documented separately, but the runnable starter emitted by `new` is TCP today. |
| **Mixed starter** | **Scaffolded now** | Node.js + Fastify HTTP app + attached TCP microservice via `--shape mixed --transport tcp --runtime node --platform fastify` | This is the only published mixed starter variant today. |
| **Broader adapter/runtime ecosystem** | **Documented, not wired into `fluo new` yet** | `@fluojs/platform-express`, `@fluojs/platform-nodejs`, `@fluojs/platform-bun`, `@fluojs/platform-deno`, and `@fluojs/platform-cloudflare-workers` are real package/runtime paths, but they are not current `fluo new` starter choices. | Use the runtime/package docs below to adopt these adapters after scaffolding or in hand-authored setups. |

## how to read other docs

- Treat `fluo new` docs as a starter contract, not as a promise that every documented adapter already has a starter preset.
- Treat runtime and package reference docs as the broader ecosystem map for adapters, platforms, and deployment targets you can adopt outside the current starter matrix.
- When a page mentions Express, Bun, Deno, or Cloudflare Workers, read that as ecosystem support unless it explicitly points back to one of the three starter rows above.

## authoritative sources

- `packages/cli/src/new/resolver.ts` is the source of truth for the currently scaffolded `fluo new` matrix.
- [Package Surface](./package-surface.md#canonical-runtime-package-matrix) is the source of truth for the broader runtime/package ecosystem.
- [Bootstrap Paths](../getting-started/bootstrap-paths.md), [Package Chooser](./package-chooser.md), and [Migrate from NestJS](../getting-started/migrate-from-nestjs.md) should link here whenever they discuss adapters that are not starter presets yet.
