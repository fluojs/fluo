# 저장한 데이터와 공개할 데이터 구분하기

<!-- book:volume=01-fluoblog;chapter=07 -->

[이전: 외부 입력을 내부 데이터로 바꾸기](./ch06-request-boundaries.ko.md) · [1권 목차](./toc.ko.md) · [다음: 사용자가 이해할 수 있는 API 계약 만들기](./ch08-api-contracts.ko.md)

## 내부 필드를 하나 추가했을 뿐인데

FluoBlog의 입력 경계는 이제 요청 본문에 끼워 넣은 `authorId`를 거부한다. 운영자는 안심하고 서비스를 계속 개발한다. 그러다 글 상세 응답을 살펴보고 다른 문제를 발견한다. 저장소의 `authorId`, `status`, `version`까지 독자의 브라우저에 전달되고 있다. 이 값이 모두 비밀이라는 뜻은 아니다. 공개 여부를 결정한 적 없이 저장한 객체가 곧 API가 되었다는 것이 문제다.

상황을 더 구체적으로 보자. 편집 화면에 내부 메모를 추가하려고 저장 모델에 `editorNote`를 넣었다고 하자. 컨트롤러가 저장 객체를 그대로 반환하면 독자 API도 같은 날 새 필드를 내보낸다. 리뷰어가 데이터 모델 변경만 보고 “응답 변경은 없다”고 판단하면 사고를 놓친다. 비밀번호 해시나 토큰을 계정 모델에 추가할 때도 같은 구조가 반복될 수 있다.

이번 장에서는 독자 목록, 독자 상세, 작성 명령 결과를 서로 다른 출력 모델로 만든다. `@fluojs/serialization`의 데코레이터는 이 모델에서 공개한다고 표시한 필드만 내보내게 한다. 하지만 직렬화 패키지가 어떤 글을 누구에게 보여 줘도 되는지 판단하지는 않는다. 발행 상태 선택은 전 장의 `getPublished()`와 `listPublished()`에 남고, 작성 권한은 뒤의 인증·인가 장에서 연결한다.

중요한 경계가 세 개 생긴 셈이다. 입력 DTO는 요청자가 보낼 수 있는 값, 도메인 스냅샷은 내부 규칙에 필요한 값, 응답 DTO는 서버가 공개하기로 약속한 값이다. 필드 이름이 일부 겹친다고 하나의 클래스가 세 책임을 모두 맡아야 하는 것은 아니다.

## 목록과 상세는 같은 저장 행을 다르게 읽는다

독자 목록은 ID, 제목, slug, 발행 시각만 보여 준다. 목록에 50개의 글이 있을 때 본문 전체를 실어 보낼 이유가 없다. 상세는 여기에 `content`를 추가한다. 공개 상세에 `version`을 넣지 않는 것은 이번 제품의 선택이다. 독자가 편집 버전으로 캐시를 검증하는 기능을 아직 약속하지 않았기 때문이다. 나중에 캐시 validator를 도입한다고 해도 그 값을 공개 JSON 필드로 노출할지는 따로 정할 수 있다.

작성 명령은 `id`, `status`, `version`, `publishedAt`을 반환한다. 생성 뒤 다음 저장에서 사용할 버전을 전달해야 하고, 발행 성공 여부도 알아야 한다. 이것은 작성 화면 전체를 복원하는 조회 모델이 아니라 명령의 결과 확인서다. 편집 화면 전용 조회가 필요해지는 시점에는 인증된 작성자용 경로와 응답을 별도로 설계한다. 지금의 공개 `GET /posts/:id`를 초안 조회로 바꾸지 않는다.

발행 전 `publishedAt`은 명시적 `null`이다. 필드가 없는 것과 값이 없는 것을 구분하면 클라이언트가 같은 응답 형태를 유지할 수 있다. 반면 공개 상세는 발행된 글만 나오므로 발행 시각이 항상 ISO 문자열이다. 프런트엔드가 공개 글마다 “이 값이 없으면 어떻게 하지?”를 반복하지 않도록 서버가 이미 확보한 사실을 계약에 반영한다.

