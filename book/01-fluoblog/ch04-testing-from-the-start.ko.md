# 동작을 증명하면서 개발하기

<!-- book:volume=01-fluoblog;chapter=04 -->

[이전: 컨트롤러에서 로직 꺼내기](./ch03-modules-and-di.ko.md) · [1권 목차](./toc.ko.md) · [다음: 초안과 발행된 글은 무엇이 다른가](./ch05-post-domain.ko.md)

## 읽기 전용 기능도 회귀한다

FluoBlog에는 아직 쓰기 API가 없으니 데이터가 잘못 바뀔 일이 없다고 생각하기 쉽다. 그런데 운영자가 제목 보고서를 꾸미면서 조회 결과의 제목을 수정했다고 해 보자. 서비스가 내부 객체를 그대로 반환했다면 뒤이어 들어온 HTTP 요청도 바뀐 제목을 받는다. 글을 수정하는 기능을 만들지 않았는데 글이 달라진 것이다. 이전 장에서 복사 경계를 만든 이유가 여기에 있다.

수동으로 `/posts/1`을 한 번 열어 보는 검사는 이 문제를 발견하지 못한다. 조회 결과를 바꾸고 다시 읽는 순서까지 실행해야 결함이 드러난다. 테스트의 가치는 성공을 여러 번 확인하는 데만 있지 않다. 어떤 실패를 막으려는지 구체적인 조작과 관찰로 남기는 데 있다. 좋은 테스트는 코드가 바뀌었을 때 “무언가 다르다”가 아니라 “호출자가 서비스의 데이터를 바꿀 수 있게 되었다”라고 알려 준다.

현재 구조를 출발점으로 삼는다. `PostsService`는 `INITIAL_POSTS`로 주입받은 목록을 복사해서 소유하고, `list()`와 `findById()`에서 다시 복사본을 반환한다. `PostsModule`은 서비스와 컨트롤러를 등록하고 서비스를 export한다. `PostsController`는 ID를 해석하고 없는 글을 `404`로 표현한다. 테스트는 이 경계들 각각에 질문을 던지되 모든 질문을 서버 실행으로 해결하지 않는다.

이 장의 코드는 생성 프로젝트에 추가하는 테스트다. CLI가 만든 greeting 테스트와 기존 앱 테스트는 보존한다. 새 게시글 검사는 `src/posts/`와 `test/posts.e2e.test.ts`에 둔다. 이미 있는 테스트를 지워서 새 테스트의 결과만 좋아 보이게 하지 않는다. 본문은 작성할 파일과 실행 절차, 예상 실패를 제시하며 이 새 테스트 묶음을 집필 과정에서 실행해 통과시켰다고 주장하지 않는다.

## 테스트도 같은 데코레이터 언어를 사용한다

테스트를 쓰기 전에 생성된 설정을 확인한다. Node.js 24, pnpm 10을 그대로 사용하며 Vitest는 현재 starter의 4 계열을 따른다. `@fluojs/testing`은 애플리케이션 구성과 요청 테스트를 돕지만 테스트 실행기 자체는 아니다. Vitest와 Babel 의존성이 설치되어 있어야 한다.

```bash
pnpm add -D @babel/core @babel/plugin-proposal-decorators @babel/preset-typescript @fluojs/testing @fluojs/vite vitest
```

