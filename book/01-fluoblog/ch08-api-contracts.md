# Creating API Contracts Users Can Understand

<!-- book:volume=01-fluoblog;chapter=08 -->

[Previous: Separating Stored Data from Public Data](./ch07-response-models.md) | [Volume 1 Contents](./toc.md) | [Next: Running the Same Code Across Environments](./ch09-configuration.md)

## The Operation Succeeded, but the Screen Says It Failed

A colleague building FluoBlog's editing screen connects the Publish button. The server publishes the post correctly, but the screen displays a failure message. The colleague assumed that every `POST` returned `201`, while the server returned `200` because this was a state transition of an existing post. On another day, a version conflict was treated as an input error, turning the title field red. No amount of editing the title resolved the conflict.

Over the previous three chapters, the server made reasonably clear choices. Drafts can be saved, but publication has separate requirements; input accepts only the necessary fields; public responses do not contain the entire storage model. If those choices remain only in code, however, client developers must guess. This chapter connects the shapes of requests, successes, and failures with the user's next action in a single API contract.

A contract is not another name for a Swagger UI screen. The machine-readable description of paths and fields, actual HTTP behavior, and the user experience when errors occur must agree. `@fluojs/openapi` generates an OpenAPI 3.1.0 document from explicitly supplied handler descriptors and metadata. It does not execute business rules for us or infer all controller return types.

The app in this chapter is still the same `fluo-blog`, using the in-memory store. Adding documentation does not provide persistence across restarts or author authentication. We document the five operations actually implemented so far. As we add accounts and shop features to the same application later, we will extend this contract.

## Status Codes Carry the Next Action

First, let us gather the current contract in one table. The DTOs in Chapter 6 own the precise sources and validation of input fields; the mappers in Chapter 7 own the precise selection of response fields.

| Request | Normal result | Typical rejection | Client's next action |
| --- | --- | --- | --- |
| `GET /posts` | `200`, array of published post summaries | `500` for an unexpected internal failure | Display the array as a list |
| `GET /posts/:id` | `200`, published post details | `400` for an invalid ID; `404` for a missing post or draft | Check the address or display a not-found screen |
| `POST /posts` | `201`, draft write receipt | `400` for missing fields, wrong types, or extra fields | Store the ID and version in the editing state |
| `PUT /posts/:id` | `200`, updated write receipt | `400` for invalid values; `409` for an old version or a published state | On conflict, compare the server state with the edits |
| `POST /posts/:id/publish` | `200`, publication write receipt | `400` for an empty body; `409` for version, slug, or state conflicts | Use the error code to prompt a fresh read or a slug change |

Treating drafts and missing posts alike with `404` is a choice for public reads. There is no reason to tell readers whether a private post exists. Authors continue their editing flow with the ID received in the command result. We do not solve the absence of an authenticated editing query by relaxing the public route's `404` policy.

Choosing `400` for `POST_NOT_PUBLISHABLE` in the previous chapter means the publication command cannot currently run with the submitted content. An old version is a conflict with server state rather than a problem with the content itself, so it receives `409`. Collapsing both into a single "Save failed" message leaves users unable to tell what to fix. Conversely, subdividing every exception excessively and exposing internal implementation names as API codes is not helpful either. Preserve differences that require different client behavior as stable codes.

The default HTTP exception response has the form `{ error: { code, message, status } }`, with optional `details`, `meta`, and `requestId`. The following is **example JSON for a stale publication request**, not a captured execution log.

```json
{
  "error": {
    "code": "POST_VERSION_CONFLICT",
    "message": "Another change was saved first.",
    "status": 409
  }
}
```

The UI can map codes to the Korean messages shown to users. Do not branch by comparing the full `message` sentence. For binding and validation failures, use `field`, `source`, and `code` in `details` to distinguish title input from version input. `requestId` is not always present by default, so we do not promise it as required here. We will extend its meaning after adding correlation middleware in the observability chapter.

