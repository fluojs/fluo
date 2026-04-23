# book-docs-ssot-audit-beginner

## Part Metadata
- Part: `beginner`
- Execution order slot: `1`
- SSOT snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Report path: `docs/audits/book-docs-ssot-audit/beginner.md`
- Assigned chapter list: `book/beginner/ch00-introduction.ko.md` through `book/beginner/ch21-production.ko.md` (`22` chapters)
- Chapter inventory: `book/beginner/ch00-introduction.ko.md`, `book/beginner/ch01-fluo-intro.ko.md`, `book/beginner/ch02-cli-setup.ko.md`, `book/beginner/ch03-modules-providers.ko.md`, `book/beginner/ch04-decorators-intro.ko.md`, `book/beginner/ch05-routing-controllers.ko.md`, `book/beginner/ch06-validation.ko.md`, `book/beginner/ch07-serialization.ko.md`, `book/beginner/ch08-exceptions.ko.md`, `book/beginner/ch09-guards-interceptors.ko.md`, `book/beginner/ch10-openapi.ko.md`, `book/beginner/ch11-config.ko.md`, `book/beginner/ch12-prisma.ko.md`, `book/beginner/ch13-transactions.ko.md`, `book/beginner/ch14-jwt.ko.md`, `book/beginner/ch15-passport.ko.md`, `book/beginner/ch16-throttler.ko.md`, `book/beginner/ch17-cache.ko.md`, `book/beginner/ch18-health.ko.md`, `book/beginner/ch19-metrics.ko.md`, `book/beginner/ch20-testing.ko.md`, `book/beginner/ch21-production.ko.md`
- Excluded surfaces: `book/README*`, `book/*/toc*`, English `book/**/ch*.md`, Korean `docs/**` authority inputs, hubs, indexes, navigation aids
- Aggregate chapter status counts: `mixed=16`, `real_issue=2`, `insufficient_ssot=4`, `false_positive=0`, `no_issues=0`
- Mapping source note: `Frozen before reviewer fan-out per chapter.`

## Chapter Inventory
- `book/beginner/ch00-introduction.ko.md`
- `book/beginner/ch01-fluo-intro.ko.md`
- `book/beginner/ch02-cli-setup.ko.md`
- `book/beginner/ch03-modules-providers.ko.md`
- `book/beginner/ch04-decorators-intro.ko.md`
- `book/beginner/ch05-routing-controllers.ko.md`
- `book/beginner/ch06-validation.ko.md`
- `book/beginner/ch07-serialization.ko.md`
- `book/beginner/ch08-exceptions.ko.md`
- `book/beginner/ch09-guards-interceptors.ko.md`
- `book/beginner/ch10-openapi.ko.md`
- `book/beginner/ch11-config.ko.md`
- `book/beginner/ch12-prisma.ko.md`
- `book/beginner/ch13-transactions.ko.md`
- `book/beginner/ch14-jwt.ko.md`
- `book/beginner/ch15-passport.ko.md`
- `book/beginner/ch16-throttler.ko.md`
- `book/beginner/ch17-cache.ko.md`
- `book/beginner/ch18-health.ko.md`
- `book/beginner/ch19-metrics.ko.md`
- `book/beginner/ch20-testing.ko.md`
- `book/beginner/ch21-production.ko.md`

## Chapter Reports

### `book/beginner/ch00-introduction.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/reference/glossary-and-mental-model.md`, `docs/getting-started/quick-start.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/decorators-and-metadata.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 insufficient_ssot candidate; example-code=no_issues; coverage/edge-case=no_issues; adjudication=1 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Prerequisite version claims outrun mapped setup authority`
  - Book: `book/beginner/ch00-introduction.ko.md:55-56`, `book/beginner/ch00-introduction.ko.md:180-181`
  - Docs: `docs/getting-started/quick-start.md:5-10`
  - Rationale: The mapped English setup authority requires only a host Node.js runtime and available pnpm, so the chapter's Node.js version floors and explicit pnpm installation path are more specific than the frozen authority set can confirm or reject safely.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch01-fluo-intro.ko.md`
- Final chapter status: `real_issue`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/glossary-and-mental-model.md`, `docs/getting-started/first-feature-path.md`, `docs/getting-started/migrate-from-nestjs.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/di-and-modules.md`, `docs/architecture/decorators-and-metadata.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=no_issues; example-code=1 real_issue candidate; coverage/edge-case=no_issues; adjudication=1 real_issue.`

#### Accepted Findings
- Canonical Title: `DI example uses the wrong injection surface for the current contract`
  - Severity: `P1`
  - Book: `book/beginner/ch01-fluo-intro.ko.md:129-139`
  - Docs: `docs/getting-started/migrate-from-nestjs.md:17-18`, `docs/getting-started/first-feature-path.md:65-76`
  - Problem: The chapter teaches a provider example that imports `Inject` and `Injectable` from `@fluojs/di` and uses `@Injectable()`, but the mapped English docs define constructor wiring through `@Inject(...)` from `@fluojs/core` and describe provider registration through module metadata instead of an `@Injectable()` marker.
  - Rationale: The migration and first-feature docs explicitly define the current teaching surface as `@Inject(TokenA, TokenB)` from `@fluojs/core` and state that fluo does not use `@Injectable()` as a required provider-registration step, so the cited example teaches an out-of-contract API shape.

#### False Positives
- None.

#### Insufficient SSOT
- None.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch02-cli-setup.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/reference/package-chooser.md`, `docs/reference/fluo-new-support-matrix.md`, `docs/getting-started/quick-start.md`, `docs/getting-started/bootstrap-paths.md`, `docs/getting-started/first-feature-path.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 real_issue candidate + 1 insufficient_ssot candidate; example-code=1 real_issue candidate; coverage/edge-case=no_issues; adjudication=2 real_issue + 1 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Default CLI scaffold tree does not match the current starter artifacts`
  - Severity: `P1`
  - Book: `book/beginner/ch02-cli-setup.ko.md:192-200`, `book/beginner/ch02-cli-setup.ko.md:237-257`
  - Docs: `docs/getting-started/quick-start.md:74-86`
  - Problem: The chapter says the default scaffold yields `src/app.module.ts`, a top-level `test/` directory, and `.fluo.json` metadata, but the mapped English starter authority lists `src/app.ts`, `src/hello.controller.ts`, `src/hello.service.ts`, `src/main.ts`, `package.json`, `pnpm-lock.yaml`, and `tsconfig.json` as the generated default artifacts.
  - Rationale: The quick-start starter artifact block is an explicit current-contract inventory for `fluo new` defaults, so the cited book tree and the follow-on explanation of `.fluo.json` contradict the mapped English SSOT rather than merely omitting detail.
- Canonical Title: `First-run verification checks the wrong default route and payload`
  - Severity: `P1`
  - Book: `book/beginner/ch02-cli-setup.ko.md:353-357`
  - Docs: `docs/getting-started/quick-start.md:106-118`
  - Problem: The chapter verifies the default starter with `curl http://localhost:3000` and expects `{"message":"Hello fluo!"}`, but the mapped English quick-start contract verifies `/health` and `/hello` with `{"status":"ok"}` and `{"message":"Hello, World!"}`.
  - Rationale: The quick-start verification section defines the default starter endpoints and expected payloads directly, so the cited chapter command and response teach a concrete starter check that does not match the current authority.

#### False Positives
- None.