아래는 `vitest.config.ts`의 **완전한 설정 파일**이다. 생성된 파일이 같다면 그대로 둔다.

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin({ sourceMaps: true, transformBoundary: 'test' })],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['@fluojs/core/metadata-preload'],
  },
});
```

다음은 같은 프로젝트 루트의 `babel.config.cjs` **완전한 파일**이다.

```js
module.exports = {
  presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
  plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
};
```

canonical plugin은 application과 test module의 표준 데코레이터를 변환한다. 테스트 안에 선언한 module class도 같은 변환이 필요하며 평가 전 metadata를 preload해야 한다. 과거 설정에서 `src/**/*.test.ts`를 Babel 처리 대상에서 제외했다면 그 제외 규칙을 유지하지 않는다. 테스트 파일이 파싱조차 되지 않는 상태를 DI 실패나 비즈니스 규칙 실패로 읽으면 진단 방향이 틀어진다.

Test mode와 application mode는 같은 `@fluojs/vite` 구현을 공유한다. 테스트에서만 `experimentalDecorators`를 켜거나 다른 reflection 방식을 도입하면 테스트한 클래스와 실제 실행한 클래스의 의미가 달라질 수 있다.

## 가장 작은 테스트: 호출자가 데이터를 바꿀 수 없는가

서비스의 복사 정책은 네트워크와 관계없다. 클래스를 직접 생성하면 테스트에 필요한 모든 입력이 보인다. 다음은 `src/posts/posts.service.test.ts`의 **완전한 파일**이다.

```ts
import { describe, expect, it } from 'vitest';
import type { Post } from './post';
import { PostsService } from './posts.service';

function makeSeed(): Post[] {
  return [{ id: 1, title: 'Hello, Fluo!', content: 'My first post.' }];
}

describe('PostsService', () => {
  it('keeps a snapshot of the constructor input', () => {
    const seed = makeSeed();
    const service = new PostsService(seed);
    seed[0].title = 'Changed outside the service';
    seed.push({ id: 2, title: 'Another post', content: 'Outside data.' });

    expect(service.list()).toEqual(makeSeed());
  });

  it('does not expose its stored rows through list results', () => {
    const service = new PostsService(makeSeed());
    const rows = service.list();
    rows[0].title = 'Changed by a reader';
    rows.pop();

    expect(service.list()).toEqual(makeSeed());
  });

  it('does not expose its stored row through detail results', () => {
    const service = new PostsService(makeSeed());
    const post = service.findById(1);
    if (!post) {
      throw new Error('Expected the seeded post.');
    }
    post.content = 'Changed by a reader';

    expect(service.findById(1)).toEqual(makeSeed()[0]);
  });

  it('distinguishes an empty collection from a missing row', () => {
    const service = new PostsService([]);

    expect(service.list()).toEqual([]);
    expect(service.findById(1)).toBeUndefined();
  });

  it('does not substitute another post for a missing id', () => {
    const service = new PostsService(makeSeed());

    expect(service.findById(999)).toBeUndefined();
  });
});
```

각 테스트는 새 seed와 새 서비스를 만든다. 하나의 전역 배열을 테스트 사이에서 재사용하면 앞 테스트의 변경이 다음 테스트의 시작 조건이 될 수 있다. 테스트가 성공한 순서를 외워야 한다면 격리가 부족한 것이다. `makeSeed()`는 구현을 추상화하려는 범용 fixture 도구가 아니라 같은 기준 데이터를 매번 새 객체로 제공하는 작은 함수다.

첫 테스트는 입력 배열의 객체 수정과 항목 추가를 함께 시도한다. 두 번째는 반환된 객체의 필드와 반환 배열 자체를 모두 바꾼다. 내부 배열만 새로 만들고 객체를 그대로 반환하는 얕은 분리가 실수로 들어와도 이를 발견할 수 있다. 세 번째는 상세 조회 경계를 따로 확인한다. 목록이 안전하다는 사실만으로 상세도 안전하다고 추론하지 않는다.

실패를 실제로 볼 수 있는 작은 실험도 해 보자. 이전 장에서 처음 추출하는 순간이었다면 두 번째 테스트를 먼저 쓰고 실행한다. 이미 정상 구현을 완성했다면 `PostsService.list()`만 잠시 다음 **잘못된 메서드 조각**으로 바꾼다. 나머지 필드와 메서드는 이전 장의 서비스 안에 그대로 둔다.

```ts
list(): Post[] {
  return this.posts;
}
```

```bash
pnpm exec vitest run src/posts/posts.service.test.ts
```

반환 배열에서 항목을 제거했으므로 다시 읽은 목록은 seed와 달라지고 해당 테스트가 실패해야 한다. import 오류나 데코레이터 구문 오류 때문에 실패했다면 아직 의도한 실패를 관찰한 것이 아니다. 원인을 고쳐 데이터 노출 때문에 실패하는 지점까지 도달한 뒤, 이전 장의 `map`과 객체 복사를 사용하는 구현으로 복구한다. 정상 코드에서 같은 테스트를 다시 실행하면 이 회귀가 막혀야 한다.

이 테스트는 서비스가 내부적으로 반드시 `map()`을 사용해야 한다고 주장하지 않는다. 나중에 다른 자료구조로 바꾸더라도 같은 관찰 결과를 유지하면 통과할 수 있다. private 필드를 꺼내 검사하거나 특정 내부 helper의 호출 횟수를 고정하는 것보다 변경에 강한 이유다.

## 입력 경계는 표로 검증하기

숫자처럼 보이는 모든 문자열이 유효한 게시글 ID는 아니다. 앞 장의 `parsePostId()`는 십진 양의 정수 표기와 안전 정수 범위를 검사했다. 이 정책은 짧은 표 기반 테스트로 빠르게 확인할 수 있다. 다음은 `src/posts/post-id.test.ts`의 **완전한 파일**이다.

```ts
import { BadRequestException } from '@fluojs/http';
import { describe, expect, it } from 'vitest';
import { parsePostId } from './post-id';

