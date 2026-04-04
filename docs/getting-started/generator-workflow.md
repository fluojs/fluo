# generator workflow

<p><strong><kbd>English</kbd></strong> <a href="./generator-workflow.ko.md"><kbd>한국어</kbd></a></p>

This guide outlines the CLI generator system and available schematics for Konekti.

## command syntax

```sh
konekti generate <schematic> <name>
konekti g <schematic> <name>
```

## available schematics

| Schematic | Alias | Wiring |
| --- | --- | --- |
| `controller` | `co` | auto |
| `guard` | `gu` | auto |
| `interceptor` | `in` | auto |
| `middleware` | `mi` | auto |
| `module` | `mo` | manual |
| `repository` | `repo` | auto |
| `request-dto` | `req` | manual |
| `response-dto` | `res` | manual |
| `service` | `s` | auto |

### wiring behavior

Generators have one of two wiring behaviors:

- **auto** — the generated class is auto-registered in the domain module. If the module file does not exist yet, the CLI creates it. The module's `controllers`, `providers`, or `middleware` array is updated automatically.
- **manual** — files only. The generated class is not registered anywhere automatically. You must wire it into a module or controller yourself. The CLI prints a next-step hint with specific instructions after generation.

After running any generator, the CLI output shows:
1. A `CREATE` line for each generated file.
2. A **Wiring** status line indicating whether the class was auto-registered or requires manual wiring.
3. A **Next steps** hint with the recommended follow-up action (e.g., run `pnpm typecheck`, import a DTO, etc.).

## generation conventions

- **Language**: All files are generated in TypeScript.
- **Naming**: Uses kebab-case for filenames and PascalCase for classes.
- **Location**: Files are written to the `src/` directory by default in starter applications.
- **Module Updates**: Generators with `auto` wiring automatically register new components in the appropriate module. Generators with `manual` wiring produce files only — you wire them yourself.

### example output

- `user.controller.ts`
- `user.service.ts`
- `user.repo.ts`
- `user.request.dto.ts`
- `user.response.dto.ts`

## implementation philosophy

- **Granular Generation**: Use individual generators to build application components.
- **DTO Separation**: Request and response DTOs are kept distinct to ensure clear API contracts.
- **No Monolithic Resources**: The CLI currently avoids complex "resource" generators (e.g., `g resource`) to maintain simplicity.
- **Neutrality**: Scaffolding remains package-manager-neutral, except for manager-specific lockfiles and commands.

## module entrypoint naming governance

Generated snippets and migration hints follow the repository-wide public module syntax contract:

- Runtime module entrypoints: `forRoot(...)`, optional `forRootAsync(...)`, `register(...)`, `forFeature(...)`
- Helper/builders only: `create*`

Treat `../reference/package-surface.md` as the source-of-truth when adding or updating CLI-facing module naming guidance.

## further reading

- `./quick-start.md`
- `./bootstrap-paths.md`
- `../reference/toolchain-contract-matrix.md`
