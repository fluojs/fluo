# quick start

<p><strong><kbd>English</kbd></strong> <a href="./quick-start.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current public bootstrap path for Konekti.

## canonical bootstrap path

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

This is the supported public entrypoint today.

For a one-off zero-install bootstrap, this alternative remains supported:

```sh
pnpm dlx @konekti/cli new starter-app
```

The global-install `pnpm add -g @konekti/cli` + `konekti new ...` path is now the canonical public bootstrap flow.

See also:

- `./bootstrap-paths.md`
- `./generator-workflow.md`
- `../reference/package-surface.md`

## generated starter shape

A new app currently includes:

- `src/main.ts` with runtime-owned Node bootstrap
- `src/app.ts` with starter module wiring
- runtime-owned `/health` and `/ready`
- `/metrics` and `/openapi.json`
- a generic repository example in `src/examples/`
- a starter test proving the app boots and dispatches correctly

## generated project commands

Run these from the generated project root:

```sh
pnpm dev
pnpm typecheck
pnpm build
pnpm test
```

The scaffold emits the same single-project layout for `pnpm`, `npm`, and `yarn`, while keeping install and run commands package-manager aware.

## first generator command

Generate a repository from the project root:

```sh
pnpm exec konekti g repo User
```

The CLI writes files into `src/` by default on generated apps.

## DTO rule to remember

DTO binding and DTO validation come from different packages:

```ts
import { FromBody } from '@konekti/http';
import { IsString, MinLength } from '@konekti/dto-validator';
```

## upgrade expectations

- minor releases keep the documented starter command set and file shapes stable unless a doc explicitly marks a surface as internal-only
- major releases may require codemods or manual edits when public contracts move
- repo-local smoke commands are implementation support, not the public bootstrap contract
