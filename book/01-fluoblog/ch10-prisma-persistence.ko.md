# 메모리의 게시글을 데이터베이스로 옮기기

<!-- book:volume=01-fluoblog;chapter=10 -->

[이전: 환경이 달라도 같은 코드 실행하기](./ch09-configuration.ko.md) · [1권 목차](./toc.ko.md) · [다음: 글 발행을 하나의 작업으로 보장하기](./ch11-publishing-transactions.ko.md)

## 저장 버튼은 성공했는데 글이 사라졌다

운영자가 FluoBlog에 긴 초안을 작성하고 저장했다. 응답은 성공이었고, 같은 프로세스에서 다시 조회하니 내용도 보였다. 설정을 바꾸고 서버를 재시작한 순간 글이 사라졌다. 게시글을 보관한 `Map`은 프로세스의 메모리에 있었기 때문이다. 두 프로세스를 동시에 실행하면 상황은 더 이상해진다. 첫 번째 서버에 저장한 글이 두 번째 서버의 목록에는 나타나지 않는다.

파일로 직렬화하면 재시작 문제의 일부는 해결할 수 있지만, 여러 쓰기 작업의 경합과 부분 기록, ID 할당, 검색 조건까지 직접 다루게 된다. 이 단계에서 필요한 것은 “배열 대신 다른 자료구조”가 아니다. 애플리케이션의 수명보다 긴 데이터 수명과 여러 요청이 공유할 저장 규칙이다. 본문은 PostgreSQL을 저장소로, Prisma를 스키마와 조회 도구로 사용한다. 다른 ORM을 동시에 도입하지 않는다.

앞 장의 `AppSettings.databaseUrl`을 연결 생성에 사용한다. 기능 모듈은 계속 `PostsModule`이며, 소스 경로는 독자의 `fluo-blog/src/posts/`다. 여기서 정의하는 모델과 마이그레이션은 애플리케이션 소유다. `@fluojs/prisma`를 등록한다고 게시글 테이블이 생기는 것은 아니다. 이 패키지의 역할은 제공받은 Prisma Client의 연결 수명과 트랜잭션 컨텍스트를 Fluo에 연결하는 데 있다.

## 먼저 무엇을 보존할지 결정하기

영속화로 옮기면서 게시글의 의미까지 바꿀 필요는 없다. `id`, `authorId`, `title`, `content`, `slug`, `status`, `version`, `publishedAt`를 저장한다. `id`는 내부 식별자이고 `slug`는 발행할 공개 주소의 제안 값이다. 초안에서는 빈 값과 중복을 허용하고 발행된 글 사이에서만 유일해야 한다. 공개 HTTP 경로는 여전히 `/posts/:id`다. slug에 고유 제약을 둔다는 사실이 새로운 라우트를 자동으로 추가하지는 않는다.

초안은 `status=draft`이며 `publishedAt`이 없다. 발행된 글은 `status=published`이며 발행 시각을 가진다. `version`은 저장 충돌을 감지하는 정수다. 벽시계 시간이나 “수정한 것처럼 보이는 정도”를 뜻하지 않는다. 5장의 기준대로 새 초안은 `version=1`이며, 첫 수정이나 발행에 성공하면 `version=2`가 된다. 지금은 초안 수정 시 한 번 증가시키고, 다음 장에서는 발행도 같은 버전 규칙에 참여시킨다.

게시글의 `id`는 양의 정수지만, `User.id`와 이를 참조하는 `authorId`는 문자열이다. 두 식별자의 표현을 같게 맞출 이유는 없다. 계정 기능이 아직 없으므로 로컬 작성 실험에서는 운영자 식별자 `'author-1'`을 애플리케이션이 전달한다. 클라이언트가 보낸 `authorId`를 신뢰한다는 뜻이 아니다. 13장에서 기존 문자열 ID 공간에 계정을 연결하고 이후 인증된 주체에서 작성자를 정하게 된다. 이 시점의 작성용 호출을 인증 없는 운영 API로 외부에 공개하지 않는다.

스키마가 모든 도메인 규칙을 대신하지는 않는다. 제목의 저장 상한이나 발행된 slug의 유일성처럼 저장소가 보장할 규칙과, 초안을 발행해도 되는지처럼 서비스가 판단할 규칙을 나눈다. 반대로 유일성을 서비스에서만 검사해서도 안 된다. 두 요청이 동시에 “해당 slug가 없다”는 결과를 읽은 뒤 둘 다 생성할 수 있으므로 최종 권위는 DB의 고유 제약이어야 한다.

## Prisma 버전과 스키마를 함께 고정하기

