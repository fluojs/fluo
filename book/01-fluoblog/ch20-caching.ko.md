# 인기 글을 빠르게 제공하기

<!-- book:volume=01-fluoblog;chapter=20 -->

[이전: 새 글을 구독자에게 알리기](./ch19-subscriptions-and-email.ko.md) · [목차](./toc.ko.md) · [다음: 예약 발행과 정기 작업 만들기](./ch21-scheduled-publishing.ko.md)

## 알림은 성공했고 같은 글에 독자가 몰렸다

새 글 알림이 나간 뒤 FluoBlog의 읽기 요청이 갑자기 늘었다. 요청마다 인증 실패가 생기는 것도 아니고 SQL 실행 계획이 완전히 잘못된 것도 아니다. 같은 발행본의 본문을 수천 번 읽고 같은 공개 응답을 만드는 비용이 반복된다. 12장에서 쿼리를 다듬었더라도 같은 작업을 매번 수행하는 비용까지 사라지지는 않는다.

캐시는 계산한 값을 잠시 재사용하는 장치다. 성능만 생각하고 넣으면 다른 문제를 만들기 쉽다. 운영자는 처음에 글 ID를 key로 삼아 편집 화면의 조회 결과까지 저장했다. 본인 초안이 잘 보이는 것을 확인한 뒤 익명 브라우저로 같은 ID를 열었더니 초안 본문이 나왔다. TTL을 짧게 줄여도 그 시간 동안의 노출은 실제 노출이다. 키와 저장 값의 의미를 정하기 전에 캐시를 붙인 것이 원인이다.

이 장은 발행된 공개 본문의 조회만 최적화한다. 기존 `Post.status`, `version`, `publishedAt`을 이용하고 초안 편집과 파일 업로드의 조건부 갱신은 건드리지 않는다. 1권의 발행본은 불변이다. 발행된 본문을 수정하거나 초안으로 되돌리는 기능을 새로 가정하지 않는다. 목록에는 새 발행이 추가되므로 상세 본문의 불변성과 목록의 최신성은 서로 다른 문제로 다룬다.

## 무엇을 얼마나 오래 틀려도 되는가

캐시하기 전에 재사용하는 값과 허용하는 지연을 적는다. 공개 본문은 발행 뒤 바뀌지 않으므로 오랫동안 재사용해도 내용이 달라지지 않는다. 반면 목록은 새 글이 올라오면 바뀐다. 이 장의 목록 정책은 새 글 노출이 최대 30초 늦을 수 있다는 것이다. 편집 화면은 방금 저장한 version을 보여줘야 하므로 공유 캐시에 넣지 않는다. 구독 동의, 이메일 전달 원장, 인증 결과 역시 이 본문 캐시의 대상이 아니다.

처음에는 메모리 저장소로도 효과를 볼 수 있다. `CacheModule.forRoot({ store: 'memory' })`는 TTL을 생략하면 300초를 쓰고, 내장 메모리 store는 살아 있는 항목 수가 1,000개를 넘으면 오래된 키부터 제거한다. 읽기마다 순서를 갱신하는 완전한 LRU라고 설명해서는 안 된다. 메모리는 빠르고 연결 관리가 필요 없지만 앱 프로세스마다 다른 상태를 갖고, 재시작하면 사라진다.

Redis를 선택하면 여러 인스턴스가 값을 공유한다. 대신 네트워크 왕복, 직렬화, 서버 운영 비용을 낸다. Redis가 PostgreSQL보다 무조건 빠르다고 가정하지 말고 공개 본문의 크기, 원본 조회 비용, 실제 hit 비율을 함께 본다. 기본 키 읽기보다 cache miss 처리와 큰 JSON 전송이 더 비쌀 수도 있다. 단일 개발 프로세스의 측정값으로 다중 인스턴스 운영 성능을 단정하지 않는다.

`CacheService.get()`은 miss를 `undefined`로 반환한다. `null`, `false`, `0`, 빈 문자열은 저장할 수 있는 값이다. 따라서 `if (!cached)`로 miss를 판단하면 정상적으로 캐시한 결과를 버린다. `RedisService.get()`은 누락을 `null`로 반환한다는 차이도 있다. 같은 Redis를 사용한다고 두 패키지의 코덱과 sentinel까지 같아지지 않는다.

## 읽기 모델만 저장하는 서비스 만들기

```bash
pnpm add @fluojs/cache-manager
```

아래 `src/posts/public-post-reader.ts`는 완전한 파일이다. 18장에서 자산 메타데이터까지 확장한 `PrismaPostsPageStore.readPublished`와 `ReadingPost`를 그대로 재사용한다. cache miss에서 본문만 새로 select해 표지와 첨부 목록을 누락시키지 않는다. 공개 여부와 버전을 확인하는 작은 쿼리는 매번 실행하고, 큰 본문·자산 목록을 읽고 직렬화하는 작업만 캐시로 줄인다.