Unauthenticated `401` and forbidden `403` are also different contracts. The current writing controller has no authentication guard, however, so displaying a security lock in the documentation does not mean those behaviors have been implemented. This API is a local operator exercise; later chapters connect actual token validation and ownership checks.

## Responses Need Explicit Schemas

The OpenAPI builder reads binding and validation metadata from request DTOs. It does not inspect handler return values or TypeScript return types to infer response bodies. Writing only `@ApiResponse(200, { description: '...' })` creates a description and status, but no body schema. A serialization DTO with `@Expose()` does not remove the need to explicitly declare the response to document.

In this app, we separate serialization DTOs from documentation schemas according to their roles. Output classes serve filters and mappers; OpenAPI declares the exact fields, types, and requiredness of the wire JSON. We could create a component with `type: ResponseDto`, but we do not assume runtime type declarations or serialization decorators can infer every documentation constraint. Explicit schemas for small public responses are easy to compare with actual JSON.

The following is the **complete `src/posts/post-api.schemas.ts` file**. In the previous chapter, we defined the write receipt's `publishedAt` as `null` for a draft and a string for a published post. Rather than merely allowing `string | null` in every result, we distinguish the two states with `oneOf` to express their relationship too.

```ts
import type { OpenApiSchemaObject } from '@fluojs/openapi';

const idSchema: OpenApiSchemaObject = {
  type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER,
};
const summaryProperties: Record<string, OpenApiSchemaObject> = {
  id: idSchema,
  title: { type: 'string', minLength: 1, maxLength: 120 },
  slug: { type: 'string', maxLength: 80, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
  publishedAt: { type: 'string', format: 'date-time' },
};

export const postSummarySchema: OpenApiSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'slug', 'publishedAt'],
  properties: summaryProperties,
};

export const publicPostSchema: OpenApiSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'slug', 'publishedAt', 'content'],
  properties: {
    ...summaryProperties,
    content: { type: 'string', minLength: 1, maxLength: 50_000 },
  },
};

const receiptProperties: Record<string, OpenApiSchemaObject> = {
  id: idSchema,
  version: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
};

export const postWriteReceiptSchema: OpenApiSchemaObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'status', 'version', 'publishedAt'],
      properties: {
        ...receiptProperties,
        status: { type: 'string', const: 'draft' },
        publishedAt: { type: 'null' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'status', 'version', 'publishedAt'],
      properties: {
        ...receiptProperties,
        status: { type: 'string', const: 'published' },
        publishedAt: { type: 'string', format: 'date-time' },
      },
    },
  ],
};

export const postIdParameterSchema: OpenApiSchemaObject = {
  type: 'string', pattern: '^[1-9][0-9]*$',
  description: 'Decimal post ID within the JavaScript safe integer range.',
};

export const errorResponseSchema: OpenApiSchemaObject = {
  $ref: '#/components/schemas/ErrorResponse',
};
```

Declaring the path parameter as a string schema is not an accidental omission of numeric conversion. Its actual URL representation is a string, and the app's converter rejects exponential notation, leading zeros, signs, and whitespace. Documenting only the integer inferred from DTO validation might suggest that `02` is the same integer. We describe the public parameter using the original string syntax, while documenting the safe integer ceiling and checking it through the actual converter tests. We do not try to express every numeric range readably with a regular expression alone.

Schemas do not express every implementation condition either. `content.minLength: 1` cannot fully reject a body consisting only of whitespace, and JSON Schema's meaning of string length can differ from JavaScript's UTF-16 code unit count for supplementary characters. The server's title and body limits follow the domain contract in Chapter 5; ordinary string schemas provide client guidance and approximate constraints. Domain functions and HTTP tests ultimately determine actual publishability. Passing the document's constraints does not mean every business rule has been satisfied.

## Add Documentation Metadata to the Five Routes

The following is the **complete final replacement `src/posts/posts.controller.ts` file**. Its behavior is the same as in Chapter 7; we add request and response descriptions to each handler. Description strings are also written in English so that code blocks can be preserved unchanged in future translations. The explanatory text of the source chapter remains in Korean.

