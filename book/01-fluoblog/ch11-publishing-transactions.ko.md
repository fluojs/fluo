# 글 발행을 하나의 작업으로 보장하기

<!-- book:volume=01-fluoblog;chapter=11 -->

[이전: 메모리의 게시글을 데이터베이스로 옮기기](./ch10-prisma-persistence.ko.md) · [1권 목차](./toc.ko.md) · [다음: 글이 많아져도 목록이 느려지지 않게 하기](./ch12-efficient-queries.ko.md)

## 절반만 성공한 발행

FluoBlog의 초안은 이제 재시작해도 남는다. 운영자는 발행 버튼에 두 작업을 연결했다. 먼저 게시글 상태를 `published`로 바꾸고, 다음으로 누가 언제 어떤 버전을 발행했는지 기록한다. 그런데 두 번째 작업에서 오류가 났다. 화면에는 발행 실패라고 나왔지만 공개 목록에는 글이 나타났다. 운영자가 다시 버튼을 누르자 이번에는 이미 발행된 글이라는 응답을 받았다.

이 문제는 각 SQL 문이 성공했는지 확인하는 것만으로 풀리지 않는다. 첫 번째 문장은 이미 확정되었고 두 번째 문장은 실패했기 때문이다. 원하는 성공 단위는 SQL 한 문장이 아니라 제품의 “발행”이다. 상태 변경과 발행 기록이 모두 남거나, 둘 다 남지 않아야 한다. 오류를 잡아서 원래 상태로 되돌리는 두 번째 갱신을 실행하면 그 복구 자체도 실패할 수 있다.

그렇다고 모든 HTTP 요청을 트랜잭션으로 감싸지는 않는다. 요청 본문을 읽는 시간, 응답을 직렬화하는 시간, 네트워크를 기다리는 시간을 DB 잠금과 연결 수명에 포함할 이유가 없다. 이 장은 `PublishingService.publish()`라는 좁은 서비스 메서드에 원자성을 부여한다. 같은 메서드는 HTTP 컨트롤러나 나중의 예약 발행 작업에서 호출할 수 있다.

## 발행 작업의 계약을 문장으로 고정하기

입력은 `postId`, `actorId`, `expectedVersion`이다. `postId`는 양의 정수인 게시글 ID이며 `actorId`는 기존 사용자 ID와 같은 문자열인 실행 주체다. 인증을 도입하기 전 로컬 실습에서는 운영자 ID `'author-1'`을 넘긴다. 외부 JSON의 작성자 ID를 권위 있는 값으로 채택하지 않는다. `expectedVersion`은 사용자가 편집 화면에서 확인한 게시글 버전이다.

초안을 발행하려면 작성자가 일치하고, 읽은 버전이 현재 버전과 같으며, 제목과 본문이 비어 있지 않아야 한다. slug도 허용한 형식이어야 한다. 성공하면 상태가 바뀌고 버전이 한 번 증가하며 발행 시각이 정해진다. 새 초안의 `version=1`을 수정 없이 발행하면 게시글과 발행 기록은 모두 `version=2`가 된다. 발행 후의 일반 수정은 이 장에서 허용하지 않는다. 앞 장의 `editDraft` 역시 `status=draft`를 갱신 조건에 포함한다.

5~8장의 반복 발행 계약을 유지한다. 같은 `expectedVersion`으로 다시 발행하면 `POST_VERSION_CONFLICT`, 이미 발행된 현재 버전으로 요청하면 `POST_NOT_DRAFT`이며 둘 다 HTTP 409다. 동시에 같은 초안을 읽은 두 요청도 하나만 전환할 수 있다. 발행 기록을 만들었다는 이유로 이전 성공 응답을 재생하지 않는다.

발행 기록은 게시글과 같은 버전·시각의 감사 자료다. 응답 유실 시에는 공개 상태를 다시 조회한다. 멱등성 키에 따른 성공 응답 재생이나 외부 알림 전달은 별도 계약이며, 이후 발행 취소와 재발행을 허용하면 현재의 한 글당 한 기록이라는 모델부터 다시 검토해야 한다.