캐시 key의 `reading-v2-assets`는 자산 메타데이터를 포함하는 응답 모델의 스키마 버전이다. `Post.version`은 게시글 데이터 버전이므로 둘의 책임이 다르다. 응답 필드를 바꾸는 배포에서 새 스키마 key를 사용하면 이전 구조의 JSON을 새로운 코드가 읽지 않는다. 문자열의 숫자 부분은 이미 HTTP 경계에서 검증한 양의 정수다. 사용자가 준 검색 문자열이나 JWT 원문을 key에 이어 붙이지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { CacheService } from '@fluojs/cache-manager';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type { ReadingPost } from './post-pages.js';
import { PrismaPostsPageStore } from './prisma-posts-page-store.js';

export class CacheFallbacks {
  readFailures = 0;
  writeFailures = 0;

  record(operation: 'get' | 'set') {
    if (operation === 'get') this.readFailures += 1;
    else this.writeFailures += 1;
  }
}

@Inject(PrismaService, CacheService, CacheFallbacks)
export class PublicPostReader {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly cache: CacheService,
    private readonly fallbacks: CacheFallbacks,
  ) {}

  async readPublished(id: number): Promise<ReadingPost | null> {
    const head = await this.prisma.current().post.findFirst({
      where: { id, status: 'published' },
      select: { version: true, publishedAt: true },
    });
    if (!head || !head.publishedAt) return null;
    const key = `reading-v2-assets:post:${id}:version:${head.version}`;
    let cached: ReadingPost | undefined;
    try {
      cached = await this.cache.get<ReadingPost>(key);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.fallbacks.record('get');
    }
    if (cached !== undefined) return cached;

    const post = await new PrismaPostsPageStore(this.prisma).readPublished(id);
    if (!post) return null;
    try {
      await this.cache.set(key, post, 300);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.fallbacks.record('set');
    }
    return post;
  }
}
```

이 구현은 `get`과 `set`의 실패만 분리해 다룬다. 캐시가 실패하면 원본을 읽지만 PostgreSQL 오류를 “캐시 miss”로 숨기지 않는다. 본문 조회는 두 catch 밖에 있다. 캐시 쓰기가 실패해도 이미 얻은 본문을 다시 조회하지 않고 반환한다. 캐시 원문이나 사용자 식별자를 오류 로그에 넣는 대신 fallback 횟수만 별도로 관찰한다.

형식 매개변수 `get<ReadingPost>()`가 Redis JSON을 런타임 검증해 주는 것은 아니다. 이 namespace에는 위 serializer만 쓴다는 애플리케이션 계약과 스키마 버전 key를 사용한다. 다른 시스템이 같은 namespace를 쓰는 구성이 필요하다면 저장소가 외부 입력 경계가 되므로 읽을 때 스키마 검증도 추가해야 한다. 현재 코드에서 그 가정을 묵묵히 확대하지 않는다.

`Date`는 기존 조회 어댑터에서 ISO 문자열로 바뀐다. 자산도 18장의 공개 메타데이터와 URL만 포함하고 바이트·소유자·구독 주소는 포함하지 않는다. RedisStore는 JSON을 저장하므로 클래스 인스턴스, 함수, `bigint`, 순환 참조를 원본 형태로 보존하지 않는다. miss와 hit 모두 같은 `ReadingPost`를 React `ReadingPage`로 전달하므로 표지와 첨부 링크가 cache hit에서 사라지는 회귀를 막는다. 발행 이후 자산도 수정할 수 없다는 정책 때문에 공개 여부를 읽은 뒤 DTO를 읽는 사이에 같은 버전의 표지가 바뀌지 않는다.

다음 `src/posts/cached-posts-page-store.ts`는 완전한 파일이다. 기존 조회 어댑터를 확장하되 공개 조회 하나만 재정의하고 `readOwnedDraft`는 상속한다. 부모의 `readPublished` 자체를 캐시 reader 호출로 바꾸면 miss가 다시 캐시에 들어가는 재귀가 생기므로 부모 구현은 그대로 둔다. 저장 메서드는 이 포트에 없으며 React 저장은 계속 `PostEditingService.edit`에 위임한다. 새로운 영속성 래퍼나 DB client를 만들지 않는다.

```ts
import type { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { PrismaPostsPageStore } from './prisma-posts-page-store.js';
import type { PublicPostReader } from './public-post-reader.js';

export class CachedPostsPageStore extends PrismaPostsPageStore {
  constructor(prisma: PrismaService<PrismaClient>, private readonly publicPosts: PublicPostReader) {
    super(prisma);
  }

  override readPublished(id: number) {
    return this.publicPosts.readPublished(id);
  }
}
```

이제 17장의 페이지 factory가 기본 조회 어댑터 대신 위 어댑터를 만들게 한다. DI가 새 의존성을 공급하는 실제 경계는 다음 절에서 닫는다.

## 이름 있는 Redis 연결과 모듈을 조립하기

다음 `src/posts/reading-cache.module.ts`는 완전한 모듈 factory다. 캐시 설정과 reader를 같은 graph에 등록하고 `PublicPostReader`, `CacheFallbacks`를 export한다. `posts-cache`는 19장의 `mail-jobs`와 다른 연결 이름이지만, 이름이 다르다고 Redis 서버의 장애까지 분리되는 것은 아니다. 같은 host와 DB를 가리킬 수 있다. 실제 저장 키는 명시적인 cache prefix로 나눈다.

```ts
import { Module } from '@fluojs/core';
import { CacheModule } from '@fluojs/cache-manager';
import { RedisModule } from '@fluojs/redis';
import {
  CacheFallbacks, PublicPostReader,
} from './public-post-reader.js';

export function createReadingCacheModule(
  redis: { readonly host: string; readonly port: number },
) {
  @Module({
    imports: [
      RedisModule.forRoot({
        name: 'posts-cache', ...redis,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 500,
      }),
      CacheModule.forRoot({
        global: true,
        store: 'redis',
        redis: { clientName: 'posts-cache' },
        keyPrefix: 'fluo-blog:local:public-cache:',
        ttl: 300,
        httpKeyStrategy: 'route+query',
        ttlJitter: { ratio: 0.1, mode: 'shorten' },
      }),
    ],
    providers: [
      CacheFallbacks,
      PublicPostReader,
    ],
    exports: [PublicPostReader, CacheFallbacks],
  })
  class ReadingCacheModule {}
  return ReadingCacheModule;
}

export const ReadingCacheModule = createReadingCacheModule({
  host: '127.0.0.1', port: 6379,
});
```

위 파일이 cache 등록 identity를 한 번 만든다. `global: true`는 실제 `CacheService`와 `CacheInterceptor`를 JSON `PostsController`에서도 해석하게 한다. `PublicPostReader`는 모듈 export로 페이지에 공개한다. 이름 있는 Redis는 scoped이므로 `global: true`를 Redis 옵션에 넣지 않는다. 로컬 Redis 주소는 구독 큐와 같은 서버를 가리킬 수 있고, 배포에서는 이 한 호출의 인수를 검증된 cache 연결 옵션으로 바꾼다. 새 DB 설정은 추가하지 않는다.

소켓 오류가 영원히 대기하면 catch가 있다는 것만으로 빠른 fallback이 되지 않는다. 이 연결은 선택적 캐시용이므로 offline queue를 끄고 명령 시간 예산도 정했다. 서버가 내려갔을 때 얼마나 기다릴지와 그 뒤 DB가 감당할 부하를 함께 정하는 선택이다. 이 fail-soft는 이미 시작한 앱의 요청에 적용된다. Redis module의 bootstrap 연결 실패까지 무시하지 않으므로 Redis 없이 시작해야 하는 배포는 명시적으로 메모리 설정을 선택해야 한다. 이 옵션을 큐 worker 연결에 그대로 복사하지 않는다. Queue는 BullMQ가 요구하는 연결 제약과 별도의 소유권을 갖는다.

Redis module은 client를 생성하고 연결·종료를 소유한다. CacheService가 공유 client를 닫는 것은 아니다. `CacheModule.forRoot({ redis: { client } })`로 외부 client를 직접 전달할 수도 있지만 그때는 연결의 lifecycle이 애플리케이션 책임이다. 기본 연결과 이름 있는 연결을 중복 등록해 startup 충돌을 만든 뒤 수동으로 소켓을 열어 우회하지 않는다.

다음은 `src/posts/posts-pages.module.ts`의 **`createPostsPagesModule` 전체 교체 부분**이다. 기존 `PostsPages`, `Document`, `PostsModule`, `FormsAuthModule`, `POSTS_PAGE_STORE`, `PrismaService`와 모든 라우트·가드는 유지한다. `PrismaPostsPageStore` import만 제거하고 아래 세 import를 추가한다. 이 파일에 이미 있는 symbol을 중복 import하지 않는다.

```ts
import { CachedPostsPageStore } from './cached-posts-page-store.js';
import { PublicPostReader } from './public-post-reader.js';
import { ReadingCacheModule } from './reading-cache.module.js';

export function createPostsPagesModule() {
  return ReactModule.forRoot({
    imports: [PostsModule, FormsAuthModule, ReadingCacheModule],
    controllers: [PostsPages],
    providers: [
      {
        provide: POSTS_PAGE_STORE,
        inject: [PrismaService, PublicPostReader],
        useFactory: (prisma: unknown, reader: unknown) => {
          if (!(prisma instanceof PrismaService) || !(reader instanceof PublicPostReader)) {
            throw new Error('Expected PrismaService and PublicPostReader.');
          }
          return new CachedPostsPageStore(prisma, reader);
        },
      },
    ],
    renderPage: (page) => createReactServerEntry(
      createElement(Document, null, page),
    ),
  });
}
```

루트 `src/app.ts`의 기존 `createPostsPagesModule()` 호출은 그대로다. `src/posts/posts.module.ts`도 아래처럼 **같은 `ReadingCacheModule` identity**를 import한다. 나머지 `AuthModule`, 제공자·컨트롤러·exports 배열은 유지한다. 두 곳에서 factory를 재호출하지 않으므로 named Redis 등록이 중복되지 않는다.

```diff
+import { ReadingCacheModule } from './reading-cache.module.js';
@@
-  imports: [AuthModule],
+  imports: [AuthModule, ReadingCacheModule],
```

설정을 비동기로 해석해야 한다면 `CacheModule.forRootAsync({ inject, useFactory, global: true })`가 실제 지원 API다. 그 경우에도 설정 토큰은 해당 모듈에서 보이는 runtime provider나 global export여야 한다. `global`은 factory 반환값이 아니라 등록 옵션에서 결정한다.

## TTL과 무효화를 같은 말로 쓰지 않기

CacheService의 TTL 단위는 초다. `set(key, value, 300)`은 300밀리초가 아니다. 양수에 jitter를 주면 같은 시각에 채운 키가 모두 같은 시각에 만료되는 현상을 완화할 수 있다. 위 `shorten` 설정은 300초를 최대값으로 유지하면서 약 270~300초 범위로 줄인다. 허용 지연을 넘지 않도록 줄이는 방향을 선택한 것이다.

`ttl: 0`은 만료 없음이다. `set` / `remember` 쓰기는 음수 또는 유한하지 않은 TTL을 건너뛴다. 0을 “캐시를 끄는 옵션”으로 오해하면 오래 남는 키를 만든다. RedisService의 직접 `set()`에서는 0 이하나 유한하지 않은 TTL이 persistent 저장이라는 다른 계약이 있으므로 facade를 바꿀 때 이 차이를 반드시 확인한다. 단순 Redis 값을 다루는 서비스와 cache-manager의 저장 envelope를 섞지 않는다.

RedisStore의 일반 `set`은 양의 소수 TTL을 허용하고 Redis에는 올림한 정수 초 만료를 전달하면서 내부 timestamp도 기록한다. 따라서 Redis key가 아직 존재한다고 CacheService에서도 hit라는 뜻은 아니다. 테스트에서는 Redis의 `TTL` 값만 보지 말고 실제 `CacheService.get()` 결과를 확인한다. 아래 원자 갱신은 고정 만료를 보존하기 위해 절대 밀리초 `PXAT`를 사용한다.

발행 직후 목록을 최신으로 보이고 싶어서 DB 커밋 전에 캐시를 지우는 방법은 위험하다. 다른 요청이 아직 커밋 전 목록을 읽어 다시 채울 수 있다. 커밋 후 삭제해도 다른 프로세스에서 진행 중인 loader가 이전 결과를 나중에 저장할 수 있다. 이 장의 목록에는 짧은 TTL을 적용해 최대 노출 지연을 받아들인다. 이것은 즉시 최신성의 보장이 아니다. 반드시 즉시 새 글을 보여야 하는 작성자 확인 화면은 원본 조회로 보낸다.

`CacheService.del()`과 `reset()`에는 같은 서비스 인스턴스에서 진행 중인 `remember()` loader의 재채우기를 막는 로직이 있다. 그 로직은 Redis를 사용하는 모든 프로세스의 진행 중인 작업을 알아내는 분산 장벽이 아니다. 발행본 자체를 불변으로 유지하는 정책이 상세 캐시를 크게 단순화한다. 제품이 나중에 개정판을 도입한다면 새 revision의 key와 현재 revision을 고르는 권위 있는 조회가 필요하다.

애플리케이션이 직접 관리하는 캐시 key를 커밋 뒤 지우려면 11장의 `afterCommit`을 사용할 수 있다. 다음은 **소비자 호출 조각**이다. `prisma`는 기존 `BlogDatabaseModule`의 `PrismaService`, `cache`는 주입된 `CacheService`, `cacheKey`는 그 서비스의 쓰기·읽기가 공유하는 정확한 key다. `persist`는 같은 `prisma.current()`로 DB 변경만 수행하는 애플리케이션 콜백이며, 자체 네이티브 옵션을 가진 `PublishingService.publish()`를 중첩 호출하는 예제가 아니다.

```ts
await prisma.transaction(async () => {
  await persist();
  prisma.afterCommit(async () => {
    await cache.del(cacheKey);
  });
}, undefined, { requireAfterCommit: true });
```

`undefined`는 기존 네이티브 옵션 자리를 보존한다. 능력이 없는 클라이언트에서는 `persist` 실행 전에 거부하므로 “저장은 했는데 훅을 등록할 수 없다”는 경로를 피한다. 롤백·커밋 실패에서는 삭제하지 않고, 성공한 바깥 커밋 뒤 삭제를 기다린다. 삭제가 실패하면 `AfterCommitError.committed`는 `true`이며 `results`에는 모든 훅의 결과가 남는다. 발행을 다시 시도하는 대신 DB의 확정 상태와 캐시 실패를 분리해서 기록하고, 캐시 복구·TTL·영속 재전달 중 필요한 정책을 애플리케이션이 선택한다.

이 조각을 아래의 query별 HTTP 캐시 key에 대한 자동 무효화라고 읽지 않는다. 모든 query·principal 변형을 추적하는 caller는 추가하지 않았으며, 현재 목록은 계속 30초 TTL 정책을 사용한다. 다른 프로세스의 오래된 loader가 재채우는 경합도 훅으로 사라지지 않는다. Redis에는 Fluo 소유 커밋 추적이 없어 이 API를 적용할 수 없고, 향후 `MULTI/EXEC` 지원은 별도 검토 대상이다. DB 훅에서 Redis 캐시를 삭제해도 PostgreSQL+Redis 원자성이나 크래시·네트워크 exactly-once 전달은 생기지 않는다.

## 동시 miss를 소스 계약으로 실험하기

앞의 fail-soft reader는 의도적으로 `get → DB → set`을 드러냈다. 단점은 cold key로 요청이 동시에 오면 같은 본문 조회를 중복 수행할 수 있다는 것이다. `CacheService.remember()`는 같은 서비스 인스턴스 안에서 동일 key의 동시 miss를 하나의 loader로 합친다. 이를 선택하면 코드가 짧아지지만 store 실패도 직접 API의 rejection으로 관찰하므로 원본 실패와 캐시 실패를 구분하는 정책까지 같이 설계해야 한다.

다음 `src/posts/cache-contract.test.ts`는 실제 공개 `CacheService`와 `MemoryStore`를 사용하는 완전한 Vitest 테스트다. 애플리케이션 HTTP 테스트나 실제 Redis 검증이라고 부르지 않는다. `Promise.withResolvers()`는 Node24에서 사용할 수 있고, loader 시작 신호를 기다리므로 우연한 microtask 순서나 sleep에 기대지 않는다. 테스트 timeout은 누락된 신호를 실패로 끝내는 상한이다.

```ts
import { describe, expect, it } from 'vitest';
import {
  CacheService, MemoryStore, type NormalizedCacheModuleOptions,
} from '@fluojs/cache-manager';

const options: NormalizedCacheModuleOptions = {
  store: 'memory', ttl: 300, global: false,
  keyPrefix: 'book-test:', httpKeyStrategy: 'route',
  principalScopeResolver: undefined,
};

describe('cache invalidation boundaries', () => {
  it('does not refill after deletion in the same service', async () => {
    const cache = new CacheService(new MemoryStore(), options);
    const started = Promise.withResolvers<void>();
    const released = Promise.withResolvers<string>();
    const pending = cache.remember('latest-posts', async () => {
      started.resolve();
      return released.promise;
    });
    try {
      await started.promise;
      await cache.del('latest-posts');
      released.resolve('old-list');
      expect(await pending).toBe('old-list');
      expect(await cache.get('latest-posts')).toBeUndefined();
    } finally {
      released.resolve('old-list');
      await pending;
      await cache.close();
    }
  }, 2000);

  it('does not coordinate in-flight loaders across service instances', async () => {
    const store = new MemoryStore();
    const first = new CacheService(store, options);
    const second = new CacheService(store, options);
    const started = Promise.withResolvers<void>();
    const released = Promise.withResolvers<string>();
    const pending = first.remember('latest-posts', async () => {
      started.resolve();
      return released.promise;
    });
    try {
      await started.promise;
      await second.del('latest-posts');
      released.resolve('old-list');
      await pending;
      expect(await second.get('latest-posts')).toBe('old-list');
    } finally {
      released.resolve('old-list');
      await pending;
      await first.close();
      await second.close();
    }
  }, 2000);
});
```

첫 실험에서 이미 시작한 호출자는 `old-list`를 받을 수 있다. 무효화는 과거 호출의 반환값을 바꾸는 취소가 아니라 캐시 재채우기를 막는다. 두 번째 실험은 의도적으로 `old-list`가 다시 들어오는 것을 기대한다. 공유 store만으로 분산 loader 조정이 되지 않는다는 반례다. 실제 Redis 두 연결로 같은 시나리오를 수행하면 네트워크 경계까지 검증할 수 있지만, 위 테스트 자체는 메모리의 두 서비스 인스턴스만 사용한다.

독자의 앱에 파일을 만든 뒤 실행할 명령은 다음과 같다. 이 원고 작성 과정에서 해당 앱 테스트를 실행했다는 출력은 아니다.

```bash
pnpm exec vitest run src/posts/cache-contract.test.ts
```

jitter는 서로 다른 키의 만료를 분산할 뿐 단일 인기 키의 동시 miss를 합치지 않는다. `remember()`의 합치기도 프로세스당 한 번이므로 앱 10개가 동시에 cold key를 읽으면 원본 조회는 여러 번 발생할 수 있다. 인기 발행본을 배포 후 미리 채우거나 원본의 동시 실행 예산을 제한할지 결정할 수 있다. 정확성이 필요한 분산 락을 캐시 최적화 하나 때문에 섣불리 추가하지 않는다.

## key queue 없이 캐시 값 하나를 갱신하기

같은 숫자를 두 요청이 읽고 각각 1을 더해 `set()`하면 한 번의 증가가 사라질 수 있다. 앱의 key별 promise queue로 이를 감싸기보다 [cache-manager README의 원자 갱신 계약](../../packages/cache-manager/README.ko.md#원자-갱신)을 사용한다. 이 실험은 캐시 산술만 보여 준다. 조회수 영속화, 인증 실패 횟수, 차단 시간, 재고 정책을 추가하지 않으며 앞의 불변 본문 reader도 바꾸지 않는다.

다음은 `src/posts/cache-update.experiment.ts`로 옮길 수 있는 독립 실행 파일이다. 기존 앱 모듈을 교체하는 코드가 아니다. Module 등록과 공개 DI를 거치며, 앱에는 pending map이나 key queue가 없다.

```ts
import { Inject } from '@fluojs/core';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { CacheModule, CacheService } from '@fluojs/cache-manager';

@Inject(CacheService)
class Counters {
  constructor(private readonly cache: CacheService) {}

  increment(key: string) {
    return this.cache.update<number>(key, (value) => ({
      action: 'set',
      value: (value ?? 0) + 1,
    }));
  }
}

class AppModule {}
defineModule(AppModule, {
  imports: [CacheModule.forRoot({ store: 'memory', ttl: 60 })],
  providers: [Counters],
});

const app = await FluoFactory.createApplicationContext(AppModule);
try {
  const counters = await app.get(Counters);
  console.log(await Promise.all([
    counters.increment('example:counter'),
    counters.increment('example:counter'),
  ])); // [1, 2]
} finally {
  await app.close();
}
```

두 호출은 store 하나의 동일 key FIFO를 따르고 다른 key는 독립적으로 진행한다. Memory의 `local-process`는 같은 `MemoryStore`를 공유하는 facade까지 포함하지만 별도 store 인스턴스는 포함하지 않는다. Reducer는 누락/만료를 `undefined`로 받고 명시적 set/delete 결정을 반환한다. TTL 생략은 처음 생성할 때 위의 60초를 쓰며 다음 증가에서 절대 만료를 연장하지 않는다. 명시적 `0`은 persistent이고 invalid TTL은 `RangeError`이며 update에는 jitter가 없다. 결과는 커밋한 값 또는 명시적 삭제 후 `undefined`다.

일반 쓰기 경합으로 reducer가 다시 실행될 수 있으므로 안에서 DB, 이메일, 결제를 호출하지 않는다. `{ attempt, signal }`의 attempt는 1부터 시작하고 기본 총 시도 한도는 16이다. 같은 key update를 중첩하거나 reducer 안에서 reset/close를 await하면 자기 자신을 기다리는 교착이 생긴다. `del`/`reset`/`close`는 늦은 reducer를 취소하며 reset/close는 queued update, reducer, 격리 연결 정리까지 기다린다. Signal을 무시하고 끝나지 않는 reducer를 강제로 끊지는 않는다. Reset 중 호출은 `invalidated`로 거부될 수 있으므로 reset을 await한 뒤 새 작업을 시작한다. 오류 분류와 원본 실패 전파는 README가 소유한다.

여러 프로세스에서는 앞의 named RedisModule DI를 유지하면서 **참여하는 모든 cache 등록**에 `redis: { clientName: 'posts-cache', atomicUpdates: true }`를 적용해야 한다. Redis >=6.2 standalone/single-primary와 비어 있지 않은 앱 전용 prefix가 필요하며 Cluster 지원은 주장하지 않는다. WATCH는 data와 namespace/key 무효화 identity를 함께 확인하고, 각 작업의 격리 duplicate만 닫는다. 공유 Redis client의 소유자는 그대로다. EXEC dispatch 전 취소는 commit을 막지만 dispatch 후 취소가 이미 커밋한 결과를 되돌리지는 않는다.

이 opt-in은 `remember()`를 분산 loader로 바꾸지 않는다. Namespace에는 reset 후 epoch 하나와 reset 전까지 삭제한 서로 다른 key별 marker가 남는다. 예약 key와 metadata 비용은 README를 따르고 외부에서 metadata를 수정하거나 eviction하지 않는다. Reset은 여전히 SCAN이며 원격 reset 시작 후의 새 update를 전역 차단하는 snapshot이나 failover durability를 보장하지 않는다.

의존성이 이미 설치된 repository workspace에서 같은 공개 consumer 경계를 확인할 명령은 다음과 같다. 먼저 패키지와 dependency closure를 build하여 필요한 모듈을 emit한 뒤 지정 파일을 실행한다. 마지막 명령은 Docker `redis:7.4-alpine` 격리 container와 임시 port를 사용하며 환경이 없으면 skip하지 않고 실패한다.

```bash
pnpm --filter '@fluojs/cache-manager...' build
pnpm --dir packages/cache-manager exec vitest run -c vitest.config.ts src/cache-update.test.ts src/cache-update.consumer.test.ts
pnpm --filter @fluojs/cache-manager test:redis
```

## HTTP 캐시를 붙일 때 바뀌는 질문

공개 JSON 목록에도 캐시를 적용한다. 아래 import를 `src/posts/posts.controller.ts`에 추가하고 이어지는 **변경 조각을 기존 GET 목록 메서드에 반드시 적용한다**. 12장의 `ListPostsDto → PostFeed.list(input)`과 `{ items, nextCursor }` 응답, 15장의 공개 컨트롤러 분리를 그대로 유지한다. `Get`, `UseInterceptors`는 기존 import에 있으므로 중복 선언하지 않는다. `PostsModule`은 앞 절의 `ReadingCacheModule`을 가져오고 그 안의 전역 cache 등록이 실제 interceptor 토큰을 제공한다.

```ts
import { CacheInterceptor, CacheTTL } from '@fluojs/cache-manager';
```

```ts
@Get()
@UseInterceptors(CacheInterceptor)
@CacheTTL(30)
@RequestDto(ListPostsDto)
@ApiOperation({ summary: 'List published posts' })
@ApiResponse(200, { schema: postPageSchema })
list(input: ListPostsDto) {
  return this.feed.list({ limit: input.limit, cursor: input.cursor });
}
```

이 목록은 이미 cursor 기반이므로 앞의 등록은 `httpKeyStrategy: 'route+query'`를 **필수로 설정했다**. 기본 `'route'`는 query를 무시하므로 사용할 수 없다. `/posts?limit=1`과 `/posts?limit=2`, 첫 페이지와 `/posts?cursor=<nextCursor>&limit=1`은 다른 key다. 파라미터 순서만 뒤집은 `limit=1&cursor=C`와 `cursor=C&limit=1`은 같은 key다. 여기의 C는 설명용 표기이고 실제 요청에는 `PostFeed`가 반환한 검증 가능한 cursor를 사용한다. 라우트 템플릿이 아니라 구체적 요청 경로도 key에 포함된다.

query-aware 전략은 반복 값까지 정렬한다. 12장의 `PostFeed`는 배열로 들어온 반복 limit/cursor를 거부하므로 이를 순서 있는 입력으로 해석하지 않는다. 잘못된 cursor를 첫 페이지로 바꾸지 않고 기존 400을 유지한다. `@CacheKey('posts')` 같은 상수 key를 추가하면 설정한 전략을 덮어쓰므로 이 라우트에는 사용하지 않는다. 인증 principal이 있으면 key에 principal scope도 추가되지만 이 GET은 여전히 공개 게시글만 조회한다.

인증된 요청에는 해석 가능한 principal scope가 붙지만 그 사실만으로 모든 사용자별 응답을 캐시해도 된다고 결론 내리지 않는다. 개인 설정, 권한 변경, 쿠키, 응답 헤더의 의미도 검토해야 한다. 이 책의 편집 화면은 계속 `private, no-store`이고 서버 캐시 대상에서도 제외한다. 브라우저의 `Cache-Control`과 서버 CacheService는 서로 다른 층이라 HTTP 헤더 하나가 서버 저장을 자동으로 막는다고 가정하지 않는다.

인터셉터는 재사용 가능한 성공한 GET handler 결과만 저장한다. 이미 commit된 응답, `undefined`, SSE, 비 2xx 결과는 건너뛴다. React의 streamed HTML을 평범한 JSON 목록처럼 캐시하려고 붙이지 않는다. 17장의 렌더링 경계 아래에서 공개 DTO만 캐시한 이유다. `CacheInterceptor`는 store 실패를 완화해 원래 handler를 진행하지만, 직접 호출하는 `CacheService`의 실패 계약은 그와 다르다.

## 장애와 운영에서 캐시를 평가하기

캐시가 있는 상태와 없는 상태를 같은 요청 묶음으로 비교한다. 처음 한 번은 cold 요청, 이후는 같은 발행본의 warm 요청이다. HTTP 상태와 응답 DTO가 같고, warm 요청에서는 큰 본문 SQL 호출 수가 줄어야 한다. 작은 공개 여부 쿼리는 계속 발생하므로 총 SQL 수가 0이 되기를 기대하지 않는다. 평균 지연뿐 아니라 p95, 본문 쿼리 횟수, 캐시 오류 수를 같이 기록해야 “빨라졌다”는 말을 검증할 수 있다.

권한 회귀 시나리오는 초안 ID에 공개 key를 미리 만들어 놓는 것이다. 익명 `/posts/:id/read`는 cache hit 전에 공개 여부를 확인하므로 404여야 한다. 다른 사용자의 초안을 읽거나, cache hit에서 편집용 version과 authorId가 노출되면 실패다. 존재하지 않는 글의 `null` 결과는 이 reader가 캐시하지 않으므로, 새 글을 발행한 직후 이전 negative cache 때문에 숨는 문제도 만들지 않는다.

Redis 장애 실험은 전용 개발 환경에서만 한다. 요청 중 cache get이 실패하면 `CacheFallbacks.readFailures`가 증가하고 PostgreSQL이 정상인 한 읽기 결과는 정상이어야 한다. cache set 실패도 응답을 실패시키지 않는다. 반대로 원본 DB 실패를 일으키면 빈 글이나 캐시 miss로 성공 응답을 만들면 안 된다. Redis가 사라진 순간 모든 트래픽이 DB로 넘어오는 부하는 별도로 측정한다. fail-soft는 무한 처리 능력을 뜻하지 않는다.

`CacheModule`의 `observer.onCacheOperation`은 `operation`, `outcome`, `durationMs`를 제공한다. 키, 값, error 객체를 제공하지 않아 수집 과정의 개인정보 노출을 줄인다. 같은 in-flight loader에 합류한 `remember()`도 이미 저장된 값을 읽은 것은 아니라 `miss`로 기록한다. 따라서 miss 수를 DB 호출 수와 동일하게 계산하지 않는다. 22장에서 metrics를 붙일 때 이 구분이 중요해진다.

마지막으로 `reset()`을 운영 복구의 만능 버튼으로 만들지 않는다. RedisStore의 reset은 설정된 `keyPrefix` 아래에 있는 캐시 키를 대상으로 하며, 19장의 큐나 구독 원장과 prefix를 공유해서는 안 된다. 빈 prefix를 지정했을 때는 현재 store 인스턴스가 쓴 키만 추적한다는 제한도 있다. 명확한 환경별 namespace를 쓰고 한 글의 문제에는 정확한 key 삭제를 우선한다. 대량 reset은 correctness 수리를 대신하지 못하면서 cold load를 한꺼번에 만들 수 있다.

FluoBlog는 불변 공개 본문을 재사용하고, 동적으로 늘어나는 목록은 허용한 시간만큼 늦게 갱신하는 상태에 도달했다. 메일 알림으로 독자가 몰려와도 어떤 비용을 줄였는지 설명할 수 있다. 다음 장에서는 작성자가 자리에 없어도 정한 시각에 초안을 발행한다. 예약 작업 역시 기존 발행 트랜잭션과 전달 원장을 호출해야 하며, 시간에 맞췄다는 이유로 새로운 상태 전이나 캐시 갱신 규칙을 만들어서는 안 된다.

## 구현 근거

- [원자 갱신 API 원본](../../packages/cache-manager/README.ko.md#원자-갱신), [순수 reducer와 TTL](../../packages/cache-manager/src/atomic-update.ts)
- [원자 갱신 회귀](../../packages/cache-manager/src/cache-update.test.ts), [queue 없는 앱 consumer](../../packages/cache-manager/src/cache-update.consumer.test.ts), [실제 Redis fixture](../../packages/cache-manager/test/redis-update.native.test.ts)
- `update`는 기존 `CacheObservation` event를 내보내지 않는다. 아래 observer 근거를 update 계측으로 해석하지 않는다.
- [Cache-manager README: TTL·키·실패·observer](../../packages/cache-manager/README.ko.md), [공개 export](../../packages/cache-manager/src/index.ts)
- [CacheService의 remember·del·reset](../../packages/cache-manager/src/service.ts), [메모리 보관과 만료 구현](../../packages/cache-manager/src/stores/memory-store.ts)
- [캐시 계약 테스트](../../packages/cache-manager/src/cache-service.test.ts), [독립 key 동시 실행 테스트](../../packages/cache-manager/src/cache-service.concurrency.test.ts)
- [모듈 설정과 client 해석](../../packages/cache-manager/src/module.ts), [HTTP 인터셉터 회귀 테스트](../../packages/cache-manager/src/interceptor.contract-regression.test.ts)
- [Redis README: TTL 코덱과 연결 수명주기](../../packages/redis/README.ko.md), [Redis 공개 export](../../packages/redis/src/index.ts)
- [커밋 후 실행의 공통 계약](../../docs/architecture/transactions.ko.md), [Prisma after-commit API](../../packages/prisma/README.ko.md), [회귀 검증 대상](../../packages/prisma/src/after-commit.test.ts)
