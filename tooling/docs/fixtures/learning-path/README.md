# Learning Path Checkpoints (Node + Fastify posts app)

Six cumulative, independently runnable public-API checkpoints for a
CLI-generated Fluo application. Each checkpoint directory contains COMPLETE,
copy-ready files for the generated project's `src/posts/` directory. Files are
imported by the generated root module only (`./filename` relative imports);
checkpoints never import from each other. No database, no auth.

The generated root module (`src/app.ts`) keeps its existing
`ConfigModule`, `GreetingModule`, and `HealthModule.forRoot()` wiring; every
checkpoint only adds `PostsModule` to `imports`.

## File manifest

| Stage | Directory | Files |
| --- | --- | --- |
| 01 modules | `01-modules/` | `posts.module.ts` (empty `PostsModule`; health handled by root) |
| 02 controllers | `02-controllers/` | `posts.module.ts` (+ `controllers: [PostsController]`), `posts.controller.ts` (`GET /posts` static seed) |
| 03 providers | `03-providers/` | `posts.module.ts` (+ `providers: [PostsService]`), `posts.controller.ts` (`@Inject(PostsService)` constructor injection), `posts.service.ts` (singleton stores the seed) |
| 04 validation | `04-validation/` | `posts.module.ts`, `posts.controller.ts` (+ `POST /posts`), `posts.service.ts` (+ generated sequential ids), `create-post.dto.ts` |
| 05 serialization | `05-serialization/` | `posts.module.ts` (+ `providers: [PostsService, SerializerInterceptor]`), `posts.controller.ts` (+ `@UseInterceptors(SerializerInterceptor)`, explicit `PostResponseDto` instances), `posts.service.ts` (`Post[]` with `internalNotes`), `post.ts`, `post-response.dto.ts`, `create-post.dto.ts` |
| 06 errors | `06-errors/` | `posts.module.ts`, `posts.controller.ts` (+ `GET /posts/:id`), `posts.service.ts` (+ `get(id)` throwing `NotFoundException`), `post.ts`, `post-response.dto.ts`, `create-post.dto.ts`, `post-params.dto.ts` |

Test infrastructure (not part of any copy manifest): `01-modules.test.ts`,
`02-controllers.test.ts`, `03-providers.test.ts`, `04-validation.test.ts`,
`05-serialization.test.ts`, `06-errors.test.ts`, `test-support.ts`.

## Behavior contract per checkpoint

- Seed: exactly `{ id: '1', title: 'Hello Fluo', content: 'First post' }`.
- 02/03: `GET /posts` returns the seed list (03 serves it from the injected singleton).
- 04: `POST /posts` validates `CreatePostDto` (`title`: `@IsString() @MinLength(3) @MaxLength(120)`;
  `content`: `@IsString() @MinLength(1) @MaxLength(5000)`), answers `201` via
  `@HttpCode(201)`, and generates sequential string ids (`'2'`, `'3'`, ...).
- 05: handlers return explicit `PostResponseDto` instances; class-level
  `@Expose({ excludeExtraneous: true })` plus `SerializerInterceptor` strips the
  unexposed `internalNotes` field on both `GET /posts` and `POST /posts`.
- 06: `GET /posts/:id` binds `@FromPath('id')` through `PostParamsDto`; unknown
  ids throw `NotFoundException` and map to the canonical
  `404 { error: { code: 'NOT_FOUND', status: 404 } }` envelope; list/create behavior is retained.
- The route decorator is imported as `Post as PostRoute` from checkpoint 04
  onward to avoid colliding with the `Post` model type introduced in 05.
- DTO fields are initialized decorated fields; all exports are named exports.

## Test suite

Each `NN-*.test.ts` assembles its checkpoint exactly as a generated root
module would — `@Module({ imports: [HealthModule.forRoot(), PostsModule] })` —
boots it with `Test.createApp({ rootModule })`, and asserts
`/health` → `200 { status: 'ok' }` and `/ready` → `200 { status: 'ready' }` in
every stage. `06-errors.test.ts` additionally boots the same checkpoint
through `FluoFactory.create` with
`FastifyHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 })` and
exercises a real HTTP round trip (list, create, 404, health, ready) over a real
listening socket. All apps are closed via `app.close()` in `finally`; the port
is OS-assigned; there are no sleeps, so runs are deterministic.

