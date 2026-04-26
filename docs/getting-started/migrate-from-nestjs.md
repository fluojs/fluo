# NestJS → fluo Migration Map

<p><strong><kbd>English</kbd></strong> <a href="./migrate-from-nestjs.ko.md"><kbd>한국어</kbd></a></p>

Use this document as a migration contract map. Each row identifies the closest allowed fluo target for a NestJS construct, and each rule below marks the places where the migration is not one-to-one.

## API Correspondence Table

Apply the fluo construct in the second column, not the NestJS source pattern, when migrating production code.

| NestJS construct | fluo construct | Notes |
| --- | --- | --- |
| `@Module({ imports, controllers, providers, exports })` | `@Module({ imports, controllers, providers, exports })` from `@fluojs/core` | Module boundaries and explicit exports remain the primary composition unit. |
| `@Controller('/users')` | `@Controller('/users')` from `@fluojs/http` | Controller decoration is part of the HTTP package, not the core package. |
| `@Get()`, `@Post()`, other route decorators | `@Get()`, `@Post()`, other route decorators from `@fluojs/http` | HTTP route decoration remains method-based. |
| `NestFactory.create(AppModule)` | `FluoFactory.create(AppModule, { adapter })` from `@fluojs/runtime` | Bootstrap requires an explicit platform adapter such as `createFastifyAdapter()`. |
| `@Injectable()` provider marker | provider class listed in `@Module(...).providers` | fluo does not use `@Injectable()` as a required provider registration step. |
| constructor type reflection via `emitDecoratorMetadata` | `@Inject(TokenA, TokenB)` from `@fluojs/core` | Constructor dependencies are declared explicitly in decorator argument order. |
| `class-validator` / decorator-driven DTO validation | `@fluojs/validation` with Standard Schema support | Current validation direction is Standard Schema based, including Zod and Valibot support. |
| `createApplicationContext()` standalone bootstrap | `FluoFactory.createApplicationContext(AppModule)` | Standalone application context exists in `@fluojs/runtime`. |

## Breaking Differences

- Decorators MUST follow the TC39 standard model. NestJS legacy decorator assumptions do not carry over.
- Dependency injection is NEVER inferred from constructor types. fluo requires explicit `@Inject(...)` declarations for constructor dependencies.
- Bootstrap is adapter-first. `FluoFactory.create(...)` REQUIRES an `adapter` option instead of selecting the HTTP platform implicitly.
- Validation MUST be migrated to the Standard Schema direction instead of keeping a `class-validator`-first contract.
- Controller decorators MUST be imported from `@fluojs/http`, while structural decorators such as `@Module` come from `@fluojs/core`.

## Removed Concepts

- `@Injectable()` as the default provider marker. Provider registration happens through the module `providers` array.
- Reflection-driven constructor resolution through `reflect-metadata`.
- Implicit DI based on emitted design-time types.
- Legacy decorator compiler mode as a framework requirement.
- Assuming every documented platform is part of `fluo new`; starter coverage is defined separately in the support matrix.

## tsconfig Changes

Migration MUST remove legacy NestJS-era decorator assumptions from `tsconfig.json`.

```json
{
  "compilerOptions": {
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false
  }
}
```

- `experimentalDecorators` is not part of the required fluo baseline and MUST remain disabled.
- `emitDecoratorMetadata` is not used for DI wiring and MUST remain disabled.
- Code that depended on metadata emission or `reflect-metadata` MUST be migrated to explicit tokens and explicit registration.

## CLI Migration Preview

`fluo migrate` runs in dry-run mode by default. Use it to inspect the NestJS-to-fluo codemod report before writing any files:

```bash
fluo migrate ./src
fluo migrate ./src --json
```

Use `--apply` only after reviewing the report and warnings:

```bash
fluo migrate ./src --apply
fluo migrate ./src --apply --json
```

Human-readable output is the default. Add `--json` when CI jobs, dashboards, or migration reports need stable machine-readable output. JSON mode writes only the structured migration report to stdout on success. Parser errors and invalid flag combinations still write their message to stderr, return exit code `1`, and do not emit partial JSON.

The JSON report includes `mode` (`dry-run` or `apply`), `dryRun`, `apply`, enabled `transforms`, `scannedFiles`, `changedFiles`, aggregate `warningCount`, and per-file metadata. Each file entry records `filePath`, whether the file changed, applied transforms, warning count, and warning details with category labels and source line numbers.

The codemod can rewrite imports, remove `@Injectable()`, map provider scopes, update decorator compiler flags, and rewrite `baseUrl` path alias configuration. It does not remove the need for manual review. Treat every warning category as a post-codemod checklist item before accepting the migration.

## Related Docs

- [NestJS Parity Gaps](../contracts/nestjs-parity-gaps.md)
- [DI and Modules](../architecture/di-and-modules.md)
- [Decorators and Metadata](../architecture/decorators-and-metadata.md)
- [fluo new Support Matrix](../reference/fluo-new-support-matrix.md)