이 장의 생성기와 생성자 예제는 **Prisma 6.19.0**을 기준으로 한다. `prisma` CLI와 `@prisma/client`를 같은 버전으로 설치한다. 이는 Fluo가 Prisma 6만 지원한다는 뜻이 아니다. 현재 패키지의 peer 범위는 `@prisma/client >=5.0.0`이며, Prisma의 다른 주 버전에서 달라지는 생성기나 연결 어댑터 설정을 이 예제와 섞지 않기 위한 실습 기준이다. 실행 환경은 계속 Node.js 24와 pnpm 10이다.

```bash
pnpm add @fluojs/prisma @prisma/client@6.19.0
pnpm add -D prisma@6.19.0
```

아래는 이 시점의 `prisma/schema.prisma` 전체다. PostgreSQL의 시간 정밀도를 밀리초로 맞췄다. 자바스크립트 `Date`가 표현할 수 없는 마이크로초를 저장했다가 뒤의 커서 조회에서 경계를 잃지 않도록 하기 위해서다. 시간대가 있는 시각을 저장하되 화면 표시는 응답 계층의 책임으로 남긴다.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PostStatus {
  draft
  published
}

model Post {
  id          Int        @id @default(autoincrement())
  authorId    String
  title       String     @db.VarChar(120)
  content     String     @db.Text
  slug        String     @db.VarChar(80)
  status      PostStatus @default(draft)
  version     Int        @default(1)
  publishedAt DateTime?  @db.Timestamptz(3)
}
```

연결할 로컬 전용 PostgreSQL과 비어 있는 연습용 DB가 먼저 준비되어 있어야 한다. 여기서는 서버 설치나 운영 인프라 변경을 수행하지 않는다. 다음 명령은 독자가 해당 DB를 준비한 뒤 실행할 개발 절차이며, 이미 실행한 결과를 인용한 것이 아니다.

```bash
pnpm exec prisma validate
pnpm exec prisma migrate dev --name create_posts --create-only
```

두 번째 명령이 만든 `prisma/migrations/<생성된_디렉터리>/migration.sql` 끝에 다음 SQL을 추가한다. 이 블록은 생성된 테이블 정의를 대체하지 않는 **마이그레이션 추가 부분**이다. 실제 디렉터리 이름은 CLI가 출력한 것을 사용한다.

```sql
ALTER TABLE "Post"
  ADD CONSTRAINT "Post_author_nonempty" CHECK (length("authorId") > 0),
  ADD CONSTRAINT "Post_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "Post_publication_shape" CHECK (
    ("status" = 'draft' AND "publishedAt" IS NULL)
    OR
    ("status" = 'published' AND "publishedAt" IS NOT NULL AND "version" >= 2)
  );

CREATE UNIQUE INDEX "Post_published_slug_key" ON "Post" ("slug")
WHERE "status" = 'published';
```

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

부분 고유 인덱스는 초안의 빈 slug와 중복 제안을 허용하고 발행 시점의 경합만 막는다. Prisma 6.19.0 스키마에는 `@unique`를 다시 붙이지 않으며 이 인덱스는 SQL 마이그레이션으로 관리한다. 따라서 slug를 `findUnique`의 키로 사용할 수 없다. ID 조회는 그대로이고 공개 slug 조회가 필요하면 `findFirst({ where: { slug, status: 'published' } })`를 사용한다. PostgreSQL `varchar(n)`은 문자를 세므로 5장의 UTF-16 코드 단위 상한은 도메인과 DTO에서도 계속 검사한다.

생성된 클라이언트는 스키마의 타입을 제공하지만, 사용자 정의 `CHECK`의 의미까지 타입으로 표현하지는 않는다. 따라서 SQL 마이그레이션도 소스의 일부로 검토한다. 스키마 파일만 수정하고 클라이언트를 재생성하면 DB가 바뀌지 않고, DB만 수정하면 생성 타입이 오래된 상태가 된다. 두 단계가 다른 일을 한다는 점을 구분해야 한다.

Prisma CLI의 환경 로딩과 Fluo의 `ConfigModule` 로딩도 별개다. CLI는 이 장의 `DATABASE_URL`을 자체 환경이나 `.env`에서 얻는다. Fluo의 `runtimeOverrides`나 `.env.local` 병합 결과가 CLI로 전달되는 것은 아니다. 개발 마이그레이션 전에는 CLI와 앱이 같은 연습용 DB를 가리키는지 비밀을 노출하지 않는 방식으로 확인한다. 배포 단계에는 검토된 마이그레이션을 적용하는 별도 절차를 두며, 앱 시작 때마다 `migrate dev`를 실행하지 않는다.

## 연결의 주인을 한 곳에 두기

각 요청에서 `new PrismaClient()`를 만들면 요청 수에 따라 연결 풀이 늘어난다. 반대로 모듈 바깥의 전역 변수를 무조건 공유하면 같은 프로세스에서 독립 앱을 부트스트랩하는 테스트가 서로의 연결을 닫을 수 있다. 한 애플리케이션 컨테이너가 자신의 클라이언트를 하나 소유하게 하자.

다음은 `src/database/blog-database.module.ts`의 완전한 파일이다. 앞 장의 `AppSettings`는 `AppSettingsModule`이 전역으로 내보내는 실제 클래스 토큰이다. `forRootAsync`의 factory는 반드시 `async` 함수일 필요는 없다. DI로 설정을 받은 뒤 컨테이너별로 클라이언트를 만들기 위해 이 등록 경로를 선택한다.

```ts
import { PrismaModule } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';
import { AppSettings } from '../config/app-settings.js';

