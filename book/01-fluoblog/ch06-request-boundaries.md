# Turning External Input into Internal Data

<!-- book:volume=01-fluoblog;chapter=06 -->

[Previous: How Drafts Differ from Published Posts](./ch05-post-domain.md) | [Volume 1 Contents](./toc.md) | [Next: Separating Stored Data from Public Data](./ch07-response-models.md)

## A Non-Numeric Value Arrived Despite the Type Annotation

After defining the publication rules, the operator connects the editing screen. Everything works for normal requests. But a small change in the browser's developer tools lets someone send the string `"1"` as `expectedVersion`, or add `authorId` and `status` to the body. An ID in a URL is a string to begin with. Writing `number` on a controller argument does not turn `"2"` into the number 2.

The previous chapter's service accepts commands that can be called inside the server. Force a non-string title into `createDraft()`, and it fails as soon as it calls `trim()`. Checking every possible shape of HTTP values in every domain function is not a good alternative either. Scheduled tasks and tests already pass typed values, so they would repeat the same checks. Let us establish the source, representation, and validity of input at a single point where it enters from the outside world.

This chapter connects DTO binding in `@fluojs/http` with validation in `@fluojs/validation`. Binding determines where to read a value, conversion changes its representation, and validation decides whether the converted value is allowed. Finally, the controller selects only the necessary fields and transfers them into a service command. Keeping this order prevents values smuggled into a request from becoming authoritative values in the storage model.

The writing API in this chapter is a local operator exercise before authentication is introduced. It runs on `127.0.0.1`, and the server sets the author to `author-1`. We do not present it as authentication for a publicly deployed production system. Later chapters on accounts, authentication, and authorization keep this writing boundary and connect it to a server-verified user ID. The shop in Volume 2 continues using the same account.

## Divide the Boundary into Three Questions

The body accepted by `POST /posts` contains only `title`, `content`, and `slug`. All three strings may be empty because this is a draft. `status`, `id`, `authorId`, `publishedAt`, and `version` belong to the server. Saving the entire body with object spread, as in an initial implementation, would let the client choose these values too. The allowlist is determined by the server's command shape, not the UI's input form.

`PUT /posts/:id` replaces the title, body, and slug in full. We do not introduce a `PATCH` contract that leaves omitted fields unchanged at the same time. Requiring `expectedVersion` connects the previous chapter's conflict check to HTTP. `POST /posts/:id/publish` is a command that transitions an existing draft rather than recreating the post. We therefore explicitly use `200` for successful publication and `201` for creating a new draft.

When optional fields become necessary, distinguish two meanings of "optional." HTTP's `@Optional()` skips a binding failure when the value is absent from the relevant request source. Validation's `@IsOptional()` skips other validation rules when the value is `null` or `undefined`. Ordinary field validators also skip those two values, so required values need `@IsDefined()`. Stacking decorators without first deciding whether omission and explicit `null` mean the same thing can let empty input pass unexpectedly.

### Define the Syntax Before Converting URL Numbers

`Number('')` is 0, and `parseInt('2oops', 10)` is 2. That convenience is not the contract for post IDs. An ID in this app must be a positive decimal integer string without a leading zero, within the safe integer range. The following is the **complete `src/posts/post-id.converter.ts` file**.

```ts
import type { Converter } from '@fluojs/http';

export class PostIdConverter implements Converter {
  convert(value: unknown): number {
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
      return Number.NaN;
    }
    const result = Number(value);
    return Number.isSafeInteger(result) ? result : Number.NaN;
  }
}
```

Returning `NaN` for an invalid conversion lets the subsequent `@IsInt()` treat it as a field validation failure. Throwing an ordinary `Error` here could classify it as a server processing failure rather than a request error. If you want the converter itself to reject user input directly, throwing an explicit `BadRequestException` is another option. This chapter separates conversion from rejection to reuse the validator's field-level error details.

We do not apply this converter to `expectedVersion` in the JSON body. JSON can already represent numbers, so there is no reason to automatically accept a string. The transport constraint that URLs supply strings does not warrant the same permissiveness for JSON data types.

## Declare the DTOs That HTTP Will Assemble

The following is the **complete `src/posts/post-request.dto.ts` file**. Omitting the argument to `@FromBody()` reads the body key with the same name as the property. `@FromPath('id')` reads the ID from the path. The source is not inferred from constructor arguments or TypeScript types.

