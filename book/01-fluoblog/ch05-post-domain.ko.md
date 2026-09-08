# 초안과 발행된 글은 무엇이 다른가

<!-- book:volume=01-fluoblog;chapter=05 -->

[이전: 동작을 증명하면서 개발하기](./ch04-testing-from-the-start.ko.md) · [1권 목차](./toc.ko.md) · [다음: 외부 입력을 내부 데이터로 바꾸기](./ch06-request-boundaries.ko.md)

## 저장 버튼과 발행 버튼 사이

FluoBlog의 첫 글 `Hello, Fluo!`는 이제 HTTP로 조회할 수 있고, 컨트롤러 밖으로 꺼낸 서비스는 테스트에서 호출할 수 있다. 여기까지는 글이 존재한다는 사실만 중요했다. 운영자가 두 번째 글을 쓰기 시작하면 다른 요구가 생긴다. 제목만 적어 놓고 노트북을 닫고 싶고, 본문을 완성한 뒤에는 독자에게 보이는 시점을 직접 결정하고 싶다. 저장과 공개가 같은 동작이면 자동 저장 한 번으로 미완성 문장이 배포된다.

처음에는 `published: boolean` 하나면 충분해 보인다. 문제는 다른 값과의 관계다. `published`가 참인데 발행 시각은 없을 수 있고, 공개 주소는 빈 문자열일 수 있다. 목록에서는 참인 글을 골라 냈지만 상세 조회는 ID만 찾는다면 미발행 글도 주소를 아는 독자에게 보인다. 이는 프레임워크 라우팅의 결함이 아니다. 애플리케이션이 무엇을 게시글이라고 인정하는지 아직 정하지 않은 결과다.

이번 장에서 게시글을 애플리케이션 소유 모델로 정의한다. Fluo가 상태 머신이나 게시글 테이블을 만들어 주는 것은 아니다. `src/posts/post.ts`가 글의 규칙을, `src/posts/posts.service.ts`가 여러 글을 보관하고 찾는 작업을 맡는다. HTTP 입력은 다음 장에서 연결한다. 모델을 먼저 완성하는 이유는 컨트롤러뿐 아니라 나중의 예약 발행 작업도 같은 규칙을 사용해야 하기 때문이다.

이 네 장의 실행 기준은 CLI로 만든 `fluo-blog`, Node.js 24, pnpm 10이다. 코드의 `src/...`는 독자가 만드는 애플리케이션 경로다. 저장소의 `examples/fluo-blog`는 초기 HTTP/DI 경로의 실행 근거이지, 이 장까지 구현된 별도 스냅샷이 아니다. 기존 테스트 환경은 앞 장에서 준비한 것을 사용하며, 아래 코드 블록은 파일 전체인지 부분 교체인지 각각 밝힌다.

## 상태가 아니라 허용하는 작업을 먼저 정한다

FluoBlog에서 초안은 빈 제목과 빈 본문을 저장할 수 있다. 작성 중인 내용을 잃지 않는 편이 저장 버튼을 거부하는 것보다 낫다. 다만 메모리를 무한히 차지하는 입력은 받을 수 없으므로 제목은 120, 본문은 50,000, slug는 80이라는 길이 상한을 둔다. 이 장의 길이는 JavaScript 문자열의 `length`, 즉 UTF-16 코드 단위 수다. 화면에 보이는 글자 수와 완전히 같다는 약속은 하지 않는다.

발행할 때는 제목과 본문에 공백 아닌 문자가 있어야 하고, slug는 소문자 영문·숫자를 하이픈으로 연결한 값이어야 한다. 한국어 제목을 주소로 자동 음역하지 않고 작성자가 slug를 직접 고른다. 자동 생성은 편리하지만 제목 변경 때 URL을 바꿀지, 같은 제목 두 개를 어떻게 구별할지라는 별도 결정을 요구한다. 작은 제품에서는 명시적 입력이 더 설명하기 쉽다.