## 발행 기록도 우리가 소유하는 데이터다

10장의 `prisma/schema.prisma`에서 기존 `Post` 모델 안에 다음 필드를 추가한다. 이 블록은 모델 전체가 아닌 **필드 추가 부분**이다.

```prisma
publication PostPublication?
```

같은 파일에 아래 모델을 추가한다. `PostPublication`은 Fluo가 생성하는 이벤트 테이블이 아니라 이 애플리케이션의 발행 기록이다. `postId`의 고유 제약은 같은 글의 첫 발행 기록이 둘 생기는 것을 막는다. 발행자와 작성자가 지금은 같더라도 `actorId`를 기록하면 나중에 편집자가 발행하는 정책을 설명할 수 있다.

```prisma
model PostPublication {
  id          Int      @id @default(autoincrement())
  postId      Int      @unique
  actorId     String
  version     Int
  publishedAt DateTime @db.Timestamptz(3)
  post        Post     @relation(fields: [postId], references: [id], onDelete: Restrict)
}
```

```bash
pnpm exec prisma migrate dev --name add_post_publication --create-only
```

생성된 마이그레이션 파일에서 테이블 생성문 뒤에 다음 SQL을 추가한다. 추가 제약과 기존 발행 행의 초기 기록을 함께 넣는다. 앞 장의 연습 seed는 이미 발행된 `version=2`의 글이므로 같은 버전과 시각의 발행 기록을 만든다. 다른 기존 발행 행도 현재 버전을 그대로 복사하며, 이관을 새 발행으로 취급해 버전을 올리거나 다시 매기지 않는다. 생성 버전이 1이고 발행 시 한 번 이상 증가하므로 발행 기록의 최소 버전은 2다. 여기서 만드는 과거 행의 `actorId`는 당시의 실제 조작 로그가 아니라 작성자 기반의 이관 값이라는 한계가 있다.

```sql
ALTER TABLE "PostPublication"
  ADD CONSTRAINT "PostPublication_actor_nonempty" CHECK (length("actorId") > 0),
  ADD CONSTRAINT "PostPublication_version_positive" CHECK ("version" >= 2);

INSERT INTO "PostPublication" ("postId", "actorId", "version", "publishedAt")
SELECT "id", "authorId", "version", "publishedAt"
FROM "Post"
WHERE "status" = 'published';
```

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

이 데이터 이관은 작성이 멈춘 연습 DB에서 수행한다. 실행 중인 서비스의 쓰기와 병행하면서 모든 과거 이력을 복원한다고 주장하지 않는다. 운영 데이터가 있다면 변경 배포 순서와 쓰기 중단 구간을 별도로 정해야 한다. 또한 `onDelete: Restrict` 때문에 발행 기록이 있는 게시글을 실수로 삭제할 수 없다. 테스트 정리는 자신이 만든 기록을 먼저 지우고 게시글을 지우며, 제품의 삭제 정책을 테스트 편의 때문에 약하게 만들지 않는다.

## 트랜잭션에 참여하는 저장소 만들기

다음은 `src/posts/post-publications.repository.ts`의 완전한 파일이다. 기존 게시글 저장소와 같은 `PrismaService` 토큰을 주입한다. 두 저장소가 서로 다른 클라이언트나 서로 다른 서비스 인스턴스를 사용하면 같은 DB 주소를 가리켜도 하나의 트랜잭션이 되지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

export type PublicationInput = {
  postId: number;
  actorId: string;
  version: number;
  publishedAt: Date;
};

@Inject(PrismaService)
export class PostPublicationsRepository {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  findByPostId(postId: number) {
    return this.prisma.current().postPublication.findUnique({
      where: { postId },
    });
  }