## Verification

Commands run from the worktree root (`docs-foundation` @ `e0c73126e`):

1. Red (before any checkpoint implementation):
   `pnpm vitest run tooling/docs/fixtures/learning-path`
   → `Test Files 6 failed (6)`, `Tests no tests`; every suite failed with
   `Error: Cannot find module './0N-.../posts.module'`.
2. Red after 01–03 landed: same command →
   `Test Files 3 failed | 3 passed (6)`, `Tests 6 passed (6)`
   (04/05/06 still failing on missing modules).
3. Green (all six checkpoints implemented):
   `CI=1 pnpm vitest run tooling/docs/fixtures/learning-path --reporter=verbose`
   → `Test Files 6 passed (6)`, `Tests 19 passed (19)`; the real-listener test
   logged `FluoFactory Listening on http://127.0.0.1:<ephemeral>` and
   `fluo application successfully started.`
4. Typecheck: `tsc -p tsconfig.tools.json --noEmit` → 0 errors under
   `tooling/docs/fixtures/learning-path`. The 17 remaining errors are
   pre-existing in this worktree and outside this track
   (`packages/passport/src/**` missing `@fluojs/jwt` dist;
   `tooling/realtime-native/fixtures/*.ts` missing `@fluojs/websockets`
   dist types).
5. Lint/LSP: `biome check --write tooling/docs/fixtures/learning-path`
   (fixed import order in 5 test files; clean afterwards); LSP diagnostics on
   the directory → `Total diagnostics: 0`.
6. Scope: `git status --porcelain tooling/docs/fixtures/learning-path`
   shows only this directory as new; no other files touched, no commits made.

## Source and API references

- `@fluojs/core`: `Module`, `Inject` (`packages/core/src/decorators.ts`).
- `@fluojs/http`: `Controller`, `Get`, `Post`, `HttpCode`, `RequestDto`,
  `FromBody`, `FromPath`, `UseInterceptors`, `NotFoundException`
  (`packages/http/src/decorators.ts`, `packages/http/src/index.portable.ts`).
- `@fluojs/validation`: `IsString`, `MinLength`, `MaxLength`
  (`packages/validation/src/decorators.ts`).
- `@fluojs/serialization`: `Expose` (`packages/serialization/src/decorators/expose.ts`),
  `SerializerInterceptor` (`packages/serialization/src/serializer-interceptor.ts`);
  `excludeExtraneous` emits only `@Expose()`-marked fields
  (`packages/serialization/src/serialize.ts`, `resolveCandidateKeys`).
- `@fluojs/runtime`: `HealthModule.forRoot` with `/health` and `/ready`
  (`packages/runtime/src/health/health.ts`), `FluoFactory.create`
  (`packages/runtime/src/bootstrap.ts`).
- `@fluojs/testing`: `Test.createApp` request facade
  (`packages/testing/src/module.ts`, `packages/testing/src/http.ts`).
- `@fluojs/platform-fastify`: `FastifyHttpApplicationAdapter.create` and
  `getListenTarget` (`packages/platform-fastify/src/adapter.ts`).
- Canonical error envelopes (404 `NOT_FOUND`, 400 `BAD_REQUEST`) follow the
  existing docs fixture precedent
  (`tooling/docs/fixtures/docs-foundation/controllers.http.test.ts`).

## Left for lead verification (outside this track)

- Copying each checkpoint into a real `fluo new`-generated project and running
  that project's own dev/test entry points (generated root module wiring with
  `ConfigModule`/`GreetingModule`/`HealthModule` plus `PostsModule`).
- Rendering the checkpoint files in MDX via the server-side `CheckpointCode`
  component and running the docs EN/KO parity pipeline for the affected pages.