describe('parsePostId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('accepts %s as %s', (input, expected) => {
    expect(parsePostId(input)).toBe(expected);
  });

  it.each([
    '',
    '0',
    '-1',
    '01',
    '1.5',
    '1garbage',
    ' 1',
    '1e3',
    '9007199254740992',
  ])('rejects %j', (input) => {
    expect(() => parsePostId(input)).toThrow(BadRequestException);
  });
});
```

거부 사례는 같은 실패를 아홉 번 반복하는 목록이 아니다. 빈 입력, 범위 하한, 음수, 비정규 표기, 소수, 부분 파싱, 공백, 지수 표기, 정밀도 초과라는 서로 다른 경계를 대표한다. `BadRequestException`이라는 분류를 확인하지만 사람이 읽는 오류 문장의 철자까지 고정하지 않는다. API가 문구가 아니라 오류 코드로 동작한다면 테스트도 그 계약을 따라야 한다.

이 테스트만으로 HTTP `400`이 증명되는 것은 아니다. 함수가 올바른 예외를 던져도 컨트롤러가 함수를 호출하지 않거나 dispatcher까지 예외가 전달되지 않으면 요청 결과는 달라질 수 있다. 반대로 HTTP 테스트에 모든 문자열 조합을 넣으면 작은 변환 버그를 찾기 위해 앱을 반복 조립하는 비용이 든다. 빠른 함수 테스트에 조합을 두고 HTTP에는 대표 실패를 남기는 이유다.

## 모듈 테스트: 같은 클래스가 아니라 같은 조립을 검사하기

직접 생성 테스트는 `@Inject`가 틀려도 통과할 수 있다. 테스트 코드가 올바른 생성자 인수를 수동으로 넣었기 때문이다. `PostsModule`이 서비스를 export하지 않아도 직접 생성에는 영향이 없다. 이 빈틈은 실제 모듈 그래프를 컴파일하는 테스트가 담당한다.

다음은 `src/posts/posts.slice.test.ts`의 **완전한 파일**이다. 테스트 전용 소비자를 통해 `PostsModule` 바깥에서 서비스가 주입되는지도 검사한다.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  createTestingModule,
  type TestingModuleRef,
} from '@fluojs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { Post } from './post';
import { INITIAL_POSTS } from './post.tokens';
import { PostsModule } from './posts.module';
import { PostsService } from './posts.service';

@Inject(PostsService)
class PostsConsumer {
  constructor(private readonly posts: PostsService) {}

  count(): number {
    return this.posts.list().length;
  }
}

@Module({
  imports: [PostsModule],
  providers: [PostsConsumer],
})
class PostsSliceModule {}

describe('PostsModule', () => {
  let module: TestingModuleRef | undefined;

  afterEach(async () => {
    const owned = module;
    module = undefined;
    await owned?.container.dispose();
  });

  it('exports a service that an importing module can inject', async () => {
    module = await createTestingModule({
      rootModule: PostsSliceModule,
    }).compile();

    const consumer = await module.resolve(PostsConsumer);
    expect(consumer.count()).toBe(1);
  });

  it('accepts an empty seed through a pre-compile override', async () => {
    module = await createTestingModule({
      rootModule: PostsSliceModule,
    })
      .overrideProvider<readonly Post[]>(INITIAL_POSTS)
      .useValue([])
      .compile();

    const consumer = await module.resolve(PostsConsumer);
    expect(consumer.count()).toBe(0);
  });
});
```

