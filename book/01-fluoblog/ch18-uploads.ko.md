# 표지 이미지와 첨부파일 받기

<!-- book:volume=01-fluoblog;chapter=18 -->

[이전: 독자가 볼 페이지와 작성자가 쓸 화면 만들기](./ch17-react-reading-and-writing.ko.md) · [목차](./toc.ko.md) · [다음: 새 글을 구독자에게 알리기](./ch19-subscriptions-and-email.ko.md)

## 파일 하나가 세 가지 경계를 넘는다

작성자가 튜토리얼의 표지 이미지와 실습 자료를 올리고 싶어 한다. 17장의 폼에 파일 입력을 추가하면 브라우저는 바이트를 보낼 수 있다. 그러나 서버에 도착했다는 것과 안전하게 게시글에 연결됐다는 것은 다른 사건이다. 운영자가 겪은 첫 사고는 표지 교체 중의 충돌이다. 오래된 탭에서 보낸 이미지가 방금 저장한 제목의 버전을 무시하고 연결됐다. 두 번째 사고는 더 단순하다. 업로드에 실패한 줄 알고 재시도했더니 서버에는 이름만 다른 파일 두 개가 남았다.

파일 처리는 전송, 검증, 저장과 게시글 연결이라는 세 경계를 통과한다. 이 중 어느 단계에서 실패했는지 구분하지 않으면 파일만 남거나, 바이트가 없는 첨부파일 링크가 생긴다. 이번 장은 작은 블로그에 맞춰 크기가 제한된 파일을 PostgreSQL에 보관한다. Prisma의 `Bytes` 필드와 게시글 갱신을 같은 트랜잭션으로 묶는 선택이다. 대용량 파일 서비스의 최종 설계는 아니지만 핵심 동작을 가짜 객체 저장소 호출 뒤로 숨기지 않고 완성할 수 있다.

계정과 글은 계속 앞 장의 것이다. `authorId`는 검증된 principal의 subject이고, `Post.version`은 글 내용뿐 아니라 표지나 첨부파일 연결이 바뀔 때도 증가한다. 브라우저가 제출한 사용자 ID는 받지 않는다. 업로드는 초안에서만 허용한다. 발행된 글의 표지를 바꾸는 제품 기능은 발행 수정 정책과 함께 설계해야 하므로 이 초안 경로로 우회하지 않는다.

## 어댑터가 만든 배열을 DTO로 받기

`@fluojs/http`는 특정 웹 서버의 파일 객체를 컨트롤러 계약으로 삼지 않는다. `FrameworkRequestFile`의 공통 필드는 `fieldname`, `originalname`, `mimetype`, `buffer`, `size`다. `buffer`는 `Uint8Array`이고, Node 전용 `Buffer` 메서드가 존재한다고 가정하지 않는다. Fastify의 기본 buffered multipart 경로는 파일을 이 형태의 `request.files`에 노출한다.

DTO에는 `@FromFiles('file')`을 사용한다. 단수 이름을 주어도 반환값은 배열이다. 파일 collection이 있지만 해당 이름의 파일이 없으면 빈 배열이고, collection 자체가 없으면 필수 필드의 missing-field 오류가 된다. 필드 초기값을 `[]`로 두었다고 누락된 multipart가 성공으로 바뀌지는 않는다. `@Optional()`을 붙이는 경우에만 collection 부재를 선택적으로 받는다. DTO binder는 공통 다섯 필드만 투영하므로 어댑터 내부 임시 경로에 기대어 파일을 옮기는 코드를 작성하지 않는다.

아래는 17장의 편집 화면에 추가하는 **JSX 부분 구현**이다. 기존의 텍스트 저장 폼 안에 중첩하지 말고 별도 폼으로 둔다. `post.id`와 `post.version`은 서버가 조회한 `EditingPost`의 값이다. 표지를 올릴 때와 일반 첨부파일을 올릴 때 같은 endpoint를 사용하고 `kind`만 바꾼다.

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

`accept`는 파일 선택기를 돕는 힌트일 뿐 검증이 아니다. 일반 첨부파일도 받기 때문에 위 입력에는 형식 제한을 두지 않았다. `Content-Type` 헤더에 multipart boundary를 수동으로 적지 않는다. 브라우저가 파일과 텍스트 part에 맞는 경계를 만든다. API 클라이언트에서도 `FormData`를 쓰면서 JSON용 헤더를 재사용하면 요청이 파싱되지 않을 수 있다.