```ts
import { Convert, FromBody, FromPath } from '@fluojs/http';
import { IsDefined, IsInt, IsString, Max, MaxLength, Min } from '@fluojs/validation';
import { PostIdConverter } from './post-id.converter.js';

export class CreatePostDto {
  @FromBody()
  @IsDefined()
  @IsString()
  @MaxLength(120)
  title = '';

  @FromBody()
  @IsDefined()
  @IsString()
  @MaxLength(50_000)
  content = '';

  @FromBody()
  @IsDefined()
  @IsString()
  @MaxLength(80)
  slug = '';
}

export class GetPostDto {
  @FromPath('id')
  @Convert(PostIdConverter)
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id = 0;
}

export class ReplacePostDto extends CreatePostDto {
  @FromPath('id')
  @Convert(PostIdConverter)
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id = 0;

  @FromBody()
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion = 0;
}

export class PublishPostDto extends GetPostDto {
  @FromBody()
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion = 0;
}
```

We have not declared decorated fields as `title!: string`. Fluo's current Babel decorator transformation path can reject this definite assignment form. Providing an initial value does not automatically turn a missing title into an empty draft, either. The binder detects the absence of the required `@FromBody()` field first, so the client must explicitly send an empty string. This distinguishes an empty work-in-progress value from a bug that omits the field.

Inheriting from the creation DTO reuses the allowed input fields and validation metadata. It does not inherit from the storage model. The storage model contains server-owned fields and state transition rules; the request DTO contains only values that may be accepted from outside. We will preserve this boundary even if we use `PartialType()` later. The convenience of mapped DTOs is no reason to expose the entire `PostSnapshot` through an editing API.

You may notice that length limits appear in both the domain and the request DTO. The two checks protect different call paths. HTTP rejects excessively long raw text before running server logic, while the domain maintains its limits for internal calls that do not come through HTTP. The domain trims the title, but the DTO checks the raw length first, so a 121-character title padded with whitespace is still rejected. It is better to document this difference in the input contract than hide it.

## Translate Domain Failures into HTTP Failures

Throwing a domain exception unchanged does not make the framework recognize its business meaning and turn it into `409`. The HTTP writer recognizes `HttpException`; other ordinary errors are treated as internal errors. The following is the **complete `src/posts/post-http-error.ts` file**. It maps every error code defined in the previous chapter.

```ts
import { HttpException } from '@fluojs/http';
import { PostDomainError, type PostErrorCode } from './post.js';

const statusByCode = {
  POST_NOT_FOUND: 404,
  POST_INVALID_TEXT: 400,
  POST_VERSION_CONFLICT: 409,
  POST_NOT_DRAFT: 409,
  POST_NOT_PUBLISHABLE: 400,
  POST_SLUG_CONFLICT: 409,
} satisfies Record<PostErrorCode, number>;

export function runPostCommand<T>(action: () => T): T {
  try {
    return action();
  } catch (error: unknown) {
    if (error instanceof PostDomainError) {
      throw new HttpException(statusByCode[error.code], error.message, {
        code: error.code,
      });
    }
    throw error;
  }
}
```

This helper is specific to the current synchronous service. If we switch to an asynchronous store, a synchronous `catch` will not catch a rejection of the Promise returned by `action()`. At that point, we must also change this boundary to return a Promise and `await action()` inside the `try`. We do not add `async` to every function now to accommodate an asynchronous implementation that does not yet exist.

The built-in `ConflictException` provides the stable framework code `CONFLICT`. Here, the client needs to respond differently to version conflicts and slug conflicts, so we use the `code` option on the base `HttpException`. We do not put raw user input into `meta` or copy an error's `cause` into response fields. We translate only known errors and rethrow the rest so that server defects are not disguised as normal input rejection.

The following is the **complete `src/posts/posts.controller.ts` for this stage of the chapter**. It still returns internal snapshots; we will replace the response models in the next chapter. This stage is therefore a boundary for checking the local writing flow, not the final public response contract.