export const BlogDatabaseModule = PrismaModule.forRootAsync({
  global: true,
  inject: [AppSettings],
  useFactory: (settings: unknown) => {
    if (!(settings instanceof AppSettings)) throw new Error('Expected AppSettings from DI.');
    return {
    client: new PrismaClient({
      datasources: { db: { url: settings.databaseUrl } },
    }),
      strictTransactions: true,
    };
  },
});
```

`global`은 factory의 반환값이 아니라 등록의 바깥 옵션이다. 모듈의 가시성은 factory를 실행하기 전에 결정해야 하기 때문이다. 이름 없는 등록은 기본적으로 전역이 아니지만, 여기서는 앱 전체의 단일 DB이므로 `global: true`를 명시한다. 여러 DB를 사용해야 하는 상황이 오면 이름 있는 등록과 `getPrismaServiceToken(name)`을 사용한다. 이름 있는 등록을 전역으로 만드는 구성은 현재 계약에서 거부된다.

`strictTransactions: true`도 명시한다. 트랜잭션을 지원하지 않는 대체 클라이언트가 들어와도 트랜잭션처럼 보이는 직접 실행으로 조용히 바뀌어서는 안 된다. 이 설정은 DB의 격리 수준이나 저장 규칙을 강화하는 옵션이 아니라, 트랜잭션 지원 능력이 없을 때 경계를 실패시키는 옵션이다.

`src/app.ts`의 기존 `AppModule.imports`에 `BlogDatabaseModule`을 추가한다. 합성 부분은 다음과 같다. 기존 HTTP 관련 옵션이나 provider를 제거하라는 뜻은 아니다.

```ts
import { Module } from '@fluojs/core';
import { AppSettingsModule } from './config/app-settings.module.js';
import { BlogDatabaseModule } from './database/blog-database.module.js';
import { PostsModule } from './posts/posts.module.js';

@Module({
  imports: [AppSettingsModule, BlogDatabaseModule, PostsModule],
})
export class AppModule {}
```

`PrismaModule`이 제공하는 `PrismaService`는 초기화 시 `$connect()`를 호출하고 애플리케이션 종료 시 `$disconnect()`를 맡는다. 서비스나 컨트롤러에서 요청마다 연결을 끊지 않는다. 연결 문자열의 구조가 유효해도 초기 연결은 실패할 수 있으며, 그 경우 게시글 저장이 가능한 것처럼 요청을 받기보다 초기화 실패를 드러내야 한다. 강제 프로세스 종료는 정상적인 종료 훅 실행과 같지 않으므로, 종료 보장 전체는 후반의 수명주기 장에서 다시 다룬다.

## 게시글에 필요한 저장 연산만 만들기

아래는 `src/posts/posts.repository.ts`의 완전한 파일이다. 범용 `Repository<T>`를 만드는 대신 현재 제품에 필요한 연산을 이름으로 드러낸다. `DraftInput`은 HTTP 원문이 아니라 앞 장의 요청 경계에서 문자열 타입과 길이를 확인한 내부 입력이다. slug 형식과 빈 제목·본문은 발행 때 검사한다. `authorId`는 신뢰한 작성자 컨텍스트에서 채운다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { normalizeText, type PublishedPost } from './post.js';

export type DraftInput = { authorId: string; title: string; content: string; slug: string };
export type DraftEdit = Pick<DraftInput, 'title' | 'content' | 'slug'>;

@Inject(PrismaService)
export class PostsRepository {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  createDraft(input: DraftInput) {
    return this.prisma.current().post.create({
      data: {
        ...normalizeText(input), authorId: input.authorId,
        status: 'draft', version: 1, publishedAt: null,
      },
    });
  }

  async findById(id: number) {
    return this.prisma.current().post.findUnique({ where: { id } });
  }

  findPublishedById(id: number) {
    return this.prisma.current().post.findFirst({ where: { id, status: 'published' } });
  }

  listPublished() {
    return this.prisma.current().post.findMany({
      where: { status: 'published' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 20,
      select: { id: true, title: true, slug: true, publishedAt: true },
    });
  }

  async editDraft(id: number, expectedVersion: number, input: DraftEdit) {
    const result = await this.prisma.current().post.updateMany({
      where: { id, status: 'draft', version: expectedVersion },
      data: { ...normalizeText(input), version: { increment: 1 } },
    });
    return result.count === 1;
  }

  async publishDraft(post: PublishedPost, expectedVersion: number) {
    const result = await this.prisma.current().post.updateMany({
      where: { id: post.id, status: 'draft', version: expectedVersion },
      data: {
        status: 'published', version: { increment: 1 },
        publishedAt: new Date(post.publishedAt),
      },
    });
    return result.count === 1;
  }
}
```