  async record(input: PublicationInput) {
    return this.prisma.current().postPublication.create({ data: input });
  }
}
```

저장소는 트랜잭션을 직접 열지 않는다. 발행 기록 하나를 쓰는 저장소는 앞서 게시글 상태를 바꿨는지 알지 못한다. 두 작업의 관계를 아는 서비스가 바깥 경계를 결정해야 한다. 각 저장소가 별도 트랜잭션을 열고 확정해 버리면 원래의 부분 성공 문제로 돌아간다.

아래는 `src/posts/publishing.service.ts`의 완전한 파일이다. `PostsRepository`는 10장에서 만든 클래스다. 내부 오류 코드는 HTTP 예외가 아니므로, 자동으로 400이나 409가 된다고 가정하지 않는다. 아래 HTTP 오류 파일이 `not_found`를 404, `forbidden`을 403, `conflict`와 `slug_conflict`를 기존 409 코드로 변환한다. 예상하지 못한 저장 오류는 성공 결과로 바꾸지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, Transaction } from '@fluojs/prisma';
import { Prisma, type PostPublication, type PrismaClient } from '@prisma/client';
import { publishPost } from './post.js';
import { toPostSnapshot } from './post-row.js';
import { PostsRepository } from './posts.repository.js';
import { PostPublicationsRepository } from './post-publications.repository.js';

export type PublishCommand = { postId: number; actorId: string; expectedVersion: number };
export type PublicationReceipt = { postId: number; version: number; publishedAt: string };
export type PublishRejectionCode = 'not_found' | 'forbidden' | 'conflict' | 'slug_conflict';
export class PublishRejected extends Error {
  constructor(readonly code: PublishRejectionCode) {
    super(code);
    this.name = 'PublishRejected';
  }
}

function receipt(record: PostPublication): PublicationReceipt {
  return { postId: record.postId, version: record.version, publishedAt: record.publishedAt.toISOString() };
}

@Inject(PrismaService, PostsRepository, PostPublicationsRepository)
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly posts: PostsRepository,
    private readonly publications: PostPublicationsRepository,
  ) {}

  @Transaction({ isolationLevel: 'ReadCommitted', timeout: 5000 })
  async publish(command: PublishCommand): Promise<PublicationReceipt> {
    const row = await this.posts.findById(command.postId);
    if (!row) throw new PublishRejected('not_found');
    if (row.authorId !== command.actorId) throw new PublishRejected('forbidden');
    const next = publishPost(toPostSnapshot(row), command.expectedVersion, new Date());
    const publishedAt = new Date(next.publishedAt);
    try {
      const changed = await this.prisma.current().post.updateMany({
        where: {
          id: row.id, authorId: command.actorId,
          status: 'draft', version: command.expectedVersion,
        },
        data: { status: 'published', publishedAt, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new PublishRejected('conflict');
    } catch (error: unknown) {
      // This update can violate only the published-slug unique index.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PublishRejected('slug_conflict');
      }
      throw error;
    }
    const publication = await this.publications.record({
      postId: row.id, actorId: command.actorId, version: next.version, publishedAt,
    });
    return receipt(publication);
  }
}
```

`@Transaction`은 현재의 표준 메서드 데코레이터다. 이 코드에서는 인스턴스의 `prisma`와 저장소의 동일한 Prisma 서비스가 하나로 해석되므로, 옵션 객체로 격리 수준과 제한 시간을 전달했다. 여러 Prisma 등록이 섞인 서비스라면 `@Transaction((self: SomeService) => self.prisma)`처럼 접근자를 명시하는 방법이 있다. 옵션 객체와 접근자를 임의의 두 인수로 전달하는 API는 아니다.

`ReadCommitted`라는 선택만으로 경합을 해결했다고 말할 수는 없다. 첫 조회와 실제 갱신 사이에 다른 요청이 상태를 바꿀 수 있기 때문이다. 정확성을 만드는 핵심은 `updateMany`의 상태·버전 조건이다. PostgreSQL에서 같은 행을 먼저 갱신한 트랜잭션이 확정되면 뒤의 갱신은 조건을 다시 평가하고, 더 이상 초안이 아니거나 버전이 바뀐 행을 갱신하지 않는다. 그 결과를 검사하지 않으면 트랜잭션을 사용하고도 잘못된 성공을 반환할 수 있다.