#### Insufficient SSOT
- `Installer and update matrix is broader than the frozen setup authority`
  - Book: `book/beginner/ch02-cli-setup.ko.md:30-39`, `book/beginner/ch02-cli-setup.ko.md:108-114`
  - Docs: `docs/getting-started/quick-start.md:12-20`, `docs/getting-started/quick-start.md:30-35`
  - Rationale: The mapped English setup authority documents `pnpm add -g @fluojs/cli` and the no-install `pnpm dlx @fluojs/cli new ...` path, but it stays silent on npm/yarn global installation and CLI update commands, so those broader workflow claims cannot be adjudicated safely as current-contract facts.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch03-modules-providers.ko.md`
- Final chapter status: `real_issue`
- Mapped English authority: `docs/CONTEXT.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/di-and-modules.md`, `docs/reference/glossary-and-mental-model.md`, `docs/getting-started/first-feature-path.md`, `docs/getting-started/migrate-from-nestjs.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 real_issue candidates; example-code=1 real_issue candidate; coverage/edge-case=no_issues; adjudication=2 real_issue.`

#### Accepted Findings
- Canonical Title: `Provider chapter still teaches @Injectable() as the provider-registration contract`
  - Severity: `P1`
  - Book: `book/beginner/ch03-modules-providers.ko.md:127-132`, `book/beginner/ch03-modules-providers.ko.md:298-300`, `book/beginner/ch03-modules-providers.ko.md:309-309`
  - Docs: `docs/getting-started/migrate-from-nestjs.md:17-18`, `docs/getting-started/migrate-from-nestjs.md:32-34`, `docs/getting-started/first-feature-path.md:13-15`, `docs/getting-started/first-feature-path.md:65-76`
  - Problem: The chapter defines provider management around `@Injectable()` from `@fluojs/di`, but the mapped English docs define provider registration through `@Module(...).providers` and reserve `@Inject(...)` for explicit constructor-token wiring.
  - Rationale: The migration and first-feature docs explicitly remove `@Injectable()` as the default provider-registration contract and instead teach module `providers` registration plus constructor-token wiring with `@Inject(...)`, so the cited chapter prose and example teach an out-of-contract provider model.
- Canonical Title: `DI flow claims fluo auto-wires constructor types`
  - Severity: `P1`
  - Book: `book/beginner/ch03-modules-providers.ko.md:309-312`
  - Docs: `docs/architecture/di-and-modules.md:24-27`, `docs/getting-started/migrate-from-nestjs.md:18`, `docs/getting-started/migrate-from-nestjs.md:25`
  - Problem: The chapter says fluo recognizes constructor parameter types and wires them automatically, but the mapped English DI contract requires explicit `@Inject(...)` token coverage instead of type-reflection-based inference.
  - Rationale: The current DI rules state that constructor resolution must use declared tokens and that required constructor parameters must be covered by `@Inject(...)`, so the cited automatic type-recognition explanation contradicts the frozen English authority.

#### False Positives
- None.

#### Insufficient SSOT
- None.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch04-decorators-intro.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/decorators-and-metadata.md`, `docs/reference/glossary-and-mental-model.md`, `docs/getting-started/first-feature-path.md`, `docs/getting-started/migrate-from-nestjs.md`, `docs/getting-started/quick-start.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 real_issue candidate + 1 insufficient_ssot candidate; example-code=1 real_issue candidate + 1 insufficient_ssot candidate; coverage/edge-case=no_issues; adjudication=1 real_issue + 1 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Decorator overview treats @Injectable() as a canonical fluo class decorator`
  - Severity: `P1`
  - Book: `book/beginner/ch04-decorators-intro.ko.md:127-155`
  - Docs: `docs/architecture/decorators-and-metadata.md:22-31`, `docs/getting-started/migrate-from-nestjs.md:14-18`, `docs/getting-started/migrate-from-nestjs.md:32-34`
  - Problem: The chapter lists and demonstrates `@Injectable()` as one of fluo's class-decorator primitives, but the mapped English docs define the current class-decorator contract around `@Module(...)`, `@Global()`, `@Inject(...)`, `@Scope(...)`, and `@Controller(...)` while removing `@Injectable()` as the default provider marker.
  - Rationale: The decorator contract and migration guide explicitly document the supported class-decorator surface and state that provider registration now happens through module metadata, so the cited chapter example and explanation contradict the current English SSOT.

#### False Positives
- None.

#### Insufficient SSOT
- `Accessor injection example outruns the frozen decorator authority`
  - Book: `book/beginner/ch04-decorators-intro.ko.md:241-245`, `book/beginner/ch04-decorators-intro.ko.md:252-255`, `book/beginner/ch04-decorators-intro.ko.md:268-282`
  - Docs: `docs/architecture/decorators-and-metadata.md:22-29`, `docs/reference/glossary-and-mental-model.md:31`
  - Rationale: The frozen English authority clearly defines `@Inject(...)` as constructor-token metadata and lists HTTP field decorators separately, but it does not document a beginner-facing accessor injection contract strongly enough to confirm or reject the chapter's `@Inject(MyService) accessor service` teaching example with a safe dual-citation contradiction test.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch05-routing-controllers.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/decorators-and-metadata.md`, `docs/architecture/http-runtime.md`, `docs/getting-started/first-feature-path.md`, `docs/getting-started/bootstrap-paths.md`, `docs/getting-started/migrate-from-nestjs.md`, `docs/reference/glossary-and-mental-model.md`, `docs/reference/package-surface.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 insufficient_ssot candidate; example-code=2 real_issue candidates; coverage/edge-case=no_issues; adjudication=2 real_issue + 1 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Routing chapter still relies on removed @Injectable() and implicit constructor DI`
  - Severity: `P1`
  - Book: `book/beginner/ch05-routing-controllers.ko.md:89-103`, `book/beginner/ch05-routing-controllers.ko.md:107-121`, `book/beginner/ch05-routing-controllers.ko.md:281-309`, `book/beginner/ch05-routing-controllers.ko.md:313-335`
  - Docs: `docs/getting-started/migrate-from-nestjs.md:17-18`, `docs/getting-started/migrate-from-nestjs.md:24-27`, `docs/getting-started/migrate-from-nestjs.md:32-34`, `docs/getting-started/first-feature-path.md:13-18`, `docs/getting-started/first-feature-path.md:63-108`
  - Problem: The chapter's service and controller examples still use `@Injectable()` from `@fluojs/di` and constructor injection without `@Inject(...)`, but the mapped English SSOT removes `@Injectable()` and requires explicit constructor-token wiring.
  - Rationale: The migration and first-feature docs explicitly define provider registration through `@Module(...).providers` and constructor wiring through `@Inject(...)`, so the cited chapter code teaches an outdated DI surface instead of the current documented contract.
- Canonical Title: `Routing chapter teaches parameter-decorator input binding outside the documented handler contract`
  - Severity: `P1`
  - Book: `book/beginner/ch05-routing-controllers.ko.md:180-199`, `book/beginner/ch05-routing-controllers.ko.md:226-245`, `book/beginner/ch05-routing-controllers.ko.md:267-275`
  - Docs: `docs/architecture/decorators-and-metadata.md:23-25`, `docs/architecture/decorators-and-metadata.md:31-33`, `docs/architecture/http-runtime.md:18-20`, `docs/architecture/http-runtime.md:24-35`, `docs/getting-started/first-feature-path.md:80-99`, `docs/reference/glossary-and-mental-model.md:21-22`
  - Problem: The chapter teaches `@FromPath(...)`, `@FromQuery(...)`, `@FromBody()`, and `@FromHeader(...)` on handler parameters with multi-argument method signatures, but the frozen English docs document DTO binding through `@RequestDto()` and controller invocation as `(input, requestContext)`.
  - Rationale: The mapped decorator and HTTP runtime docs define route metadata, DTO binding, and request-context propagation without a parameter-decorator handler contract, so the cited examples teach a different binding surface than the English SSOT currently documents.

#### False Positives
- None.

