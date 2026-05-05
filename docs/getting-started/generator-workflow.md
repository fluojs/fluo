# CLI Generator Reference

<p><strong><kbd>English</kbd></strong> <a href="./generator-workflow.ko.md"><kbd>한국어</kbd></a></p>

`fluo generate` and `fluo g` create feature-slice files under a resolved source directory. The shipped generator set covers modules, full resource slices, HTTP entrypoints, providers, middleware, and DTO stubs.

## Available Generators

```bash
fluo generate <generator> <name> [--target-directory <path>] [--force] [--dry-run]
fluo g <generator> <name> [--target-directory <path>] [--force] [--dry-run]
fluo g request-dto <feature> <name> [--target-directory <path>] [--force] [--dry-run]
fluo g e2e <name> [--target-directory <path>] [--force] [--dry-run]
```

| Generator | Accepted tokens | Example syntax | Wiring | Output scope |
| --- | --- | --- | --- | --- |
| Module | `module`, `mo` | `fluo generate module Billing --with-test` | Files only | Standalone module file, optional slice test |
| E2E | `e2e` | `fluo generate e2e Billing` | Files only | App-level e2e-style test under `test/` |
| Controller | `controller`, `co` | `fluo g controller Billing` | Auto-registered | Controller file, test file, module update |
| Service | `service`, `s` | `fluo g service Billing` | Auto-registered | Service file, test file, module update |
| Repository | `repo`, `repository` | `fluo g repo Billing` | Auto-registered | Repository file, unit test, slice test, module update |
| Guard | `guard`, `gu` | `fluo generate guard Billing` | Auto-registered | Guard file, module update |
| Interceptor | `interceptor`, `in` | `fluo generate interceptor Billing` | Auto-registered | Interceptor file, module update |
| Middleware | `middleware`, `mi` | `fluo generate middleware Billing` | Auto-registered | Middleware file, module update |
| Resource | `resource`, `resrc` | `fluo generate resource Billing --with-slice-test` | Files only | Module, controller, service, repository, DTOs, and tests |
| Request DTO | `request-dto`, `req` | `fluo generate request-dto billing CreateBilling` | Files only | Request DTO file |
| Response DTO | `response-dto`, `res` | `fluo generate response-dto Billing` | Files only | Response DTO file |

Auto-registered generators create or update the slice module and append the generated class to `controllers`, `providers`, or `middleware`. Files-only generators emit files without parent-module registration; `resource` creates a complete slice but still leaves parent-module import wiring to the caller.

## Generated Artifacts

Most generator outputs are written under `<resolved-target>/<plural-resource>/`. For `fluo g service Post`, the slice directory is `src/posts/` when the resolved target directory is `src/`. Request DTOs also accept an explicit feature target: `fluo g req posts CreatePost` writes into `src/posts/` instead of deriving a `create-posts/` directory from the DTO class name.

| Generator | Files emitted in the slice directory | Module effect |
| --- | --- | --- |
| Module | `post.module.ts`; add `post.slice.test.ts` with `--with-test` | None. Import into a parent module separately. |
| E2E | `test/post.e2e.test.ts` | None. Imports `AppModule` from the resolved source directory and uses `createTestApp({ rootModule })`. |
| Controller | `post.controller.ts`, `post.controller.test.ts` | Creates or updates `post.module.ts`, adds `PostController` to `controllers`. |
| Service | `post.service.ts`, `post.service.test.ts` | Creates or updates `post.module.ts`, adds `PostService` to `providers`. |
| Repository | `post.repo.ts`, `post.repo.test.ts`, `post.repo.slice.test.ts` | Creates or updates `post.module.ts`, adds `PostRepo` to `providers`. |
| Guard | `post.guard.ts` | Creates or updates `post.module.ts`, adds `PostGuard` to `providers`. |
| Interceptor | `post.interceptor.ts` | Creates or updates `post.module.ts`, adds `PostInterceptor` to `providers`. |
| Middleware | `post.middleware.ts` | Creates or updates `post.module.ts`, adds `PostMiddleware` to `middleware`. |
| Resource | `post.module.ts`, `post.controller.ts`, `post.controller.test.ts`, `post.service.ts`, `post.service.test.ts`, `post.repo.ts`, `post.repo.test.ts`, `post.repo.slice.test.ts`, `create-post.request.dto.ts`, `post.response.dto.ts`; add `post.slice.test.ts` with `--with-slice-test` | None for parent modules. Import the generated module separately. |
| Request DTO | `create-post.request.dto.ts` in `posts/` when using `fluo g req posts CreatePost` | None. Import into controllers manually. |
| Response DTO | `post.response.dto.ts` | None. Use as a controller return type manually. |

Controller and service templates inspect sibling files before rendering. A controller stub imports `post.service.ts` only when that service file already exists in the same slice. A service stub imports `post.repo.ts` only when the repository file already exists in the same slice.

## Options