전용 루트 모듈을 만드는 이유는 production의 `PostsModule`을 복사하기 위해서가 아니다. 실제 모듈을 import하는 소비자를 하나 만들어 export 경계를 통과시키기 위해서다. 테스트 안에서 서비스와 seed를 새 `providers` 목록으로 다시 조립하면 프로덕션 모듈의 등록 누락을 놓칠 수 있다. 실제 소유 모듈을 그대로 가져오는 것이 중요하다.

두 번째 테스트는 `INITIAL_POSTS` 값만 교체한다. `PostsService` 자체를 가짜로 만들지 않으므로 실제 서비스와 주입 관계는 계속 실행된다. 교체는 `compile()` 전에 한다. 이미 생성된 서비스를 직접 수정하는 대신 구성 단계에서 입력을 바꾸면 테스트의 시작 상태와 lifecycle이 명확하다.

`afterEach`는 성공 여부와 관계없이 성공적으로 반환받은 컨테이너를 정리한다. 변수에서 소유권을 먼저 분리한 뒤 `dispose()`를 기다리므로 이전 참조를 다음 테스트에 남기지 않는다. 이 파일은 일반 `it`의 순차 실행을 전제로 하며 공유 변수를 가진 채 `it.concurrent`로 바꾸지 않는다. 테스트를 병렬화하려면 각 테스트가 자기 컨테이너 참조와 정리를 독립적으로 소유하도록 구조도 함께 바꿔야 한다.

`compile()` 자체가 실패해 참조가 반환되지 않은 경우에는 builder가 내부 컨테이너 정리를 소유한다. 초기화와 정리가 모두 실패하면 두 실패를 보존하는 `AggregateError`가 보고될 수 있다. 성공적으로 반환된 뒤에는 호출자가 정리를 소유한다. 따라서 실패를 `catch`해서 빈 객체로 바꾸거나 정리 오류를 무시하면 테스트 환경이 망가진 상태로 다음 테스트가 시작될 수 있다.

이 경계의 실패 실험은 `PostsModule.exports`에서 `PostsService`를 잠시 제거하는 것이다. 직접 생성 테스트는 계속 통과할 수 있지만 첫 slice 테스트는 소비자의 의존성을 조립할 수 없어 실패해야 한다. export를 복구하고 다시 확인한다. 이런 차이를 관찰하면 테스트 계층이 같은 검사를 반복하는 것이 아니라 서로 다른 누락을 찾아낸다는 점이 분명해진다.

## HTTP 테스트: 컨트롤러 메서드가 아니라 요청 보내기

이제 앱을 사용하는 독자의 계약을 검사한다. `@fluojs/testing`의 `createTestApp()`은 실제 runtime dispatcher를 조립하지만 TCP 포트를 열지 않는다. `app.request(...).send()`가 가상 요청을 전달하고 상태, 헤더, 본문을 돌려준다. 직접 `controller.get({ id: '1' })`를 호출하는 것과 달리 라우트 선택과 DTO 바인딩, 예외 응답 작성이 함께 실행된다.

아래는 `test/posts.e2e.test.ts`의 **완전한 파일**이다.

