# 컨트롤러에서 로직 꺼내기

<!-- book:volume=01-fluoblog;chapter=03 -->

[이전: 첫 게시글을 HTTP로 보여주기](./ch02-first-http-route.ko.md) · [1권 목차](./toc.ko.md) · [다음: 동작을 증명하면서 개발하기](./ch04-testing-from-the-start.ko.md)

## 두 번째 호출자가 생기면 보이는 경계

FluoBlog의 첫 글은 이제 HTTP로 읽을 수 있다. 운영자는 다음 글을 준비하면서 배포 전에 게시글 개수와 제목을 터미널에서 확인하고 싶어졌다. API를 호출하는 작은 스크립트도 가능하지만, 서버를 먼저 켜지 않고 애플리케이션의 조회 규칙만 실행하는 방법이 있으면 편리하다. 그런데 현재 데이터를 가진 객체는 `PostsController`다. 글을 조회하려고 HTTP 입력 DTO와 `404` 예외까지 알아야 한다.

문제는 컨트롤러가 길다는 사실보다 서로 다른 변경 이유가 한곳에 모였다는 점이다. URL의 ID를 해석하는 일은 HTTP 입력 정책이다. 글을 찾아 반환하는 일은 게시글 기능이다. 찾지 못한 결과를 `404`로 전달하는 일은 다시 HTTP 응답 정책이다. 조회 로직을 재사용할 때 이 셋을 함께 가져오면 콘솔 명령도 HTTP 예외를 이해해야 하고, 단순 데이터 테스트도 요청 모양을 만들어야 한다.

이번 장은 기능을 늘리기보다 경계를 옮긴다. `/posts`, `/posts/1`, 잘못된 ID의 `400`, 없는 글의 `404`를 그대로 유지한다. 이전 장의 `scripts/check-posts.mjs`가 리팩터링 전후에 같은 계약을 검사할 수 있어야 한다. 내부 파일을 바꿨다는 이유로 URL이나 seed의 필드 이름까지 바꾸면 실패 원인이 구조 변경인지 기능 변경인지 구별하기 어려워진다.

처음부터 범용 저장소 인터페이스나 외부 데이터베이스를 만들지는 않는다. 아직 데이터는 메모리의 게시글 배열이다. 필요한 변화는 조회 로직을 `PostsService`에 두고, 그 서비스가 받을 초기 데이터를 명시하고, 기능 모듈이 조립을 책임지게 하는 것이다. 모듈과 DI는 모든 클래스를 잘게 나누는 이유가 아니라 이미 생긴 협력 관계를 드러내는 도구다.

## 먼저 직접 생성할 수 있는 서비스로 옮기기

가장 작은 중간 단계는 `PostsService`가 기존 배열과 `list()`, `findById()`를 소유하는 것이다. 컨트롤러는 입력 ID를 숫자로 바꾼 다음 서비스에 조회를 요청하고, 결과가 없을 때만 `NotFoundException`을 던진다. 서비스는 요청 객체도 Fastify 응답도 받지 않는다. 이 관계는 프레임워크를 떠나 일반 TypeScript의 생성자 호출만으로도 표현할 수 있어야 한다.

여기에 테스트 요구를 하나 더 붙여 보자. “글이 없는 블로그”와 “한 글이 있는 블로그”를 같은 테스트 실행에서 독립적으로 만들고 싶다. 서비스 내부의 고정 seed를 테스트마다 수정하면 테스트 순서에 따라 결과가 달라질 수 있다. 초기 데이터를 생성자 입력으로 받으면 각 서비스의 시작 상태를 호출자가 명시할 수 있다. 외부 저장소를 추상화하는 대신 현재 실제로 필요한 입력만 분리하는 선택이다.

먼저 `src/posts/post.tokens.ts`를 만든다. 다음은 **완전한 파일**이다.

```ts
export const INITIAL_POSTS = Symbol('INITIAL_POSTS');
```

이 토큰은 초기 게시글 목록을 가리키는 런타임 값이다. `Post[]`라는 인터페이스 표현 자체를 DI 토큰으로 사용할 수는 없다. TypeScript 타입은 실행 시점에 사라지기 때문이다. 다른 파일에서 같은 설명 문자열로 Symbol을 다시 만들면 다른 토큰이 된다. 등록과 주입 양쪽이 이 파일의 `INITIAL_POSTS`를 import해야 한다.