다음은 **`src/posts/post-response.dto.ts` 전체**다. 타입 단언으로 저장 객체를 DTO라고 부르지 않고 실제 인스턴스를 만든다. `@Expose({ excludeExtraneous: true })`는 클래스 수준에서 허용 목록을 켠다.

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

export function toPostSummary(post: PublishedPost): PostSummaryDto {
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

export function toPostWriteReceipt(post: PostSnapshot): PostWriteReceiptDto {
  return Object.assign(new PostWriteReceiptDto(), {
    id: post.id,
    status: post.status,
    version: post.version,
    publishedAt: post.publishedAt,
  });
}
```

목록 DTO를 상속한 상세 DTO에는 클래스 옵션을 다시 붙이지 않았다. 직렬화 메타데이터는 상속되며 가장 가까운 클래스 설정을 사용한다. 따라서 상세에서도 허용 목록이 유지되고, 목록의 네 필드와 상세의 `content`만 노출된다. 상속은 이처럼 공개 의미가 실제로 포함 관계일 때만 사용한다. 작성 결과는 공개 목록의 확장이 아니므로 별도 클래스다.

`Object.assign(new PublicPostDto(), post)`처럼 원본 전체를 복사하지 않은 것도 의도적이다. 허용 목록이 최종 출력을 막더라도 내부 정보를 애초에 DTO에 넣지 않는 편이 확인하기 쉽다. 명시적 매핑은 의미를 드러내고 허용 목록은 이후 우연히 붙은 필드를 방어한다. 서로 같은 검사를 두 번 한 것이 아니라 데이터 선택과 최종 출력 경계라는 두 단계다.

단순한 공개 객체를 명시적으로 만드는 함수만으로도 작은 앱에는 충분하다. 다만 여러 컨트롤러와 중첩 DTO가 같은 출력 정책을 공유하기 시작하면 클래스 메타데이터를 사용한 공통 직렬화가 실수를 줄인다. 반대로 필드가 두 개뿐인 건강 확인 응답까지 의미 없는 계층으로 감싸는 것은 이득이 작다. 모든 객체를 DTO 클래스로 바꾸는 것이 이 장의 목표는 아니다.

## 클래스 이름은 출력 필터가 아니다

다음의 **실패를 설명하는 타입 단언 조각**은 실행 시 원본 객체를 전혀 바꾸지 않는다. `as`는 JSON에서 필드를 제거하지 않고 생성자를 바꾸지도 않는다.

```ts
const claimedDto = storedPost as PublicPostDto;
return claimedDto;
```

이 조각의 `storedPost`는 전 장의 `PostSnapshot`, `PublicPostDto`는 방금 정의한 클래스이며, 컨트롤러 안에서 쓰면 안 되는 대조 예시다. 원본은 일반 객체이고 직렬화 데코레이터를 가진 클래스 인스턴스가 아니다. 반면 `new PublicPostDto()`의 프로토타입에는 직렬화기가 찾아갈 실제 클래스가 있다.

인스턴스를 만든 다음 `return { ...dto }`로 풀어 버리는 것도 조심한다. 필드는 복사되지만 클래스 정체성과 메타데이터 연결은 사라진다. 아직 허용하지 않은 필드가 객체에 붙었다면 최종 일반 객체에 남을 수 있다. 도메인에서 응답 모델로 변환한 뒤에는 인터셉터가 처리할 때까지 인스턴스를 유지한다.

`@Exclude()`로 위험한 필드만 표시하는 방식도 있다. 이미 존재하는 내부 클래스에서 몇 필드를 빼는 데는 편리하다. 그러나 앞으로 추가할 비공개 필드는 작성자가 매번 제외 표시를 기억해야 한다. 공개 API에서는 노출할 필드만 선언하는 정책이 저장 모델 확장에 덜 민감하다. 어느 방식을 택해도 비밀번호·토큰 원문을 응답 객체에 복사하는 설계를 피하는 것이 먼저다.

## 응답 writer 앞에 직렬화기를 연결한다

다음은 **`src/posts/posts.controller.ts` 교체 파일 전체**다. 입력 DTO와 도메인 오류 번역은 그대로 쓰고, 각 작업의 결과에 맞는 출력 mapper를 호출한다.

```ts
import { Inject } from '@fluojs/core';
import {
  Controller, Get, HttpCode, Post, Put, RequestDto, UseInterceptors,
} from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';
import { runPostCommand } from './post-http-error.js';
import { CreatePostDto, GetPostDto, PublishPostDto, ReplacePostDto } from './post-request.dto.js';
import { toPostSummary, toPostWriteReceipt, toPublicPost } from './post-response.dto.js';
import { PostsService } from './posts.service.js';

@Controller('/posts')
@Inject(PostsService)
@UseInterceptors(SerializerInterceptor)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list() {
    return this.posts.listPublished().map(toPostSummary);
  }

  @Get('/:id')
  @RequestDto(GetPostDto)
  get(input: GetPostDto) {
    return runPostCommand(() => toPublicPost(this.posts.getPublished(input.id)));
  }

  @Post()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return runPostCommand(() => toPostWriteReceipt(this.posts.create('author-1', {
      title: input.title, content: input.content, slug: input.slug,
    })));
  }

  @Put('/:id')
  @HttpCode(200)
  @RequestDto(ReplacePostDto)
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
  publish(input: PublishPostDto) {
    return runPostCommand(() => toPostWriteReceipt(
      this.posts.publish(input.id, input.expectedVersion),
    ));
  }
}
```

`@UseInterceptors(SerializerInterceptor)`에 클래스 토큰을 주었으므로 DI 컨테이너가 해당 인스턴스를 해석할 수 있어야 한다. 다음은 **`src/posts/posts.module.ts` 교체 파일 전체**다. `src/app.ts`는 계속 이 모듈을 import하고, 전 장의 `src/main.ts`는 메타데이터를 준비한 뒤 앱을 동적 import한다.

```ts
import { Module } from '@fluojs/core';
import { SerializerInterceptor } from '@fluojs/serialization';
import { PostIdConverter } from './post-id.converter.js';
import { PostsController } from './posts.controller.js';
import { POST_CLOCK, PostsService, type PostClock } from './posts.service.js';

