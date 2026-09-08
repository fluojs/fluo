# Accepting Cover Images and Attachments

<!-- book:volume=01-fluoblog;chapter=18 -->

[Previous: Building Pages for Readers and Screens for Writers](./ch17-react-reading-and-writing.md) | [Contents](./toc.md) | [Next: Notifying Subscribers About New Posts](./ch19-subscriptions-and-email.md)

## One File Crosses Three Boundaries

A writer wants to upload a cover image and exercise materials for a tutorial. Adding a file input to the form from Chapter 17 lets the browser send bytes. But arriving at the server and being safely attached to a post are different events. The operator's first incident is a conflict during cover replacement: an image sent from a stale tab was attached without respecting the version of the title just saved. The second incident is simpler. A writer thought an upload had failed and retried, leaving two files on the server with different names.

File handling crosses three boundaries: transport, validation, and storage together with attachment to the post. Unless we distinguish which stage failed, we can leave an orphaned file or create an attachment link with no bytes behind it. For this small blog, this chapter stores size-limited files in PostgreSQL. We choose to put a Prisma `Bytes` field and the post update in the same transaction. This is not the final design for a large-file service, but it lets us complete the core behavior without hiding it behind a fake object-storage call.

The accounts and posts remain those from the previous chapters. `authorId` is the verified principal's subject, and `Post.version` increments not only when post content changes but also when a cover or attachment association changes. We do not accept a user ID submitted by the browser. Uploads are allowed only on drafts. Replacing the cover of a published post is a product feature that must be designed together with a policy for revising published content; we do not bypass that policy through this draft route.

## Receiving the Adapter's Array Through a DTO

`@fluojs/http` does not use a particular web server's file object as the controller contract. The common fields of `FrameworkRequestFile` are `fieldname`, `originalname`, `mimetype`, `buffer`, and `size`. `buffer` is a `Uint8Array`; do not assume Node-specific `Buffer` methods exist. Fastify's default buffered multipart path exposes files in this form through `request.files`.

Use `@FromFiles('file')` in the DTO. The return value is an array even when the name is singular. If a file collection exists but contains no file with that name, the result is an empty array. If the collection itself is absent, a required field produces a missing-field error. Initializing the field to `[]` does not turn a missing multipart request into a success. Only adding `@Optional()` makes the collection's absence optional. The DTO binder projects only the five common fields, so do not write code that moves files by relying on an adapter-internal temporary path.

The following is a **partial JSX implementation** to add to the editor from Chapter 17. Keep it as a separate form rather than nesting it inside the existing text-saving form. `post.id` and `post.version` are values from the `EditingPost` queried by the server. Cover uploads and ordinary attachment uploads use the same endpoint; only `kind` changes.

```tsx
<form action={`/posts/${post.id}/assets`} method="post"
  encType="multipart/form-data">
  <input type="hidden" name="version" value={post.version} />
  <label htmlFor="asset-kind">Asset kind</label>
  <select id="asset-kind" name="kind" defaultValue="cover">
    <option value="cover">PNG cover</option>
    <option value="attachment">Download attachment</option>
  </select>
  <label htmlFor="asset-file">File</label>
  <input id="asset-file" type="file" name="file" required />
  <button type="submit">Upload asset</button>
</form>
```

`accept` is only a hint for the file picker, not validation. Since we also accept ordinary attachments, the input above does not restrict file formats. Do not manually specify the multipart boundary in the `Content-Type` header. The browser creates the boundary for the file and text parts. API clients can also fail to parse a request if they reuse JSON headers while using `FormData`.

Transport limits must apply before the controller. The following is a **partial configuration** to merge into the second argument of `runFastifyApplication` in the existing Node24 `src/main.ts`. If the same keys already exist, replace their values with those below; do not add another call. Retain the existing `port: blogConfig.PORT`, host, logging and shutdown settings, and the dynamic `AppModule` import after `ensureMetadataSymbol()`. Do not replace it with a new bootstrap that hardcodes port 3000. The location of the `multipart` option differs between the helper and a direct `createFastifyAdapter` call. When creating the adapter directly, pass the multipart option in the second argument.