이제 `src/posts/posts.service.ts`의 **완전한 파일**을 작성한다. `Post`는 이전 장의 `src/posts/post.ts`에 정의한 `id`, `title`, `content` 세 필드다.

```ts
import { Inject } from '@fluojs/core';
import type { Post } from './post';
import { INITIAL_POSTS } from './post.tokens';

@Inject(INITIAL_POSTS)
export class PostsService {
  private readonly posts: Post[];

  constructor(initialPosts: readonly Post[]) {
    this.posts = initialPosts.map((post) => ({ ...post }));
  }

  list(): Post[] {
    return this.posts.map((post) => ({ ...post }));
  }

  findById(id: number): Post | undefined {
    const post = this.posts.find((candidate) => candidate.id === id);
    return post ? { ...post } : undefined;
  }
}
```

생성자와 반환 경계에서 모두 복사한다. 생성자에서 복사하지 않으면 호출자가 나중에 seed 배열이나 그 안의 객체를 수정해 서비스 상태를 바꿀 수 있다. 반환값을 복사하지 않으면 목록이나 상세를 받은 같은 프로세스의 호출자가 내부 상태를 바꿀 수 있다. `private readonly posts`는 필드에 다른 배열을 재할당하지 못하게 할 뿐, 배열과 객체의 내용을 자동으로 불변으로 만들지는 않는다.

현재 필드가 모두 원시 값이므로 이 복사는 명확하고 충분하다. 모든 데이터에 JSON 직렬화와 역직렬화를 적용하는 범용 복사 함수를 만들 필요는 없다. 나중에 날짜나 중첩 객체가 생기면 반환 모델을 다시 설계해야 한다. 지금 해결한 문제를 미래의 모든 객체에 대한 깊은 불변성 보장으로 확대해서 설명하지 않는다.

`findById()`의 없는 결과는 `undefined`다. 콘솔 보고서는 이를 누락 항목으로 처리할 수 있고 HTTP 컨트롤러는 `404`로 바꿀 수 있다. 서비스가 HTTP 패키지를 import하지 않는 덕분에 호출자별 표현 정책을 서비스 안에 넣지 않아도 된다. 반면 `id`가 올바른 숫자인지는 호출 경계의 계약이다. 앞 장의 `parsePostId()`를 서비스 안에 복사하지 않는다. 새 외부 입력 경로를 만들면 그 경로가 자신의 입력을 검사해야 한다.

## 주입 선언과 등록은 서로 다른 일이다

컨트롤러에서 `new PostsService(seed)`를 직접 호출해도 지금은 동작한다. 그러나 그렇게 하면 어떤 데이터로 서비스를 시작할지 컨트롤러가 결정하게 된다. 테스트나 다른 실행 모드가 다른 초기 데이터를 쓰려면 컨트롤러까지 바꿔야 한다. 생성은 구성 경계로 옮기고 컨트롤러는 필요한 서비스를 받도록 하자.

아래는 `src/posts/posts.controller.ts`의 **완전한 교체 파일**이다. `parsePostId`와 `PostParamsDto`는 이전 장의 구현을 그대로 사용한다.

```ts
import { Inject } from '@fluojs/core';
import { Controller, Get, NotFoundException, RequestDto } from '@fluojs/http';
import type { Post } from './post';
import { parsePostId } from './post-id';
import { PostParamsDto } from './post-params.dto';
import { PostsService } from './posts.service';

@Inject(PostsService)
@Controller('/posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list(): Post[] {
    return this.posts.list();
  }

  @Get('/:id')
  @RequestDto(PostParamsDto)
  get(input: PostParamsDto): Post {
    const post = this.posts.findById(parsePostId(input.id));
    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    return post;
  }
}
```

`@Inject(PostsService)`는 클래스 위에 붙는 표준 데코레이터다. 생성자 매개변수나 프로퍼티에 붙이는 예전 데코레이터 문법이 아니다. 생성자의 첫 인수에 `PostsService` 토큰으로 해석한 인스턴스를 넣으라는 선언이다. 의존성이 여러 개라면 `@Inject(A, B)`의 순서와 생성자 인수 순서가 맞아야 한다. 타입 이름을 읽어 자동으로 주입해 줄 것이라고 기대하지 않는다.