전송 단계의 제한은 컨트롤러보다 앞에 있어야 한다. 다음은 기존 Node24 `src/main.ts`의 `runFastifyApplication` 두 번째 인자 안에 합치는 **설정 부분 구현**이다. 같은 키가 이미 있으면 아래 값으로 교체하며 호출을 하나 더 만들지 않는다. 기존 `port: blogConfig.PORT`, host, 로그·종료 설정과 `ensureMetadataSymbol()` 뒤의 동적 `AppModule` import는 그대로 둔다. 포트를 3000으로 하드코딩한 새 부트스트랩으로 바꾸지 않는다. `multipart` 옵션의 위치는 helper와 `createFastifyAdapter` 직접 호출에서 다르다. 직접 생성할 때는 multipart 옵션을 두 번째 인자로 전달한다.

```ts
maxBodySize: 6 * 1024 * 1024,
multipart: {
  maxFileSize: 5 * 1024 * 1024,
  maxFiles: 1,
  maxTotalSize: 6 * 1024 * 1024,
},
```

파일 한도와 전체 요청 한도는 다르다. 전체에는 텍스트 필드와 multipart framing도 들어가므로 5 MiB 파일을 허용하면서 전체 한도를 정확히 5 MiB로 잡지 않았다. 앱은 파일 용도별로 더 좁은 크기도 검사한다. 어댑터 제한이 정상이어도 내부 테스트나 다른 호출자가 파일 정책을 직접 사용할 수 있기 때문이다. 이 경로는 업로드를 메모리에 모은다. 동시 업로드 수가 커지면 파일 한도에 동시 요청 수와 복사본 수를 곱한 메모리 비용을 고려해야 한다.

## 파일 이름은 표시용이고 바이트가 판단 근거다

다음 `src/uploads/upload-policy.ts`는 완전한 정책 파일이다. 표지는 2 MiB 이하의 PNG 형태만 허용하고, 일반 첨부파일은 5 MiB 이하를 다운로드 전용으로 취급한다. `mimetype`과 확장자는 클라이언트의 주장이라 형식 판정의 근거로 삼지 않는다. 이름은 경로로 사용하지 않고 표시용 basename만 보관한다. CR/LF와 제어 문자를 제거해 응답 헤더에 그대로 섞이지 않게 한다.

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

이 검사는 PNG 전체 디코더나 악성코드 검사기가 아니다. 헤더가 정상이어도 뒤의 이미지 데이터가 손상됐다면 브라우저에 깨진 이미지가 보일 수 있다. 여기서 보장하는 것은 바이트 수, 허용한 표지 envelope, 헤더에 선언된 차원의 상한이다. 실제 디코딩 성공과 재인코딩을 요구하는 미디어 서비스라면 별도 디코더로 이를 증명하고 메타데이터를 제거해야 한다. 이 원고는 PNG 헤더 검사만으로 그런 보장을 얻었다고 쓰지 않는다.

그렇다면 왜 이 검사가 유용할까? HTML이나 SVG를 확장자만 바꾸어 표지로 등록하는 실수는 막고, 다운로드 전용 바이트와 이미지로 렌더링할 바이트를 나눈다. 다운로드 경로는 일반 첨부파일을 `application/octet-stream`과 `attachment`로 내보낸다. 이것도 파일 내용 자체가 무해하다는 보장은 아니다. 공개 업로드 서비스에 필요한 검역과 신고 처리는 별개의 제품 책임이다. 현재 FluoBlog의 업로드 권한은 인증된 작성자의 자기 초안으로 제한되어 있다.

해시는 저장 바이트의 동일성을 확인하는 값이다. 같은 SHA-256이라고 같은 작성자의 같은 업로드 작업은 아니다. 해시를 전역 공개 ID로 사용하면 다른 사용자의 비공개 파일 존재를 추측하게 만들 수 있다. 아래에서는 무작위 asset ID를 사용하고 해시는 무결성 진단용 메타데이터에만 남긴다.

## 바이트와 게시글 연결을 한 번에 커밋하기

다음은 `prisma/schema.prisma`에 합치는 **스키마 부분 구현**이다. 먼저 기존 `Post`의 닫는 중괄호 앞에 다음 두 필드를 추가한다. `PostAsset.post`의 relation과 별개로 `coverAssetId`는 현재 표지를 가리키는 애플리케이션 관리 포인터다. 이 예제에서는 같은 트랜잭션의 검증된 코드만 이 필드를 변경한다. 기존 계정·게시글 모델을 새로 생성하는 독립 스키마가 아니며 `Post.publication`과 `PostPublication(id, postId, actorId, version, publishedAt)`도 유지한다. 아직 예약 발행 필드는 추가하지 않는다.

