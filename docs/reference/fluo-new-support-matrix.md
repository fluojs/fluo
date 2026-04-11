# fluo new support matrix

<p><strong><kbd>English</kbd></strong> <a href="./fluo-new-support-matrix.ko.md"><kbd>한국어</kbd></a></p>

Use this page to distinguish what `fluo new` scaffolds today from the broader runtime and adapter ecosystem that fluo documents elsewhere.

## current starter coverage vs broader ecosystem support

| surface | status today | what is wired into `fluo new` | where to go next |
| --- | --- | --- | --- |
| **Application starter** | **Scaffolded now** | Node.js + HTTP via `--shape application --transport http --runtime node --platform fastify|express|nodejs` | Fastify remains the default starter baseline when you omit `--platform`; Express and raw Node.js are also first-class starters now. |
| **Microservice starter** | **Scaffolded now** | Node.js + no HTTP platform + TCP via `--shape microservice --transport tcp --runtime node --platform none` | Additional transport families are documented separately, but the runnable starter emitted by `new` is TCP today. |
| **Mixed starter** | **Scaffolded now** | Node.js + Fastify HTTP app + attached TCP microservice via `--shape mixed --transport tcp --runtime node --platform fastify` | This is the only published mixed starter variant today. |
| **Broader adapter/runtime ecosystem** | **Partially scaffolded, partially docs-only** | `@fluojs/platform-bun`, `@fluojs/platform-deno`, and `@fluojs/platform-cloudflare-workers` remain documented runtime paths outside the current `fluo new` starter matrix. `@fluojs/platform-express` and `@fluojs/platform-nodejs` are now first-class application starter choices. | Use the runtime/package docs below to adopt the remaining docs-only adapters after scaffolding or in hand-authored setups. |

## how to read other docs

- Treat `fluo new` docs as a starter contract, not as a promise that every documented adapter already has a starter preset.
- Treat runtime and package reference docs as the broader ecosystem map for adapters, platforms, and deployment targets you can adopt outside the current starter matrix.
- When a page mentions Bun, Deno, or Cloudflare Workers, read that as ecosystem support unless it explicitly points back to one of the three starter rows above. Express and raw Node.js now belong to the application starter row as well as the wider package ecosystem.

## authoritative sources

- `packages/cli/src/new/resolver.ts` is the source of truth for the currently scaffolded `fluo new` matrix.
- [Package Surface](./package-surface.md#canonical-runtime-package-matrix) is the source of truth for the broader runtime/package ecosystem.
- [Bootstrap Paths](../getting-started/bootstrap-paths.md), [Package Chooser](./package-chooser.md), and [Migrate from NestJS](../getting-started/migrate-from-nestjs.md) should link here whenever they discuss adapters that are not starter presets yet.