이 선언은 provider를 등록하지는 않는다. `PostsService` 파일이 있고 컨트롤러가 import했다고 해서 모듈 그래프에 서비스가 생기는 것은 아니다. JavaScript의 import는 코드의 값에 접근하는 경계이고, Fluo의 provider 등록은 실행할 객체를 조립하는 경계다. 두 가지를 구분하지 않으면 에디터에서는 타입이 맞는데 실행 시 의존성을 찾지 못하는 일이 생긴다.

이를 연결하는 `src/posts/posts.module.ts`의 **완전한 파일**은 다음과 같다.

```ts
import { Module } from '@fluojs/core';
import type { Post } from './post';
import { INITIAL_POSTS } from './post.tokens';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

const initialPosts: Post[] = [
  { id: 1, title: 'Hello, Fluo!', content: 'My first post.' },
];

@Module({
  controllers: [PostsController],
  providers: [
    { provide: INITIAL_POSTS, useValue: initialPosts },
    PostsService,
  ],
  exports: [PostsService],
})
export class PostsModule {}
```

`controllers`는 HTTP 진입점을, `providers`는 기능 내부의 값과 서비스를, `exports`는 이 모듈을 사용하는 다른 모듈에 공개할 토큰을 정한다. 여기서는 초기 배열 자체를 내보내지 않고 `PostsService`만 공개한다. 다른 기능이 seed를 직접 읽고 수정하면 서비스의 복사 정책과 조회 계약을 우회하기 때문이다.

초기 데이터는 이제 controller가 아니라 구성 경계에 있다. 이 값 provider는 데이터베이스도 영속 저장소도 아니다. 프로세스를 다시 시작하면 같은 seed로 새 서비스를 만든다. 이렇게 제한된 입력을 토큰으로 분리하는 것은 빈 데이터나 특정 테스트 데이터를 주입하는 데 충분하며, 아직 존재하지 않는 `Repository<T>` 계층을 만들지 않아도 된다.

## 루트에는 기능의 입구만 연결하기

다음은 `src/app.ts`의 **완전한 교체 파일**이다. 이전 장의 `PostsController` 직접 등록을 제거하고 `PostsModule`을 import한다. 나머지는 생성된 starter 구성이다.

```ts
import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { HealthModule } from '@fluojs/runtime';
import { GreetingModule } from './greeting/greeting.module';
import { PostsModule } from './posts/posts.module';

@Module({
  global: true,
  imports: [
    ConfigModule.forRoot({
      envFilePaths: ['.env'],
      processEnv: process.env,
    }),
    GreetingModule,
    HealthModule.forRoot(),
    PostsModule,
  ],
})
export class AppModule {}
```

이제 루트 모듈은 게시글 기능에 컨트롤러가 몇 개 있고 어떤 seed 토큰을 쓰는지 몰라도 된다. `PostsService`를 루트의 `providers`에도 다시 등록하지 않는다. 그것은 의존성을 보이게 하는 정상 경로가 아니라 등록 소유권을 중복시키는 시도다. 다른 기능이 서비스를 필요로 한다면 자신의 `imports`에 `PostsModule`을 연결하고 그 모듈의 export를 사용한다.

starter의 루트에 있던 `@Module({ global: true })`를 모든 기능 모듈로 복제하지도 않는다. `PostsModule`에는 글로벌 선언이 없다. 전역 가시성으로 빠진 import를 숨기면 기능 간 의존성의 방향이 코드에서 잘 보이지 않는다. 규모가 커질수록 명시적인 모듈 연결은 처음 보는 사람이 변경 영향 범위를 읽는 데 도움이 된다.

새 구조의 요청은 루트에서 게시글 모듈로, 그 안에서 controller로, 주입된 service로 이어진다. `INITIAL_POSTS`는 서비스 생성 시 읽힌다. GET 요청마다 seed를 다시 주입하거나 새로운 배열 provider를 만드는 구조가 아니다. 기본 singleton 서비스가 앱 컨텍스트 안에서 공유되고, 조회할 때 호출자에게 반환할 복사본을 만든다.

이 시점에 이전 장의 HTTP 검사를 다시 실행한다. 목록과 상세의 seed, 잘못된 ID의 `400`, 없는 ID의 `404`가 그대로여야 한다. 내부 배열이 더 이상 컨트롤러에 없다는 사실을 HTTP 검사에 억지로 노출하지 않는다. 외부 계약을 유지하면서 내부 조립을 바꾸는 것이 이번 리팩터링의 성공 조건이다.

