# Package-guide workstream fixtures: http, graphql, validation, serialization, openapi

Evidence fixtures for the five package guides this workstream owns:

- `apps/docs/content/docs/packages/http.mdx`
- `apps/docs/content/docs/packages/graphql.mdx`
- `apps/docs/content/docs/packages/validation.mdx`
- `apps/docs/content/docs/packages/serialization.mdx`
- `apps/docs/content/docs/packages/openapi.mdx`

Machine-readable summary: `evidence.json` (repository-relative paths, actual results only).

## Files

| File | Purpose |
| --- | --- |
| `metadata-preload.ts` | Application-entrypoint `ensureMetadataSymbol()` pattern documented by the Serialization guide (no-op under the repo vitest setup, which installs `Symbol.metadata` via `tooling/vitest/src/symbol-metadata.setup.ts`). |
| `http-guide-app.ts` | Complete example from the HTTP guide: DTO binding + validation, `InputPolicy` strip/reject, class guard, canonical errors. |
| `http-guide.test.ts` | HTTP+validation composition through `Test.createApp` (binding, 400 details, 404 envelope, policy strip vs reject, guard 403/200). |
| `serialization-guide-app.ts` | Complete example from the Serialization guide: `@Expose`/`@Exclude`/`@Transform` + `SerializerInterceptor`. |
| `serialization-guide.test.ts` | Engine semantics (expose/transform, cycle cut to `undefined`, shared references) and interceptor response shaping. |
| `openapi-guide-app.ts` | Complete example from the OpenAPI guide: `OpenApiModule.forRoot` with an explicit `sources` controller and DTO-derived request schema. |
| `openapi-guide.test.ts` | Served `/openapi.json` document assertions, controller/document route coexistence, offline `OpenApiDocumentBuilder.build`. |
| `graphql-guide-app.ts` | Complete example from the GraphQL guide: resolver with validated input DTO, request-scoped store, `GraphqlModule.forRoot`. |
| `graphql-guide.test.ts` | Native Node server via `FluoFactory.create` + `NodeHttpApplicationAdapter`; queries, `BAD_USER_INPUT` mapping, operation-scoped store isolation. |

## Commands and results

Recorded on this worktree (`docs-foundation`), Node v24.20.0, pnpm 10.4.1, vitest 4.1.11.

```
pnpm vitest run --project tooling tooling/docs/fixtures/package-guides/http --maxWorkers=1
# exit 0 — Test Files 4 passed (4), Tests 14 passed (14)

pnpm exec tsc -p tsconfig.tools.json --noEmit
# exit 2 overall, but 0 errors under tooling/docs/fixtures/package-guides/http;
# remaining errors are in other workstreams' fixture dirs
# (package-guides/data, package-guides/foundation, native-platforms) and were not touched.

pnpm vitest run --project tooling tooling/docs/fixtures/docs-foundation --maxWorkers=1
# environment probe before authoring: exit 0 — 4 files / 25 tests passed
```

No fixed sleeps, polling delays, or wall-clock waits appear in any fixture; every test is
request/response or event-driven, and every app/server is closed in `finally`.

## Per-package source and contract evidence

### @fluojs/http

- Contract: `packages/http/README.md` (route grammar, lifecycle order, InputPolicy defaults, error envelope, guards/interceptors).
- Source: `packages/http/src/index.ts` + `index.portable.ts` (export surface), `src/decorators.ts`, `src/exceptions.ts` (`HttpException` family, `ErrorResponse`), `src/types.ts` (`RequestContext`, `GuardContext` with `requestContext`, `InterceptorContext`), `src/guards.ts` (class refs resolve from `requestContext.container`; `false` → `ForbiddenException`), `src/interceptors.ts`.
- Verified in fixtures: binding + validation → 400 with `MISSING_FIELD`/`UNKNOWN_FIELD`/`BAD_REQUEST` details; `NotFoundException` → canonical 404 envelope; DTO-class `InputPolicy` strip vs route-level reject; guard class resolution (must be a registered provider — discovered during fixture authoring and documented in the guide).
- No `HttpModule.forRoot` exists; composition is `FluoFactory.create(AppModule, { adapter })` (README Quick Start + runtime contract).

### @fluojs/validation

