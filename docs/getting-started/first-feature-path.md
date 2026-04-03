# from quick start to first feature

<p><strong><kbd>English</kbd></strong> <a href="./first-feature-path.ko.md"><kbd>한국어</kbd></a></p>

This guide picks up immediately after `quick-start.md`. Its goal is simple: move from "the app boots" to "I can add one real feature, document it, test it, and inspect the runtime output" without leaving the repository docs.

### related documentation

- `./quick-start.md`
- `./generator-workflow.md`
- `../operations/testing-guide.md`
- `../concepts/openapi.md`
- `../reference/package-chooser.md`
- `../../examples/minimal/README.md`
- `../../examples/realworld-api/README.md`

## the official next step after quick start

If `konekti new starter-app` and `pnpm dev` already work, the recommended next path is:

1. Read the **minimal** example to see the smallest complete request path.
2. Read the **realworld-api** example to see a real module boundary, DTO validation, and explicit DI.
3. Generate one new domain slice with the CLI.
4. Add request DTO validation and response shape documentation.
5. Run tests.
6. Export a runtime snapshot with `konekti inspect --json` and open it in Studio.

That sequence gives you the first practical Konekti loop without forcing you to jump between package READMEs randomly.

## step 1: start from the smallest runnable shape

Read `../../examples/minimal/README.md` first.

That example shows:

- runtime-owned bootstrap,
- standard decorator usage,
- a single controller/service path,
- built-in `/health` and `/ready`,
- and the smallest testing path.

If you are coming from NestJS, this is the fastest place to internalize the two most important differences:

- no `@Injectable()` requirement,
- explicit dependency metadata through `@Inject([...])`.

## step 2: move to a real module boundary

Read `../../examples/realworld-api/README.md` next.

That example adds:

- `imports` / `exports` module composition,
- typed config,
- request DTO validation,
- explicit repository and service wiring,
- a realistic CRUD surface,
- integration and e2e-style tests.

This is the best current in-repo example for learning how a Konekti feature grows past the starter scaffold.

## step 3: generate your first slice

Use the CLI to scaffold one small domain path.

```bash
konekti generate module users
konekti generate controller users
konekti generate service users
konekti generate repo users
konekti generate request-dto create-user
konekti generate response-dto user-profile
```

Recommended reading order after generation:

1. generated DTO
2. generated repo
3. generated service
4. generated controller
5. generated module

If you want a more detailed explanation of generator output and auto-registration rules, continue to `./generator-workflow.md`.

## step 4: make the request boundary explicit

For the first feature, prefer the standard Konekti boundary split:

- request binding in `@konekti/http`
- validation in `@konekti/validation`
- output shaping in `@konekti/serialization` when needed

The mental model is:

```text
controller route
  -> request DTO binding
  -> validation
  -> service call
  -> optional serialization
```

If you need a worked example, use `examples/realworld-api/src/users/*` as the canonical reference.

## step 5: document the feature with OpenAPI

If the feature belongs to an HTTP API, add `@konekti/openapi` when you want a generated contract.

- canonical artifact: `GET /openapi.json`
- optional interactive viewer: `GET /docs` via Swagger UI

Read `../concepts/openapi.md` before adding the package if you want the cross-package model, and `../../packages/openapi/README.md` if you want the package API directly.

## step 6: test before you widen the app

Do not wait until the feature is large.

Use `../operations/testing-guide.md` to choose one of these paths early:

- unit test for pure logic,
- integration/slice test for module wiring,
- e2e-style dispatch test for route behavior.

The examples already show the expected layout and naming style for those tests.

## step 7: inspect the runtime snapshot

Once the feature exists, export the runtime platform snapshot.

```bash
konekti inspect ./src/app.module.mjs --json
konekti inspect ./src/app.module.mjs --mermaid
konekti inspect ./src/app.module.mjs --timing
```

What this gives you:

- canonical JSON snapshot for Studio,
- dependency-chain rendering via Mermaid,
- optional timing payload for bootstrap analysis.

Then use `@konekti/studio` to load the exported JSON and inspect:

- component readiness,
- component health,
- diagnostics with `fixHint`,
- ownership details,
- dependency chains.

## step 8: choose the next package deliberately

After one working feature, do not add packages by guesswork.

Use `../reference/package-chooser.md` to decide the next step by task:

- auth,
- metrics,
- OpenAPI,
- queue/cron/event-bus,
- Redis/Prisma/Drizzle,
- GraphQL,
- caching.

That keeps the learning path repo-native and markdown-first.

## recommended first-feature checklist

Use this checklist for the first real slice you add to a starter app:

- [ ] route exists
- [ ] service exists
- [ ] module wiring is explicit
- [ ] request DTO validation exists when inputs are non-trivial
- [ ] response shape is deliberate
- [ ] at least one test exists
- [ ] optional OpenAPI contract exists if the surface is public HTTP
- [ ] runtime snapshot can be exported and inspected

## where to go next

- Want deeper module/DI reasoning? → `../concepts/di-and-modules.md`
- Want API documentation? → `../concepts/openapi.md`
- Want testing recipes? → `../operations/testing-guide.md`
- Want package-by-task selection? → `../reference/package-chooser.md`
- Want runnable examples first? → `../../examples/README.md`
