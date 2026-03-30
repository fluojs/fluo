# generator workflow

<p><strong><kbd>English</kbd></strong> <a href="./generator-workflow.ko.md"><kbd>한국어</kbd></a></p>

This guide outlines the CLI generator system and available schematics for Konekti.

## command syntax

```sh
konekti generate <schematic> <name>
konekti g <schematic> <name>
```

## available schematics

| Schematic | Alias |
| --- | --- |
| `controller` | `co` |
| `guard` | `gu` |
| `interceptor` | `in` |
| `middleware` | `mi` |
| `module` | `mo` |
| `repository` | `repo` |
| `request-dto` | `req` |
| `response-dto` | `res` |
| `service` | `s` |

## generation conventions

- **Language**: All files are generated in TypeScript.
- **Naming**: Uses kebab-case for filenames and PascalCase for classes.
- **Location**: Files are written to the `src/` directory by default in starter applications.
- **Module Updates**: Generators automatically register new components in the appropriate module.

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

## further reading

- `./quick-start.md`
- `./bootstrap-paths.md`
- `../reference/toolchain-contract-matrix.md`