새 시각은 한 번 생성해서 두 행에 함께 쓴다. 두 번의 `new Date()`를 호출해서 기록마다 조금씩 다른 시각을 만들지 않는다. 이 값은 서비스가 정한 발행 시각이지 DB 확정 순서를 나타내는 전역 시계가 아니다. 저장소가 늘어나거나 서버 시계가 어긋나면 시각만으로 모든 사건의 순서를 증명할 수 없다.

`record()`가 실패하면 오류가 트랜잭션 콜백 바깥까지 전파된다. 그때 앞선 게시글 갱신도 롤백된다. 내부에서 오류를 잡고 `{ success: false }`를 반환하면 콜백이 정상 완료되어 첫 번째 갱신이 확정될 수 있으므로 그렇게 처리하지 않는다. 서비스의 반환 Promise가 성공한 뒤에야 호출자는 발행이 확정된 결과를 받는다.

## 기존 HTTP 결과와 오류 계약에 연결하기

10장의 `PostsRepository.publishDraft`와 그 메서드만 사용하던 `PublishedPost` 타입 import는 이제 삭제한다. 발행을 한 행 갱신으로 우회하는 경로를 남기지 않는다. `PostsService`의 나머지 조회·초안 연산은 유지하되 **`src/posts/posts.service.ts`는 다음 전체 파일**로 교체한다. 내부 `PublicationReceipt.postId`를 기존 작성 응답의 `id`로 바꾸고 `status`를 명시하므로 HTTP 필드가 바뀌지 않는다.

```ts
import { Inject } from '@fluojs/core';
import {
  PostDomainError, reviseDraft,
  type DraftText, type PostSnapshot, type PublishedPost,
} from './post.js';
import { PostsRepository } from './posts.repository.js';
import { toPostSnapshot } from './post-row.js';
import { PublishingService } from './publishing.service.js';

@Inject(PostsRepository, PublishingService)
export class PostsService {
  constructor(private readonly posts: PostsRepository, private readonly publishing: PublishingService) {}

  async create(authorId: string, input: DraftText): Promise<PostSnapshot> {
    return toPostSnapshot(await this.posts.createDraft({ ...input, authorId }));
  }

  async get(id: number): Promise<PostSnapshot> {
    const row = await this.posts.findById(id);
    if (!row) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
    return toPostSnapshot(row);
  }

  async getPublished(id: number): Promise<PublishedPost> {
    const row = await this.posts.findPublishedById(id);
    if (!row) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
    const post = toPostSnapshot(row);
    if (post.status !== 'published') throw new Error('Expected a published post.');
    return post;
  }

  async listPublished() {
    return (await this.posts.listPublished()).map((row) => {
      if (row.publishedAt === null) throw new Error('Published post has no timestamp.');
      return { ...row, publishedAt: row.publishedAt.toISOString() };
    });
  }

  async revise(id: number, expectedVersion: number, input: DraftText): Promise<PostSnapshot> {
    const next = reviseDraft(await this.get(id), expectedVersion, input);
    if (!await this.posts.editDraft(id, expectedVersion, next)) {
      throw new PostDomainError('POST_VERSION_CONFLICT', 'Another change was saved first.');
    }
    return next;
  }

  async publish(id: number, expectedVersion: number, actorId: string) {
    const result = await this.publishing.publish({ postId: id, actorId, expectedVersion });
    return {
      id: result.postId, status: 'published' as const,
      version: result.version, publishedAt: result.publishedAt,
    };
  }
}
```

**`src/posts/post-http-error.ts` 전체**다. 발행의 저장 경계 오류도 기존 도메인 코드로 번역한다. 제목·본문·slug 검증과 반복 발행은 5장의 `publishPost`가 던진 `PostDomainError`를 그대로 사용한다.