@Module({
  controllers: [PostsController],
  providers: [
    PostsService,
    PostIdConverter,
    SerializerInterceptor,
    { provide: POST_CLOCK, useValue: { now: () => new Date() } satisfies PostClock },
  ],
  exports: [PostsService],
})
export class PostsModule {}
```

서비스는 `@Inject(POST_CLOCK)`, 컨트롤러는 `@Inject(PostsService)`라는 실제 토큰 연결을 유지한다. `SerializerInterceptor`는 추가 의존성이 없는 클래스다. provider로 등록한 사실만으로 모든 응답에 적용되지는 않으며, `UseInterceptors` 메타데이터가 해당 컨트롤러의 파이프라인에 연결한다. 등록과 적용을 각각 확인해야 한다.

직렬화 패키지는 import 부작용으로 `Symbol.metadata`를 설치하지 않는다. 따라서 테스트에서 응답 DTO를 HTTP 모듈보다 먼저 import해도 동작하도록 앞 장의 표준 데코레이터 테스트 설정과 메타데이터 사전 로드를 유지한다. 개발 서버에서 우연히 다른 import가 먼저 symbol을 설치해 준 사실에 의존하면 단독 DTO 테스트에서 실패할 수 있다.

## 이미 보낸 응답은 나중에 고칠 수 없다

프레임워크가 관리하는 응답에서는 핸들러가 DTO를 반환하고 인터셉터가 가공한 뒤 writer가 전송한다. 그런데 `context.response.send()`를 직접 호출하면 핸들러가 최종 응답을 소유한다. `SerializerInterceptor`는 `next.handle()`이 끝났을 때 응답이 이미 commit되었는지 확인하고, commit되었다면 직렬화를 건너뛴다.

따라서 컨트롤러에 인터셉터가 붙어 있어도 원본 저장 객체를 `send()`로 쓰면 보호받지 못한다. 이것은 예외적인 구현 결함이 아니라 응답 소유권의 계약이다. 이미 전송한 바이트에서 필드를 제거할 수 없고, 두 번째 응답을 보내서 교정할 수도 없다. CSV나 스트림처럼 직접 응답을 소유해야 할 때는 최종 payload를 먼저 만들어야 한다.

다음은 **직접 전송이 필요한 경우에만 사용하는 `src/posts/send-public-post.ts` 전체**다. 이번 컨트롤러에 추가할 라우트가 아니라 동일한 데이터에 대한 대안 경계를 보여 준다. `post`는 서비스의 `getPublished()`로 얻은 값이어야 하며, 그 조회와 권한 판단을 이 helper가 대신하지 않는다.

```ts
import type { RequestContext } from '@fluojs/http';
import { serialize } from '@fluojs/serialization';
import type { PublishedPost } from './post.js';
import { toPublicPost } from './post-response.dto.js';