```ts
maxBodySize: 6 * 1024 * 1024,
multipart: {
  maxFileSize: 5 * 1024 * 1024,
  maxFiles: 1,
  maxTotalSize: 6 * 1024 * 1024,
},
```

The file limit and total request limit are different. The total includes text fields and multipart framing, so we do not set it to exactly 5 MiB while allowing a 5 MiB file. The app also checks tighter size limits according to the file's purpose, because internal tests or other callers can use the file policy directly even when adapter limits work correctly. This path buffers uploads in memory. As concurrent uploads increase, account for memory use by multiplying the file limit by the number of simultaneous requests and the number of copies.

## Filenames Are for Display; Bytes Provide the Evidence

The following `src/uploads/upload-policy.ts` is a complete policy file. Covers are limited to PNG-shaped data of at most 2 MiB, while ordinary attachments of at most 5 MiB are treated as download-only. `mimetype` and the extension are client claims, not evidence for identifying a format. We do not use the name as a path; we keep only a basename for display. CR/LF and control characters are removed so they cannot be mixed directly into response headers.

```ts
import { createHash } from 'node:crypto';
import {
  BadRequestException, PayloadTooLargeException, type FrameworkRequestFile,
} from '@fluojs/http';

export type AssetKind = 'cover' | 'attachment';
export type PreparedAsset = {
  readonly kind: AssetKind;
  readonly originalName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly size: number;
  readonly sha256: string;
};

export function prepareAsset(
  file: FrameworkRequestFile, kind: AssetKind,
): PreparedAsset {
  const limit = (kind === 'cover' ? 2 : 5) * 1024 * 1024;
  const size = file.buffer.byteLength;
  if (size === 0 || file.size !== size) {
    throw new BadRequestException('Invalid file size');
  }
  if (size > limit) throw new PayloadTooLargeException('File is too large');
  const bytes = Uint8Array.from(file.buffer);
  let mediaType = 'application/octet-stream';

  if (kind === 'cover') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || !signature.every((v, i) => bytes[i] === v)) {
      throw new BadRequestException('Cover must have a PNG signature');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ihdr = new TextDecoder().decode(bytes.subarray(12, 16));
    if (view.getUint32(8) !== 13 || ihdr !== 'IHDR') {
      throw new BadRequestException('PNG header is missing');
    }
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width === 0 || height === 0 || width > 4096 || height > 4096) {
      throw new BadRequestException('Cover dimensions are out of range');
    }
    mediaType = 'image/png';
  }

  const basename = file.originalname.replaceAll('\\', '/').split('/').pop() ?? '';
  const originalName = basename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)
    || 'download.bin';
  return {
    kind, originalName, mediaType, bytes, size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
```

This check is neither a complete PNG decoder nor a malware scanner. Even with a valid header, corrupt image data later in the file may appear as a broken image in the browser. What we guarantee here is the byte count, the permitted cover envelope, and upper bounds on the dimensions declared in the header. A media service that requires successful decoding and re-encoding must prove those properties with a separate decoder and remove metadata. This manuscript does not claim that checking the PNG header alone provides those guarantees.

Why is this check useful, then? It prevents mistakes such as renaming an HTML or SVG file's extension and registering it as a cover, and it separates download-only bytes from bytes rendered as an image. The download route serves ordinary attachments as `application/octet-stream` with `attachment`. That still does not guarantee that the file's contents are harmless. Quarantine and report handling for a public upload service are separate product responsibilities. FluoBlog currently restricts uploads to authenticated writers' own drafts.

The hash is a value for checking whether stored bytes are identical. The same SHA-256 does not mean the same upload operation by the same author. Using a hash as a globally public ID could let another user infer the existence of a private file. Below, we use random asset IDs and keep the hash only as metadata for integrity diagnostics.

## Committing Bytes and the Post Association Together