```ts
import { Inject } from '@fluojs/core';
import {
  Controller, Get, HttpCode, Post, Put, RequestDto, UseInterceptors,
} from '@fluojs/http';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTag } from '@fluojs/openapi';
import { SerializerInterceptor } from '@fluojs/serialization';
import {
  errorResponseSchema, postIdParameterSchema, postSummarySchema,
  postWriteReceiptSchema, publicPostSchema,
} from './post-api.schemas.js';
import { runPostCommand } from './post-http-error.js';
import { CreatePostDto, GetPostDto, PublishPostDto, ReplacePostDto } from './post-request.dto.js';
import { toPostSummary, toPostWriteReceipt, toPublicPost } from './post-response.dto.js';
import { PostsService } from './posts.service.js';

@ApiTag('Posts')
@Controller('/posts')
@Inject(PostsService)
@UseInterceptors(SerializerInterceptor)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @ApiOperation({ summary: 'List published posts' })
  @ApiResponse(200, {
    description: 'Published post summaries.',
    schema: { type: 'array', items: postSummarySchema },
  })
  list() {
    return this.posts.listPublished().map(toPostSummary);
  }

  @Get('/:id')
  @RequestDto(GetPostDto)
  @ApiOperation({ summary: 'Read one published post' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiResponse(200, { description: 'Published post.', schema: publicPostSchema })
  @ApiResponse(404, { description: 'Missing or unpublished post.', schema: errorResponseSchema })
  get(input: GetPostDto) {
    return runPostCommand(() => toPublicPost(this.posts.getPublished(input.id)));
  }

  @Post()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  @ApiOperation({ summary: 'Create a draft for the local operator' })
  @ApiBody({ description: 'All three strings are required; empty draft text is allowed.' })
  @ApiResponse(201, { description: 'Draft created.', schema: postWriteReceiptSchema })
  create(input: CreatePostDto) {
    return runPostCommand(() => toPostWriteReceipt(this.posts.create('author-1', {
      title: input.title, content: input.content, slug: input.slug,
    })));
  }

  @Put('/:id')
  @HttpCode(200)
  @RequestDto(ReplacePostDto)
  @ApiOperation({ summary: 'Replace all editable draft text' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiBody({ description: 'Send all text fields and the version last observed.' })
  @ApiResponse(200, { description: 'Draft updated.', schema: postWriteReceiptSchema })
  @ApiResponse(409, { description: 'Version or state conflict.', schema: errorResponseSchema })
  replace(input: ReplacePostDto) {
    return runPostCommand(() => toPostWriteReceipt(
      this.posts.revise(input.id, input.expectedVersion, {
        title: input.title, content: input.content, slug: input.slug,
      }),
    ));
  }

  @Post('/:id/publish')
  @HttpCode(200)
  @RequestDto(PublishPostDto)
  @ApiOperation({ summary: 'Publish an existing draft' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiBody({ description: 'Publishing checks nonblank text and a unique valid slug.' })
  @ApiResponse(200, { description: 'Post published.', schema: postWriteReceiptSchema })
  @ApiResponse(409, {
    description: 'Version, state, or slug conflict. Read the error code before retrying.',
    schema: errorResponseSchema,
  })
  publish(input: PublishPostDto) {
    return runPostCommand(() => toPostWriteReceipt(
      this.posts.publish(input.id, input.expectedVersion),
    ));
  }
}
```

Since we added only descriptions through `@ApiBody()`, request schemas retain what was derived from the existing DTOs. We reuse field sources and basic validation metadata rather than overriding them with a separate body schema. For the ID parameter, we explicitly replace the inferred result of the same name to convey the string representation contract described above.

`@ApiResponse()` is documentation metadata. HTTP's `@HttpCode()` changes the actual success status. Confusing the two can leave publication documented as `200` while the runtime sends the default POST status of `201`. We explicitly specify `201` for creation and `200` for revision and publication in both places. Details and lists use the default `200`, with separate response schemas.