## 컨테이너에서 등록과 교체를 직접 관찰하기

모듈을 통하지 않는 작은 실험으로 DI 자체를 볼 수 있다. 아래는 `src/posts/di-probe.ts`의 **완전한 파일**이다. 애플리케이션의 request handler에 컨테이너를 끼워 넣기 위한 코드가 아니라 등록과 해석의 차이를 관찰하는 독립 실험이다.

```ts
import assert from 'node:assert/strict';
import { Container, DuplicateProviderError } from '@fluojs/di';
import { INITIAL_POSTS } from './post.tokens';
import { PostsService } from './posts.service';

const container = new Container();
container.register(
  { provide: INITIAL_POSTS, useValue: [] },
  PostsService,
);

try {
  assert.throws(
    () => container.register({ provide: INITIAL_POSTS, useValue: [] }),
    DuplicateProviderError,
  );

  container.override({
    provide: INITIAL_POSTS,
    useValue: [
      { id: 1, title: 'Hello, Fluo!', content: 'My first post.' },
    ],
  });

  const first = await container.resolve(PostsService);
  const second = await container.resolve(PostsService);
  assert.equal(first, second);
  assert.equal(first.list().length, 1);
  assert.equal(first.findById(999), undefined);
  console.log('DI registration checks passed.');
} finally {
  await container.dispose();
}
```

```bash
pnpm exec vite build --ssr src/posts/di-probe.ts --outDir dist-di-probe
node dist-di-probe/main.js
```

정상 기대 결과는 마지막 성공 출력과 종료다. 중복 `register()`가 거부되는 것을 assertion으로 확인하고, 의도적인 교체에는 `override()`를 사용한다. 이 실험은 서비스가 처음 생성되기 전에 교체하므로 이미 사용 중인 객체를 바꾸는 복잡한 수명주기까지 다루지 않는다. 두 번 해석한 참조가 같다는 assertion은 기본 singleton의 의미를 보여 준다.

`await container.resolve()`는 선택적인 장식이 아니다. provider는 팩토리나 비동기 해석을 포함할 수 있으므로 공개 API는 비동기 결과를 돌려준다. 동기적인 서비스 생성만 보고 Promise를 객체처럼 사용하는 코드를 작성하지 않는다. 사용을 마친 컨테이너는 `dispose()`를 기다려 정리한다. 현재 서비스에는 외부 자원이 없어도 호출자가 소유한 수명주기를 끝내는 규칙은 같다.

독립 컨테이너가 성공했다고 모듈의 `imports`와 `exports`까지 검증된 것은 아니다. 위 코드는 provider를 직접 등록했으므로 모듈 가시성 경계를 통과하지 않는다. 실제 앱의 구성 실수는 별도의 모듈 실험으로 확인해야 한다.

## HTTP 없는 두 번째 호출자 만들기

처음 요구했던 제목 보고서를 구현해 보자. 아래는 `src/posts-summary.ts`의 **완전한 파일**이다.

```ts
import { Inject, Module } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';
import { PostsModule } from './posts/posts.module';
import { PostsService } from './posts/posts.service';

@Inject(PostsService)
class PostsSummary {
  constructor(private readonly posts: PostsService) { }

  render(): string {
    const rows = this.posts.list();
    return JSON.stringify({
      count: rows.length,
      titles: rows.map((post) => post.title),
    });
  }
}

@Module({
  imports: [PostsModule],
  providers: [PostsSummary],
})
class SummaryModule { }

const context = await FluoFactory.createApplicationContext(SummaryModule);
try {
  const summary = await context.get(PostsSummary);
  console.log(summary.render());
} finally {
  await context.close();
}
```

```bash
pnpm exec vite build --ssr src/posts-summary.ts --outDir dist-summary
node dist-summary/main.js
```

기대하는 보고서 데이터는 `{"count":1,"titles":["Hello, Fluo!"]}`다. HTTP 서버는 열지 않는다. `PostsSummary`는 `PostsService`를 사용하지만 초기 배열 토큰은 모른다. 이것이 `PostsModule`의 공개 경계가 실제 호출자에게 제공하는 가치다.