```prisma
coverAssetId String?
assets       PostAsset[]
```

그다음 같은 스키마 파일에 모델을 추가한다.

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

`kind`는 이 작은 예제에서는 문자열이지만 외부 입력을 그대로 저장하지 않고 정책의 두 값만 허용한다. 스키마 migration과 Prisma client 재생성은 독자의 개발 데이터베이스에서 수행한다. 생성기는 그대로 `prisma-client-js`이고 타입은 `@prisma/client`에서 import한다. 이 원고를 집필하면서 데이터베이스를 변경한 것은 아니다.

```bash
pnpm exec prisma validate
pnpm exec prisma migrate dev --name add_post_assets
pnpm exec prisma generate
```

아래 `src/uploads/post-assets.ts`는 완전한 저장 서비스 파일이다. 파일을 먼저 만들고 별도 요청에서 표지를 연결하지 않는다. 조건부 게시글 갱신에 성공한 트랜잭션만 asset을 생성할 수 있으며, 생성이나 이전 표지 삭제가 실패하면 버전 증가까지 함께 롤백된다.

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

잘못된 버전의 재시도는 409이며 새 asset을 남기지 않는다. 첫 요청이 커밋됐지만 응답이 사라진 경우에도 같은 버전으로 재시도하면 409다. 이는 중복 저장을 피하는 동작이지 동일 응답을 재생하는 멱등성 저장소는 아니다. 작성자는 편집 화면을 다시 조회해 올라간 표지를 확인한다. 대용량 업로드에서 매번 바이트를 재전송하기 싫다면 별도 업로드 세션과 멱등성 키가 필요하지만, 현재 한도를 가진 경로에는 버전 충돌을 명확히 보여주는 것으로 충분하다.

일반 첨부파일은 여러 개를 허용하므로 표지 교체 때만 이전 표지를 삭제한다. 글 자체를 삭제하면 FK의 cascade가 연결된 바이트도 지운다. 파일 저장과 포인터 갱신이 한 PostgreSQL 트랜잭션이기 때문에 객체 저장소와 DB 사이의 실패 창은 없다. 그 대가로 DB 백업, 복제, 조회 트래픽에 파일 크기가 그대로 실린다. 이 선택은 영구적 정답이 아니라 작은 파일의 정합성을 먼저 끝내는 단계다.

## HTTP 경계를 등록하고 다운로드까지 닫기

다음 `src/uploads/uploads.module.ts`는 완전한 모듈 파일이다. factory가 전역 `PrismaService`를 주입받아 `PostAssets`를 만든다. 출처 설정은 `FormsAuthModule`이 `AppSettings`에서 받으므로 별도의 origin 토큰이나 새 DB 래퍼가 없다. 업로드는 폼 쿠키 로그인·`posts:write`·동일 Origin을 모두 요구한다. 공개 다운로드는 쿠키가 없으면 익명으로, 쿠키가 있으면 같은 현재 계정 정책으로 검증한다.

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

루트 `src/app.ts`에 아래 import를 추가하고 기존 `AppModule.imports` 배열 끝에 `createUploadsModule()`을 한 번 추가한다. `FormsPagesModule`, `createPostsPagesModule()`과 기존 설정·DB·API·제한 모듈도 그대로 남는다.

```ts
import { createUploadsModule } from './uploads/uploads.module.js';
```

17장의 imports 배열에서 페이지 모듈을 나열한 줄은 다음처럼 바뀐다. 이 줄 앞의 전역 설정·DB·계정 모듈과 뒤의 OpenAPI 등록은 유지한다.

```ts
ProtectionModule, FormsPagesModule, createPostsPagesModule(), createUploadsModule(),
```

`attach`의 성공 결과는 `{ id, version, assetUrl, editUrl, readUrl }`다. 303 Location은 실제 편집 GET의 첨부 앵커이고, `Link: <...>; rel="item"`은 이번 파일의 다운로드 주소다. `readUrl`은 글이 발행된 뒤 공개 페이지를 열 때 쓴다. 초안 시점에는 그 주소가 404인 것이 맞다. 텍스트 편집은 여전히 `PostEditingService`만 소유하며, `PostAssets.attach`는 바이트·연결·버전만 바꾼다. 발행은 여전히 `PublishingService.publish({ postId, actorId, expectedVersion })`가 소유하고 발행 기록을 함께 커밋한다.

