# quick start

<p><strong><kbd>English</kbd></strong> <a href="./quick-start.ko.md"><kbd>한국어</kbd></a></p>

This guide outlines the standard bootstrap process for Konekti.

> [!IMPORTANT]
> Konekti uses TC39 standard decorators (TypeScript 5.0+). Do not enable legacy decorator flags in your `tsconfig.json`:
> - Avoid setting `"experimentalDecorators": true`.
> - Avoid setting `"emitDecoratorMetadata": true`.
>
> Unlike NestJS, Konekti does not rely on legacy decorators or metadata emission. Standard TypeScript configuration is sufficient.

## canonical bootstrap path

The recommended way to start a new project is via the Konekti CLI:

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

Alternatively, you can use `dlx` for a one-time execution without a global installation:

```sh
pnpm dlx @konekti/cli new starter-app
```

### related documentation

- `./bootstrap-paths.md`
- `./generator-workflow.md`
- `../reference/package-surface.md`

## generated starter structure

A newly generated application includes:

- `src/main.ts`: Application entry point with Node bootstrap.
- `src/app.ts`: Main module configuration.
- Built-in `/health` and `/ready` endpoints.
- A sample `health/` module at `/health-info/`.
- A baseline test suite to verify application startup and dispatching.

## project commands

Run these commands from your project root:

```sh
pnpm dev        # Start development server
pnpm typecheck  # Run TypeScript type checks
pnpm build      # Build for production
pnpm test       # Run tests
```

The scaffold generates a consistent layout compatible with `pnpm`, `npm`, and `yarn`.

## development mode behavior

`pnpm dev` uses the generated Node watch runner, so source-code edits trigger a **process restart** rather than in-process HMR.

Config file changes can use a narrower **in-process config reload** path when the app bootstraps with `watch: true`.

For the ownership split and exact guarantees, see `../concepts/dev-reload-architecture.md`.

## generating components

To generate a new repository:

```sh
konekti g repo User
```

The CLI writes generated files to the `src/` directory by default.

## dto validation

Note that DTO binding and validation are handled by separate packages:

```ts
import { FromBody } from '@konekti/http';
import { IsString, MinLength } from '@konekti/dto-validator';
```

## upgrade policy

- Minor releases maintain stable command sets and file structures.
- Major releases may involve breaking changes to public contracts, potentially requiring manual updates or codemods.
- In-repo utility commands are for internal development and are not part of the public API.