각 호출에서 `current()`를 사용하는 이유는 다음 장을 위한 장식이 아니다. 이 함수는 트랜잭션 경계 안에서는 그 경계의 클라이언트를, 밖에서는 루트 클라이언트를 돌려준다. 생성자에서 `const client = prisma.current()`를 저장하면 생성 당시의 루트 클라이언트를 붙잡아 나중의 트랜잭션을 우회할 수 있다. 클라이언트뿐 아니라 모델 delegate를 클래스 필드에 미리 저장하는 습관도 피한다.

`findById`는 편집용 내부 조회이고, `findPublishedById`는 공개 조회다. 공개 경로에서 전체 조회 후 응답 직전에만 초안을 거르는 것보다 저장 연산 자체에 공개 조건이 있는 편이 실수할 여지가 적다. 두 경우 모두 없으면 `null`이다. 이를 HTTP 404로 바꾸는 일은 기존 API 경계가 맡으며, Prisma가 애플리케이션의 404 응답을 자동 생성하는 것은 아니다.

`editDraft`는 먼저 조회한 뒤 조건 없는 `update`를 하지 않는다. ID, 상태, 버전을 하나의 갱신 조건으로 넣는다. 두 요청이 같은 버전으로 수정하면 한 요청만 행을 바꾸고 다른 요청은 `false`를 얻는다. 단일 SQL 갱신 자체는 원자적이므로 이를 위해 별도의 대화형 트랜잭션을 열 필요는 없다. 다만 `false`만으로 없는 글인지, 이미 발행했는지, 다른 수정이 있었는지 알 수는 없다. 상세한 사용자 메시지가 필요하면 서비스가 추가로 조회하되, 최종 쓰기의 조건을 제거해서는 안 된다.

저장소는 내부 행을 반환할 수 있지만 HTTP 응답이 곧 DB 행은 아니다. 앞 장에서 만든 응답 모델을 계속 적용하고 `Date`는 경계에서 ISO 문자열로 바꾼다. `authorId`, `version`, 상태처럼 편집 경로에 필요한 값과 공개 목록에 필요한 값을 구분한다. 목록에서는 본문을 선택하지 않았고 최대 20개만 가져온다. 모든 글을 반환하던 계약에서 상한을 도입한다면 API 문서와 클라이언트도 함께 바꾼다. 이 장은 첫 페이지만 제공하며, 12장에서 연속 조회 계약을 완성한다.

## 동기 컨트롤러까지 함께 교체하기

생성자만 저장소로 바꾸면 8장의 동기 호출은 Promise에 `map`을 호출한다. 아래 파일들을 같은 단계에서 교체한다. 5장의 `src/posts/post.ts`에서는 정규화 함수를 저장소도 사용하도록 `export function normalizeText(input: DraftText): DraftText`로 공개하고, `requireDraft`의 정수 범위 검사에 `current.version >= 2_147_483_647`도 OR 조건으로 추가한다. 나머지 생성·수정·발행 규칙은 유지한다. 6장의 `src/posts/post-request.dto.ts`에서 ID의 `@Max(Number.MAX_SAFE_INTEGER)`는 `@Max(2_147_483_647)`로, 두 `expectedVersion`의 상한은 다음 증가가 가능한 `@Max(2_147_483_646)`로 바꾼다. `@Min(1)`과 문자열의 UTF-16 길이 검사는 그대로다.

**`src/posts/post-row.ts` 전체**는 Prisma의 Date를 5장의 ISO 문자열 스냅샷으로 복원한다.

