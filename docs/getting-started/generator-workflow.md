# generator workflow

<p><strong><kbd>English</kbd></strong> <a href="./generator-workflow.ko.md"><kbd>한국어</kbd></a></p>


This file describes the current CLI generator surface.

## command shape

```sh
konekti generate <kind> <name>
konekti g <kind> <name>
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

## output conventions

- files are generated in TypeScript
- names use kebab-case filenames and PascalCase classes
- generators write into `src/` by default in starter apps
- generators update the target module when the schematic participates in module registration

Examples:

- `user.controller.ts`
- `user.service.ts`
- `user.repo.ts`
- `user.request.dto.ts`
- `user.response.dto.ts`

## current generator philosophy

- individual generators are the default path
- `g resource` is not part of the current default CLI model
- request and response DTOs are intentionally split into separate schematics
- scaffold and generator output stay package-manager-neutral apart from package-manager-aware commands and lockfiles

## related docs

- `./quick-start.md`
- `../reference/naming-and-file-conventions.md`
- `../../packages/cli/README.md`