export async function sendPublicPost(
  post: PublishedPost,
  context: RequestContext,
): Promise<void> {
  const payload = serialize(toPublicPost(post));
  await context.response.send(payload);
}
```

일반 JSON API에서는 DTO를 반환하는 쪽이 짧고 책임도 분명하다. 직접 전송의 이점이 없는데 응답 객체를 사용하면 직렬화뿐 아니라 상태 코드와 오류 처리의 소유권까지 고려해야 한다. 여기서 `SerializerInterceptor`가 건너뛴다고 다른 인터셉터도 전부 건너뛴다는 뜻은 아니다. 다른 인터셉터는 체인의 반환값을 계속 변환할 수 있으므로 패키지 하나의 보장을 전체 파이프라인으로 일반화하지 않는다.

## 허용 목록은 필드 추가 사고로 시험한다

다음은 **`src/posts/post-response.test.ts` 전체**다. 정상 JSON만 비교하는 데서 끝내지 않고 DTO에 내부 필드가 우연히 붙는 회귀를 만든다. `serialize()`가 원본 스냅샷을 수정하지 않는지도 함께 확인한다.

```ts
import { describe, expect, it } from 'vitest';
import { Expose, Transform, serialize } from '@fluojs/serialization';
import { createDraft, publishPost } from './post.js';
import { toPostSummary, toPostWriteReceipt, toPublicPost } from './post-response.dto.js';

const draft = createDraft(2, 'author-1', {
  title: 'Output boundary',
  content: 'Keep internal data inside.',
  slug: 'output-boundary',
});
const published = publishPost(draft, 1, new Date('2026-06-01T09:00:00.000Z'));