```ts
import type { Post as PostRow } from '@prisma/client';
import type { PostSnapshot } from './post.js';

export function toPostSnapshot(row: PostRow): PostSnapshot {
  const base = {
    id: row.id, authorId: row.authorId, title: row.title,
    content: row.content, slug: row.slug, version: row.version,
  };
  if (row.status === 'draft' && row.publishedAt === null) {
    return Object.freeze({ ...base, status: 'draft', publishedAt: null });
  }
  if (row.status === 'published' && row.publishedAt !== null) {
    return Object.freeze({
      ...base, status: 'published', publishedAt: row.publishedAt.toISOString(),
    });
  }
  throw new Error('Stored post violates the publication shape.');
}
```

**`src/posts/posts.service.ts` 전체**다. 조건부 갱신에 성공한 바로 그 후보 스냅샷을 반환하므로 나중 쓰기가 끝난 행을 다시 읽어 자기 결과로 돌려주지 않는다. 이 장의 발행은 한 행만 갱신한다. 11장에서 기록까지 하나의 트랜잭션으로 옮긴다.

```ts
import { Inject } from '@fluojs/core';
import { Prisma } from '@prisma/client';
import {
  PostDomainError, publishPost, reviseDraft,
  type DraftText, type PostSnapshot, type PublishedPost,
} from './post.js';
import { PostsRepository } from './posts.repository.js';
import { toPostSnapshot } from './post-row.js';

export const POST_CLOCK = Symbol('POST_CLOCK');
export type PostClock = { now(): Date };

@Inject(PostsRepository, POST_CLOCK)
export class PostsService {
  constructor(private readonly posts: PostsRepository, private readonly clock: PostClock) {}

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

  async publish(id: number, expectedVersion: number): Promise<PublishedPost> {
    const next = publishPost(await this.get(id), expectedVersion, this.clock.now());
    try {
      if (!await this.posts.publishDraft(next, expectedVersion)) {
        throw new PostDomainError('POST_VERSION_CONFLICT', 'Another change was saved first.');
      }
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PostDomainError('POST_SLUG_CONFLICT', 'The public slug is already in use.');
      }
      throw error;
    }
    return next;
  }
}
```

**`src/posts/post-http-error.ts` 전체**다. 동기 예외와 비동기 거부를 모두 같은 HTTP 코드로 변환한다.

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