```ts
import { HttpException } from '@fluojs/http';
import { PostDomainError, type PostErrorCode } from './post.js';
import { PublishRejected, type PublishRejectionCode } from './publishing.service.js';

const publicationErrors = {
  not_found: { status: 404, code: 'POST_NOT_FOUND' },
  forbidden: { status: 403, code: 'FORBIDDEN' },
  conflict: { status: 409, code: 'POST_VERSION_CONFLICT' },
  slug_conflict: { status: 409, code: 'POST_SLUG_CONFLICT' },
} satisfies Record<PublishRejectionCode, { status: number; code: string }>;

const statusByCode = {
  POST_NOT_FOUND: 404,
  POST_INVALID_TEXT: 400,
  POST_VERSION_CONFLICT: 409,
  POST_NOT_DRAFT: 409,
  POST_NOT_PUBLISHABLE: 400,
  POST_SLUG_CONFLICT: 409,
} satisfies Record<PostErrorCode, number>;

export async function runPostCommand<T>(action: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error: unknown) {
    if (error instanceof PostDomainError) {
      throw new HttpException(statusByCode[error.code], error.message, {
        code: error.code,
      });
    }
    if (error instanceof PublishRejected) {
      const mapped = publicationErrors[error.code];
      throw new HttpException(mapped.status, error.message, { code: mapped.code });
    }
    throw error;
  }
}
```

10장의 `PostsController.publish` 본문은 아래로 교체한다. 나머지 라우트와 데코레이터는 유지한다. 로컬 운영자 ID를 새 필수 인수에 명시하며 15장에서 인증된 주체로 바꾼다.

```ts
publish(input: PublishPostDto) {
  return runPostCommand(async () => toPostWriteReceipt(
    await this.posts.publish(input.id, input.expectedVersion, 'author-1'),
  ));
}
```

## 모듈에 연결하고 경계를 짧게 유지하기

10장의 `BlogDatabaseModule` 등록을 계속 사용한다. `strictTransactions: true`, 컨테이너별 클라이언트 생성, `AppSettings` 주입을 그대로 유지하며, 발행용 클라이언트를 하나 더 만들지 않는다. `src/posts/posts.module.ts`의 전체 교체 파일은 다음과 같다. 기존 `PostsService`는 일반 게시글 API를 맡고, 발행 작업은 여기서 추가한 `PublishingService`로 위임한다.

```ts
import { Module } from '@fluojs/core';
import { SerializerInterceptor } from '@fluojs/serialization';
import { PostIdConverter } from './post-id.converter.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';
import { PostsRepository } from './posts.repository.js';
import { PostLinks } from './post-links.js';
import { PostPublicationsRepository } from './post-publications.repository.js';
import { PublishingService } from './publishing.service.js';

@Module({
  controllers: [PostsController],
  providers: [
    PostsService, PostsRepository, PostLinks, PostIdConverter, SerializerInterceptor,
    PostPublicationsRepository, PublishingService,
  ],
  exports: [PostsService, PostsRepository, PublishingService],
})
export class PostsModule {}
```

Fluo는 비동기 로컬 저장소인 `AsyncLocalStorage`로 현재 트랜잭션을 유지한다. `await`를 지나 저장소를 호출해도 `current()`가 같은 트랜잭션 클라이언트를 선택한다. 원시 `PRISMA_CLIENT`를 주입받아 직접 호출하거나, 저장소 필드에 루트 delegate를 미리 보관하면 이 경계를 우회할 수 있다. 단지 같은 함수에서 호출했다고 참여하는 것이 아니다.