```ts
import { Inject } from '@fluojs/core';
import { Controller, Get, HttpCode, Post, Put, RequestDto } from '@fluojs/http';
import { runPostCommand } from './post-http-error.js';
import { CreatePostDto, GetPostDto, PublishPostDto, ReplacePostDto } from './post-request.dto.js';
import { PostsService } from './posts.service.js';

@Controller('/posts')
@Inject(PostsService)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list() {
    return this.posts.listPublished();
  }

  @Get('/:id')
  @RequestDto(GetPostDto)
  get(input: GetPostDto) {
    return runPostCommand(() => this.posts.getPublished(input.id));
  }

  @Post()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return runPostCommand(() => this.posts.create('author-1', {
      title: input.title, content: input.content, slug: input.slug,
    }));
  }

  @Put('/:id')
  @HttpCode(200)
  @RequestDto(ReplacePostDto)
  replace(input: ReplacePostDto) {
    return runPostCommand(() => this.posts.revise(input.id, input.expectedVersion, {
      title: input.title, content: input.content, slug: input.slug,
    }));
  }

  @Post('/:id/publish')
  @HttpCode(200)
  @RequestDto(PublishPostDto)
  publish(input: PublishPostDto) {
    return runPostCommand(() => this.posts.publish(input.id, input.expectedVersion));
  }
}
```

Without `@RequestDto()`, the type annotation `input: CreatePostDto` alone does not enable binding. Types disappear after compilation. With explicit DTO registration and validation metadata, the HTTP pipeline validates after binding and then calls the handler. The application does not need to register an imaginary separate `ValidationModule` or unconditionally add `DefaultValidator` as a global provider.

## An Unregistered Type Is Not an Execution Path

The following are the **replacement `src/posts/posts.module.ts` file** and the **complete `src/app.ts` for this exercise**. We keep the previous chapter's clock token and service, and connect the controller and converter to the actual provider graph. The converter has no dependencies to inject, so it uses a constructor with no arguments.

```ts
// src/posts/posts.module.ts
import { Module } from '@fluojs/core';
import { PostIdConverter } from './post-id.converter.js';
import { PostsController } from './posts.controller.js';
import { POST_CLOCK, PostsService, type PostClock } from './posts.service.js';

@Module({
  controllers: [PostsController],
  providers: [
    PostsService,
    PostIdConverter,
    { provide: POST_CLOCK, useValue: { now: () => new Date() } satisfies PostClock },
  ],
  exports: [PostsService],
})
export class PostsModule {}
```

```ts
// src/app.ts
import { Module } from '@fluojs/core';
import { PostsModule } from './posts/posts.module.js';

@Module({ imports: [PostsModule] })
export class AppModule {}
```

If your app already has other feature modules, preserve their `imports` and connect `PostsModule` once. Do not register the controller in both the root and the feature module. Composing them by providing the same `/posts` routes twice causes a route conflict at startup.

To make standard-decorator metadata preinstallation explicit, use the following **complete `src/main.ts` file**. The serialization classes in the next chapter do not install `Symbol.metadata` as an import side effect, so preparing it before decorated modules matters.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
const { AppModule } = await import('./app.js');
const { runFastifyApplication } = await import('@fluojs/platform-fastify');
await runFastifyApplication(AppModule, { host: '127.0.0.1', port: 3000 });
```

`runFastifyApplication()` starts listening and registers shutdown handling before it resolves. Do not call `app.listen()` again afterward. Start through the previous chapter's CLI/Vite execution path rather than handing `main.ts` directly to Node's untransformed TypeScript execution feature. Changing the decorator build configuration to legacy `experimentalDecorators` is not the solution.

## The HTTP Binder and Standalone Validation Are Different Entry Points

When using the validation package in a separate import job, you can materialize a DTO as follows. This block is the **complete unit test file `src/posts/request-validation.test.ts`**. We check the results separately so that they cannot be mistaken for having run the HTTP converter too.

```ts
import { describe, expect, it } from 'vitest';
import { DefaultValidator } from '@fluojs/validation';
import { CreatePostDto, GetPostDto } from './post-request.dto.js';