There is also a reason we registered publication's `409` directly. The default error injection policy provides `400`, `401`, `403`, `404`, and `500`, but our current business contract must add `409`. The reference to the `ErrorResponse` component assumes the default error injection policy in the module below. If that policy is changed to `omit`, we must also supply the shared error schema ourselves; leaving only the reference would break the document.

## Register the Documentation Sources Explicitly Too

The following is the **complete replacement `src/app.ts` file**. `PostsModule` uses the registrations from Chapter 7, so `PostsService`, `PostIdConverter`, `SerializerInterceptor`, and `POST_CLOCK` remain connected. The feature module owns the actual `PostsController` instance that handles requests.

```ts
import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';
import { PostsController } from './posts/posts.controller.js';
import { PostsModule } from './posts/posts.module.js';

@Module({
  imports: [
    PostsModule,
    OpenApiModule.forRoot({
      title: 'FluoBlog API',
      version: '1.0.0',
      sources: [{ controllerToken: PostsController }],
      documentPath: '/openapi.json',
      uiPath: '/docs',
      ui: true,
      defaultErrorResponsesPolicy: 'inject',
    }),
  ],
})
export class AppModule {}
```

Registering a controller in `@Module({ controllers: [...] })` does not make OpenAPI automatically discover and document every controller. We must supply `sources` or prebuilt `descriptors`. This explicitness is useful when documenting internal operational APIs separately from reader APIs. In return, tests must catch the mistake of adding a controller but leaving it out of the documentation sources.

The code above does not also add `PostsController` to the root's `controllers`. `sources` identifies the metadata to include in the document; it is not an instruction to register the same routes again. Confusing the two registrations can create route conflicts or problems with separate service instances.

`/openapi.json` is the machine-readable document, and `/docs` is the optional Swagger UI. The UI path remains reserved even with `ui: false`, so do not assume another controller can reuse `/docs`. If document paths, UI paths, or app routes overlap after normalization, bootstrap fails with `RouteConflictError`. When creating multiple documents, use different paths for both the JSON and the UI.

Registration options are snapshotted at registration time. Do not expect the document to update live if you add a controller to the original `sources` array or change the title string after startup. When connecting environment configuration in the next chapter, we can consider `forRootAsync()` if asynchronous DI configuration is needed. Even then, `documentPath` and `uiPath` belong to the outer registration options, not inside the factory. Fixed configuration is sufficient for now.

A working Swagger UI is not evidence of authentication. `ApiBearerAuth` and `ApiSecurity` document requirements; they are not guards. Even if the default error policy displays `401` and `403` responses, that does not mean authentication is enabled on every current route. An honest contract does not imply unimplemented security behavior through documentation decorations.

## Test the Document Structure Without Starting a Server

The following is the **complete `src/posts/post-api.test.ts` file**. It creates descriptors from a handler mapping and calls the public builder. This experiment compares document generation with serialization output without DI instances or a network port. It uses the previous chapter's standard-decorator test configuration and metadata preinstallation.