export async function runPostCommand<T>(action: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
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

**`src/posts/post-response.dto.ts` 전체**다. 출력 필드와 클래스 허용 목록은 유지하고, 요약 mapper는 실제 SELECT의 네 필드만 요구한다. Date 변환은 이미 저장 행 경계에서 끝났다.

```ts
import { Expose } from '@fluojs/serialization';
import type { PostSnapshot, PublishedPost } from './post.js';

@Expose({ excludeExtraneous: true })
export class PostSummaryDto {
  @Expose()
  id = 0;

  @Expose()
  title = '';

  @Expose()
  slug = '';

  @Expose()
  publishedAt = '';
}

export class PublicPostDto extends PostSummaryDto {
  @Expose()
  content = '';
}

@Expose({ excludeExtraneous: true })
export class PostWriteReceiptDto {
  @Expose()
  id = 0;

  @Expose()
  status: 'draft' | 'published' = 'draft';

  @Expose()
  version = 0;

  @Expose()
  publishedAt: string | null = null;
}

export function toPostSummary(post: Pick<PublishedPost, 'id' | 'title' | 'slug' | 'publishedAt'>): PostSummaryDto {
  return Object.assign(new PostSummaryDto(), {
    id: post.id,
    title: post.title,
    slug: post.slug,
    publishedAt: post.publishedAt,
  });
}

export function toPublicPost(post: PublishedPost): PublicPostDto {
  return Object.assign(new PublicPostDto(), {
    id: post.id,
    title: post.title,
    slug: post.slug,
    publishedAt: post.publishedAt,
    content: post.content,
  });
}

export function toPostWriteReceipt(post: Pick<PostSnapshot, 'id' | 'status' | 'version' | 'publishedAt'>): PostWriteReceiptDto {
  return Object.assign(new PostWriteReceiptDto(), {
    id: post.id,
    status: post.status,
    version: post.version,
    publishedAt: post.publishedAt,
  });
}
```

**`src/posts/posts.controller.ts` 전체**는 8장의 메타데이터를 유지하면서 모든 비동기 결과를 기다린다. 계정을 도입하기 전의 세 쓰기 경로는 여전히 로컬 운영자 실습이며 15장에서 모두 인증된 경로로 교체한다.

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
  async list() {
    return (await this.posts.listPublished()).map(toPostSummary);
  }

  @Get('/:id')
  @RequestDto(GetPostDto)
  @ApiOperation({ summary: 'Read one published post' })
  @ApiParam('id', { schema: postIdParameterSchema })
  @ApiResponse(200, { description: 'Published post.', schema: publicPostSchema })
  @ApiResponse(404, { description: 'Missing or unpublished post.', schema: errorResponseSchema })
  get(input: GetPostDto) {
    return runPostCommand(async () => toPublicPost(await this.posts.getPublished(input.id)));
  }

  @Post()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  @ApiOperation({ summary: 'Create a draft for the local operator' })
  @ApiBody({ description: 'All three strings are required; empty draft text is allowed.' })
  @ApiResponse(201, { description: 'Draft created.', schema: postWriteReceiptSchema })
  create(input: CreatePostDto) {
    return runPostCommand(async () => toPostWriteReceipt(await this.posts.create('author-1', {
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
    return runPostCommand(async () => toPostWriteReceipt(
      await this.posts.revise(input.id, input.expectedVersion, {
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
    return runPostCommand(async () => toPostWriteReceipt(
      await this.posts.publish(input.id, input.expectedVersion),
    ));
  }
}
```

8장의 `src/posts/post-api.schemas.ts`에서 ID와 응답 버전의 `maximum`도 `2_147_483_647`로 맞춘다. URL 문법은 유지하되 parameter 설명은 PostgreSQL Int 범위를 명시한다. 정상 JSON 필드와 400·404·409 오류 코드는 바뀌지 않는다.

다음은 **`src/posts/posts.module.ts` 전체**다. 변환기·직렬화기·시계 등록을 누락하지 않는다.

```ts
import { Module } from '@fluojs/core';
import { SerializerInterceptor } from '@fluojs/serialization';
import { PostIdConverter } from './post-id.converter.js';
import { PostsController } from './posts.controller.js';
import { POST_CLOCK, PostsService, type PostClock } from './posts.service.js';
import { PostsRepository } from './posts.repository.js';
import { PostLinks } from './post-links.js';

@Module({
  controllers: [PostsController],
  providers: [
    PostsService, PostsRepository, PostLinks, PostIdConverter, SerializerInterceptor,
    { provide: POST_CLOCK, useValue: { now: () => new Date() } satisfies PostClock },
  ],
  exports: [PostsService, PostsRepository],
})
export class PostsModule {}
```

## 첫 seed와 실제 데이터 이전은 다르다

최초 HTTP 실습의 `id=1`, `title=Hello, Fluo!`, `content=My first post.`를 잃지 않고 옮겨 보자. 다음은 새 연습 DB에 한 번 넣는 seed SQL이다. PostgreSQL 클라이언트에서 실행하며 운영 데이터 이전 스크립트로 쓰지 않는다. 5장에서 이미 발행한 같은 글이므로 `status=published`, `version=2`와 기존 발행 시각을 보존하고 공개 조회로 확인한다.

```sql
BEGIN;

INSERT INTO "Post"
  ("id", "authorId", "title", "content", "slug", "status", "version", "publishedAt")
VALUES
  (1, 'author-1', 'Hello, Fluo!', 'My first post.', 'hello-fluo', 'published', 2,
   timestamptz '2026-01-01 00:00:00+00');

SELECT setval(
  pg_get_serial_sequence('"Post"', 'id'),
  (SELECT MAX("id") FROM "Post"),
  true
);

COMMIT;
```

명시적 ID를 넣었으므로 자동 증가 시퀀스도 조정했다. 그렇지 않으면 다음 자동 생성이 `id=1`을 다시 시도할 수 있다. 이 seed는 중복 실행하면 고유 제약으로 실패하도록 두었다. 운영자가 수정한 글을 seed가 덮어쓰는 동작보다 명백한 실패가 낫다. 대량 이전이라면 쓰기를 일시 정지하고 원본을 내보낸 뒤, 개수·ID·slug 중복·본문 누락을 검증하고 전환해야 한다. 개발 seed와 실제 데이터 이전의 책임을 하나의 `upsert`로 감추지 않는다.

메모리 상태를 읽어 올 수 있는 동안에만 이전이 가능하다는 점도 기억하자. 프로세스를 이미 종료해 잃어버린 초안은 DB를 도입한다고 복원되지 않는다. 영속화는 앞으로의 보존을 제공하며, 백업과 복원은 별도 운영 능력이다. “DB에 저장했다”와 “어떤 장애에서도 복구할 수 있다” 사이에는 여전히 거리가 있다.

## 연결을 바꿔도 남는지 증명하기

5장의 `src/posts/post.test.ts`에서 메모리 `PostsService`를 직접 만들던 테스트는 저장소 교체 후 그대로 실행할 수 없다. 다음 **전체 교체 파일**은 순수 도메인 전이를 검사한다. 두 연결 수명과 오래된 저장의 거부는 바로 아래 저장소 통합 테스트가, 중복 slug 발행과 반복 요청은 11장의 실제 DB 통합 테스트가 이어 맡는다. 7장의 응답 mapper 테스트는 그대로 유지한다.

```ts
import { describe, expect, it } from 'vitest';
import { createDraft, publishPost, reviseDraft } from './post.js';

const at = new Date('2026-06-01T09:00:00.000Z');
const text = { title: 'First review', content: 'We tested a restart.', slug: 'first-review' };

describe('Post transitions', () => {
  it('keeps an empty draft at version 1 after publication is rejected', () => {
    const draft = createDraft(2, 'author-1', { title: '', content: '', slug: '' });
    expect(() => publishPost(draft, 1, at)).toThrow(
      expect.objectContaining({ code: 'POST_NOT_PUBLISHABLE' }),
    );
    expect(draft).toMatchObject({ status: 'draft', version: 1, publishedAt: null });
  });

  it('revises a draft once and rejects its stale version', () => {
    const draft = createDraft(2, 'author-1', text);
    const edited = reviseDraft(draft, 1, { ...text, title: 'Saved first' });
    expect(edited).toMatchObject({ title: 'Saved first', version: 2 });
    expect(() => reviseDraft(edited, 1, text)).toThrow(
      expect.objectContaining({ code: 'POST_VERSION_CONFLICT' }),
    );
    expect(draft.version).toBe(1);
  });

  it('does not change the publication time or version on repetition or editing', () => {
    const published = publishPost(createDraft(2, 'author-1', text), 1, at);
    expect(published).toMatchObject({ status: 'published', version: 2, publishedAt: at.toISOString() });
    expect(() => publishPost(published, 1, at)).toThrow(
      expect.objectContaining({ code: 'POST_VERSION_CONFLICT' }),
    );
    expect(() => publishPost(published, 2, at)).toThrow(
      expect.objectContaining({ code: 'POST_NOT_DRAFT' }),
    );
    expect(() => reviseDraft(published, 2, text)).toThrow(
      expect.objectContaining({ code: 'POST_NOT_DRAFT' }),
    );
    expect(published.version).toBe(2);
  });
});
```

```bash
pnpm exec vitest run src/posts/post.test.ts src/posts/post-response.test.ts
```

아래는 `test/post-storage.integration.test.ts`의 완전한 파일이다. 실제 PostgreSQL에 위 스키마가 적용되어 있어야 하며, `DATABASE_URL_TEST`는 운영 DB와 분리된 연습 DB여야 한다. 누락되면 테스트를 건너뛰지 않고 실패시킨다. 표준 데코레이터를 변환하는 앞 장의 Vitest 설정을 사용한다.

```ts
import { randomUUID } from 'node:crypto';
import { PrismaModule } from '@fluojs/prisma';
import { FluoFactory, defineModule } from '@fluojs/runtime';
import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { PostsRepository } from '../src/posts/posts.repository.js';

async function openStore(url: string) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  class TestModule { }
  defineModule(TestModule, {
    imports: [PrismaModule.forRoot({ client, strictTransactions: true })],
    providers: [PostsRepository],
    exports: [PostsRepository],
  });
  const app = await FluoFactory.create(TestModule);
  const store = await app.container.resolve(PostsRepository);
  return { app, store };
}

it('persists a draft across two application lifetimes', async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required');

  const slug = `storage-${randomUUID()}`;
  const cleanup = new PrismaClient({ datasources: { db: { url } } });
  try {
    const first = await openStore(url);
    let id: number;
    try {
      const post = await first.store.createDraft({
        authorId: 'author-1',
        title: 'A durable draft',
        content: 'This text must survive a restart.',
        slug,
      });
      id = post.id;
      expect(post.version).toBe(1);
      expect(await first.store.findPublishedById(id)).toBeNull();

      await expect(first.store.createDraft({
        authorId: 'author-1', title: 'Duplicate draft', content: '', slug,
      })).resolves.toMatchObject({ status: 'draft', version: 1, slug });

      expect(await first.store.editDraft(id, 1, {
        title: 'Edited draft', content: 'Saved once.', slug,
      })).toBe(true);
      expect(await first.store.editDraft(id, 1, {
        title: 'Stale edit', content: 'Must not overwrite.', slug,
      })).toBe(false);
    } finally {
      await first.app.close();
    }

    const second = await openStore(url);
    try {
      expect(await second.store.findById(id)).toMatchObject({
        title: 'Edited draft',
        content: 'Saved once.',
        status: 'draft',
        version: 2,
        publishedAt: null,
      });
      expect(await second.store.findPublishedById(id)).toBeNull();
    } finally {
      await second.app.close();
    }
  } finally {
    try {
      await cleanup.post.deleteMany({ where: { slug } });
    } finally {
      await cleanup.$disconnect();
    }
  }
});
```

```bash
pnpm exec vitest run test/post-storage.integration.test.ts
```

이 실험은 새 애플리케이션 컨테이너와 새 Prisma Client에서 같은 행을 읽는다는 점이 핵심이다. 같은 저장소 인스턴스를 두 번 읽는 테스트는 메모리 구현도 통과할 수 있다. DB를 흉내 낸 객체의 `$transaction`이 콜백을 호출하기만 한다면 영속성이나 롤백 역시 입증할 수 없다. 패키지의 모듈 계약 테스트와 이 DB 통합 테스트가 서로 다른 경계를 확인하는 이유다.

예상 결과는 새 컨테이너에서도 수정된 본문과 `version=2`가 남고, 초안은 공개 조회에서 보이지 않는 것이다. 초안의 slug 중복은 허용되고, 오래된 버전의 수정은 `false`로 거부된다. 발행 시 고유 제약의 `P2002`는 서비스가 `POST_SLUG_CONFLICT`로 변환한다. 실제 프로세스 재시작 확인에서는 초안을 만든 뒤 정상 종료하고 다시 시작해 같은 ID를 편집 경로로 조회한다. 조회할 때마다 seed를 다시 넣는 코드는 이 실험을 속일 수 있으므로 두 번째 시작에서는 seed를 실행하지 않는다.

이 장의 집필 과정에서 이 PostgreSQL 통합 실험을 실행하지 않았다. 현재 저장소의 Prisma 등록·수명주기 소스와 테스트를 확인했으며, 위 코드는 독자 애플리케이션용 재현 절차다. 검증 결과를 기록할 때는 DB 버전, Prisma 버전, 마이그레이션 상태와 함께 실제 실행 결과를 구분해 남긴다.

## 영속성 다음에 남는 문제

모든 기능에 저장소 인터페이스를 추가해야 하는 것은 아니다. 현재의 `PostsRepository`는 게시글 연산을 모으는 작은 클래스이고 Fluo와 Prisma에 직접 의존한다. 여러 구현을 실제로 교체할 필요가 생기면 그때 토큰과 포트를 추가해도 늦지 않다. 인터페이스 이름만으로 DI가 해결된다고 쓰거나, 교체할 계획이 없는 저장소까지 범용 계층으로 감싸지 않는다.

이제 재시작은 초안을 지우지 않는다. 그러나 게시글을 발행된 상태로 바꾼 뒤 발행 기록을 쓰는 중 오류가 발생하면, 반만 끝난 작업이 더 오래 남게 된다. 메모리 때의 문제가 사라진 자리에 새로운 정합성 문제가 드러난 것이다. 다음 장에서는 게시글 상태 변경과 발행 기록 생성을 하나의 서비스 작업으로 묶고, 동시에 누르는 발행 버튼에도 규칙이 유지되는지 확인한다.

## 근거가 되는 구현과 계약

- [Prisma 통합의 등록·수명주기·트랜잭션 계약](../../packages/prisma/README.ko.md)
- [공개 export](../../packages/prisma/src/index.ts)와 [Prisma peer 의존성 범위](../../packages/prisma/package.json)
- [동기·비동기 모듈 등록 구현](../../packages/prisma/src/module.ts)
- [클라이언트 경계와 트랜잭션 타입](../../packages/prisma/src/types.ts)
- [`current()`와 연결 수명주기 구현](../../packages/prisma/src/service.ts)
- [컨테이너별 등록·수명주기 테스트](../../packages/prisma/src/module.test.ts)
- [비동기 전역 등록의 형제 모듈 가시성 테스트](../../packages/prisma/src/module-global-visibility.test.ts)
- [HTTP·서비스·저장소 연결 실험](../../packages/prisma/src/vertical-slice.test.ts)

[이전: 환경이 달라도 같은 코드 실행하기](./ch09-configuration.ko.md) · [1권 목차](./toc.ko.md) · [다음: 글 발행을 하나의 작업으로 보장하기](./ch11-publishing-transactions.ko.md)