describe('Standalone post input validation', () => {
  const validator = new DefaultValidator();
  const input = { title: '', content: '', slug: '', status: 'published' };

  it('requires an explicit undeclared-property policy outside HTTP', async () => {
    const loose = await validator.materialize(input, CreatePostDto);
    expect(Object.hasOwn(loose, 'status')).toBe(true);
    await expect(
      validator.materialize(input, CreatePostDto, { undeclaredProperties: 'reject' }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'UNDECLARED_PROPERTY', field: 'status' }),
      ]),
    });
  });

  it('does not execute HTTP scalar conversion during materialization', async () => {
    await expect(validator.materialize({ id: '2' }, GetPostDto)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ field: 'id' })]),
    });
    await expect(validator.materialize({ id: 2 }, GetPostDto)).resolves.toMatchObject({ id: 2 });
  });
});
```

The default `materialize()` policy preserves safe additional own enumerable fields. The default HTTP binder, by contrast, compares body keys with those declared through `@FromBody()` and rejects unknown fields with `UNKNOWN_FIELD`. We must not claim that input from file imports or job queues is automatically strict just because HTTP was strict. Specify `{ undeclaredProperties: 'reject' }` at standalone input boundaries.

`materialize()` creates and validates a DTO, but it does not perform URL scalar conversion. That is why the first ID assertion expects failure. In the HTTP path, the binder calls `PostIdConverter` first, so it reads `/posts/2` as a valid number. `validate()` is the API for checking an already prepared root object. Failing to distinguish which function was called creates a puzzling gap where unit tests pass but real requests fail.

## Use Real Requests to Check Rejection Before the Service Call

The following is the **complete local check file `scripts/request-boundary-check.mjs`**. Run it once with `node scripts/request-boundary-check.mjs` against a freshly started application. Because it uses the same slug each time, restart the in-memory app before rerunning it. Instead of adding sleeps or readiness polling, confirm that the development server has started listening before running the script.

```js
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:3000';
async function request(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

const text = { title: 'Boundary test', content: 'Only declared input.', slug: 'boundary-test' };
const forged = await request('POST', '/posts', { ...text, authorId: 'other-author' });
assert.equal(forged.status, 400);
assert.ok(forged.body.error.details.some(
  (issue) => issue.code === 'UNKNOWN_FIELD' && issue.field === 'authorId',
));

const created = await request('POST', '/posts', text);
assert.equal(created.status, 201);
const id = created.body.id;
assert.equal(created.body.version, 1);
assert.equal((await request('GET', `/posts/${id}`)).status, 404);
assert.equal((await request('GET', '/posts/2oops')).status, 400);
assert.equal((await request('GET', '/posts/9007199254740992')).status, 400);
assert.equal((await request('GET', '/posts/999999')).status, 404);

const badVersion = await request('POST', `/posts/${id}/publish`, { expectedVersion: '1' });
assert.equal(badVersion.status, 400);
const published = await request('POST', `/posts/${id}/publish`, { expectedVersion: 1 });
assert.equal(published.status, 200);
assert.equal(published.body.version, 2);
const repeated = await request('POST', `/posts/${id}/publish`, { expectedVersion: 1 });
assert.equal(repeated.status, 409);
assert.equal(repeated.body.error.code, 'POST_VERSION_CONFLICT');
assert.equal((await request('GET', `/posts/${id}`)).status, 200);
console.log('Request boundary checks passed.');
```

This manuscript does not claim that the unit tests or HTTP script above were executed. The expected results are two passing unit tests and the script's final message. In particular, publication with the valid version 1 must still succeed after sending an invalid version. That observation demonstrates that the rejected request did not change state first. The actual responses also confirm the distinction between `400` for an invalid `GET` ID format and `404` for a well-formed ID with no matching post.

Sending an array as the body makes the default binder reject a violation of the object-body contract. `@IsDefined()` blocks `title: null`. If `title` is omitted, the binder's `MISSING_FIELD` comes first. Even when the status is the same `400`, the detail codes and sources differ. Client tests assert machine-consumed parts such as status, code, and field rather than an entire human-readable sentence. Changing the wording of a sentence should not break a functional test.

String length validation, however, limits values after parsing. This DTO does not prevent the cost of first reading a request of tens of MB into memory. Such limits must be configured separately at the transport boundary, using an option such as Fastify's `maxBodySize`. The chapters on file uploads and excessive requests will add byte limits and usage policies. Do not overstate the current limits as protection for the entire service.

## Optional Experiment: Project Input While Preserving the Original

Keep the class DTO exercise and check script above unchanged. `/posts` still rejects unknown body fields, and the later OpenAPI chapter still uses these classes' binding and validation metadata. The following is an **optional comparison experiment** for a consumer app with an existing input schema, not an instruction to replace the chapter's final implementation.

### Rejection and Removal Are Different Application Policies

When compatibility with clients that send extra fields is intentional, declare `@InputPolicy({ unknownFields: 'strip' })` from `@fluojs/http` on a separate DTO class or route method. The defaults remain `unknownFields: 'reject'` and `nonObjects: 'reject'`. A route overrides only explicitly declared policy fields; omitted fields retain the DTO settings. With `@FromBody('post_title')`, the allowlist key is the transport alias `post_title`, not `title`. Applying this policy alone to an ordinary class DTO does not require a schema binder.

`strip` does not hide non-object input. Only consumers that intend to treat arrays or primitives as an empty binding body should separately select `nonObjects: 'empty'`. Required class fields can still fail with `MISSING_FIELD`. Existing missing-value behavior for `null` and absent bodies is unchanged. Dangerous own enumerable keys `__proto__`, `constructor`, and `prototype` remain blocked with both `strip` and `empty`. This is a top-level input boundary, not a recursive sanitizer.

Distinguish this from a projection interceptor that replaces the entire body. Framework projection creates only a binding-local request view and does not replace `RequestContext.request.body`. After transport parsing and middleware, the path that continues processing follows this order:

```text
guard: original parsed input
  -> interceptor-before: original parsed input
  -> binding / projection
  -> schema parsing OR converters + class validation
  -> handler / service
  -> interceptor-after
```

Configured conditional requests may finish after guards and before interceptors. Parser failures and byte limits still apply before guards. This feature changes neither native parser nor HEAD policies. The original input inspected by an authentication guard and the validated argument passed to a service are different values; later context readers also see the original body. `strip` does not replace authentication or ownership checks. The experiment below is still only a local exercise with the author fixed to `author-1`.

### Receive an Existing Schema's Successful Value as a Service Argument

If you choose Zod 4, install it in the exercise app with `pnpm add zod@^4`. Other Standard Schema v1 vendors are also supported. The following is the complete additional **`src/schema-boundary-app.ts` file**. It reuses the existing `PostsModule` and service but registers the new route only at `/schema-drafts`.

```ts
import { Inject, Module } from '@fluojs/core';
import { Controller, createSchemaDto, HttpCode, Post, RequestDto } from '@fluojs/http';
import { z } from 'zod';
import { runPostCommand } from './posts/post-http-error.js';
import { PostsModule } from './posts/posts.module.js';
import { PostsService } from './posts/posts.service.js';

const SchemaDraftRequest = createSchemaDto(z.object({
  title: z.string().max(120).trim(),
  content: z.string().max(50_000).default(''),
  slug: z.string().max(80).trim().default(''),
}), {
  fields: {
    title: { source: 'body', key: 'post_title' },
    content: { source: 'body' },
    slug: { source: 'body' },
  },
  policy: { unknownFields: 'strip' },
});

@Controller('/schema-drafts')
@Inject(PostsService)
class SchemaDraftController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  @HttpCode(201)
  @RequestDto(SchemaDraftRequest)
  create(input: InstanceType<typeof SchemaDraftRequest>) {
    return runPostCommand(() => this.posts.create('author-1', {
      title: input.title, content: input.content, slug: input.slug,
    }));
  }
}