#### Insufficient SSOT
- `Built-in route versioning claim outruns the frozen routing authority`
  - Book: `book/beginner/ch05-routing-controllers.ko.md:48-50`
  - Docs: `docs/architecture/decorators-and-metadata.md:31-33`, `docs/architecture/http-runtime.md:24-35`
  - Rationale: The mapped English routing authority covers controller base paths, route-method metadata, path normalization, and allowed segment shapes, but it does not document built-in route versioning support strongly enough to confirm or reject the chapter's `/v1` and `/v2` claim safely.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch06-validation.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/decorators-and-metadata.md`, `docs/architecture/http-runtime.md`, `docs/getting-started/first-feature-path.md`, `docs/getting-started/migrate-from-nestjs.md`, `docs/reference/glossary-and-mental-model.md`, `docs/reference/package-surface.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 insufficient_ssot candidate; example-code=2 real_issue candidates; coverage/edge-case=no_issues; adjudication=2 real_issue + 1 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Validation chapter keeps the removed @Injectable() provider marker in the service example`
  - Severity: `P1`
  - Book: `book/beginner/ch06-validation.ko.md:290-310`
  - Docs: `docs/getting-started/migrate-from-nestjs.md:17-18`, `docs/getting-started/migrate-from-nestjs.md:32-34`, `docs/getting-started/first-feature-path.md:13-18`
  - Problem: The chapter's `PostsService` example still uses `@Injectable()` from `@fluojs/di`, even though the mapped English docs remove `@Injectable()` as the provider-registration contract and define services through module `providers` registration instead.
  - Rationale: The migration map explicitly removes `@Injectable()` and the feature-slice contract registers services via `@Module(...).providers`, so the cited example continues an outdated provider marker pattern rather than the current English SSOT.
- Canonical Title: `Validation chapter mixes @RequestDto() with an undocumented multi-parameter handler signature`
  - Severity: `P1`
  - Book: `book/beginner/ch06-validation.ko.md:180-198`, `book/beginner/ch06-validation.ko.md:267-278`
  - Docs: `docs/architecture/decorators-and-metadata.md:23-25`, `docs/architecture/http-runtime.md:18-20`, `docs/getting-started/first-feature-path.md:80-99`, `docs/reference/glossary-and-mental-model.md:21-22`
  - Problem: The chapter shows `@RequestDto(UpdatePostDto)` together with `@FromPath('id')` and transform-callback `@FromQuery(...)` parameter binding, but the frozen English docs document DTO binding as a single `input` payload plus `requestContext`.
  - Rationale: The mapped HTTP runtime and feature-slice docs define the current handler contract around `@RequestDto()`-bound DTO input and `requestContext`, so the cited chapter examples teach a broader parameter-binding surface than the English SSOT currently supports explicitly.

#### False Positives
- None.

#### Insufficient SSOT
- `Concrete validation decorator and mapped-type helper APIs outrun the frozen English docs`
  - Book: `book/beginner/ch06-validation.ko.md:57-72`, `book/beginner/ch06-validation.ko.md:101-109`, `book/beginner/ch06-validation.ko.md:166-233`
  - Docs: `docs/reference/package-surface.md:54`, `docs/getting-started/migrate-from-nestjs.md:19`, `docs/getting-started/migrate-from-nestjs.md:27`, `docs/getting-started/first-feature-path.md:17-18`, `docs/reference/glossary-and-mental-model.md:18`, `docs/reference/glossary-and-mental-model.md:21`
  - Rationale: The frozen English docs acknowledge DTO validation, coercion, and validation-package direction at a high level, but they do not define `@IsString()`, `@MinLength()`, `@IsBoolean()`, `PartialType()`, `PickType()`, or `OmitType()` as an explicit current-contract surface strongly enough for a safe dual-citation pass/fail decision.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch07-serialization.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/CONTEXT.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/http-runtime.md`, `docs/getting-started/first-feature-path.md`, `docs/reference/glossary-and-mental-model.md`, `docs/reference/package-surface.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 insufficient_ssot candidate; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Concrete serialization decorator and interceptor APIs outrun the frozen response-shaping authority`
  - Book: `book/beginner/ch07-serialization.ko.md:55-79`, `book/beginner/ch07-serialization.ko.md:99-152`, `book/beginner/ch07-serialization.ko.md:162-226`
  - Docs: `docs/architecture/architecture-overview.md:21-25`, `docs/architecture/http-runtime.md:18-20`, `docs/architecture/http-runtime.md:46`, `docs/getting-started/first-feature-path.md:18`, `docs/reference/glossary-and-mental-model.md:20`, `docs/reference/package-surface.md:10`
  - Rationale: The mapped English docs confirm that fluo has output shaping, response serialization, interceptors, and optional response-contract DTO files, but they do not document `@Expose()`, `@Exclude()`, `@Transform()`, `SerializerInterceptor`, or `serialize(...)` strongly enough to adjudicate the chapter's concrete API examples safely.
- `Advanced serializer behavior claims are too specific for the frozen English docs`
  - Book: `book/beginner/ch07-serialization.ko.md:228-265`
  - Docs: `docs/architecture/architecture-overview.md:21-25`, `docs/architecture/http-runtime.md:20`, `docs/architecture/http-runtime.md:46`
  - Rationale: The frozen English authority documents response serialization as part of the transport pipeline, but it stays silent on recursive traversal, circular-reference handling, inheritance behavior, collection treatment, `Date`/`bigint` normalization limits, and performance claims, so those details must remain fail-closed as `insufficient_ssot`.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch08-exceptions.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/http-runtime.md`, `docs/architecture/error-responses.md`, `docs/getting-started/first-feature-path.md`, `docs/getting-started/migrate-from-nestjs.md`, `docs/reference/glossary-and-mental-model.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 real_issue candidate + 1 insufficient_ssot candidate; example-code=1 real_issue candidate; coverage/edge-case=no_issues; adjudication=2 real_issue + 1 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Exception chapter still shows the pre-contract error JSON shape`
  - Severity: `P1`
  - Book: `book/beginner/ch08-exceptions.ko.md:77-89`
  - Docs: `docs/architecture/error-responses.md:5-18`, `docs/architecture/error-responses.md:20-38`, `docs/architecture/error-responses.md:72-89`
  - Problem: The chapter says fluo's global exception handling turns failures into a top-level `{ "statusCode": ..., "message": ..., "error": ... }` object, but the current HTTP error contract serializes failures as `{ error: { code, status, message, ... } }`.
  - Rationale: The mapped English error-response authority defines the canonical serialized envelope and handling rules explicitly, so the cited chapter JSON example teaches a concrete response shape that contradicts the current SSOT rather than a harmless simplification.
- Canonical Title: `Exception chapter keeps the removed @Injectable() provider marker in the service example`
  - Severity: `P1`
  - Book: `book/beginner/ch08-exceptions.ko.md:97-103`
  - Docs: `docs/getting-started/migrate-from-nestjs.md:17-18`, `docs/getting-started/migrate-from-nestjs.md:25`, `docs/getting-started/migrate-from-nestjs.md:32`, `docs/getting-started/first-feature-path.md:13-15`, `docs/getting-started/first-feature-path.md:22-39`
  - Problem: The chapter's `PostsService` not-found example imports `Injectable` from `@fluojs/di` and registers the service with `@Injectable()`, but the current fluo contract registers providers through `@Module(...).providers` and uses explicit `@Inject(...)` for constructor wiring instead of an `@Injectable()` provider marker.
  - Rationale: The migration and feature-slice docs explicitly remove `@Injectable()` as the required provider-registration step and keep service registration in module metadata, so the cited example teaches an outdated DI surface.

#### False Positives
- None.

#### Insufficient SSOT
- `Custom exception payload examples outrun the frozen error-response authority`
  - Book: `book/beginner/ch08-exceptions.ko.md:183-189`
  - Docs: `docs/architecture/error-responses.md:13-18`, `docs/architecture/error-responses.md:84-89`
  - Rationale: The mapped English docs define the serialized error envelope fields and recommend throwing `HttpException` subclasses for stable client-facing codes, but they do not document a constructor contract that proves or disproves the chapter's `BadRequestException('...', { cause, field })` example safely.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch09-guards-interceptors.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/http-runtime.md`, `docs/architecture/decorators-and-metadata.md`, `docs/getting-started/first-feature-path.md`, `docs/reference/glossary-and-mental-model.md`, `docs/reference/package-surface.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 real_issue candidate + 1 insufficient_ssot candidate; example-code=1 real_issue candidate; coverage/edge-case=1 real_issue candidate; adjudication=2 real_issue + 1 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Pipeline lifecycle list no longer matches the current HTTP runtime order`
  - Severity: `P1`
  - Book: `book/beginner/ch09-guards-interceptors.ko.md:30-38`, `book/beginner/ch09-guards-interceptors.ko.md:50-50`
  - Docs: `docs/architecture/http-runtime.md:9-22`, `docs/architecture/architecture-overview.md:21-21`, `docs/architecture/architecture-overview.md:48-48`
  - Problem: The chapter presents an exact request order of middleware → guards → pre-handle interceptors → pipes → controller handler → post-handle interceptors → exception filters, but the current HTTP runtime contract defines middleware and guard ordering explicitly, composes the interceptor chain before controller invocation, and performs DTO binding/validation inside `invokeControllerHandler(...)` rather than as a separate post-interceptor `pipes` phase.
  - Rationale: The mapped runtime contract spells out the current phase order and transport invariant directly, so the cited lifecycle list is a contradiction against the English SSOT, not just a pedagogical simplification.