발행된 글의 본문 수정과 비공개 전환은 이번 모델에서 허용하지 않는다. 둘 다 가능한 제품 선택이지만, 이미 공개한 내용의 개정 이력과 링크 수명이라는 새로운 요구를 동반한다. 지금의 상태 전이는 `draft → published` 한 방향이다. 초안 수정은 `draft → draft`이지만 다른 사람이 본 버전을 덮어쓸 수 있으므로 이것도 버전을 증가시키는 쓰기다.

`version`은 생성 시 1이고 성공한 변경마다 1 증가한다. 클라이언트가 읽은 버전을 `expectedVersion`으로 제출하면 서비스가 현재 값과 비교한다. 이 값은 작성자 인증을 대신하지 않는다. “누가 쓸 수 있는가”와 “누가 먼저 바꾸었는가”는 다른 질문이다. 이번에는 운영자 한 명이 같은 글을 두 탭에서 편집하는 사고를 다룬다. 계정과 권한은 뒤의 장에서 기존 `authorId`에 연결한다.

## 한 번의 함수 호출로 규칙을 표현한다

다음은 **`src/posts/post.ts`의 완전한 파일**이다. HTTP와 Fluo를 import하지 않는다. 실패는 애플리케이션 오류 코드로 구분하고, 성공은 새 스냅샷을 반환한다.

```ts
export type PostErrorCode =
  | 'POST_NOT_FOUND'
  | 'POST_INVALID_TEXT'
  | 'POST_VERSION_CONFLICT'
  | 'POST_NOT_DRAFT'
  | 'POST_NOT_PUBLISHABLE'
  | 'POST_SLUG_CONFLICT';

export class PostDomainError extends Error {
  constructor(
    readonly code: PostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PostDomainError';
  }
}

export type DraftText = Readonly<{
  title: string;
  content: string;
  slug: string;
}>;

type PostBase = DraftText & Readonly<{
  id: number;
  authorId: string;
  version: number;
}>;

export type DraftPost = PostBase & Readonly<{
  status: 'draft';
  publishedAt: null;
}>;

export type PublishedPost = PostBase & Readonly<{
  status: 'published';
  publishedAt: string;
}>;

export type PostSnapshot = DraftPost | PublishedPost;

function normalizeText(input: DraftText): DraftText {
  const title = input.title.trim();
  const slug = input.slug.trim();
  const content = input.content;
  if (title.length > 120 || content.length > 50_000 || slug.length > 80) {
    throw new PostDomainError('POST_INVALID_TEXT', 'Post text exceeds the length limit.');
  }
  return { title, content, slug };
}

function requireDraft(
  current: PostSnapshot,
  expectedVersion: number,
): asserts current is DraftPost {
  if (current.version !== expectedVersion) {
    throw new PostDomainError('POST_VERSION_CONFLICT', 'Another change was saved first.');
  }
  if (current.status !== 'draft') {
    throw new PostDomainError('POST_NOT_DRAFT', 'This operation requires a draft.');
  }
  if (!Number.isSafeInteger(current.version + 1)) {
    throw new Error('Post version exceeds the safe integer range.');
  }
}

export function createDraft(
  id: number,
  authorId: string,
  input: DraftText,
): DraftPost {
  if (!Number.isSafeInteger(id) || id < 1 || authorId.length === 0) {
    throw new Error('Invalid server-owned post identity.');
  }
  return Object.freeze({
    ...normalizeText(input),
    id,
    authorId,
    version: 1,
    status: 'draft',
    publishedAt: null,
  });
}

export function reviseDraft(
  current: PostSnapshot,
  expectedVersion: number,
  input: DraftText,
): DraftPost {
  requireDraft(current, expectedVersion);
  return Object.freeze({
    ...current,
    ...normalizeText(input),
    version: current.version + 1,
  });
}

export function publishPost(
  current: PostSnapshot,
  expectedVersion: number,
  now: Date,
): PublishedPost {
  requireDraft(current, expectedVersion);
  if (
    current.title.trim().length === 0
    || current.content.trim().length === 0
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(current.slug)
  ) {
    throw new PostDomainError('POST_NOT_PUBLISHABLE', 'Check the title, content, and public slug.');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error('The publishing clock returned an invalid date.');
  }
  return Object.freeze({
    ...current,
    status: 'published',
    publishedAt: now.toISOString(),
    version: current.version + 1,
  });
}
```