The following is a **partial schema implementation** to merge into `prisma/schema.prisma`. First, add these two fields before the existing `Post` model's closing brace. Separate from the `PostAsset.post` relation, `coverAssetId` is an application-managed pointer to the current cover. In this example, only validated code within the same transaction changes this field. This is not a standalone schema that recreates the account and post models; retain `Post.publication` and `PostPublication(id, postId, actorId, version, publishedAt)` as well. Do not add scheduled-publishing fields yet.

```prisma
coverAssetId String?
assets       PostAsset[]
```

Then add the model to the same schema file.

```prisma
model PostAsset {
  id           String   @id
  postId       Int
  post         Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  ownerId      String
  kind         String
  originalName String
  mediaType    String
  size         Int
  sha256       String
  bytes        Bytes
  createdAt    DateTime @default(now())

  @@index([postId])
}
```

In this small example, `kind` is a string, but we allow only the policy's two values instead of storing external input directly. Run the schema migration and regenerate the Prisma client against your development database. The generator remains `prisma-client-js`, and types are imported from `@prisma/client`. We did not modify a database while writing this manuscript.

```bash
pnpm exec prisma validate
pnpm exec prisma migrate dev --name add_post_assets
pnpm exec prisma generate
```

The following `src/uploads/post-assets.ts` is a complete storage service file. We do not create the file first and attach the cover in a separate request. Only a transaction that succeeds at the conditional post update may create an asset. If asset creation or deletion of the previous cover fails, even the version increment rolls back with it.

