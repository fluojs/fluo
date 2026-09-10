# FluoBlog: cumulative tutorial checkpoints

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Build a small posts API with Node.js 24, Fastify, pnpm, explicit module
registration, constructor injection, DTO validation, and request-pipeline tests.
The [FluoBlog tutorial](../../apps/docs/content/docs/tutorial/index.mdx) starts
with `00-start`: edit this same application throughout the course. The complete
`01-first-route`, `02-dependency-injection`, and `03-validation-errors`
directories are immutable comparison/recovery snapshots, not the files you edit
as you learn.

The example stores posts in memory. Restarting the application resets its data.
It does not implement a database, authentication, authorization, update/delete,
or a production deployment. Persistence and authentication are follow-on guides.

## Build one application

Every stage preserves the starter `GET /health` and `GET /ready` routes through
`HealthModule.forRoot()` from `@fluojs/runtime`.

| Lesson | Start state | Complete end state |
| --- | --- | --- |
| Create app | `00-start` | Health/readiness only; begin editing `00-start/src/`. |
| First route | The same `00-start` app | Add `GET /posts` and explicit controller registration; compare against `01-first-route`. |
| Dependency injection | Your first-route changes in `00-start` | Add list/get service, `PostsModule`, constructor injection, and resource 404; compare against `02-dependency-injection`. |
| Validation and errors | Your DI changes in `00-start` | Add validated `POST /posts`, 201 and field-level 400 errors; compare against `03-validation-errors`. |
| Testing | Your completed `00-start` app | Add the final snapshot's service, module, and request tests to your working app; retain its health/readiness tests. |

The seed and each snapshot contain their own complete `src/` and `test/`. No
application source imports another checkpoint. Shared Vite/Vitest configuration
is only repository execution infrastructure. The seed's tests assert only
health/readiness, so adding posts does not invalidate them.

```text
00-start/                    # edit this application throughout the course
  src/
    app.ts
    main.ts
  test/app.e2e.test.ts
01-first-route/
  src/
    app.ts
    main.ts
    post.ts
    posts.controller.ts
  test/app.e2e.test.ts
02-dependency-injection/
  src/
    app.ts
    main.ts
    post.ts
    post-params.dto.ts
    posts.controller.ts
    posts.module.ts
    posts.service.ts
    posts.slice.test.ts
  test/app.e2e.test.ts
03-validation-errors/
  src/
    app.ts
    main.ts
    post.ts
    post-params.dto.ts
    create-post.dto.ts
    posts.controller.ts
    posts.module.ts
    posts.service.ts
    posts.service.test.ts
    posts.slice.test.ts
  test/app.e2e.test.ts
```

`src/app.ts` exports `AppModule` in every checkpoint. Tests import it without
starting a socket. `src/main.ts` is the executable bootstrap. `post.ts` exports
the `Post` interface. Other classes are named exports matching their filenames:
`PostsController`, `PostsModule`, `PostsService`, `PostParamsDto`, `CreatePostDto`.

In `00-start/src/`, first author `post.ts` and `posts.controller.ts` and register
the controller in `app.ts`. Next add `posts.module.ts`, `posts.service.ts`, and
`post-params.dto.ts`, then update the same `app.ts` and `posts.controller.ts`.
Finally add `create-post.dto.ts` and extend the same controller and service.
Use the corresponding snapshot to check your end state without switching your
working directory. If you need recovery, copy that snapshot's complete source
into `00-start/src/`, then keep working in `00-start`.

## Run inside the repository

Use Node.js 24 and the root-pinned pnpm version. The declared Node support range
is `>=24.0.0 <27`. From a clean clone's repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @fluojs/example-fluo-blog typecheck
pnpm --filter @fluojs/example-fluo-blog test 00-start
pnpm --filter @fluojs/example-fluo-blog build:00
pnpm --filter @fluojs/example-fluo-blog start:00
```

The root build prepares the public workspace packages used by this private
example. After each lesson, stop with Ctrl+C, rebuild with `build:00`, and run
`start:00` again. These commands always execute your evolving `00-start` app.
Do not switch to `start:01`, `start:02`, or `start:03` to complete a lesson.

To inspect a reference snapshot independently, stop your learning app and use:

```bash
pnpm --filter @fluojs/example-fluo-blog build:01
pnpm --filter @fluojs/example-fluo-blog start:01
```

```bash
pnpm --filter @fluojs/example-fluo-blog build:02
pnpm --filter @fluojs/example-fluo-blog start:02
```

```bash
pnpm --filter @fluojs/example-fluo-blog build:03
pnpm --filter @fluojs/example-fluo-blog start:03
```

`build` and `start` are aliases for the final reference snapshot, stage 03.
Use the explicit `build:00`/`start:00` commands for the course. The builds use
`fluoDecoratorsPlugin()` from `@fluojs/vite`, the generated-starter Vite
configuration pattern, and a `node24` target. Output is
`dist/<checkpoint>/main.js`, executed by Node, not a custom tutorial runner.

All stages bind to `127.0.0.1:3000`. To choose another port:

```bash
PORT=3100 pnpm --filter @fluojs/example-fluo-blog start:00
```

Each `main.ts` creates a static Fastify adapter and calls `FluoFactory.create(...)`
with an explicit Node shutdown callback, then awaits `app.listen()`. Ctrl+C closes the application and
listener; after the process exits, the port can be reused. Calling `app.close()`
is the corresponding explicit cleanup when you own an application object.

## Use sources in a CLI-generated application

The repository's `workspace:*` manifest and checkpoint-mode build configuration
are not standalone application templates. Generate the ordinary Node + Fastify
application with pnpm:

```bash
pnpm dlx @fluojs/cli new fluo-blog \
  --shape application --transport http \
  --runtime node --platform fastify --package-manager pnpm