- Canonical Title: `Guard/interceptor examples keep undocumented handler signatures instead of the current RequestDto input contract`
  - Severity: `P1`
  - Book: `book/beginner/ch09-guards-interceptors.ko.md:85-94`, `book/beginner/ch09-guards-interceptors.ko.md:232-255`
  - Docs: `docs/architecture/http-runtime.md:18-20`, `docs/getting-started/first-feature-path.md:79-99`, `docs/reference/glossary-and-mental-model.md:21-22`
  - Problem: The protected-route examples use plain controller signatures such as `create(input: CreatePostDto)` and `update(id: string, input: UpdatePostDto)` without the documented `@RequestDto(...)` binding step, while the current English HTTP examples and runtime contract document controller entry as `(input, requestContext)` with DTO binding through `@RequestDto()`.
  - Rationale: The mapped English feature-slice and runtime docs show the current handler contract concretely, so the cited examples teach a broader parameter-binding shape than the frozen SSOT documents.

#### False Positives
- None.

#### Insufficient SSOT
- `Deep helper access to the active request context outruns the frozen pipeline authority`
  - Book: `book/beginner/ch09-guards-interceptors.ko.md:281-299`
  - Docs: `docs/architecture/http-runtime.md:9-20`, `docs/reference/glossary-and-mental-model.md:22-22`
  - Rationale: The mapped English docs define `RequestContext` as the per-request runtime object and document handler-level access, but they do not state a strong enough public contract for ambient or deep-helper access to the active request context to accept or reject that beginner guidance safely.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch10-openapi.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/CONTEXT.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/openapi.md`, `docs/architecture/decorators-and-metadata.md`, `docs/reference/glossary-and-mental-model.md`, `docs/reference/package-surface.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=3 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Success-response inference and validation-decorator projection outrun the frozen OpenAPI authority`
  - Book: `book/beginner/ch10-openapi.ko.md:170-176`
  - Docs: `docs/architecture/openapi.md:25-27`, `docs/reference/package-surface.md:43-54`
  - Rationale: The mapped English docs confirm explicit response metadata and DTO schema generation from binding and validation metadata, but they do not document automatic `200`/`201` success-response inference or the chapter's concrete `@IsString({ minLength: 10 })`-style projection rules strongly enough for a safe pass/fail decision.
- `ApiProperty override guidance and schema-name collision rules outrun the mapped OpenAPI contract`
  - Book: `book/beginner/ch10-openapi.ko.md:185-216`
  - Docs: `docs/architecture/openapi.md:23-28`, `docs/architecture/decorators-and-metadata.md:25-26`
  - Rationale: The mapped English authority documents controller tags, operation metadata, response metadata, parameter/body metadata, security metadata, and DTO schema generation at a contract level, but it does not define `@ApiProperty()` override semantics or schema-name collision behavior strongly enough to adjudicate those specific claims.
- `Advanced tagging, UI customization, and multi-version document-splitting claims outrun the frozen OpenAPI docs`
  - Book: `book/beginner/ch10-openapi.ko.md:239-247`, `book/beginner/ch10-openapi.ko.md:249-264`, `book/beginner/ch10-openapi.ko.md:288-292`
  - Docs: `docs/architecture/openapi.md:11-15`, `docs/architecture/openapi.md:21-22`, `docs/architecture/openapi.md:30-45`
  - Rationale: The mapped English docs cover `OpenApiModule` entrypoints, descriptor-driven inclusion, versioned route metadata, `/openapi.json`, optional `/docs`, and the fixed Swagger UI runtime surface, but they stay too silent on multi-tag `@ApiTag('Posts', 'Search')`, custom CSS/assets support, and the chapter's version-split document orchestration guidance to support an evidence-complete adjudication.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch11-config.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/contracts/behavioral-contract-policy.md`, `docs/contracts/deployment.md`, `docs/architecture/config-and-environments.md`, `docs/architecture/dev-reload-architecture.md`, `docs/architecture/lifecycle-and-shutdown.md`, `docs/getting-started/first-feature-path.md`, `docs/getting-started/migrate-from-nestjs.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 real_issue candidate + 2 insufficient_ssot candidates; example-code=1 real_issue candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 real_issue + 2 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Config chapter treats ambient process.env as an automatic config source`
  - Severity: `P1`
  - Book: `book/beginner/ch11-config.ko.md:52-54`, `book/beginner/ch11-config.ko.md:101-106`, `book/beginner/ch11-config.ko.md:267-270`
  - Docs: `docs/architecture/config-and-environments.md:11-17`, `docs/architecture/config-and-environments.md:61-65`, `docs/contracts/deployment.md:15-24`
  - Problem: The chapter says `ConfigModule` merges the live `process.env` automatically and that plain process environment values always outrank `.env`, but the English config contract says only an explicit `processEnv` snapshot participates and `@fluojs/config` does not scan ambient `process.env` automatically.
  - Rationale: The mapped English config and deployment docs define source precedence around `defaults`, env file, explicit `processEnv`, and explicit `runtimeOverrides`, so the cited chapter prose overstates the current contract by teaching ambient `process.env` as an automatic source.
- Canonical Title: `Config provider example keeps the removed @Injectable() provider marker`
  - Severity: `P1`
  - Book: `book/beginner/ch11-config.ko.md:162-173`
  - Docs: `docs/getting-started/migrate-from-nestjs.md:17-18`, `docs/getting-started/migrate-from-nestjs.md:32-34`, `docs/getting-started/first-feature-path.md:13-18`, `docs/getting-started/first-feature-path.md:63-76`
  - Problem: The chapter's `ApiService` example still registers the provider with `@Injectable()`, even though the mapped English docs define provider registration through `@Module(...).providers` and constructor wiring through explicit `@Inject(...)`.
  - Rationale: The migration and feature-slice docs explicitly remove `@Injectable()` as the provider-registration contract, so the cited example teaches an outdated DI surface instead of the documented current one.

#### False Positives
- None.

#### Insufficient SSOT
- `getOrThrow() startup-failure semantics outrun the mapped config contract`
  - Book: `book/beginner/ch11-config.ko.md:68-73`, `book/beginner/ch11-config.ko.md:168-171`
  - Docs: `docs/architecture/config-and-environments.md:28-38`
  - Rationale: The mapped English docs document `get(...)` and `getOrThrow(...)` as typed read access and document fail-fast `INVALID_CONFIG` behavior for the `validate` hook, but they do not define a public contract that `getOrThrow()` itself raises `InternalServerError` during startup or stops deployment in the exact way the chapter describes.