이미 트랜잭션 안에서 또 `transaction()`이나 장식된 메서드를 호출하면 기존 경계를 재사용한다. 별도의 저장점이 생기지 않으며, 내부 성공이 바깥 실패로부터 보호되지도 않는다. 중첩 호출에 새로운 격리 옵션을 주면 의도를 조용히 무시하지 않고 거부한다. 이 장의 `publish()`는 옵션을 가진 바깥 경계이므로 다른 트랜잭션 안에 숨겨 호출하지 않는다. 더 큰 작업으로 합성해야 한다면 경계 소유자를 먼저 재설계한다.

발행 후 이메일을 보내고 싶어도 이 트랜잭션 안에 네트워크 전송을 추가하지 않는다. DB 롤백은 이미 전송된 이메일을 회수할 수 없다. 그렇다고 확정 직후 한 줄로 보내면 프로세스가 그 사이 종료될 때 전송 의도가 사라질 수 있다. 그 문제에는 애플리케이션 소유의 영속 전달 의도가 필요하며, 후속 비동기 장에서 별도로 다룬다. 현재의 `PostPublication`은 발행 기록일 뿐 전송 완료 상태나 재시도 책임을 가진 outbox가 아니다.

## 실패를 넣어도 한 작업인지 검사하기

다음은 `test/publishing.integration.test.ts`의 완전한 파일이다. 10장과 이 장의 마이그레이션을 적용한 독립 PostgreSQL DB, Prisma 6.19.0 생성 클라이언트, 표준 데코레이터를 처리하는 Vitest 구성이 필요하다. 첫 테스트는 실제 DB 갱신 뒤 기록 저장 경계에서 실패시킨다. 두 번째 테스트는 두 호출이 초안을 읽은 순간을 먼저 관측한 뒤 동시에 진행시켜, 경합이 우연히 발생하기를 기다리지 않는다.