`publishedAt`을 모든 상태에서 `string | null`로 둬도 저장은 가능하다. 하지만 두 타입을 나누면 `status === 'published'`를 확인한 다음에는 시각이 문자열이라는 사실을 TypeScript가 안다. 이것은 잘못된 데이터베이스 행을 자동 복구한다는 뜻이 아니다. 이 파일의 생성·변경 함수를 통과한 값에 관한 약속이다. 이후 데이터베이스에서 읽을 때도 그 약속을 복원하는 책임이 남는다.

본문의 앞뒤 공백은 보존했다. 코드 예제와 Markdown 들여쓰기를 사용하는 기술 블로그이기 때문이다. 발행 가능 여부를 확인할 때만 `trim()`한 길이를 본다. 제목과 slug는 입력 때 정리한다. 모든 문자열에 같은 정규화 함수를 적용하면 데이터의 의미를 바꿀 수 있다는 작은 사례다.

식별자와 시계가 잘못된 경우에는 일반 `Error`를 던진다. 둘은 서버가 공급할 값이므로 사용자가 고쳐 제출할 문서 오류와 구분한다. 반대로 빈 본문으로 발행을 요청하는 것은 예상 가능한 업무 실패다. 이 구분 덕분에 다음 장의 HTTP 경계가 서버 결함까지 `400`으로 감추지 않는다.

`Object.freeze()`는 얕은 동결이다. 현재 스냅샷은 원시 값만 갖기 때문에 반환된 객체를 실수로 고쳐 저장소 안의 상태를 바꾸는 일을 막기에 충분하다. 나중에 태그 배열이나 작성자 객체를 넣으면 같은 보장이 자동으로 확장되지 않는다. 불변이라는 단어보다 실제로 공유하는 참조가 무엇인지 확인해야 한다.

## 한 글의 규칙과 여러 글의 규칙을 분리한다

slug의 형식은 한 글만 보고 판단한다. slug의 중복은 다른 발행 글도 보아야 한다. 이를 순수 함수 안에서 전역 `Map`을 찾아 검사하게 만들면 테스트마다 전역 상태를 지워야 하고, 저장소를 바꾸기도 어려워진다. 여러 글을 조회할 수 있는 서비스가 중복을 검사하고, 모든 검사 뒤에 한 번만 저장하도록 한다.

다음은 **`src/posts/posts.service.ts`의 완전한 파일**이다. 지금은 단일 프로세스 메모리 구현이다. 범용 Repository 인터페이스는 만들지 않는다. 이 정도 동작을 위해 `findMany`, `updateAny`, `saveAnything`을 가진 추상 계층부터 도입하면 정작 원자적으로 보장해야 할 작업이 가려진다.