@Module({
  imports: [PostsModule],
  controllers: [SchemaDraftController],
})
export class SchemaBoundaryModule {}
```

As in the existing exercise, the title's raw length is limited before trimming. Supplying empty strings for missing `content` and `slug`, however, is a separate application contract chosen for this experiment. The binder omits missing mappings from schema input, allowing schema defaults to run. Explicit `null` is passed to the schema rather than treated as missing, so it fails the string schemas above.

The following is the complete optional **`src/schema-boundary-main.ts` file**. Select this file as the entry in the existing CLI/Vite execution configuration, and do not run it on the same port alongside the existing server. Leave the chapter's `src/main.ts` unchanged.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';
import { StandardSchemaBinder } from '@fluojs/http';
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { bootstrapApplication } from '@fluojs/runtime';

ensureMetadataSymbol();
const { SchemaBoundaryModule } = await import('./schema-boundary-app.js');
const app = await bootstrapApplication({
  rootModule: SchemaBoundaryModule,
  adapter: createFastifyAdapter({ host: '127.0.0.1', port: 3000 }),
  binder: (defaultBinder) => new StandardSchemaBinder(defaultBinder),
});
await app.listen();
```

This adapter-first example does not automatically register shutdown signals. The execution host must call `await app.close()` during shutdown or install Node shutdown registration. `FluoFactory.create(SchemaBoundaryModule, options)` accepts the same `binder` option. The factory composes once per bootstrap, and the supplied default binder includes configured global converters. Ordinary DTOs delegate to that fallback, preserving the existing `/posts/:id` route's `PostIdConverter` and class validation. Pure application contexts do not expose this HTTP option.