```ts
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient, type Post as PostRow } from '@prisma/client';
import { expect, it } from 'vitest';
import { PostsRepository } from '../src/posts/posts.repository.js';
import {
  PostPublicationsRepository,
  type PublicationInput,
} from '../src/posts/post-publications.repository.js';
import { PublishingService } from '../src/posts/publishing.service.js';

async function withDraft(
  run: (prisma: PrismaService<PrismaClient>, post: PostRow) => Promise<void>,
) {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required');
  const client = new PrismaClient({ datasources: { db: { url } } });
  const prisma = new PrismaService(client, { strictTransactions: true });
  let id: number | undefined;
  try {
    await prisma.onModuleInit();
    const post = await client.post.create({
      data: {
        authorId: 'author-1',
        title: 'One publication',
        content: 'Both writes must agree.',
        slug: `publish-${randomUUID()}`,
      },
    });
    id = post.id;
    await run(prisma, post);
  } finally {
    try {
      if (id !== undefined) {
        await client.postPublication.deleteMany({ where: { postId: id } });
        await client.post.deleteMany({ where: { id } });
      }
    } finally {
      await prisma.onApplicationShutdown();
    }
  }
}

it('rolls back the post when the publication write fails', async () => {
  await withDraft(async (prisma, post) => {
    class RejectingPublications extends PostPublicationsRepository {
      override async record(_input: PublicationInput): Promise<never> {
        throw new Error('Publication storage failed');
      }
    }
    const service = new PublishingService(
      prisma, new PostsRepository(prisma), new RejectingPublications(prisma),
    );
    await expect(service.publish({
      postId: post.id, actorId: 'author-1', expectedVersion: 1,
    })).rejects.toThrow('Publication storage failed');

    expect(await prisma.current().post.findUnique({
      where: { id: post.id },
    })).toMatchObject({ status: 'draft', version: 1, publishedAt: null });
    expect(await prisma.current().postPublication.count({
      where: { postId: post.id },
    })).toBe(0);
  });
});

it('lets only one competing transition win and rejects repetition', async () => {
  await withDraft(async (prisma, post) => {
    const bothRead = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let arrivals = 0;
    class SynchronizedPosts extends PostsRepository {
      override async findById(id: number) {
        const row = await super.findById(id);
        if (row?.status === 'draft') {
          arrivals += 1;
          if (arrivals === 2) bothRead.resolve();
          await release.promise;
        }
        return row;
      }
    }
    const service = new PublishingService(
      prisma, new SynchronizedPosts(prisma), new PostPublicationsRepository(prisma),
    );
    const command = { postId: post.id, actorId: 'author-1', expectedVersion: 1 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Both readers did not arrive')), 2000);
    });
    const settled = Promise.allSettled([
      service.publish(command),
      service.publish(command),
    ]);
    try {
      await Promise.race([bothRead.promise, deadline]);
    } finally {
      clearTimeout(timer);
      release.resolve();
      await settled;
    }
    const results = await settled;
    const successful = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'conflict' });
    const winner = successful[0];
    if (!winner) throw new Error('Expected a successful publication');

    expect(winner.value).toMatchObject({ postId: post.id, version: 2 });
    await expect(service.publish(command)).rejects.toMatchObject({ code: 'POST_VERSION_CONFLICT' });
    await expect(service.publish({ ...command, expectedVersion: 2 }))
      .rejects.toMatchObject({ code: 'POST_NOT_DRAFT' });
    expect(await prisma.current().post.findUnique({
      where: { id: post.id },
    })).toMatchObject({ status: 'published', version: 2 });
    expect(await prisma.current().postPublication.count({
      where: { postId: post.id },
    })).toBe(1);
  });
}, 15000);

it('allows duplicate draft slugs but rolls back the losing publication', async () => {
  await withDraft(async (prisma, first) => {
    const db = prisma.current();
    const second = await db.post.create({
      data: { authorId: first.authorId, title: first.title, content: first.content, slug: first.slug },
    });
    try {
      const service = new PublishingService(
        prisma, new PostsRepository(prisma), new PostPublicationsRepository(prisma),
      );
      const results = await Promise.allSettled([first, second].map((post) =>
        service.publish({ postId: post.id, actorId: post.authorId, expectedVersion: 1 }),
      ));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((result) => result.status === 'rejected');
      if (!failure || failure.status !== 'rejected') throw new Error('Expected one rejected publication');
      expect(failure.reason).toMatchObject({ code: 'slug_conflict' });
      const rows = await db.post.findMany({ where: { id: { in: [first.id, second.id] } } });
      expect(rows.find((row) => row.status === 'draft')).toMatchObject({ version: 1, publishedAt: null });
      expect(rows.find((row) => row.status === 'published')).toMatchObject({ version: 2 });
      expect(await db.postPublication.count({ where: { postId: { in: [first.id, second.id] } } })).toBe(1);
    } finally {
      await db.postPublication.deleteMany({ where: { postId: second.id } });
      await db.post.deleteMany({ where: { id: second.id } });
    }
  });
});
```

```bash
pnpm exec vitest run test/publishing.integration.test.ts
```

동시성 테스트에는 적어도 두 개의 연결을 열 수 있는 테스트 풀이 필요하다. 하나만 열 수 있으면 두 번째 트랜잭션이 첫 번째 읽기와 합류할 수 없고, 도착 제한 시간으로 실패하는 것이 맞다. 타이머는 경합을 만들기 위한 잠깐의 대기가 아니라, 필요한 사건이 발생하지 않았음을 알리는 상한이다. 검증할 두 읽기가 모두 끝난 사건을 기다린 뒤 명시적으로 문을 연다.

롤백 테스트에서 대체한 것은 발행 기록 저장 한 곳뿐이다. 첫 게시글 갱신과 트랜잭션 확정·롤백은 실제 Prisma와 PostgreSQL을 통과한다. 따라서 `@Transaction`을 제거하면 발행 상태가 남아 테스트가 실패해야 한다. 이것이 이 테스트가 방지하려는 회귀다. 단순히 저장소 mock 두 개가 호출되었는지 확인해서는 이 사실을 입증할 수 없다.