```ts
import { Inject } from '@fluojs/core';
import {
  createDraft,
  PostDomainError,
  publishPost,
  reviseDraft,
  type DraftText,
  type PostSnapshot,
  type PublishedPost,
} from './post.js';

export const POST_CLOCK = Symbol('POST_CLOCK');
export type PostClock = { now(): Date };

@Inject(POST_CLOCK)
export class PostsService {
  private readonly posts = new Map<number, PostSnapshot>();
  private nextId = 2;

  constructor(private readonly clock: PostClock) {
    const seed = createDraft(1, 'author-1', {
      title: 'Hello, Fluo!',
      content: 'My first post.',
      slug: 'hello-fluo',
    });
    this.posts.set(1, publishPost(seed, 1, new Date('2026-01-01T00:00:00.000Z')));
  }

  create(authorId: string, input: DraftText): PostSnapshot {
    const post = createDraft(this.nextId, authorId, input);
    this.posts.set(post.id, post);
    this.nextId += 1;
    return post;
  }

  get(id: number): PostSnapshot {
    const post = this.posts.get(id);
    if (!post) {
      throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
    }
    return post;
  }

  listPublished(): PublishedPost[] {
    return [...this.posts.values()].filter(
      (post): post is PublishedPost => post.status === 'published',
    );
  }

  getPublished(id: number): PublishedPost {
    const post = this.get(id);
    if (post.status !== 'published') {
      throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
    }
    return post;
  }

  revise(id: number, expectedVersion: number, input: DraftText): PostSnapshot {
    const next = reviseDraft(this.get(id), expectedVersion, input);
    this.posts.set(id, next);
    return next;
  }

  publish(id: number, expectedVersion: number): PublishedPost {
    const next = publishPost(this.get(id), expectedVersion, this.clock.now());
    const duplicate = [...this.posts.values()].some(
      (post) => post.status === 'published' && post.slug === next.slug,
    );
    if (duplicate) {
      throw new PostDomainError('POST_SLUG_CONFLICT', 'The public slug is already in use.');
    }
    this.posts.set(id, next);
    return next;
  }
}
```

첫 seed의 ID·제목·본문은 초기 HTTP 실습과 같다. 이미 독자에게 보여 준 글이므로 발행 상태로 올려 놓았고 버전은 2다. 새 초안은 ID 2, 버전 1부터 시작한다. `author-1`은 이 실습에서 서버가 소유하는 운영자 식별자다. 이후 계정 모델에 연결할 자리이지 요청 본문의 `authorId`를 믿겠다는 뜻이 아니다. 발행 시각은 테스트 가능한 고정 seed 값이며, 실제 새 글은 주입한 시계를 사용한다.

`publish()`에서 후보 객체를 만들었다고 저장이 끝난 것은 아니다. slug 검사에 실패하면 `Map`에 쓰지 않으므로 원래 초안과 버전이 그대로 남는다. 함수가 원본 객체를 수정했다면 이 순서를 지켜도 이미 상태 일부가 바뀌었을 것이다. 새 스냅샷을 만드는 선택은 단순한 함수 취향이 아니라 부분 실패를 다루기 위한 것이다.

한 프로세스 안에서 이 메서드는 동기적으로 실행되고 검사와 `Map.set()` 사이에 `await`가 없다. 따라서 현재 모델에서는 두 HTTP 요청이 같은 버전으로 발행을 호출해도 첫 번째 호출이 저장을 끝낸 뒤 두 번째가 최신 버전을 읽는다. 이것을 분산 잠금이나 데이터베이스 트랜잭션이라고 부르면 안 된다. 저장소를 비동기로 바꾸는 순간 이 근거가 사라지므로, 뒤의 Prisma·발행 트랜잭션 장에서 조건부 갱신과 고유 제약으로 다시 보장해야 한다.

## DI는 규칙이 아니라 필요한 외부 값을 연결한다

`PostClock`은 타입 별칭이다. JavaScript 실행 시에는 존재하지 않으므로 `@Inject(PostClock)`라고 쓸 수 없다. 실제 토큰은 `POST_CLOCK`이고 `@Inject(POST_CLOCK)`를 클래스에 붙였다. 다음은 **이 장의 서비스 단위 실험용 `src/posts/posts.module.ts` 전체**다. 앞 장의 HTTP 컨트롤러 등록까지 유지하는 최종 모듈은 다음 장에서 제시한다.

```ts
import { Module } from '@fluojs/core';
import { POST_CLOCK, PostsService, type PostClock } from './posts.service.js';

@Module({
  providers: [
    PostsService,
    {
      provide: POST_CLOCK,
      useValue: { now: () => new Date() } satisfies PostClock,
    },
  ],
  exports: [PostsService],
})
export class PostsModule {}
```