```ts
import { createHandlerMapping } from '@fluojs/http';
import { buildOpenApiDocument } from '@fluojs/openapi';
import { serialize } from '@fluojs/serialization';
import { describe, expect, it } from 'vitest';
import { createDraft, publishPost } from './post.js';
import { toPublicPost } from './post-response.dto.js';
import { PostsController } from './posts.controller.js';

function buildDocument() {
  return buildOpenApiDocument({
    descriptors: createHandlerMapping([{ controllerToken: PostsController }]).descriptors,
    title: 'FluoBlog API',
    version: '1.0.0',
    defaultErrorResponsesPolicy: 'inject',
  });
}

describe('Post API contract', () => {
  it('includes all five operations and the explicit publish status', () => {
    const document = buildDocument();
    const operations = Object.values(document.paths).flatMap((item) =>
      ['get', 'post', 'put'].filter((method) => Object.hasOwn(item, method)),
    );
    expect(operations).toHaveLength(5);
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/posts']?.post?.responses['201']).toBeDefined();
    const publish = document.paths['/posts/{id}/publish']?.post;
    expect(publish?.responses['200']).toBeDefined();
    expect(publish?.responses['201']).toBeUndefined();
    expect(publish?.responses['409']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/ErrorResponse',
    });
    expect(document.components?.schemas?.ErrorResponse).toBeDefined();
  });

  it('documents the HTTP body allowlist instead of the stored model', () => {
    const schema = buildDocument().components?.schemas?.CreatePostDto;
    expect(schema?.additionalProperties).toBe(false);
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['content', 'slug', 'title']);
    expect([...(schema?.required ?? [])].sort()).toEqual(['content', 'slug', 'title']);
  });

  it('matches public response keys to the actual serializer output', () => {
    const draft = createDraft(2, 'author-1', {
      title: 'Contract test', content: 'A stable public shape.', slug: 'contract-test',
    });
    const post = publishPost(draft, 1, new Date('2026-06-01T09:00:00.000Z'));
    const payload = serialize(toPublicPost(post));
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('Public post serialization must return an object.');
    }
    const schema = buildDocument().paths['/posts/{id}']?.get
      ?.responses['200']?.content?.['application/json']?.schema;
    expect(schema?.additionalProperties).toBe(false);
    expect(Object.keys(payload).sort()).toEqual(Object.keys(schema?.properties ?? {}).sort());
    expect(Object.keys(payload).sort()).toEqual([...(schema?.required ?? [])].sort());
  });
});
```

Run `pnpm exec vitest run src/posts/post-api.test.ts` in your app. This is not a recorded pass from executing it for the manuscript. The expected result is three passing tests. The first checks both the HTTP status metadata and documentation registration for publication; the second checks that server-owned fields have not entered the request document. The third compares the keys actually produced by the serializer with the document's keys.

This test is not a complete JSON Schema validator. It does not claim to verify string formats, every combination constraint, or every response in every state. It quickly exposes specific regressions: added or removed public fields and missing metadata. Changing the document's wording does not break the tests. Nor do we indiscriminately snapshot `operationId` as if it were prose before this app uses it as a fixed identifier for a generated client.

Changing OpenAPI's `info.version` from `1.0.0` does not add `/v2` to HTTP routes. Path versions and document versions are different settings. Deleting an error code or adding a required request field while keeping the current paths does not become a compatible change merely by increasing the document's version number. First review which client behavior will break.

## Compare Actual Responses with the Served Document

Even if the unit-level builder test passes, the actual `/openapi.json` may lack routes when the app's `sources` registration is missing. The following is the **complete `scripts/api-contract-check.mjs` file**. Run it once against a freshly started local in-memory app to compare the served document with requests.

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

const served = await request('GET', '/openapi.json');
assert.equal(served.status, 200);
assert.equal(served.body.openapi, '3.1.0');
const paths = served.body.paths;
assert.ok(paths['/posts'].post.responses['201']);
assert.ok(paths['/posts/{id}/publish'].post.responses['409']);

const created = await request('POST', '/posts', {
  title: 'Wire contract', content: 'Compare docs with responses.', slug: 'wire-contract',
});
assert.equal(created.status, 201);
const id = created.body.id;
const published = await request('POST', `/posts/${id}/publish`, { expectedVersion: 1 });
assert.equal(published.status, 200);
assert.ok(paths['/posts/{id}/publish'].post.responses[String(published.status)]);
const repeated = await request('POST', `/posts/${id}/publish`, { expectedVersion: 1 });
assert.equal(repeated.status, 409);
assert.equal(repeated.body.error.status, repeated.status);
assert.equal(repeated.body.error.code, 'POST_VERSION_CONFLICT');