- `Config load ordering and source-tracing internals outrun the mapped authority`
  - Book: `book/beginner/ch11-config.ko.md:52-54`, `book/beginner/ch11-config.ko.md:75-76`, `book/beginner/ch11-config.ko.md:281-287`
  - Docs: `docs/architecture/lifecycle-and-shutdown.md:7-18`, `docs/architecture/dev-reload-architecture.md:12-15`, `docs/architecture/dev-reload-architecture.md:22-30`
  - Rationale: The mapped English docs describe the generic bootstrap hook order and optional config-reload activation, but they do not document a public contract that `ConfigModule` initializes ahead of most modules, keeps source-tracing metadata for every key, or must sit at the top of `AppModule.imports` for correctness.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch12-prisma.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/guides/decision-guide.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/transactions.md`, `docs/getting-started/first-feature-path.md`, `docs/getting-started/migrate-from-nestjs.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 real_issue candidate + 1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=1 real_issue + 3 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Prisma repository example keeps the removed @Injectable() provider marker`
  - Severity: `P1`
  - Book: `book/beginner/ch12-prisma.ko.md:192-201`
  - Docs: `docs/getting-started/migrate-from-nestjs.md:17-18`, `docs/getting-started/migrate-from-nestjs.md:32-34`, `docs/getting-started/first-feature-path.md:13-18`, `docs/getting-started/first-feature-path.md:63-76`
  - Problem: The `PostsRepository` example still uses `@Injectable()` as the provider marker, but the mapped English docs define provider registration through module metadata and explicit constructor-token wiring instead.
  - Rationale: The migration and feature-slice docs make `@Module(...).providers` plus `@Inject(...)` the current DI contract, so the cited repository example keeps teaching the removed provider marker.

#### False Positives
- None.

#### Insufficient SSOT
- `Prisma CLI and schema-authoring workflow outrun the mapped English docs`
  - Book: `book/beginner/ch12-prisma.ko.md:52-67`, `book/beginner/ch12-prisma.ko.md:71-149`
  - Docs: `docs/reference/package-chooser.md:40-48`, `docs/guides/decision-guide.md:16-24`, `docs/reference/package-surface.md:53-56`
  - Rationale: The mapped English docs confirm that `@fluojs/prisma` is the Prisma persistence integration with ORM lifecycle and ALS-backed transaction context, but they do not document `npx prisma init`, `prisma generate`, `prisma migrate dev`, or the chapter's concrete Prisma DSL/schema guidance strongly enough to support a pass/fail adjudication.
- `PrismaModule registration and lifecycle-hook claims outrun the mapped authority`
  - Book: `book/beginner/ch12-prisma.ko.md:153-183`
  - Docs: `docs/reference/package-surface.md:55-55`, `docs/architecture/transactions.md:9-13`, `docs/architecture/transactions.md:29-39`
  - Rationale: The mapped English docs document Prisma lifecycle integration at a high level and define transaction-context behavior, but they do not publish a current contract for `PrismaModule.forRoot(...)`, pre/post connection hooks, pooling controls, or scoped multi-client registration.
- `Prisma operational guidance on retries, logging, locking, and distributed coordination outruns the mapped contract`
  - Book: `book/beginner/ch12-prisma.ko.md:225-234`, `book/beginner/ch12-prisma.ko.md:262-266`
  - Docs: `docs/architecture/transactions.md:15-42`, `docs/reference/package-surface.md:55-55`
  - Rationale: The mapped English docs define `current()`, transaction boundaries, nested-boundary reuse, and rollback semantics, but they stay silent on timeout APIs, automatic retry strategies, optimistic/pessimistic locking guidance, and service-to-service transaction orchestration with Prisma.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch13-transactions.ko.md`
- Final chapter status: `insufficient_ssot`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/architecture/transactions.md`, `docs/architecture/observability.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 insufficient_ssot candidates; example-code=1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=3 insufficient_ssot.`

#### Accepted Findings
- None.

#### False Positives
- None.

#### Insufficient SSOT
- `Isolation-level and retry guidance outrun the mapped Prisma transaction contract`
  - Book: `book/beginner/ch13-transactions.ko.md:166-187`
  - Docs: `docs/architecture/transactions.md:21-23`, `docs/architecture/transactions.md:29-42`
  - Rationale: The mapped English docs confirm `PrismaService.transaction(fn, options?)`, nested-boundary reuse, nested-options restriction, and exception-driven rollback, but they do not document supported isolation-level values, default isolation policy, or a public retry contract strongly enough to adjudicate the chapter's `Serializable` and retry guidance.
- `Advanced transaction hooks, audit, and observability claims outrun the mapped authority`
  - Book: `book/beginner/ch13-transactions.ko.md:254-281`
  - Docs: `docs/architecture/transactions.md:32-42`, `docs/architecture/observability.md:49-51`
  - Rationale: The mapped English docs cover request-scoped transaction boundaries, abort handling, shutdown cleanup, and the repository's built-in observability surface, but they do not define transaction hooks, row-level audit logging integration, built-in transaction metrics, or ALS transaction IDs as a documented public contract.
- `Distributed saga guidance outruns the mapped beginner transaction authority`
  - Book: `book/beginner/ch13-transactions.ko.md:272-273`
  - Docs: `docs/architecture/transactions.md:5-42`, `docs/reference/package-surface.md:15-15`
  - Rationale: The mapped English docs define the current persistence transaction-context contract and list messaging-pattern families separately, but they do not document a transaction-to-saga migration contract for this beginner transaction surface strongly enough to accept or reject the chapter's distributed consistency guidance safely.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch14-jwt.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/architecture/auth-and-jwt.md`, `docs/contracts/behavioral-contract-policy.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 real_issue candidate + 2 insufficient_ssot candidates; example-code=1 real_issue candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 real_issue + 2 insufficient_ssot.`
- Adjudicator reasoning: `Accepted only the claim-normalization and verifier-error-class mismatches because the frozen English auth contract names those surfaces explicitly. Broader JWT guidance around advanced key management, storage, federation, and operational hooks stays fail-closed because the mapped docs do not document those features strongly enough for a dual-citation contradiction test.`

#### Accepted Findings
- Canonical Title: `JwtPrincipal normalization overstates the supported claim aliases`
  - Severity: `P1`
  - Book: `book/beginner/ch14-jwt.ko.md:52-56`
  - Docs: `docs/architecture/auth-and-jwt.md:41-50`
  - Problem: The chapter says `JwtPrincipal.roles` can be normalized from `roles`, `groups`, or `permissions` and `JwtPrincipal.scopes` from `scope` or `scp`, but the mapped English contract limits roles to a string-array `roles` claim and scopes to `scopes[]` or the space-delimited `scope` claim.
  - Rationale: The frozen JWT principal contract enumerates the normalized fields and their allowed source claims directly, so the cited chapter alias-expansion guidance teaches claim mappings that are broader than the documented SSOT.
- Canonical Title: `Manual verifier example names undocumented token error classes`
  - Severity: `P1`
  - Book: `book/beginner/ch14-jwt.ko.md:208-215`, `book/beginner/ch14-jwt.ko.md:220-223`
  - Docs: `docs/architecture/auth-and-jwt.md:27-35`
  - Problem: The manual verification example says `verifyAccessToken(...)` handling centers on `ExpiredTokenError` and `InvalidSignatureError`, but the mapped English contract documents `JwtExpiredTokenError` for expiry and `JwtInvalidTokenError` for malformed or invalid tokens.
  - Rationale: The verification-constraint table names the current failure classes and conditions explicitly, so the cited example/comment block teaches a token-error surface that does not match the current documented contract.

#### False Positives
- None.

#### Insufficient SSOT
- `Expanded JwtModule capability claims outrun the mapped auth authority`
  - Book: `book/beginner/ch14-jwt.ko.md:111-114`, `book/beginner/ch14-jwt.ko.md:249-257`, `book/beginner/ch14-jwt.ko.md:372-375`
  - Docs: `docs/architecture/auth-and-jwt.md:11-20`, `docs/architecture/auth-and-jwt.md:27-35`
  - Rationale: The frozen English auth docs define module entrypoints, signer/verifier exports, algorithm and key-material rules, refresh-token rotation, and JWKS-backed verification at a contract level, but they do not document multi-issuer registries, custom signer registration, live multi-key rollover policy, or automatic JWKS caching strongly enough to accept or reject those advanced chapter claims safely.