다른 기능 모듈은 `PostsModule`을 `imports`에 넣고 `PostsService`를 주입한다. 내부의 시계 토큰을 다른 기능에 공개할 필요는 없다. 하나의 앱에서 `PostsService`를 여러 모듈의 `providers`에 중복 등록하는 대신 이 export 경계를 사용한다. 테스트에서는 컨테이너가 없어도 `new PostsService(fixedClock)`로 동작을 검증할 수 있다. DI가 테스트 가능성을 만든 것이 아니라 의존 값을 생성자 인수로 명시했기 때문에 가능한 것이다.

## 두 탭 사고를 재현하는 테스트

다음은 **`src/posts/post.test.ts` 전체**다. 앞 장에서 설정한 Vitest 표준 데코레이터 변환 환경을 전제로 한다. Node.js 24가 TypeScript의 데코레이터 문법까지 그대로 실행해 준다는 가정은 하지 않는다.

```ts
import { describe, expect, it } from 'vitest';
import { createDraft, publishPost } from './post.js';
import { PostsService } from './posts.service.js';

const fixedClock = { now: () => new Date('2026-06-01T09:00:00.000Z') };
const text = { title: 'First review', content: 'We tested a restart.', slug: 'first-review' };

describe('Post transitions', () => {
  it('keeps an empty draft unchanged after publishing fails', () => {
    const draft = createDraft(2, 'author-1', { title: '', content: '', slug: '' });
    expect(() => publishPost(draft, 1, fixedClock.now())).toThrow(
      expect.objectContaining({ code: 'POST_NOT_PUBLISHABLE' }),
    );
    expect(draft).toMatchObject({ status: 'draft', version: 1, publishedAt: null });
  });

  it('rejects the late writer when two tabs read the same version', () => {
    const service = new PostsService(fixedClock);
    const draft = service.create('author-1', text);
    const leftVersion = draft.version;
    const rightVersion = draft.version;
    service.revise(draft.id, leftVersion, { ...text, title: 'Saved first' });
    expect(() => service.revise(draft.id, rightVersion, text)).toThrow(
      expect.objectContaining({ code: 'POST_VERSION_CONFLICT' }),
    );
    expect(service.get(draft.id)).toMatchObject({ title: 'Saved first', version: 2 });
  });

  it('does not change the publication time or version on repetition', () => {
    const service = new PostsService(fixedClock);
    const draft = service.create('author-1', text);
    const published = service.publish(draft.id, 1);
    expect(published).toMatchObject({
      status: 'published', version: 2, publishedAt: '2026-06-01T09:00:00.000Z',
    });
    expect(() => service.publish(draft.id, 1)).toThrow(
      expect.objectContaining({ code: 'POST_VERSION_CONFLICT' }),
    );
    expect(() => service.publish(draft.id, 2)).toThrow(
      expect.objectContaining({ code: 'POST_NOT_DRAFT' }),
    );
    expect(service.get(draft.id)).toBe(published);
  });

  it('keeps the second post as a draft after a slug conflict', () => {
    const service = new PostsService(fixedClock);
    const first = service.create('author-1', text);
    const second = service.create('author-1', text);
    service.publish(first.id, 1);
    expect(() => service.publish(second.id, 1)).toThrow(
      expect.objectContaining({ code: 'POST_SLUG_CONFLICT' }),
    );
    expect(service.get(second.id)).toMatchObject({ status: 'draft', version: 1 });
    expect(() => service.getPublished(second.id)).toThrow(
      expect.objectContaining({ code: 'POST_NOT_FOUND' }),
    );
  });
});
```

독자의 애플리케이션에서 실행할 명령은 `pnpm exec vitest run src/posts/post.test.ts`다. 이 원고 작성 과정에서 이 파일을 앱에 생성하여 실행한 것은 아니므로 통과 기록으로 읽지 않는다. 관찰해야 할 결과는 네 테스트의 성공이며, 특히 실패 뒤 저장된 객체의 버전과 상태가 바뀌지 않았는지가 핵심이다. 첫 구현에서 버전 비교를 지워 보면 두 탭 테스트가 실패해야 한다. 실패해도 상태를 먼저 바꾸는 구현이라면 slug 충돌 테스트가 이를 드러낸다.