추가로 제목을 공백으로 둔 초안은 `POST_NOT_PUBLISHABLE`로 거부되고 두 테이블이 바뀌지 않아야 한다. 다른 작성자 ID는 `forbidden`, 없는 ID는 `not_found`, 조회 시 이미 오래된 버전은 `POST_VERSION_CONFLICT`, 조건부 갱신에서 뒤처지면 `conflict`여야 한다. HTTP에서는 둘 다 `POST_VERSION_CONFLICT`와 409다. 현재 API 경계에서 이 도메인 오류를 각각의 응답으로 바꾸는 테스트도 연결한다. 본문 테스트의 문자열 비교는 제품 문구가 아니라 오류 경계에서 주입한 실패를 구별하기 위한 것이다.

이 DB 통합 실험은 집필 과정에서 실행한 결과가 아니라 재현 가능한 검증 코드다. 패키지 자체의 데코레이터·컨텍스트·종료 테스트를 소스 근거로 확인했으며, 그것이 이 게시글 스키마의 실제 PostgreSQL 동작까지 대신 검증했다고 쓰지 않는다.

## 종료와 재시도까지 포함한 성공의 의미

서비스 경계에는 5초의 Prisma 트랜잭션 제한 시간을 두었다. 긴 외부 호출을 넣어도 안전하다는 뜻이 아니라, 잠금과 연결을 무기한 잡아 두지 않겠다는 선택이다. 연결 획득 제한 시간은 별도 옵션이며, 서로 다른 제한 시간을 하나의 “요청 시간”으로 합쳐 설명하지 않는다. 과부하로 발행이 시간 초과되었다면 즉시 무한 재시도하기보다 상태를 다시 조회하고 원인을 관측해야 한다.

종료가 시작되면 Fluo의 Prisma 서비스는 새로운 바깥 수동·서비스 트랜잭션을 거부한다. 이미 열린 경계는 정리된 뒤 연결이 해제되도록 기다린다. 이것은 일반 메서드가 모든 HTTP 취소 신호를 자동으로 이어받는다는 계약은 아니다. 요청 전체 취소가 필요한 별도 작업에는 `requestTransaction` 경계와 신호를 명시한다. 현재 발행 작업에는 짧은 서비스 경계를 유지한다.

이제 발행 결과는 한 행의 상태만 보아 추측하는 것이 아니라, 게시글과 일치하는 발행 기록으로 설명할 수 있다. 그러나 성공적으로 발행된 글이 많아지면 첫 20개를 읽는 단순 조회에도 요구가 붙는다. 독자는 다음 페이지를 보고 싶어 하고 운영자는 큰 본문을 매번 읽는 비용을 줄이고 싶어 한다. 다음 장에서는 방금 확정한 발행 시각과 ID를 함께 사용해 목록의 경계와 조회 비용을 설계한다.

## 근거가 되는 구현과 계약

- [서비스 경계, 중첩 호출, 종료와 상태 계약](../../packages/prisma/README.ko.md)
- [공개 export](../../packages/prisma/src/index.ts)
- [`Transaction`의 옵션·접근자 해석과 표준 데코레이터 구현](../../packages/prisma/src/transaction.ts)
- [비동기 컨텍스트, `current()`, 바깥 경계 추적 구현](../../packages/prisma/src/service.ts)
- [엄격한 트랜잭션과 등록 타입](../../packages/prisma/src/types.ts)
- [서비스·저장소·응답 순서의 통합 테스트](../../packages/prisma/src/vertical-slice.test.ts)
- [데코레이터와 중첩 옵션 거부 계약 테스트](../../packages/prisma/src/transaction-decorator.red.test.ts)
- [종료 중 활성 경계와 연결 해제 순서 테스트](../../packages/prisma/src/shutdown-drain-status.test.ts)

[이전: 메모리의 게시글을 데이터베이스로 옮기기](./ch10-prisma-persistence.ko.md) · [1권 목차](./toc.ko.md) · [다음: 글이 많아져도 목록이 느려지지 않게 하기](./ch12-efficient-queries.ko.md)