```ts
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@fluojs/http';
import type { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type { PreparedAsset } from './upload-policy.js';

export class PostAssets {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async attach(
    postId: number, authorId: string, version: number, asset: PreparedAsset,
  ) {
    const id = randomUUID();
    return this.prisma.transaction(async () => {
      const tx = this.prisma.current();
      const post = await tx.post.findFirst({
        where: { id: postId, authorId, status: 'draft' },
        select: { coverAssetId: true },
      });
      if (!post) throw new NotFoundException('Draft not found');
      const changed = await tx.post.updateMany({
        where: { id: postId, authorId, status: 'draft', version },
        data: {
          version: { increment: 1 },
          ...(asset.kind === 'cover' ? { coverAssetId: id } : {}),
        },
      });
      if (changed.count !== 1) throw new ConflictException('Draft changed');
      await tx.postAsset.create({
        data: { id, postId, ownerId: authorId, ...asset },
      });
      if (asset.kind === 'cover' && post.coverAssetId) {
        await tx.postAsset.deleteMany({
          where: { id: post.coverAssetId, postId, kind: 'cover' },
        });
      }
      return {
        id, version: version + 1,
        assetUrl: `/posts/${postId}/assets/${id}`,
        editUrl: `/posts/${postId}/edit#asset-${id}`,
        readUrl: `/posts/${postId}/read`,
      };
    });
  }

  async download(postId: number, id: string, subject: string | undefined) {
    const asset = await this.prisma.current().postAsset.findFirst({
      where: {
        id, postId,
        post: { OR: [
          { status: 'published' },
          ...(subject === undefined ? [] : [{ status: 'draft' as const, authorId: subject }]),
        ] },
      },
      select: { id: true, kind: true, originalName: true, bytes: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }
}
```

A retry with the wrong version returns 409 and leaves no new asset. Even if the first request committed but its response was lost, retrying with the same version returns 409. This avoids duplicate storage; it is not an idempotency store that replays the same response. The writer reloads the editor to check the uploaded cover. Avoiding retransmission of all bytes on every retry for large uploads would require a separate upload session and idempotency key. For this size-limited path, clearly exposing the version conflict is sufficient.

Multiple ordinary attachments are allowed, so we delete the previous cover only when replacing a cover. Deleting the post itself also deletes the associated bytes through the foreign key's cascade. Because file storage and pointer updates happen in one PostgreSQL transaction, there is no failure window between object storage and the database. The cost is that file sizes feed directly into database backups, replication, and query traffic. This choice is not a permanent answer; it is a stage that first completes consistency for small files.

## Registering the HTTP Boundary and Completing Downloads

The following `src/uploads/uploads.module.ts` is a complete module file. Its factory receives the global `PrismaService` and creates `PostAssets`. `FormsAuthModule` obtains the origin setting from `AppSettings`, so there is no separate origin token or new database wrapper. Uploads require all three: form-cookie login, `posts:write`, and the same Origin. Public downloads are anonymous when there is no cookie; when a cookie is present, it is verified using the same current-account policy.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  BadRequestException, Controller, FromBody, FromFiles,
  FromPath, Get, Header, Post, RequestDto,
  UseGuards, buildContentDisposition,
  type FrameworkRequestFile, type RequestContext,
} from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import {
  FormOriginGuard, FormsAuthGuard, FormsAuthModule, OptionalFormsAuthGuard, requireFormWriter,
} from '../auth/forms-auth.module.js';
import { positiveInt } from '../posts/post-form-input.js';
import { PostAssets } from './post-assets.js';
import { prepareAsset } from './upload-policy.js';

class UploadInput {
  @FromPath('id') id: unknown = '';
  @FromBody('version') version: unknown = '';
  @FromBody('kind') kind: unknown = '';
  @FromFiles('file') files: readonly FrameworkRequestFile[] = [];
}

class DownloadInput {
  @FromPath('id') id: unknown = '';
  @FromPath('assetId') assetId: unknown = '';
}

@Inject(PostAssets)
@Controller('/posts')
class UploadsController {
  constructor(private readonly assets: PostAssets) {}

  @Post('/:id/assets')
  @UseGuards(FormsAuthGuard, FormOriginGuard)
  @Header('Cache-Control', 'private, no-store')
  @RequestDto(UploadInput)
  async upload(input: UploadInput, context: RequestContext) {
    const actor = requireFormWriter(context);
    if (input.kind !== 'cover' && input.kind !== 'attachment') {
      throw new BadRequestException('Invalid asset kind');
    }
    const file = input.files[0];
    if (input.files.length !== 1 || !file) {
      throw new BadRequestException('Exactly one file is required');
    }
    const postId = positiveInt(input.id);
    const result = await this.assets.attach(
      postId, actor.id, positiveInt(input.version, 2_147_483_646),
      prepareAsset(file, input.kind),
    );
    context.response.setHeader('Link', `<${result.assetUrl}>; rel="item"`);
    context.response.setHeader('Cache-Control', 'private, no-store');
    context.response.redirect(303, result.editUrl);
  }

  @Get('/:id/assets/:assetId')
  @UseGuards(OptionalFormsAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  @RequestDto(DownloadInput)
  async download(input: DownloadInput, context: RequestContext) {
    if (typeof input.assetId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.assetId)) {
      throw new BadRequestException('Invalid asset id');
    }
    const asset = await this.assets.download(
      positiveInt(input.id), input.assetId, context.principal?.subject,
    );
    const cover = asset.kind === 'cover';
    context.response.setHeader('Content-Type',
      cover ? 'image/png' : 'application/octet-stream');
    context.response.setHeader('X-Content-Type-Options', 'nosniff');
    context.response.setHeader('Content-Disposition', buildContentDisposition(
      cover ? 'inline' : 'attachment', asset.originalName,
    ));
    context.response.setHeader('Cache-Control', 'private, no-store');
    await context.response.send(new Uint8Array(asset.bytes));
  }
}

export function createUploadsModule() {
  @Module({
    imports: [FormsAuthModule],
    controllers: [UploadsController],
    providers: [
      {
        provide: PostAssets,
        inject: [PrismaService],
        useFactory: (prisma: unknown) => {
          if (!(prisma instanceof PrismaService)) throw new Error('Expected PrismaService.');
          return new PostAssets(prisma);
        },
      },
    ],
    exports: [PostAssets],
  })
  class UploadsModule {}
  return UploadsModule;
}
```

Add the following import to the root `src/app.ts` and add `createUploadsModule()` once at the end of the existing `AppModule.imports` array. Retain `FormsPagesModule`, `createPostsPagesModule()`, and the existing configuration, database, API, and rate-limiting modules.

```ts
import { createUploadsModule } from './uploads/uploads.module.js';
```

The line listing page modules in Chapter 17's imports array becomes the following. Retain the global configuration, database, and account modules before this line and the OpenAPI registration after it.

```ts
ProtectionModule, FormsPagesModule, createPostsPagesModule(), createUploadsModule(),
```

A successful `attach` returns `{ id, version, assetUrl, editUrl, readUrl }`. The 303 Location is an attachment anchor on the actual editing GET, and `Link: <...>; rel="item"` is this file's download address. `readUrl` is used to open the public page after publication. It is correct for that address to return 404 while the post is a draft. Text editing still belongs exclusively to `PostEditingService`, while `PostAssets.attach` changes only bytes, associations, and the version. Publishing still belongs to `PublishingService.publish({ postId, actorId, expectedVersion })`, which commits the publication record together with it.

Post-state and author checks remain in place for downloads too. An asset ID that is difficult to guess is not a substitute for authorization. For now, even public files are served with `no-store`. Because the same handler serves draft files readable only by the author, we begin by conservatively restricting reuse. The current product has no transition to unpublish a post. If you later introduce withdrawal or deletion along with long-lived caching or a CDN, define a separate contract for the ability to revoke already delivered bytes and for their expiration time.

## Reading Stored Files Back Into the Screen

Finishing an upload with 303 does not complete the editor. The returned page must show the cover and attachments just saved, and publishing the same post must expose the same metadata to readers. Neither bytes nor SHA-256 belongs in HTML. The following `src/uploads/post-asset-metadata.ts` is a complete query projection file. Since `PostAsset.kind` is a String in the database, this also makes the responsibility for narrowing it to two values explicit.

```ts
import type { Prisma } from '@prisma/client';
import type { AssetKind } from './upload-policy.js';

export type PostAssetView = {
  readonly id: string;
  readonly kind: AssetKind;
  readonly originalName: string;
  readonly mediaType: string;
  readonly size: number;
  readonly url: string;
};

export const postAssetSelect = {
  id: true, kind: true, originalName: true, mediaType: true, size: true,
} satisfies Prisma.PostAssetSelect;

export function toPostAssetView(
  postId: number,
  row: Prisma.PostAssetGetPayload<{ select: typeof postAssetSelect }>,
): PostAssetView {
  if (row.kind !== 'cover' && row.kind !== 'attachment') {
    throw new Error('Invalid stored asset kind.');
  }
  return {
    ...row, kind: row.kind,
    url: `/posts/${postId}/assets/${row.id}`,
  };
}
```

In Chapter 17's `src/posts/post-pages.tsx`, replace the `ReadingPost` and `EditingPost` declarations with the two types below, and add the `PostAssetView` type import. Retain the existing `Document`, the text form's slug, length limits, hidden version, and error display. These two types explicitly represent empty lists and an absent cover, so drafts without files use the same screen.

```ts
import type { PostAssetView } from '../uploads/post-asset-metadata.js';

export type ReadingPost = {
  readonly id: number;
  readonly title: string;
  readonly content: string;
  readonly slug: string;
  readonly publishedAt: string;
  readonly cover: PostAssetView | null;
  readonly attachments: readonly PostAssetView[];
};

export type EditingPost = {
  readonly id: number;
  readonly title: string;
  readonly content: string;
  readonly slug: string;
  readonly version: number;
  readonly cover: PostAssetView | null;
  readonly attachments: readonly PostAssetView[];
};
```

The following is a **complete replacement file** for `src/posts/prisma-posts-page-store.ts`. The port's two method names and arguments remain unchanged, and no write method is added. Nested `select` in the relation query prevents Prisma from reading the image Bytes. Discarding bytes later in the page model has a different cost from not reading them from the database in the first place.

```ts
import type { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { postAssetSelect, toPostAssetView } from '../uploads/post-asset-metadata.js';
import type { EditingPost, ReadingPost } from './post-pages.js';
import type { PostsPageStore } from './posts-page-store.js';

export class PrismaPostsPageStore implements PostsPageStore {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async readPublished(id: number): Promise<ReadingPost | null> {
    const row = await this.prisma.current().post.findFirst({
      where: { id, status: 'published' },
      select: {
        id: true, title: true, content: true, slug: true, publishedAt: true,
        coverAssetId: true,
        assets: { select: postAssetSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!row || !row.publishedAt) return null;
    const assets = row.assets.map((asset) => toPostAssetView(row.id, asset));
    return {
      id: row.id, title: row.title, content: row.content, slug: row.slug,
      publishedAt: row.publishedAt.toISOString(),
      cover: assets.find((asset) => asset.kind === 'cover' && asset.id === row.coverAssetId) ?? null,
      attachments: assets.filter((asset) => asset.kind === 'attachment'),
    };
  }

  async readOwnedDraft(id: number, authorId: string): Promise<EditingPost | null> {
    const row = await this.prisma.current().post.findFirst({
      where: { id, authorId, status: 'draft' },
      select: {
        id: true, title: true, content: true, slug: true, version: true,
        coverAssetId: true,
        assets: { select: postAssetSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!row) return null;
    const assets = row.assets.map((asset) => toPostAssetView(row.id, asset));
    return {
      id: row.id, title: row.title, content: row.content, slug: row.slug, version: row.version,
      cover: assets.find((asset) => asset.kind === 'cover' && asset.id === row.coverAssetId) ?? null,
      attachments: assets.filter((asset) => asset.kind === 'attachment'),
    };
  }
}
```

The two methods have different exposure boundaries but generate the same file URLs. The public query returns only published posts, and the editing query only the user's own drafts. Knowing a file URL does not let someone read a draft's bytes; the download query checks the same state and ownership conditions. Under optional authentication, an expired or forged cookie does not become anonymous: it returns 401. In that case, clearing the cookie through logout allows public downloads.

The following `src/posts/post-asset-list.tsx` is a complete presentation file. It shows the filename and byte count for the cover as well, while ordinary attachments appear only as download links. The anchor placed in the upload's `editUrl` matches an actual `id`.

```tsx
import type { PostAssetView } from '../uploads/post-asset-metadata.js';

export function PostAssetList({ cover, attachments }: {
  readonly cover: PostAssetView | null;
  readonly attachments: readonly PostAssetView[];
}) {
  return (
    <section aria-label="Post assets">
      {cover ? (
        <figure id={`asset-${cover.id}`}>
          <img src={cover.url} alt={`Cover: ${cover.originalName}`}
            style={{ maxWidth: '100%', height: 'auto' }} />
          <figcaption>
            <a href={cover.url}>{cover.originalName}</a> ({cover.size} bytes)
          </figcaption>
        </figure>
      ) : null}
      {attachments.length > 0 ? (
        <ul>
          {attachments.map((asset) => (
            <li key={asset.id} id={`asset-${asset.id}`}>
              <a href={asset.url} download>{asset.originalName}</a> ({asset.size} bytes)
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
```

Add the following import to `src/posts/post-pages.tsx`.

```ts
import { PostAssetList } from './post-asset-list.js';
```

In that file's `ReadingPage`, insert the following JSX after the body `<div>` and before `</article>`. In `EditingPage`, insert the same JSX and the upload form from the first section of this chapter after the text-saving form's `</form>`. The forms are siblings, not nested.

```tsx
<PostAssetList cover={post.cover} attachments={post.attachments} />
```

No additional provider registration is needed. The existing page router imports this component, and the existing factory in `createPostsPagesModule()` creates the replaced `PrismaPostsPageStore`. The error screen in `PostsPages.save` already spreads `...current` before overriding the submitted text and version, so it does not lose attachment metadata. The conflict screen's version remains the old submitted value. Before uploading more attachments, reload to check the latest version; the error response does not secretly attach the latest version to the user's stale edits.

## Deciding Where to Observe Failures

Small file-policy tests can run without a database or a real network. The following `src/uploads/upload-policy.test.ts` is a complete Vitest test for the complete policy file above. Example payloads and test names remain unchanged in translation.

```ts
import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@fluojs/http';
import { prepareAsset } from './upload-policy.js';

describe('upload policy', () => {
  it('rejects HTML disguised as a PNG cover', () => {
    const bytes = new TextEncoder().encode('<html>not an image</html>');
    expect(() => prepareAsset({
      fieldname: 'file', originalname: 'cover.png', mimetype: 'image/png',
      buffer: bytes, size: bytes.byteLength,
    }, 'cover')).toThrow(BadRequestException);
  });

  it('keeps attachment bytes but removes path and header control characters', () => {
    const bytes = new TextEncoder().encode('example attachment');
    const result = prepareAsset({
      fieldname: 'file', originalname: '../../notes\\guide\r\n.txt',
      mimetype: 'text/html', buffer: bytes, size: bytes.byteLength,
    }, 'attachment');
    expect(result.originalName).toBe('guide.txt');
    expect(result.mediaType).toBe('application/octet-stream');
    expect(result.bytes).toEqual(bytes);
    expect(result.bytes).not.toBe(bytes);
  });
});
```

Run only this file using your existing test configuration. We did not create this application file or run the test while writing the chapter; the command below is a reproduction procedure.

```bash
pnpm exec vitest run src/uploads/upload-policy.test.ts
```

The HTTP experiment is separate. Upload a valid PNG to your own draft: the anchor in the 303 Location and the `Link` header should point to the new asset ID, and the subsequent GET should display the new version, cover image, filename, and size. An ordinary file should appear as a download link, and requesting its asset URL should return its bytes and `nosniff`. Draft files return 404 for other accounts and anonymous requests. After publishing the same post through the existing publishing API, anonymous `/posts/:id/read` requests should also show the cover and download links, and the files should be downloadable.

Changing the multipart file field name to `attachments` should produce 400 because the DTO has no `file`. Exceed the file count or transport size limits and check the adapter's size-limit response; also instrument whether any transaction call occurred. The service's internal `PayloadTooLargeException` maps to 413. A cover over 2 MiB, an attachment over 5 MiB, and a total request over 6 MiB are rejected at their respective boundaries. Exceeding the Prisma Int boundaries for ID or version returns 400, while a cookie without the scope returns 403. An incorrect Origin cannot be used in place of a valid token to upload a file.

For a partial-failure experiment, use a test-only boundary to trigger an exception immediately after asset creation in a PostgreSQL test transaction. Observe `Post.version`, `coverAssetId`, and the asset row count. All three must remain at their previous values. For the concurrency experiment, attach different covers concurrently using the same version. Only one request should succeed, the other should return 409, and only the successful cover should remain as the current pointer. There is no need to align the order with an arbitrary sleep.

If the connection drops, do not guess the outcome. Even if the HTTP dispatcher observes cancellation, it cannot travel back in time to cancel a database transaction that has already committed. The client performs another GET to check the version and cover state. If you choose Fastify's `multipart: { strategy: 'stream' }` for larger files, files are not materialized into `request.files`, so this DTO cannot be used as-is. Stream consumption, backpressure, and temporary-object disposal require a different implementation boundary.

FluoBlog can now save drafts with files attached and serve those bytes to readers after publication. The next requirement is to notify subscribers about new posts without the writer sending links manually. We cannot apply our experience of completing file storage in one transaction directly to email. The next chapter addresses the difference: external delivery does not participate in a PostgreSQL transaction.

## Implementation References

- [HTTP README: Multipart DTOs](../../packages/http/README.md), [Public Exports](../../packages/http/src/index.portable.ts)
- [File, Request, and Response Types](../../packages/http/src/types.ts), [Tests for Array Binding and Distinguishing Absence](../../packages/http/src/adapters/binding.test.ts)
- [Download Filename Header Implementation](../../packages/http/src/header-helpers.ts), [Header Helper Tests](../../packages/http/src/header-helpers.test.ts)
- [Fastify README: Buffered and Stream Multipart](../../packages/platform-fastify/README.md), [Size Limits and Adapter Implementation](../../packages/platform-fastify/src/adapter.ts)
- [Fastify Multipart Regression Tests](../../packages/platform-fastify/src/adapter.test.ts)
- [Prisma Transaction and Global Registration Contracts](../../packages/prisma/README.md), [Passport Optional Authentication and Scope Checks](../../packages/passport/src/guard.ts)