After listening completes, send `{ "post_title": "  Draft  ", "authorId": "other-author" }` to `POST /schema-drafts`; the expected status is `201`. The service receives `{ title: 'Draft', content: '', slug: '' }`, and the author remains the server's `author-1`. The handler argument becomes successful schema output without a separate projection interceptor, `safeParse` guard, or context storage/getter. Sending the same extra field to the existing `/posts` route still fails with `UNKNOWN_FIELD`. An array body on the new route fails with `INVALID_BODY`; omitting the title produces a schema validation failure and `400`. This manuscript does not claim that this optional experiment was executed.

`InstanceType<typeof SchemaDraftRequest>` is the schema **output** type, not its input type. Calling the token with `new` throws `InvariantError`. Do not subclass it or pass it to `PickType`, `OmitType`, `PartialType`, or `IntersectionType`. The token is neither reflected class-field metadata nor automatic OpenAPI schema conversion, so adopting this experiment as a public API also requires explicitly documenting its request schema. This is why the chapter retains its class DTOs.

`@ValidateClass(schema)` remains validation-only and does not replace the existing DTO with trim/default results. Outside HTTP, await `parseStandardSchema(schema, value)` from `@fluojs/validation` to obtain the successful value. The schema binder also uses this parser to await async validators before calling the handler. Schema failures, including `issues: []`, become `DtoValidationError` and map to `400` in HTTP. The existing empty-issues success behavior of `ValidateClass` remains unchanged. Malformed schema results throw `TypeError`, and schema implementation exceptions propagate unchanged so server defects are not disguised as ordinary input rejection.

## Small Commands Reveal the Next Boundary

The finished input boundary does not give the client authority to choose server state. The converter normalizes URL notation, DTOs validate the shape of the required data, and the service enforces the draft and publication rules. Translating errors from each layer into HTTP at one place lets us preserve the domain's meaning even if the framework changes.

Not every small internal script must go through an HTTP DTO. Code with established types can call service commands directly and apply domain rules. An external CSV or queue message, on the other hand, is a new input boundary even though it is not HTTP. It can reuse the same validation policy, but must choose for itself the conversions and undeclared-property policy that HTTP previously supplied.

The request's `authorId` is no longer stored, but the object returned by the controller still includes the `authorId` the server stored. Controlling input has not solved output policy. In the next chapter, we give "information we need to store" and "information we promise to show readers" different models.

## Sources and Further Reading

- [HTTP input policy and schema binding contract](../../packages/http/README.md#explicit-input-policies), [schema output parser contract](../../packages/validation/README.md#standard-schema-output-parsing), [runtime binder composition contract](../../packages/runtime/README.md#http-binder-composition): the API owners for the optional experiment.
- [Input policy and mapping tests](../../packages/http/src/input-materialization.test.ts), [schema output tests](../../packages/validation/src/standard-schema-output.test.ts), [application-boundary tests](../../packages/testing/src/input-materialization.e2e.test.ts): regression locations for projection, original-input guards, transformed output, and fallback behavior.
- [Next App Router native request tests](../../packages/platform-nextjs/src/schema-input-materialization.test.ts), [cold public declaration tests](../../packages/runtime/src/input-materialization-public-types.test.ts): evidence locations for the real adapter and public types, not a claim that the Book exercise above was executed.
- [`@fluojs/http` README](../../packages/http/README.md), [public exports](../../packages/http/src/index.portable.ts): the public paths for `RequestDto`, `FromBody`, `FromPath`, `Convert`, and `HttpCode`.
- [Default binder](../../packages/http/src/adapters/binding.ts) and [binding tests](../../packages/http/src/adapters/binding.test.ts): evidence for unknown body keys, required sources, and converter resolution.
- [Handler invocation policy](../../packages/http/src/dispatch/dispatch-handler-policy.ts), [HTTP validation adapter](../../packages/http/src/adapters/dto-validation-adapter.ts): where to confirm validation after binding and translation to `400`.
- [`@fluojs/validation` README](../../packages/validation/README.md), [public exports](../../packages/validation/src/index.ts), [validation tests](../../packages/validation/src/validation.test.ts): the boundaries for missing values, strict materialization options, and scalar coercion.
- [`@fluojs/core` README](../../packages/core/README.md), [`@fluojs/platform-fastify` README](../../packages/platform-fastify/README.md): evidence for explicit DI, metadata preinstallation, and the execution helper.

[Previous: How Drafts Differ from Published Posts](./ch05-post-domain.md) | [Volume 1 Contents](./toc.md) | [Next: Separating Stored Data from Public Data](./ch07-response-models.md)