describe('Post output boundary', () => {
  it('keeps only the detailed public fields, including inherited metadata', () => {
    const dto = Object.assign(toPublicPost(published), {
      authorId: 'internal-author',
      editorNote: 'Do not publish this note.',
    });
    expect(serialize(dto)).toEqual({
      id: 2,
      title: 'Output boundary',
      content: 'Keep internal data inside.',
      slug: 'output-boundary',
      publishedAt: '2026-06-01T09:00:00.000Z',
    });
    expect(published.authorId).toBe('author-1');
    expect(Object.hasOwn(published, 'editorNote')).toBe(false);
  });

  it('separates list data from command receipts', () => {
    expect(serialize([toPostSummary(published)])).toEqual([{
      id: 2,
      title: 'Output boundary',
      slug: 'output-boundary',
      publishedAt: '2026-06-01T09:00:00.000Z',
    }]);
    expect(serialize(toPostWriteReceipt(draft))).toEqual({
      id: 2, status: 'draft', version: 1, publishedAt: null,
    });
  });

  it('requires an explicit conversion for bigint JSON values', () => {
    const raw = { count: 9007199254740993n };
    expect(() => JSON.stringify(serialize(raw))).toThrow(TypeError);

    @Expose({ excludeExtraneous: true })
    class CounterProbe {
      @Expose()
      @Transform((value) => String(value))
      count = 9007199254740993n;
    }

    expect(JSON.stringify(serialize(new CounterProbe()))).toBe(
      '{\"count\":\"9007199254740993\"}',
    );
  });
});
```

독자의 앱에서 `pnpm exec vitest run src/posts/post-response.test.ts`를 실행한다. 이 원고에서는 실제 앱에 이 테스트를 생성해 실행하지 않았으므로 통과를 주장하지 않는다. 첫 테스트에서 클래스 수준 허용 목록을 끄면 내부 필드가 출력되어 실패해야 한다. mapper만 검사하면 이 회귀를 놓치기 때문에 의도적으로 DTO에 추가 필드를 붙였다.

세 번째 테스트는 게시글에 카운터를 도입한 구현이 아니라 비JSON 값의 **독립적인 소스 계약 실험**이다. `serialize()`는 모든 값을 JSON 타입으로 강제 변환하는 엔진이 아니다. `bigint`는 그대로 남고, `Date`, `Map`, `Set`, `Promise` 같은 opaque 값도 보존될 수 있다. `Date`는 최종 JSON 작성에서 자체 변환될 수 있지만 모든 내장 값이 그렇게 유용한 결과를 내지는 않는다. “직렬화했다”와 “원하는 wire JSON이 되었다”는 다른 확인 항목이다.

`@Transform()`은 현재 필드 값 하나를 받아 동기적으로 새 값을 반환한다. 이 콜백에서 데이터베이스를 조회하거나 다른 DTO 필드에 접근할 수 있다고 가정하지 않는다. 사용자 표시 이름 조회처럼 비동기 작업이 필요하다면 서비스 또는 mapper 이전 단계에서 완료한다. 2권에서 금액을 `bigint`로 다루더라도 JSON에는 십진 문자열을 보내는 이유가 같은 경계에서 설명된다. 여기의 실험은 실제 주문이나 결제를 만들지 않는다.

### 중첩 객체가 생겼을 때의 실패

앞으로 작성자 공개 이름을 넣는다면 부모 DTO에 `@Expose()`로 `author`를 표시하는 것만으로 하위의 이메일·비밀번호 해시가 제거되지 않는다. 하위 값이 일반 객체라면 그 일반 객체의 enumerable 필드를 순회한다. 공개 작성자 DTO를 별도로 만들고 필요한 값만 채우는 원칙이 아래 단계에도 필요하다.

순환 참조는 무한 재귀를 막기 위해 활성 back edge에서 `undefined`로 잘린다. 반면 이미 처리한 동일 참조를 두 필드가 공유하는 경우에는 직렬화된 참조를 재사용한다. 이를 이용해 양방향 ORM 관계를 그대로 응답에 넣는 것은 좋지 않다. JSON 변환에서는 객체의 `undefined` 프로퍼티가 사라지고 배열에서는 `null`이 될 수 있어 계약이 관계 그래프 모양에 좌우된다. 공개 DTO는 필요한 관계만 한 방향으로 펼쳐야 한다.

## 네트워크 경계에서도 같은 선택을 확인한다

다음은 **`scripts/response-boundary-check.mjs` 전체**다. 로컬 메모리 앱을 새로 시작한 뒤 Node.js 24로 실행한다. 단위 테스트와 달리 인터셉터 등록을 빼먹었는지, 실제 라우트가 다른 객체를 반환하는지까지 확인할 수 있다.

```js
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:3000';
async function json(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, value: await response.json() };
}
const created = await json('POST', '/posts', {
  title: 'Public shape', content: 'A public paragraph.', slug: 'public-shape',
});
assert.equal(created.status, 201);
assert.deepEqual(Object.keys(created.value).sort(), ['id', 'publishedAt', 'status', 'version']);
assert.equal(created.value.publishedAt, null);
const id = created.value.id;
assert.equal((await json('GET', `/posts/${id}`)).status, 404);
const published = await json('POST', `/posts/${id}/publish`, { expectedVersion: 1 });
assert.equal(published.status, 200);
const detail = await json('GET', `/posts/${id}`);
assert.equal(detail.status, 200);
assert.deepEqual(
  Object.keys(detail.value).sort(),
  ['content', 'id', 'publishedAt', 'slug', 'title'],
);
const list = await json('GET', '/posts');
assert.equal(list.status, 200);
const item = list.value.find((post) => post.id === id);
assert.ok(item);
assert.deepEqual(Object.keys(item).sort(), ['id', 'publishedAt', 'slug', 'title']);
assert.equal(detail.value.publishedAt, published.value.publishedAt);
console.log('Response boundary checks passed.');
```

예상 결과는 마지막 성공 메시지다. 이 원고 작성 중 실행한 네트워크 검증 기록은 아니다. 키 집합을 정확히 단언하는 이유는 이번 테스트의 대상이 바로 공개 필드 집합이기 때문이다. 문서의 설명 문장을 고정하는 테스트와 다르다. 목록에 본문이 추가되거나 공개 상세에 버전이 새어 나오면 실제 계약 변경으로 실패해야 한다.

직렬화 테스트만 통과했다고 초안 노출까지 막았다고 말할 수는 없다. 위 스크립트는 발행 전에 같은 ID가 `404`인지 별도로 확인한다. 출력 필터는 객체의 어느 필드를 보낼지 결정하지만, 그 객체 자체를 응답해도 되는지는 서비스가 결정하기 때문이다. 두 가지 실패를 별도 단언으로 유지하면 원인도 분명하다.

## 공개 모델을 유지하는 비용과 얻는 것

이제 저장 모델에 운영용 필드를 더해도 공개 JSON은 자동으로 늘어나지 않는다. 반대로 공개 필드를 추가하려면 mapper와 DTO, 이후 문서 스키마를 함께 바꾸어야 한다. 이것은 일부러 만든 변경 비용이다. 저장 구조 변경을 독자에게 약속한 계약 변경과 분리했기 때문에, 내부 개선을 하면서 프런트엔드의 예상까지 우연히 깨뜨리지 않는다.

모든 응답에 `{ data, meta }`를 붙이거나 모든 DTO를 상속 트리로 만드는 것은 아직 필요 없다. 현재 목록은 배열이고 상세와 명령 결과는 객체다. 페이지네이션이 필요해지는 장에서 목록 계약을 명시적으로 확장하자. 작은 응답을 미래의 모든 요구에 맞추려다 오히려 현재 사용하는 필드를 읽기 어렵게 만들 수 있다.

다음 장에서는 이 출력 선택을 사람의 기억에만 남겨 두지 않는다. 프런트엔드 작성자가 `201`과 `200`, `null`과 문자열, `400`과 `409`를 구별할 수 있게 API 계약을 만들 것이다. 직렬화 데코레이터가 붙었다고 OpenAPI 응답 문서가 자동으로 완성되는 것은 아니므로, 실제 응답과 문서가 만나는 지점을 직접 연결한다.

## 근거와 이어 읽기

- [`@fluojs/serialization` README](../../packages/serialization/README.ko.md), [공개 export](../../packages/serialization/src/index.ts): 허용 목록, 메타데이터 사전 설치, 동기 값 변환의 계약이다.
- [직렬화 엔진](../../packages/serialization/src/serialize.ts), [직렬화 테스트](../../packages/serialization/src/serialize.test.ts), [상속 테스트](../../packages/serialization/src/metadata-inheritance.test.ts): 중첩·상속·일반 객체·비JSON 값의 동작을 확인할 수 있다.
- [SerializerInterceptor 구현](../../packages/serialization/src/serializer-interceptor.ts), [응답 소유권 테스트](../../packages/serialization/src/serializer-interceptor.test.ts): commit 이후에는 직렬화를 건너뛴다는 근거다.
- [HTTP 인터셉터 해석](../../packages/http/src/interceptors.ts), [`@fluojs/core` README](../../packages/core/README.ko.md): 클래스 토큰의 DI 등록과 사전 로드 순서를 뒷받침한다.

[이전: 외부 입력을 내부 데이터로 바꾸기](./ch06-request-boundaries.ko.md) · [1권 목차](./toc.ko.md) · [다음: 사용자가 이해할 수 있는 API 계약 만들기](./ch08-api-contracts.ko.md)