다운로드에도 게시글 상태와 작성자 검사가 남는다. 추측하기 어려운 asset ID는 권한 검사의 대체물이 아니다. 현재는 공개 파일도 `no-store`로 전달한다. 작성자만 읽을 수 있는 초안 파일과 같은 handler를 쓰므로 먼저 재사용 범위를 보수적으로 제한한 것이다. 현재 제품에 발행 취소 전이는 없다. 나중에 공개 철회나 삭제 기능을 도입하고 장기 캐시 또는 CDN도 붙인다면, 이미 내려간 바이트의 회수 가능성과 만료 시간을 별도 계약으로 정해야 한다.

## 저장한 파일을 다시 읽어 화면에 보여 주기

업로드가 303으로 끝났다는 사실만으로 편집 화면이 완성되지는 않는다. 돌아온 페이지에서 방금 저장한 표지와 첨부파일을 보여 주고, 같은 글을 발행하면 독자에게도 동일한 메타데이터를 제공해야 한다. 바이트와 SHA-256은 HTML에 넣지 않는다. 다음 `src/uploads/post-asset-metadata.ts`는 완전한 조회 투영 파일이다. `PostAsset.kind`는 DB에서는 String이므로 두 값으로 좁히는 책임도 여기서 드러낸다.

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

17장의 `src/posts/post-pages.tsx`에서 `ReadingPost`와 `EditingPost` 선언을 아래 두 타입으로 교체하고 `PostAssetView` type import를 추가한다. 기존 `Document`, 텍스트 폼의 slug·길이 제한·hidden version과 오류 표시는 유지한다. 다음 두 타입은 빈 목록과 표지 부재를 명시적으로 표현하므로 아직 파일이 없는 초안도 같은 화면에 들어온다.

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

다음은 `src/posts/prisma-posts-page-store.ts`의 **전체 교체 파일**이다. 포트의 두 메서드 이름과 인자는 그대로이며 쓰기 메서드는 추가하지 않는다. 관계 조회에 `select`를 중첩해 Prisma가 이미지 Bytes를 읽지 않도록 한다. 페이지 모델에서 나중에 바이트를 버리는 것과 DB에서 처음부터 읽지 않는 것은 비용이 다르다.

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

두 메서드의 공개 경계는 다르지만 같은 파일 URL을 생성한다. 공개 조회는 발행 글만, 편집 조회는 자기 초안만 반환한다. 파일 URL을 안다고 초안의 바이트를 읽을 수는 없으며 다운로드 쿼리에서도 같은 상태·소유 조건을 확인한다. 선택적 인증에서 만료되거나 위조된 쿠키는 익명으로 바뀌지 않고 401이다. 그 경우 로그아웃으로 쿠키를 지우면 공개 다운로드가 가능하다.

다음 `src/posts/post-asset-list.tsx`는 완전한 표현 파일이다. 표지에도 파일 이름과 바이트 수를 보이고, 일반 첨부파일은 다운로드 링크로만 표시한다. 업로드의 `editUrl`에 넣은 앵커가 실제 `id`와 일치한다.

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

`src/posts/post-pages.tsx`에 다음 import를 추가한다.

```ts
import { PostAssetList } from './post-asset-list.js';
```

그 파일의 `ReadingPage`에서는 본문 `<div>` 다음, `</article>` 앞에 다음 JSX를 넣는다. `EditingPage`에서는 텍스트 저장 폼의 `</form>` 다음에 같은 JSX와 이 장 첫 절의 업로드 폼을 넣는다. 폼끼리는 형제이며 중첩되지 않는다.

```tsx
<PostAssetList cover={post.cover} attachments={post.attachments} />
```

추가 provider 등록은 필요 없다. 기존 페이지 router가 이 컴포넌트를 import하고, `createPostsPagesModule()`의 기존 factory가 교체된 `PrismaPostsPageStore`를 생성한다. `PostsPages.save`의 오류 화면은 이미 `...current`를 펼친 뒤 제출한 텍스트와 version을 덮으므로 첨부 메타데이터를 잃지 않는다. 충돌 화면의 version은 여전히 제출한 옛 값이다. 첨부를 더 올리기 전에는 새로 조회해 최신 버전을 확인해야 하며, 오류 응답이 사용자의 옛 수정에 최신 버전을 몰래 붙이지 않는다.

## 실패를 어느 층에서 관찰할지 정하기

파일 정책의 작은 테스트는 DB나 실제 네트워크 없이 수행할 수 있다. 다음 `src/uploads/upload-policy.test.ts`는 앞의 완전한 정책 파일을 대상으로 하는 완전한 Vitest 테스트다. 예제 payload와 테스트 이름은 번역판에서도 동일하게 유지한다.

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