const detail = await request('GET', `/posts/${id}`);
assert.equal(detail.status, 200);
const schema = paths['/posts/{id}'].get.responses['200'].content['application/json'].schema;
assert.equal(schema.additionalProperties, false);
assert.deepEqual(Object.keys(detail.body).sort(), Object.keys(schema.properties).sort());
assert.deepEqual(Object.keys(detail.body).sort(), [...schema.required].sort());
console.log('Served API contract checks passed.');
```

The command is `node scripts/api-contract-check.mjs`, and the expected result is the final message. Again, this is not presented as HTTP verification performed during manuscript writing. Because the check script uses a fixed in-memory fixture, rerunning it against an app that has already published the same slug causes a conflict. Run it against a fresh app rather than hiding the failure by randomizing test data.

The order in which we interpret failures is also part of the contract. If a path is missing from the document, check `sources` first. If `201` and `200` differ, compare `HttpCode` with `ApiResponse`. If fields differ, compare the output mapper, serialization interceptor, and explicit schema. If the actual response is correct but only Swagger UI looks stale, first inspect the served JSON. The document received by the machine is authoritative, not the appearance of the screen.

API users must not interpret a timeout as conclusive failure. If the connection drops after publication, the server may already have changed state. The previous chapter's implementation has no idempotency store that saves and replays the same successful response, so the usage contract must state that retrying with the same version can return `409`. Automatically retrying `409` only keeps sending a request that cannot resolve itself. The next step must be a check of the latest state or a user decision.

## A Contract Reveals Changes Rather Than Declaring Nothing Will Change

Even adding one optional field to a public response can affect a client with a strict decoder. Our schemas specify the current field set with `additionalProperties: false`, so adding a server field changes both the tests and the document. Adding a new required request field has a more direct impact. The old screen cannot send it, so previously valid requests start returning `400`.

Conversely, changing how an internal `authorId` is stored or renaming a service class may not change the API as long as the public fields stay the same. The default `operationId`, however, is determined by the controller tag, handler name, method, and path, so renaming a method can still affect generated client names. When introducing a generated client, review the actual document diff and, if necessary, establish a policy that specifies stable identifiers with `documentTransform`.

We do not yet need to duplicate every API by URI version. The number of users and clients, the compatibility support period, and the deployment order determine that cost. For a small local product, contract tests and one agreed change are preferable; with many independently deployed clients, an older version needs to remain available for some time. Rather than starting with version decorators, record who depends on which contract.

FluoBlog can now explain post state, input sources, public fields, and documentation of success and failure as one coherent story. In the next chapter, we will run this app in different environments. Local success is not enough for deployment while ports and connection details remain hardcoded. Let us validate configuration values and pass them to the startup boundary, then extend the promise of storage in the following chapters by moving in-memory posts to PostgreSQL.

## Sources and Further Reading

- [`@fluojs/openapi` README](../../packages/openapi/README.md), [public exports](../../packages/openapi/src/index.ts): the contracts for explicit sources, response documentation boundaries, default error policies, and path reservation.
- [OpenAPI decorators](../../packages/openapi/src/decorators.ts), [schema builder](../../packages/openapi/src/schema-builder.ts), [builder tests](../../packages/openapi/src/schema-builder.test.ts): evidence for request inference, explicit schemas, default responses, and `operationId` generation.
- [OpenAPI module](../../packages/openapi/src/openapi-module.ts), [document route tests](../../packages/openapi/src/openapi-module-routes.test.ts): evidence for option snapshots, module registration, actual document paths, and conflicts.
- [`@fluojs/http` README](../../packages/http/README.md), [exceptions and error envelopes](../../packages/http/src/exceptions.ts), [error response writer](../../packages/http/src/dispatch/dispatch-error-representation.ts): the basis for HTTP statuses and public error shapes.
- [Finalized contents manifest](../series.json): the sequence that continues extending the same product through the next chapters on configuration and persistence.

[Previous: Separating Stored Data from Public Data](./ch07-response-models.md) | [Volume 1 Contents](./toc.md) | [Next: Running the Same Code Across Environments](./ch09-configuration.md)