cd fluo-blog
```

This is a separate application, not the working directory used by the course.
Keep its generated package/configuration files, greeting feature, and tests.
When reusing a posts feature after the course, copy its feature files and merge
the posts registration into the existing `src/app.ts`. Preserve the generated
config, greeting, and health imports; do not replace the root module or delete
starter tests to make the two applications look alike. The complete-file lesson
instructions apply only to the repository's `00-start` application.

The final checkpoint imports `@fluojs/validation`; ensure that dependency is
present in the generated application, adding it with
`pnpm add @fluojs/validation` if necessary. The generated starter supplies the
Fluo runtime, Fastify adapter, and standard-decorator build/test setup.

Verify the combined application with its own commands, not repository stage scripts:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`pnpm build` and `pnpm start` delegate to `fluo build` and `fluo start` in that
application. Do not run decorated source directly with Node's type stripping
or enable legacy `experimentalDecorators`/`emitDecoratorMetadata`.

## Try the API

With your learning app running, use another terminal:

```bash
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/ready
```

The health routes return 200 with `{"status":"ok"}` and
`{"status":"ready"}`. Once you complete the first-route lesson, request the new
route (also available in reference snapshots 01/02/03):

```bash
curl -i http://127.0.0.1:3000/posts
```

A fresh posts list returns 200:

```json
[{"id":"1","title":"Hello, Fluo!","content":"My first post."}]
```

After the DI lesson (reference snapshots 02/03), `GET /posts/1` returns that post object with 200.
`GET /posts/999` returns 404:

```json
{"error":{"code":"NOT_FOUND","message":"Post 999 was not found.","status":404}}
```

The framework may add `error.requestId`. The service throws
`NotFoundException`; it does not return `undefined` as a successful response.

After the validation-errors lesson (reference snapshot 03):

```bash
curl -i http://127.0.0.1:3000/posts \
  -H 'content-type: application/json' \
  --data '{"title":"Learning Fluo","content":"Explicit modules and DI."}'
curl -i http://127.0.0.1:3000/posts/2
curl -i http://127.0.0.1:3000/posts
```

The first create returns 201:

```json
{"id":"2","title":"Learning Fluo","content":"Explicit modules and DI."}
```

The following get and list include the new post. IDs are sequential strings
inside one running application instance.

`CreatePostDto` binds the body fields using `@FromBody()`. The handler selects
that DTO with `@RequestDto(CreatePostDto)`. Required string rules reject missing,
null, non-string, and out-of-range values before the service runs:

| Field | Rules |
| --- | --- |
| `title` | Required string, 3 to 120 characters |
| `content` | Required string, 1 to 5000 characters |

Strings are not trimmed. The HTTP binder rejects body fields not declared by
the DTO bindings with 400 and `UNKNOWN_FIELD` details. For example, a client
cannot supply its own `id` or `admin` flag. This is the HTTP request-binding
contract, not the standalone validator's default unknown-property policy.

```bash
curl -i http://127.0.0.1:3000/posts \
  -H 'content-type: application/json' \
  --data '{"title":"ab","content":"Valid content"}'
```

Invalid input returns 400 in the canonical `error` envelope, with
`code: "BAD_REQUEST"`, `status: 400`, a message and field-level `details`.
Each detail includes a stable `code`, `field`, `source: "body"`, and a message.
Rejected requests do not add a post. Tests assert status and structured fields,
not natural-language wording.

## Test the final checkpoint

Extend `00-start/test/app.e2e.test.ts` with the final snapshot's request tests,
retaining its existing health/readiness checks. Add the service and module
tests next to your authored sources. Their relative imports work unchanged
because the working application has the same source layout. Run your own work:

```bash
pnpm --filter @fluojs/example-fluo-blog test 00-start
```

To verify the immutable final reference through the installed packages:

```bash
pnpm --filter @fluojs/example-fluo-blog test 03-validation-errors
```

Or verify every checkpoint through the repository's examples project:

```bash
pnpm exec vitest run --project examples examples/fluo-blog
```

`posts.service.test.ts` checks in-memory behavior. `posts.slice.test.ts` compiles
the real module graph with `createTestingModule`, resolves registered providers,
and disposes the container in `finally`. `test/app.e2e.test.ts` calls
`createTestApp({ rootModule: AppModule })`, drives the real request pipeline with
`app.request(...).body(...).send()`, and closes every application in `finally`.

The request tests cover preserved health/readiness, list/create/get, input
boundaries, missing/null/non-string/oversized values, resource 404, rejected-write
behavior, client-owned extra fields, and application-instance isolation. They
open no network sockets, use no fixed sleeps, and do not replace the service
with a mock. Use the built `main.ts` entrypoints and the curl sequence above to
check the actual Fastify listener as well.