독자의 기존 테스트 설정에서 이 파일만 실행한다. 본문 작성 과정에서는 이 앱 파일을 생성하거나 테스트를 실행하지 않았으며, 아래 명령은 재현 절차다.

```bash
pnpm exec vitest run src/uploads/upload-policy.test.ts
```

HTTP 실험은 별개다. 정상 PNG를 자기 초안에 업로드하면 303 Location의 앵커와 `Link` 헤더가 새 asset ID를 가리키고, 뒤의 GET에서 새 version·표지 이미지·파일 이름과 크기가 보여야 한다. 일반 파일은 다운로드 링크로 나타나며 asset URL을 요청했을 때 해당 바이트와 `nosniff`가 반환되어야 한다. 다른 계정과 익명 요청에는 초안 파일이 404다. 같은 글을 기존 발행 API로 발행한 뒤에는 익명 `/posts/:id/read`에서도 표지와 다운로드 링크가 보이고 파일을 받을 수 있어야 한다.

multipart 파일 이름을 `attachments`로 바꾸면 DTO에 `file`이 없으므로 400이어야 한다. 파일 수나 전송 크기 제한을 넘으면 어댑터의 크기 제한 응답을 확인하고, 트랜잭션 호출이 없었는지도 계측한다. 서비스 내부의 `PayloadTooLargeException`은 413으로 매핑된다. 2 MiB를 넘는 표지, 5 MiB를 넘는 첨부파일, 6 MiB를 넘는 전체 요청은 각각의 경계에서 거절한다. ID와 version의 Prisma Int 경계를 넘긴 경우는 400이며, scope 없는 쿠키는 403이다. 잘못된 Origin을 올바른 토큰 대신 사용해도 업로드할 수 없다.

부분 실패 실험은 PostgreSQL 테스트 트랜잭션에서 asset 생성 직후 예외를 발생시키도록 테스트 전용 경계에서 유도한다. 관찰할 값은 `Post.version`, `coverAssetId`, asset 행 수다. 세 값이 모두 이전 상태여야 한다. 경쟁 실험에서는 같은 version으로 서로 다른 표지를 동시에 연결한다. 한 요청만 성공하고 다른 요청은 409이며, 성공한 표지 한 개만 현재 포인터로 남아야 한다. 임의의 sleep으로 순서를 맞출 필요가 없다.

연결이 끊겼다면 결과를 추측하지 않는다. HTTP dispatcher가 취소를 관찰해도 이미 커밋한 DB 트랜잭션을 취소한 과거로 되돌리지는 못한다. 클라이언트는 다시 GET해서 버전과 표지 상태를 확인한다. 더 큰 파일 때문에 Fastify의 `multipart: { strategy: 'stream' }`을 선택하면 파일이 `request.files`로 materialize되지 않으므로 이 DTO를 그대로 쓸 수 없다. 스트림 소비, backpressure, 임시 객체 정리까지 다른 구현 경계가 필요하다.

FluoBlog는 이제 파일이 붙은 초안을 저장하고, 발행 후 독자에게 바이트를 제공할 수 있다. 다음 요구는 작성자가 직접 링크를 보내지 않아도 구독자에게 새 글이 알려지는 것이다. 파일 저장을 한 트랜잭션으로 닫은 경험을 그대로 메일에 적용할 수는 없다. 외부 전달은 PostgreSQL 트랜잭션에 들어오지 않는다는 차이를 다음 장에서 다룬다.

## 구현 근거

- [HTTP README: multipart DTO](../../packages/http/README.ko.md), [공개 export](../../packages/http/src/index.portable.ts)
- [파일·요청·응답 타입](../../packages/http/src/types.ts), [배열 바인딩과 누락 구분 테스트](../../packages/http/src/adapters/binding.test.ts)
- [다운로드 파일 이름 헤더 구현](../../packages/http/src/header-helpers.ts), [헤더 helper 테스트](../../packages/http/src/header-helpers.test.ts)
- [Fastify README: buffered/stream multipart](../../packages/platform-fastify/README.ko.md), [크기 제한·어댑터 구현](../../packages/platform-fastify/src/adapter.ts)
- [Fastify multipart 회귀 테스트](../../packages/platform-fastify/src/adapter.test.ts)
- [Prisma 트랜잭션·전역 등록 계약](../../packages/prisma/README.ko.md), [Passport 선택적 인증과 scope 검사](../../packages/passport/src/guard.ts)