- Contract: `packages/validation/README.md` (materialize vs validate, issue shape, missing-value semantics, no coercion/groups, mapped types subpath only, Standard Schema rules).
- Source: `src/validation.ts` (`DefaultValidator.materialize/validate`, `MaterializeOptions.undeclaredProperties`), `src/errors.ts` (`DtoValidationError.issues`), `src/types.ts` (`ValidationIssue`), `src/decorators.ts` (`ValidationDecoratorOptions` = `{ code?, each?, message? }` via `@fluojs/core` metadata types; `ValidateIf((dto, value) => ...)`), `src/mapped-types.ts` (`PickType`/`OmitType`/`IntersectionType`/`PartialType`), `src/standard-schema.ts` (`parseStandardSchema`).
- Verified in fixtures: `@IsDefined`/`@IsString`/`@MinLength`/`@IsEmail`/`@IsInt`/`@Min` through the HTTP pipeline; engine failures carry `field`-scoped issues.

### @fluojs/serialization

- Contract: `packages/serialization/README.md` (metadata preload, quick start, cycle/reference semantics, interceptor bypass, inheritance).
- Source: `src/serialize.ts`, `src/serializer-interceptor.ts` (bypass on `response.committed`), `src/metadata.ts` (throws `Decorator metadata is not available` without `Symbol.metadata`), `src/import-side-effects.test.ts` (pins that importing the package does NOT install `Symbol.metadata`), `src/decorators/expose.ts`.
- Environment fact verified on this machine: `node -e "console.log(typeof Symbol.metadata)"` → `undefined` on Node v24.20.0, so the documented `ensureMetadataSymbol()` preload is required for applications; the repo vitest setup supplies it for tests.
- Verified in fixtures: expose/transform output, `@Exclude` stripping, cyclic back edge cut to `undefined`, shared references preserved, interceptor-shaped response body.

### @fluojs/graphql

- Contract: `packages/graphql/README.md` (forRoot/forRootAsync, fixed `/graphql`, output typing rules, guardrails, ws budgets).
- Source: `src/module.ts` (`forRoot`, `forRootAsync` accepting only `inject`/`useFactory`), `src/types.ts` (`GraphqlModuleOptions`, `listOf`), `src/decorators.ts` (`@Arg` field decorator, `@Query/@Mutation/@Subscription` method options, `@FieldResolver`, `@Args/@Parent/@Context` index bindings), `src/service.ts` (`@Controller('/graphql')` endpoint controller + lifecycle middleware).
- Verified in fixtures: native-server query success, failed DTO rule → `errors[0].extensions.code === 'BAD_USER_INPUT'` with `issues[0].field`, mutation, and fresh-operation `currentMessage` proving operation-scoped isolation of a `@Scope('request')` store.

### @fluojs/openapi

- Contract: `packages/openapi/README.md` (sources/descriptors, defaults, 3.1 strictness, multi-document, async registration).
- Source: `src/openapi-module.ts` (`OpenApiModuleOptions` incl. `defaultErrorResponsesPolicy`, snapshot/freeze behavior), `src/schema-builder.ts` (`OpenApiDocumentBuilderOptions`, `OpenApiDocumentBuilder.build`), `src/decorators.ts` (`ApiTag`, `ApiOperationOptions`, `ApiResponseOptions`, `ApiBodyOptions`, `ApiParam(name, options)`, `ApiSecurity(name, scopes)`).
- Verified in fixtures: served document exposes `paths['/users'].post.requestBody.content['application/json']` (DTO-derived), default `201` + `400` responses, `UserResponseDto` component; controller routes and document route coexist; offline builder produces the same structure.

## Not executed (explicit gaps)

- GraphQL WebSocket subscriptions and SSE subscriptions (HTTP queries/mutations only; ws requires a Node HTTP/S upgrade surface and `subscriptions.websocket.enabled`).
- SSE (`@Sse`), static assets, Early Hints, byte-range responses, CORS/rate-limit/security-headers middleware — documented from README/source only, not fixture-exercised.
- Swagger UI HTML rendering (`ui: false` in the fixture; document route and offline builder only). The pinned `swagger-ui-dist` asset URL is not fetched by any test.
- Localized validation messages (`@fluojs/i18n/validation`), `parseStandardSchema` in an HTTP pipeline, `createSchemaDto`/`StandardSchemaBinder` (documented from source; standalone `parseStandardSchema` is covered by package tests, not here).
- Non-Node runtimes (Bun/Deno/Workers) — every assigned package pins Node `>=24.0.0 <27`.
- Guide prose fragments (for example the GraphQL `forRootAsync` and OpenAPI multi-document fragments) are source-derived and shaped by the compiled fixture examples, but not every inline fragment was separately compiled.
- No Docker/native external services were needed: the GraphQL fixture runs on the native Node HTTP adapter, and no fixture claims database or broker behavior.