이제 `PostsModule`의 `exports`에서 `PostsService`만 잠시 제거하고 다시 빌드한다. 보고서 모듈은 그 서비스를 주입받을 수 없으므로 모듈 가시성 실패가 드러나야 한다. 반면 같은 모듈 안의 controller와 service 관계만 보면 누락된 export를 발견하기 어렵다. 실패를 확인한 뒤 export를 복구한다. 해결책은 보고서에 `PostsService`를 중복 등록하는 것이 아니라 소유 모듈이 의도한 공개 토큰을 제공하는 것이다.

## singleton은 현재 사용자 저장소가 아니다

서비스가 공유된다는 사실은 앞으로 주의해야 할 설계 제약이다. `PostsService`에 `currentAuthorId`를 저장하고 요청 시작마다 덮어쓰면 두 요청이 서로의 작성자 정보를 볼 수 있다. 지금은 읽기 전용 seed만 있으므로 이런 요청별 상태가 필요하지 않다. 이후 사용자 기능을 추가할 때도 현재 사용자는 메서드 인수나 적절한 요청 경계로 전달하고, singleton 필드에 임시로 숨기지 않는다.

Fluo의 scope는 기본 singleton, 요청별 request, 해석별 transient로 구분된다. 모든 provider를 request로 바꾸면 공유 상태 문제가 자동으로 해결되는 것은 아니다. 생성을 반복하는 비용이 늘고, singleton이 request provider를 의존하면 `ScopeMismatchError`로 거부된다. 루트 컨테이너에서 request provider를 직접 해석하는 것도 올바른 사용이 아니다. 요청 scope는 `createRequestScope()`로 만든 자식 경계가 소유한다.

순환 의존성도 이름만 바꿔 해결할 수 없다. 나중에 `PostsService`가 `AccountsService`를 필요로 하고 반대 방향의 생성자 의존성까지 생기면, 어떤 작업을 누가 조율할지 다시 정해야 한다. `ForwardRef.create()`는 아직 선언되지 않은 토큰의 조회를 늦출 수 있지만 실제 생성자 순환을 끊지 않는다. 작동하지 않는 관계에 지연 참조를 반복해서 붙이는 대신 두 기능을 함께 사용하는 상위 작업으로 조율을 옮기는 편이 책임을 설명하기 쉽다.

이 장에서 만든 분리는 클래스 수 자체를 목표로 하지 않는다. 일회성 계산 함수는 함수로 두면 되고, 외부 협력자가 없는 작은 로직은 `new`로 직접 테스트해도 된다. DI가 필요한 곳은 애플리케이션이 어떤 협력자를 어떤 수명으로 제공할지 결정해야 하는 구성 경계다. 2권에서 같은 블로그에 상점을 붙일 때도 모든 모듈을 새 프로세스로 옮기는 대신 이런 경계를 먼저 사용한다.

현재 상태는 명확하다. `PostsModule`이 초기 데이터와 `PostsService`, `PostsController`를 소유한다. controller는 ID 바인딩과 오류 표현을, service는 게시글 조회와 복사 경계를 맡는다. 외부 호출자는 공개된 서비스만 사용한다. 다음 장에서는 이 계약들을 직접 생성 테스트, 실제 모듈 그래프 테스트, 가상 HTTP 요청 테스트로 나누어 자동으로 증명하겠다.

## 근거와 더 읽기

- [core의 모듈·주입·scope 계약](../../packages/core/README.ko.md), [공개 토큰 타입](../../packages/core/src/types.ts), [공개 export](../../packages/core/src/index.ts)
- [DI 등록·교체·수명주기 계약](../../packages/di/README.ko.md), [provider 타입](../../packages/di/src/types.ts), [오류 클래스](../../packages/di/src/errors.ts), [컨테이너 구현](../../packages/di/src/container.ts)
- [runtime의 모듈 조립과 독립 컨텍스트](../../packages/runtime/README.ko.md), [모듈 그래프 구현](../../packages/runtime/src/module-graph.ts), [모듈 가시성 회귀 테스트](../../packages/runtime/src/module-graph-alias-visibility.test.ts)
- [scope와 순환 의존성의 테스트 경계](../../packages/testing/src/module-lifecycle-resolution-regression.test.ts)

[이전: 첫 게시글을 HTTP로 보여주기](./ch02-first-http-route.ko.md) · [1권 목차](./toc.ko.md) · [다음: 동작을 증명하면서 개발하기](./ch04-testing-from-the-start.ko.md)