- `Operational token-management guidance outruns the mapped auth authority`
  - Book: `book/beginner/ch14-jwt.ko.md:159-165`, `book/beginner/ch14-jwt.ko.md:244-257`, `book/beginner/ch14-jwt.ko.md:387-415`
  - Docs: `docs/architecture/auth-and-jwt.md:18-21`, `docs/architecture/auth-and-jwt.md:52-56`
  - Rationale: The mapped docs explicitly cover refresh-token rotation prerequisites, family revocation on reuse, and the runtime-owned principal boundary, but they stay too silent on denylist/whitelist hooks, audit hooks, versioned-session invalidation, and other operational token-management patterns to support a safe contradiction verdict.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch15-passport.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/architecture/auth-and-jwt.md`, `docs/architecture/http-runtime.md`, `docs/architecture/security-middleware.md`, `docs/contracts/behavioral-contract-policy.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 real_issue candidate + 2 insufficient_ssot candidates; example-code=no_issues; coverage/edge-case=1 insufficient_ssot candidate; adjudication=1 real_issue + 2 insufficient_ssot.`
- Adjudicator reasoning: `Accepted only the request-lifecycle ordering mismatch because the frozen HTTP and auth docs define the guard/interceptor phases directly. Broader Passport guidance on multi-strategy fallback, MFA, ABAC engines, and tenant-aware authorization patterns stays fail-closed because the mapped English authority does not publish those behaviors as current contract.`

#### Accepted Findings
- Canonical Title: `Passport chapter inverts the guard and interceptor execution order`
  - Severity: `P1`
  - Book: `book/beginner/ch15-passport.ko.md:26-33`
  - Docs: `docs/architecture/http-runtime.md:16-20`, `docs/architecture/security-middleware.md:44-45`
  - Problem: The chapter says guards run after all interceptors, but the mapped English HTTP contract runs the guard chain before composing and executing interceptors.
  - Rationale: The current dispatcher contract states that guards execute at stage 8/5 and interceptors only after guards succeed, so the cited lifecycle explanation reverses the documented order rather than adding an optional nuance.

#### False Positives
- None.

#### Insufficient SSOT
- `Multi-strategy Passport orchestration claims outrun the mapped auth authority`
  - Book: `book/beginner/ch15-passport.ko.md:145-156`
  - Docs: `docs/architecture/auth-and-jwt.md:36-38`, `docs/architecture/auth-and-jwt.md:54-56`
  - Rationale: The frozen English auth docs define `AuthGuard` route enforcement, scope checks, and the `requestContext.principal` boundary, but they do not document multi-strategy fallback ordering or per-route auth-option composition strongly enough to accept or reject the chapter's orchestration claims safely.
- `Advanced authorization and MFA patterns outrun the mapped auth authority`
  - Book: `book/beginner/ch15-passport.ko.md:174-190`, `book/beginner/ch15-passport.ko.md:214-223`, `book/beginner/ch15-passport.ko.md:241-249`
  - Docs: `docs/architecture/auth-and-jwt.md:39-56`, `docs/reference/package-surface.md:43-46`
  - Rationale: The mapped docs are explicit about the normalized JWT principal, route-scope enforcement, and package responsibilities, but they do not publish ABAC service patterns, tenant-aware provider injection, subscription-state claims, or MFA partial-token flows as current English SSOT.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch16-throttler.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/architecture/http-runtime.md`, `docs/architecture/security-middleware.md`, `docs/contracts/behavioral-contract-policy.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=3 real_issue candidates + 2 insufficient_ssot candidates; example-code=no_issues; coverage/edge-case=1 insufficient_ssot candidate; adjudication=3 real_issue + 2 insufficient_ssot.`
- Adjudicator reasoning: `Accepted only the throttling facts that the frozen English middleware contract names directly: guard/interceptor phase order, the current rate-limit response-header contract, and the trusted-proxy option name. Broader teaching about multi-window definitions, Redis cluster topology, adaptive algorithms, and non-HTTP throttling remains fail-closed because the mapped docs do not document those surfaces as binding contract.`

#### Accepted Findings
- Canonical Title: `Throttling chapter places guards after interceptors instead of before them`
  - Severity: `P1`
  - Book: `book/beginner/ch16-throttler.ko.md:50-54`
  - Docs: `docs/architecture/http-runtime.md:16-20`, `docs/architecture/security-middleware.md:44-45`, `docs/architecture/security-middleware.md:54-55`
  - Problem: The chapter says `ThrottlerGuard` runs after interceptors, but the mapped English runtime contract places route guards in the guard phase before the interceptor chain.
  - Rationale: The dispatcher and security-middleware contracts define guard execution before interceptors and call out `ThrottlerGuard` specifically as a guard-phase component, so the cited lifecycle explanation contradicts the current documented order.
- Canonical Title: `Throttling chapter teaches undocumented X-RateLimit auto headers as current contract`
  - Severity: `P1`
  - Book: `book/beginner/ch16-throttler.ko.md:55-61`
  - Docs: `docs/architecture/security-middleware.md:21-33`
  - Problem: The chapter says `ThrottlerGuard` automatically emits `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`, but the mapped English HTTP security contract documents `Retry-After` as the current rate-limit response-header requirement and does not publish those `X-RateLimit-*` headers as part of the current contract.
  - Rationale: The frozen header-contract table is the current English SSOT for middleware and rate-limit response headers, so teaching additional automatic `X-RateLimit-*` headers as if they are contractually guaranteed is broader than the documented surface.
- Canonical Title: `Proxy configuration guidance uses the wrong public option name`
  - Severity: `P1`
  - Book: `book/beginner/ch16-throttler.ko.md:93-94`, `book/beginner/ch16-throttler.ko.md:350-355`
  - Docs: `docs/architecture/security-middleware.md:61-62`
  - Problem: The chapter tells readers to enable `trust proxy`, but the mapped English middleware contract documents proxy-derived client identity behind the explicit `trustProxyHeaders: true` option.
  - Rationale: The current proxy-identity rule names the public option and its guardrails directly, so the cited book guidance teaches a different configuration surface than the English SSOT documents.

#### False Positives
- None.

#### Insufficient SSOT
- `Advanced throttling topology and algorithm claims outrun the mapped security authority`
  - Book: `book/beginner/ch16-throttler.ko.md:99-127`, `book/beginner/ch16-throttler.ko.md:146-161`, `book/beginner/ch16-throttler.ko.md:194-200`, `book/beginner/ch16-throttler.ko.md:291-300`
  - Docs: `docs/architecture/security-middleware.md:54-64`
  - Rationale: The frozen English middleware docs cover guard-phase throttling, handler-specific storage keys, proxy-trust rules, and the scope of `@Throttle(...)` / `@SkipThrottle()`, but they do not document multiple named windows, Redis-cluster setup, adaptive limits, token-bucket behavior, or Lua-backed precision guarantees strongly enough for a safe contradiction verdict.