실제 동시성을 흉내 낸다고 두 호출 사이에 `setTimeout()`을 넣을 필요가 없다. 현재 사고의 조건은 두 편집자가 같은 버전을 가지고 있었다는 사실이다. 그 조건을 변수 두 개로 명시하면 매번 같은 순서로 검증한다. 데이터베이스 요청이 겹치는 실험에서는 별도의 동기화 지점이 필요하지만, 아직 없는 비동기 저장소를 테스트에서 꾸며 내지는 않는다.

## 반복 요청과 영속성은 서로 다른 약속이다

발행 응답을 받기 전에 브라우저 연결이 끊길 수 있다. 사용자가 같은 버전으로 다시 발행하면 이 구현은 성공 응답을 재생하지 않고 충돌을 반환한다. 서버는 한 번만 상태를 바꾸었지만 클라이언트가 한 번의 성공을 확실히 관찰했다는 보장은 없다. 작성 화면은 충돌 뒤 최신 상태를 다시 읽고 이미 발행되었는지 확인할 수 있다. 같은 응답을 재생해야 하는 요구가 생기면 명령 식별자와 결과 보관이 필요하다. `version`만으로 그 기능이 생기지는 않는다.

프로세스를 종료하면 새 초안은 사라지고 seed만 다시 생긴다. 모듈을 singleton으로 등록하는 것은 프로세스 안의 공유 범위를 정할 뿐 디스크 저장을 하지 않는다. 이번 장에서는 이 제한을 테스트하기 위해 실제 운영 프로세스를 종료할 필요가 없다. `PostsService` 두 인스턴스를 만들어 첫 인스턴스에 생성한 글이 두 번째에는 없음을 확인하면 저장 범위가 드러난다. 10장에서 PostgreSQL로 이동하는 이유도 여기서 출발한다.

도메인 클래스를 반드시 복잡한 계층으로 만들 필요는 없다. 이 구현처럼 순수 함수와 불변 스냅샷으로 충분하면 유지한다. 반대로 발행 승인·철회·개정 이력이 생겨 조건문이 여러 호출자에게 흩어지기 시작하면 상태 전이를 한곳으로 모으는 방향을 유지하면서 모델을 확장한다. 작은 모델의 장점은 규칙을 덜 만드는 데 있지 않고 현재 규칙을 빠짐없이 읽을 수 있다는 데 있다.

이제 초안은 불완전한 글을 안전하게 보관하고, 발행은 공개 조건을 만족한 글만 한 번 전이시킨다. 다음 장의 문제는 JavaScript 객체가 아니라 HTTP 요청이다. `/posts/not-a-number`의 ID와 요청 본문의 `status: "published"`를 이 모델에 그대로 넘기면 방금 세운 경계가 무너진다. 입력의 출처와 허용하는 값을 정해 내부 명령으로 바꾸자.

## 근거와 이어 읽기

- [편집 계약](../EDITORIAL.ko.md)과 [확정 목차 manifest](../series.json): 게시글 필드와 제품 연속성의 기준이다.
- [`@fluojs/core` README](../../packages/core/README.ko.md), [공개 export](../../packages/core/src/index.ts): 클래스 수준 `@Inject`, 모듈 등록, 기본 singleton 범위의 근거다.
- [`@fluojs/http` 예외 구현](../../packages/http/src/exceptions.ts): 다음 장에서 도메인 실패를 HTTP 실패로 번역할 경계다.
- [`@fluojs/validation` 테스트](../../packages/validation/src/validation.test.ts): 입력 검증과 도메인 상태 전이를 혼동하지 않고 나눌 근거다. 이 장의 게시글 규칙 자체는 Fluo 패키지 API가 아니라 본문에서 정의한 애플리케이션 코드다.

[이전: 동작을 증명하면서 개발하기](./ch04-testing-from-the-start.ko.md) · [1권 목차](./toc.ko.md) · [다음: 외부 입력을 내부 데이터로 바꾸기](./ch06-request-boundaries.ko.md)