```ts
import { createTestApp, type TestApp } from '@fluojs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app';

const expected = { id: 1, title: 'Hello, Fluo!', content: 'My first post.' };

describe('Post HTTP contract', () => {
  let app: TestApp | undefined;

  afterEach(async () => {
    const owned = app;
    app = undefined;
    await owned?.close();
  });

  it('returns a collection and the same post as a detail object', async () => {
    app = await createTestApp({ rootModule: AppModule });

    const list = await app.request('GET', '/posts').send();
    const detail = await app.request('GET', '/posts/1').send();

    expect(list.status).toBe(200);
    expect(list.body).toEqual([expected]);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual(expected);
  });

  it.each([
    ['/posts/999', 404, 'NOT_FOUND'],
    ['/posts/1garbage', 400, 'BAD_REQUEST'],
    ['/posts/9007199254740992', 400, 'BAD_REQUEST'],
  ])('maps %s to %s and %s', async (path, status, code) => {
    app = await createTestApp({ rootModule: AppModule });

    const response = await app.request('GET', path).send();

    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({
      error: { status, code },
    });
  });

  it('keeps independent read requests consistent', async () => {
    app = await createTestApp({ rootModule: AppModule });

    const responses = await Promise.all([
      app.request('GET', '/posts/1').send(),
      app.request('GET', '/posts/1').send(),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body).toEqual(expected);
    }
  });
});
```

이 파일도 각 테스트마다 새 앱을 만들고 `afterEach`에서 닫는다. 한 테스트가 잘못된 입력을 보냈다고 다음 테스트의 데이터가 바뀌지 않아야 한다. 요청 builder와 응답 타입은 라이브러리가 제공하므로 수동으로 `FrameworkRequest`, `FrameworkResponse`의 가짜 객체를 채우지 않는다. 그런 저수준 표현은 어댑터나 dispatcher 자체를 개발할 때 필요한 경계다.

오류 검사는 HTTP 상태와 본문의 기계 판독 필드를 함께 확인한다. 본문에 `NOT_FOUND`만 있고 상태가 `200`인 응답은 실패해야 한다. 목록을 객체로 감싸 버리거나 상세를 배열로 바꿔도 첫 테스트가 실패한다. 이런 값은 실제 API 소비자가 구분하는 데이터 계약이므로 고정할 가치가 있다.

동시 읽기 검사는 같은 서비스를 쓰는 요청들이 정상 seed를 반환하는지 확인한다. 그러나 이것이 미래의 동시 글 수정이나 데이터베이스 트랜잭션을 검증하는 것은 아니다. 현재 구현에는 요청 사이에 조율할 쓰기 작업이 없다. 단순히 `Promise.all()`을 썼다고 경합 안전성을 증명했다고 말하지 않는다. 이후 동시 수정 요구가 생기면 두 작업이 같은 버전을 읽은 시점 등을 명시적으로 통제하는 별도 테스트가 필요하다.

## 실패의 위치를 읽고, 필요한 표면까지 올라가기

네 파일을 작성한 뒤 다음 명령으로 새 게시글 테스트만 한 번 실행한다.

```bash
pnpm exec vitest run \
  src/posts/posts.service.test.ts \
  src/posts/post-id.test.ts \
  src/posts/posts.slice.test.ts \
  test/posts.e2e.test.ts
```

기대 결과는 선택한 모든 테스트의 통과다. 실패하면 계층을 구별한다. 서비스 테스트가 실패했다면 데이터 복사와 조회 규칙을 본다. 서비스는 통과하지만 slice가 실패하면 토큰, provider, import/export 구성을 확인한다. 두 계층은 통과하지만 HTTP가 실패하면 라우트 등록과 DTO, 오류 매핑을 살핀다. 처음부터 전체 앱 코드를 다시 쓰는 것보다 작은 원인 후보로 좁힐 수 있다.

가상 HTTP 테스트는 네트워크를 열지 않으므로 포트 충돌, 실제 Fastify의 요청 파싱, 실행 산출물의 import 경로를 증명하지 않는다. 그런 문제는 2장의 `scripts/check-posts.mjs`를 실제 서버에 실행해 확인한다. 개발 경로만이 아니라 `pnpm build` 후 `pnpm start`로 시작한 서버에도 같은 검사를 적용하면 빌드와 listener 경계를 별도로 관찰할 수 있다.