- `Non-HTTP throttling and observability guidance outruns the mapped English docs`
  - Book: `book/beginner/ch16-throttler.ko.md:302-342`
  - Docs: `docs/reference/package-surface.md:16`, `docs/architecture/security-middleware.md:5-6`, `docs/architecture/security-middleware.md:21-33`
  - Rationale: The mapped English authority establishes `@fluojs/throttler` as an operations package and defines the current HTTP middleware and response-header contract, but it does not publish WebSocket, queue, GraphQL-complexity, or admin-dashboard throttling/observability behavior as current SSOT.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch17-cache.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/caching.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=3 real_issue candidates + 2 insufficient_ssot candidates; example-code=1 real_issue candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=4 real_issue + 1 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Cache chapter overstates built-in store backends beyond memory and Redis`
  - Severity: `P1`
  - Book: `book/beginner/ch17-cache.ko.md:100-103`
  - Docs: `docs/architecture/caching.md:11-15`, `docs/architecture/caching.md:54-54`
  - Problem: The chapter says fluo supports Memcached, MongoDB, and local file-system cache backends that can be swapped through the cache abstraction, but the mapped English contract documents only the current `CacheModule.forRoot(...)` store surface, built-in `MemoryStore` and `RedisStore`, and custom-store extensibility through `CacheStore`.
  - Rationale: The cache contract lists the public module options and current built-in stores explicitly, then narrows extensibility to custom stores implementing the documented interface, so teaching extra built-in backend support as if it were part of the current contract overstates the English SSOT.
- Canonical Title: `Manual cache example uses an undocumented increment API`
  - Severity: `P1`
  - Book: `book/beginner/ch17-cache.ko.md:191-194`
  - Docs: `docs/architecture/caching.md:12-12`, `docs/architecture/caching.md:54-54`
  - Problem: The chapter teaches `cacheManager.increment(key)` for atomic counter updates, but the mapped English cache-service contract exposes only `get`, `set`, `remember`, `del`, and `reset`, with custom-store extensibility limited to `get`, `set`, `del`, and `reset`.
  - Rationale: The frozen cache-service surface is enumerated directly in the English contract, so introducing `increment(...)` as a documented application-facing API is a concrete code-surface mismatch rather than a missing tutorial detail.
- Canonical Title: `Cache invalidation section teaches wildcard and tag invalidation outside the current contract`
  - Severity: `P1`
  - Book: `book/beginner/ch17-cache.ko.md:204-204`, `book/beginner/ch17-cache.ko.md:220-223`
  - Docs: `docs/architecture/caching.md:42-46`, `docs/architecture/caching.md:52-52`
  - Problem: The chapter recommends pattern-based deletion such as `user:123:*` and later teaches tag-based invalidation through `invalidateTag`, but the mapped English contract limits built-in invalidation to explicit key/list/resolver eviction and states that tag-based and wildcard invalidation are not part of the built-in contract.
  - Rationale: The invalidation table and constraints section name the supported eviction surfaces and explicitly exclude tag-based or wildcard invalidation, so the cited cache-management guidance contradicts the current English SSOT.
- Canonical Title: `Cache chapter claims CacheModule-configurable eviction policies that the current contract does not expose`
  - Severity: `P1`
  - Book: `book/beginner/ch17-cache.ko.md:235-241`
  - Docs: `docs/architecture/caching.md:11-15`, `docs/architecture/caching.md:48-54`
  - Problem: The chapter says fluo lets users configure LRU, LFU, or FIFO eviction policies through `CacheModule` settings, but the mapped English contract documents one built-in memory-store behavior that evicts the oldest keys at a 1,000-entry cap and otherwise pushes alternative behavior into custom-store implementations.
  - Rationale: The current cache docs define the public module options and the built-in memory-store behavior directly, without a public eviction-policy selector, so the cited `CacheModule` policy-tuning guidance teaches an out-of-contract configuration surface.

#### False Positives
- None.

#### Insufficient SSOT
- `Advanced cache coordination and freshness guidance outruns the mapped cache contract`
  - Book: `book/beginner/ch17-cache.ko.md:208-218`, `book/beginner/ch17-cache.ko.md:230-233`, `book/beginner/ch17-cache.ko.md:243-275`
  - Docs: `docs/architecture/caching.md:21-24`, `docs/architecture/caching.md:36-36`, `docs/architecture/caching.md:50-54`
  - Rationale: The mapped English cache docs are explicit about key derivation, per-key miss deduplication, process-local versus shared-store boundaries, JSON constraints, and the built-in invalidation model, but they stay too silent on lease-based stampede protection, TTL jitter, write-through/write-back policies, refresh-ahead behavior, automatic negative caching, multi-layer synchronization, and cache-health metrics to support safe contradiction verdicts for those broader operational claims.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch18-health.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/observability.md`, `docs/architecture/lifecycle-and-shutdown.md`, `docs/contracts/deployment.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 real_issue candidates + 2 insufficient_ssot candidates; example-code=no_issues; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 real_issue + 1 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Health chapter assigns Terminus a liveness/readiness route model the current contract does not provide`
  - Severity: `P1`
  - Book: `book/beginner/ch18-health.ko.md:28-33`, `book/beginner/ch18-health.ko.md:62-62`
  - Docs: `docs/architecture/observability.md:22-25`, `docs/architecture/observability.md:35-41`
  - Problem: The chapter frames Terminus around `/health/liveness` and `/health/readiness`, but the mapped English observability contract keeps the runtime routes at `GET /health` and `GET /ready` and explicitly says `@fluojs/terminus` does not provide a process-only liveness probe out of the box.
  - Rationale: The frozen health and readiness route tables define the current path and response contracts directly, so the cited Terminus endpoint model contradicts the English SSOT rather than filling in optional deployment detail.
- Canonical Title: `Health chapter makes Terminus the shutdown-signal owner instead of the host/runtime path`
  - Severity: `P1`
  - Book: `book/beginner/ch18-health.ko.md:51-51`, `book/beginner/ch18-health.ko.md:73-73`, `book/beginner/ch18-health.ko.md:191-203`, `book/beginner/ch18-health.ko.md:216-216`
  - Docs: `docs/architecture/lifecycle-and-shutdown.md:36-44`
  - Problem: The chapter says Terminus detects `SIGTERM`, manages shutdown timeouts, and triggers the standardized shutdown lifecycle, but the mapped English shutdown contract assigns signal registration to the surrounding host or adapter helper and defines shutdown ordering through the runtime close path.
  - Rationale: The shutdown-guarantee table names the runtime hook order, close path, signal coverage, and host timeout ownership explicitly, then states that signal registration is not owned by the universal runtime surface, so the cited Terminus-centered shutdown explanation contradicts the documented contract boundary.

#### False Positives
- None.

#### Insufficient SSOT
- `Advanced Terminus reliability features outrun the mapped observability contract`
  - Book: `book/beginner/ch18-health.ko.md:67-70`, `book/beginner/ch18-health.ko.md:123-136`, `book/beginner/ch18-health.ko.md:176-178`, `book/beginner/ch18-health.ko.md:206-208`, `book/beginner/ch18-health.ko.md:240-247`
  - Docs: `docs/architecture/observability.md:27-29`, `docs/contracts/deployment.md:35-37`, `docs/architecture/lifecycle-and-shutdown.md:37-42`
  - Rationale: The mapped English docs confirm indicator aggregation, timeout-to-down behavior, built-in HTTP/memory/disk/Prisma/Drizzle/Redis indicator families, and runtime shutdown ordering, but they do not document rate-limited health checks, CPU-specific built-ins, `HealthCheckError`-style failure contracts, transaction-manager shutdown coordination, global control-plane draining, or automated post-mortem hooks strongly enough for a safe contradiction verdict.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch19-metrics.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/architecture/architecture-overview.md`, `docs/architecture/observability.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=2 real_issue candidates + 2 insufficient_ssot candidates; example-code=no_issues; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 real_issue + 1 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Metrics chapter teaches automatic response-size tracking outside the current HTTP metrics contract`
  - Severity: `P1`
  - Book: `book/beginner/ch19-metrics.ko.md:125-126`
  - Docs: `docs/architecture/observability.md:10-10`
  - Problem: The chapter says fluo automatically tracks HTTP response sizes, but the mapped English HTTP metrics contract documents only `http_requests_total`, `http_errors_total`, and `http_request_duration_seconds` as the built-in HTTP series.
  - Rationale: The observability spec enumerates the current automatic HTTP metrics surface directly, so teaching response-size tracking as a built-in metric overstates the documented contract.
- Canonical Title: `Metrics chapter overstates built-in telemetry with dependency-pool and per-pipeline-stage metrics`
  - Severity: `P1`
  - Book: `book/beginner/ch19-metrics.ko.md:239-245`
  - Docs: `docs/architecture/observability.md:10-12`, `docs/architecture/observability.md:38-38`, `docs/architecture/observability.md:46-51`
  - Problem: The chapter says fluo exposes detailed dependency metrics such as `pool_size`, `active_connections`, and `waiting_requests` plus middleware/guard/interceptor/pipe timing metrics, but the mapped English observability contract limits the built-in surfaces to HTTP totals/errors/duration, runtime readiness and health gauges, registry mode, and user-created counters/gauges/histograms.
  - Rationale: The frozen observability surface table and constraints define the current built-in metrics contract and scope of repository observability directly, so the cited dependency-detail and per-stage timing claims teach a broader built-in telemetry surface than the English SSOT publishes.

#### False Positives
- None.

#### Insufficient SSOT
- `Advanced metrics ergonomics claims outrun the mapped observability contract`
  - Book: `book/beginner/ch19-metrics.ko.md:82-82`, `book/beginner/ch19-metrics.ko.md:91-99`, `book/beginner/ch19-metrics.ko.md:180-181`, `book/beginner/ch19-metrics.ko.md:229-231`, `book/beginner/ch19-metrics.ko.md:262-265`
  - Docs: `docs/architecture/observability.md:9-16`
  - Rationale: The mapped English observability docs are explicit about the configurable scrape path, registry mode, default process/Node collectors, route-scoped `endpointMiddleware`, and shared custom counters/gauges/histograms, but they do not document per-tenant multi-endpoint registry layouts, `Summary` support, `/metrics` response caching, or reference Grafana dashboard templates strongly enough to adjudicate those broader chapter claims safely.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch20-testing.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/contracts/testing-guide.md`, `docs/architecture/lifecycle-and-shutdown.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 real_issue candidate + 2 insufficient_ssot candidates; example-code=1 real_issue candidate + 1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=2 real_issue + 2 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Testing chapter classifies createTestingModule-based module-graph compilation as unit testing`
  - Severity: `P1`
  - Book: `book/beginner/ch20-testing.ko.md:82-83`, `book/beginner/ch20-testing.ko.md:101-128`
  - Docs: `docs/contracts/testing-guide.md:9-11`, `docs/contracts/testing-guide.md:31-32`
  - Problem: The chapter's unit-testing section compiles a DI module graph with `createTestingModule(...)` and provider overrides, but the mapped English testing contract reserves unit tests for direct Vitest plus explicit mocks and classifies `createTestingModule({ rootModule })` as integration coverage.
  - Rationale: The testing guide splits unit, integration, and request-level HTTP coverage explicitly, so teaching module-graph compilation with overrides as the unit-testing contract contradicts the English SSOT's current test-surface boundaries.