| Option | Alias | Applies to | Behavior |
| --- | --- | --- | --- |
| `--target-directory <path>` | `-o` | All generators | Writes the slice under the provided source directory. |
| `--force` | `-f` | All generators | Overwrites existing generated files instead of skipping them. |
| `--dry-run` | None | All generators | Prints the planned creates, skips, overwrites, and module updates without creating directories, writing files, or updating modules. |
| `--with-test` | None | `module` | Adds a `*.slice.test.ts` that compiles the authored module with `createTestingModule({ rootModule })`. |
| `--with-slice-test` | None | `resource` | Adds a resource-level `*.slice.test.ts` that demonstrates provider override and service resolution with `createTestingModule({ rootModule })`. |
| `--help` | `-h` | `fluo generate`, `fluo g` | Prints generate-command usage and generator metadata. |

## Generated Test Ladder

- Use generated unit tests (`*.service.test.ts`, `*.controller.test.ts`, `*.repo.test.ts`) for fast behavior checks with direct class construction and explicit fakes.
- Use repository or resource slice tests (`*.slice.test.ts`) when you need DI graph confidence, provider visibility, and override examples through `createTestingModule({ rootModule })`.
- Use `fluo g module <name> --with-test` for a minimal module compilation test before manually wiring providers.
- Use `fluo g resource <name> --with-slice-test` when a generated feature slice should include a module-level provider override pattern in addition to the repo slice test.
- Use `fluo g e2e <name>` for app-level request-pipeline scaffolding. It writes `test/<name>.e2e.test.ts`, imports `AppModule`, calls `createTestApp({ rootModule: AppModule })`, and leaves route expectations for the developer to align with the generated or authored controller.

## Dry-run Preview

Use `--dry-run` before changing a shared workspace or a generated slice that already has hand edits:

```bash
fluo generate service Billing --dry-run
fluo g request-dto billing CreateInvoice --target-directory ./src --dry-run
fluo g controller Billing --force --dry-run
```

Dry-run mode prints `Dry run: no files were written.`, followed by each planned file action. Possible actions include `CREATE`, `SKIP`, `OVERWRITE`, `UNCHANGED`, `MODULE-CREATE`, `MODULE-UPDATE`, and `MODULE-UNCHANGED`. The preview uses the same validation, target-directory resolution, request DTO feature-target parsing, and `--force` overwrite planning as a real run, but it never creates directories, writes generated files, or updates modules.

Auto-registered generators still resolve the module plan during dry-run. Files-only generators such as `module`, `resource`, `request-dto`, and `response-dto` still report their file actions and leave parent-module wiring to the caller.

## Generator Collections

`fluo generate` currently discovers exactly one deterministic collection: `@fluojs/cli/builtin`. It is bundled with `@fluojs/cli`, contains the generator metadata listed above, and is the source of truth for CLI help output, option schemas, aliases, wiring behavior, and tests.

External package-owned or app-local generator collections are intentionally deferred. The CLI does not scan local config files, import arbitrary packages, or execute collection code from the application workspace. Future collection support must remain explicit and reviewable: callers should opt into a known collection source, metadata and option schemas must be testable, and file writes must stay constrained to validated generator outputs under the resolved target directory.

| Resolution rule | Resolved base directory |
| --- | --- |
| Current directory contains `package.json` and `src/` | `<cwd>/src` |
| Current directory contains `apps/` with exactly one app that has `package.json` and `src/` | `<cwd>/apps/<app>/src` |
| Neither condition matches | `<cwd>` |

## Constraints

- Resource names must not be empty.
- Resource names must not start with `-`.
- Resource names must not contain path separators or `..` traversal segments.
- Accepted name characters are letters, numbers, spaces, underscores, and hyphens. The generated file stem is normalized to kebab case.
- Request DTO feature targets use the same validation and normalize to a kebab-case directory name. PascalCase feature names follow the normal resource pluralization (`fluo g req Post CreatePost` writes to `posts/`), while lower-case directory tokens such as `posts` are used as written. The one-name form (`fluo g req CreatePost`) remains supported for compatibility, but the explicit feature form keeps multiple DTOs in one slice.
- A multi-app workspace root with more than one valid `apps/*/src` target requires `--target-directory`.
- Existing files are skipped by default. `--force` is required for overwrite behavior.
- `--dry-run` uses the same validation, default target resolution, `--target-directory`, and request DTO feature-target rules as a real run, but it leaves the workspace unchanged.
- Dry-run output distinguishes files-only generators from auto-registered generators, including whether a module would be created, updated, or left unchanged.
- Combining `--dry-run` with `--force` previews overwrite decisions without applying them.
- `--with-test` is supported only for `module`; unsupported combinations such as `fluo g resource User --with-test` fail with a non-zero exit and guidance to use `--with-slice-test` for resources.
- `--with-slice-test` is supported only for `resource`; unsupported combinations such as `fluo g module User --with-slice-test` fail with a non-zero exit.
- Unchanged file content is not rewritten, even when the command resolves auto-registration metadata.
- Generator discovery is limited to the built-in `@fluojs/cli/builtin` collection; external or app-local collections are deferred and are not loaded by this command.
- Module auto-registration is limited to controller, service, repository, guard, interceptor, and middleware generators.
- Resource, DTO, and module generators do not wire parent-module imports automatically.
- The generate command surface documents `--target-directory`, `--force`, `--dry-run`, `--with-test`, `--with-slice-test`, and `--help`.