테스트에 고정된 대기 시간을 넣지 않는다. `await new Promise(...)`로 몇백 밀리초 쉰 뒤 “아마 준비됐을 것”이라고 가정하는 대신 `compile()`, `createTestApp()`, `send()`, `close()`가 반환하는 Promise를 기다린다. 모두 구체적인 완료 사건이다. 이후 비동기 작업을 검사할 때도 작업 완료 이벤트나 제어 가능한 Promise를 먼저 준비하고 동작을 시작해야 한다. timeout은 실패 상한으로만 사용하고 성공 순서를 우연에 맡기지 않는다.

목을 많이 쓰는 것이 좋은 격리는 아니다. HTTP 계약을 검사하면서 컨트롤러와 서비스를 모두 가짜로 바꾸면 실제 바인딩이나 호출 누락을 놓칠 수 있다. 지금의 테스트에는 외부 네트워크나 데이터베이스가 없으므로 실제 협력자를 사용하는 비용도 작다. 외부 의존성이 생기면 그 경계만 명시적인 대역으로 교체하고, 실제 연동 검사가 별도로 필요한 사실을 남긴다.

모든 함수를 직접 테스트할 필요도 없다. private helper의 호출 순서를 고정하면 더 좋은 구현으로 바꾸는 순간 테스트를 대량으로 수정하게 된다. 반면 현재의 입력 복사, 결과 복사, 모듈 가시성, 상태 코드처럼 관찰 가능한 계약은 구현을 바꿔도 유효하다. 커버리지 숫자를 높이기 위해 오류 문구나 내부 줄 수를 고정하는 것보다 어떤 회귀를 검출할 수 있는지 설명하는 편이 더 유용하다.

## 다음 기능을 받아들일 수 있는 작은 안전망

이제 FluoBlog에는 조회만 있는 작은 기능과 그 동작을 구분해서 검증하는 안전망이 생겼다. 프로그램을 실행해 보는 일은 여전히 필요하지만, 매번 모든 실패를 사람이 기억할 필요는 없다. 구성 실수와 입력 실수, 데이터 노출은 각각 적절한 테스트가 알려 준다. 테스트가 통과했다는 사실도 그 테스트가 관찰한 범위 안에서 해석할 수 있게 되었다.

다음 장에서 운영자는 아직 다 쓰지 않은 글을 저장하고 싶어 한다. 지금처럼 모든 게시글을 목록에 내보내면 초안도 독자에게 보일 수 있다. `status`, 발행 규칙, 조회 대상이라는 새 계약이 필요해진다. 이때 기존 테스트를 없애는 대신 여전히 유효한 HTTP·DI·복사 계약은 유지하고 새 상태 규칙을 가장 작은 테스트부터 추가한다. 첫 글의 성공을 보존하면서 제품의 의미를 넓히는 개발이 여기서 시작된다.

## 근거와 더 읽기

- [공식 testing 경로와 TDD 계층](../../packages/testing/README.ko.md), [공개 export](../../packages/testing/src/index.ts), [테스트 요구사항 계약](../../docs/contracts/testing-guide.ko.md)
- [가상 앱 구현](../../packages/testing/src/app.ts), [요청 builder와 응답 타입](../../packages/testing/src/http.ts), [공개 앱·모듈 타입](../../packages/testing/src/types.ts)
- [모듈 builder 구현](../../packages/testing/src/module.ts), [컴파일 실패와 정리 회귀 테스트](../../packages/testing/src/module.compile-failure.test.ts)
- [Vite 데코레이터 변환 경계](../../packages/vite/README.ko.md#데코레이터-변환-경계), [데코레이터 변환 구현](../../packages/vite/src/decorators-plugin.ts)

[이전: 컨트롤러에서 로직 꺼내기](./ch03-modules-and-di.ko.md) · [1권 목차](./toc.ko.md) · [다음: 초안과 발행된 글은 무엇이 다른가](./ch05-post-domain.ko.md)
