# naming and file conventions

<p><strong><kbd>English</kbd></strong> <a href="./naming-and-file-conventions.ko.md"><kbd>한국어</kbd></a></p>


## generator naming

Default generator naming follows the current CLI suffix rules.

- `user.controller.ts`
- `user.service.ts`
- `user.repo.ts`
- `user.request.dto.ts`
- `user.response.dto.ts`

## generator philosophy

- individual generators are the default path
- `g resource` is not part of the default generator surface
- request DTO and response DTO are separate schematics

## scaffold conventions

- default modes: `dev`, `prod`, `test`
- default env files:
  - `.env.dev`
  - `.env.prod`
  - `.env.test`

## package manager conventions

- the scaffold auto-detects package manager by default
- `--package-manager` is the explicit override
- canonical behavior is documented in `../getting-started/bootstrap-paths.md`