- Canonical Title: `Testing chapter labels createTestApp request dispatch as integration instead of E2E-style HTTP coverage`
  - Severity: `P1`
  - Book: `book/beginner/ch20-testing.ko.md:199-214`
  - Docs: `docs/contracts/testing-guide.md:10-11`, `docs/contracts/testing-guide.md:32`
  - Problem: The chapter presents `createTestApp({ rootModule })` under an integration-testing section, but the mapped English docs define `createTestApp(...)` as the E2E-style HTTP surface that executes the real request pipeline.
  - Rationale: The testing guide assigns integration coverage to `createTestingModule(...)` within one application slice and assigns request-level HTTP pipeline coverage to `createTestApp(...)`, so the cited section teaches the wrong testing category for that helper.

#### False Positives
- None.

#### Insufficient SSOT
- `Vitest bootstrap plugin and coverage-setup guidance outruns the mapped testing contract`
  - Book: `book/beginner/ch20-testing.ko.md:43-80`
  - Docs: `docs/contracts/testing-guide.md:9`, `docs/contracts/testing-guide.md:18-29`
  - Rationale: The mapped English testing docs confirm Vitest as the repo-grounded runner and list canonical commands, but they do not document global `vitest` installation, `@babel/core`, `fluoBabelDecoratorsPlugin`, `setupFiles`, or `v8`/`istanbul` configuration details strongly enough to support an evidence-backed contradiction verdict.
- `Lifecycle-hook, dynamic-module, and auto-mocking claims outrun the mapped testing authority`
  - Book: `book/beginner/ch20-testing.ko.md:153-154`, `book/beginner/ch20-testing.ko.md:196-197`, `book/beginner/ch20-testing.ko.md:275-279`
  - Docs: `docs/contracts/testing-guide.md:9-12`, `docs/architecture/lifecycle-and-shutdown.md:5-18`, `docs/architecture/lifecycle-and-shutdown.md:32-45`
  - Rationale: The mapped English docs define the public testing surfaces and the runtime lifecycle contract, but they do not document `createTestingModule(...).compile()`/`.close()` hook triggering, whole-module replacement, or automatic deep-mocking of undefined providers strongly enough for a safe dual-citation pass/fail decision.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

### `book/beginner/ch21-production.ko.md`
- Final chapter status: `mixed`
- Mapped English authority: `docs/CONTEXT.md`, `docs/reference/package-surface.md`, `docs/reference/package-chooser.md`, `docs/contracts/deployment.md`, `docs/contracts/behavioral-contract-policy.md`, `docs/architecture/config-and-environments.md`, `docs/architecture/observability.md`, `docs/architecture/lifecycle-and-shutdown.md`, `docs/getting-started/bootstrap-paths.md`, `docs/getting-started/migrate-from-nestjs.md`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Reviewer summary: `contract/prose=1 real_issue candidate + 2 insufficient_ssot candidates; example-code=1 real_issue candidate + 1 insufficient_ssot candidate; coverage/edge-case=1 insufficient_ssot candidate; adjudication=1 real_issue + 2 insufficient_ssot.`

#### Accepted Findings
- Canonical Title: `Production bootstrap example uses an undocumented createFluoApp config surface instead of the adapter-first contract`
  - Severity: `P1`
  - Book: `book/beginner/ch21-production.ko.md:114-124`
  - Docs: `docs/contracts/deployment.md:13-15`, `docs/contracts/deployment.md:21-23`, `docs/getting-started/bootstrap-paths.md:7-14`, `docs/getting-started/bootstrap-paths.md:26-30`, `docs/getting-started/migrate-from-nestjs.md:16`, `docs/getting-started/migrate-from-nestjs.md:24-27`
  - Problem: The chapter's production `main.ts` example bootstraps with `createFluoApp({ rootModule, config: { envFilePath: '.env.production' } })`, but the mapped English docs require adapter-first bootstrap through `FluoFactory.create(AppModule, { adapter })` and document process-backed configuration through explicit `ConfigModule.forRoot({ processEnv: ... })` or `loadConfig(...)` rather than an undocumented top-level `config` bootstrap option.
  - Rationale: The deployment and bootstrap docs explicitly define the current application entry surface and config boundary, so the cited example teaches a bootstrap API shape that is outside the documented contract.

#### False Positives
- None.

#### Insufficient SSOT
- `Docker, CI/CD, and rollout playbook guidance outruns the mapped deployment contract`
  - Book: `book/beginner/ch21-production.ko.md:51-109`, `book/beginner/ch21-production.ko.md:127-152`, `book/beginner/ch21-production.ko.md:190-211`, `book/beginner/ch21-production.ko.md:256-268`
  - Docs: `docs/contracts/deployment.md:9-15`, `docs/contracts/deployment.md:21-24`
  - Rationale: The mapped English deployment docs define the canonical verification gates, adapter bootstrap, health registration, config boundary, and a small set of deployment variables, but they do not document the chapter's specific multi-stage Dockerfile, Docker Compose topology, image-registry flow, `prisma migrate deploy`, IaC recommendations, multi-region rollout, canary strategy, or compliance guidance strongly enough for a safe contradiction verdict.
- `Advanced production hardening and shutdown guidance outruns the mapped observability and lifecycle contract`
  - Book: `book/beginner/ch21-production.ko.md:35-49`, `book/beginner/ch21-production.ko.md:153-179`, `book/beginner/ch21-production.ko.md:230-249`
  - Docs: `docs/architecture/observability.md:9-18`, `docs/architecture/observability.md:20-29`, `docs/architecture/observability.md:31-50`, `docs/architecture/lifecycle-and-shutdown.md:32-45`, `docs/contracts/behavioral-contract-policy.md:34-38`
  - Rationale: The mapped English docs are explicit about `/metrics`, `/health`, `/ready`, `endpointMiddleware`, runtime shutdown ordering, and the config isolation boundary, but they do not define the chapter's helmet-style header guidance, API gateway patterns, secret-rotation cadence, distributed tracing stack choices, circuit breakers, vulnerability scanning tools, quota-management strategy, or the exact application-level shutdown recipe strongly enough to accept or reject those broader production claims safely.

#### No Issues
- `No accepted contradiction or code-error findings remain for this chapter.`

## Batch H Handoff
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Assigned chapter coverage: `book/beginner/ch20-testing.ko.md`, `book/beginner/ch21-production.ko.md`
- Final dispositions: `book/beginner/ch20-testing.ko.md=mixed`, `book/beginner/ch21-production.ko.md=mixed`
- Beginner part status: `Task 13 batch H recorded under the frozen beginner snapshot SHA; beginner coverage now spans ch00-ch21 in this report.`
