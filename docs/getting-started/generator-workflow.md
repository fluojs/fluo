# CLI Generator Reference

<p><strong><kbd>English</kbd></strong> <a href="./generator-workflow.ko.md"><kbd>한국어</kbd></a></p>

`fluo generate` and `fluo g` create feature-slice files under a resolved source directory. The shipped generator set covers modules, HTTP entrypoints, providers, middleware, and DTO stubs.

## Available Generators

```bash
fluo generate <generator> <name> [--target-directory <path>] [--force] [--dry-run]
fluo g <generator> <name> [--target-directory <path>] [--force] [--dry-run]
fluo g request-dto <feature> <name> [--target-directory <path>] [--force] [--dry-run]
```

| Generator | Accepted tokens | Example syntax | Wiring | Output scope |
| --- | --- | --- | --- | --- |
| Module | `module`, `mo` | `fluo generate module Billing` | Files only | Standalone module file |
| Controller | `controller`, `co` | `fluo g controller Billing` | Auto-registered | Controller file, test file, module update |
| Service | `service`, `s` | `fluo g service Billing` | Auto-registered | Service file, test file, module update |
| Repository | `repo`, `repository` | `fluo g repo Billing` | Auto-registered | Repository file, unit test, slice test, module update |
| Guard | `guard`, `gu` | `fluo generate guard Billing` | Auto-registered | Guard file, module update |
| Interceptor | `interceptor`, `in` | `fluo generate interceptor Billing` | Auto-registered | Interceptor file, module update |
| Middleware | `middleware`, `mi` | `fluo generate middleware Billing` | Auto-registered | Middleware file, module update |
| Request DTO | `request-dto`, `req` | `fluo generate request-dto billing CreateBilling` | Files only | Request DTO file |
| Response DTO | `response-dto`, `res` | `fluo generate response-dto Billing` | Files only | Response DTO file |

Auto-registered generators create or update the slice module and append the generated class to `controllers`, `providers`, or `middleware`. Files-only generators emit files without parent-module registration.

## Generated Artifacts

Most generator outputs are written under `<resolved-target>/<plural-resource>/`. For `fluo g service Post`, the slice directory is `src/posts/` when the resolved target directory is `src/`. Request DTOs also accept an explicit feature target: `fluo g req posts CreatePost` writes into `src/posts/` instead of deriving a `create-posts/` directory from the DTO class name.

| Generator | Files emitted in the slice directory | Module effect |
| --- | --- | --- |
| Module | `post.module.ts` | None. Import into a parent module separately. |
| Controller | `post.controller.ts`, `post.controller.test.ts` | Creates or updates `post.module.ts`, adds `PostController` to `controllers`. |
| Service | `post.service.ts`, `post.service.test.ts` | Creates or updates `post.module.ts`, adds `PostService` to `providers`. |
| Repository | `post.repo.ts`, `post.repo.test.ts`, `post.repo.slice.test.ts` | Creates or updates `post.module.ts`, adds `PostRepo` to `providers`. |
| Guard | `post.guard.ts` | Creates or updates `post.module.ts`, adds `PostGuard` to `providers`. |
| Interceptor | `post.interceptor.ts` | Creates or updates `post.module.ts`, adds `PostInterceptor` to `providers`. |
| Middleware | `post.middleware.ts` | Creates or updates `post.module.ts`, adds `PostMiddleware` to `middleware`. |
| Request DTO | `create-post.request.dto.ts` in `posts/` when using `fluo g req posts CreatePost` | None. Import into controllers manually. |
| Response DTO | `post.response.dto.ts` | None. Use as a controller return type manually. |

Controller and service templates inspect sibling files before rendering. A controller stub imports `post.service.ts` only when that service file already exists in the same slice. A service stub imports `post.repo.ts` only when the repository file already exists in the same slice.

## Options

| Option | Alias | Applies to | Behavior |
| --- | --- | --- | --- |
| `--target-directory <path>` | `-o` | All generators | Writes the slice under the provided source directory. |
| `--force` | `-f` | All generators | Overwrites existing generated files instead of skipping them. |
| `--dry-run` | None | All generators | Prints the planned creates, skips, overwrites, and module updates without creating directories, writing files, or updating modules. |
| `--help` | `-h` | `fluo generate`, `fluo g` | Prints generate-command usage and generator metadata. |

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
- Unchanged file content is not rewritten, even when the command resolves auto-registration metadata.
- Module auto-registration is limited to controller, service, repository, guard, interceptor, and middleware generators.
- DTO and module generators do not wire parent-module imports automatically.
- The generate command surface documents `--target-directory`, `--force`, `--dry-run`, and `--help`.
