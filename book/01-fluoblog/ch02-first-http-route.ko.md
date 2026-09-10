# 첫 게시글을 HTTP로 보여주기

<!-- book:volume=01-fluoblog;chapter=02 -->

[이전: FluoBlog의 첫 실행 경로 만들기](./ch01-first-app.ko.md) · [1권 목차](./toc.ko.md) · [다음: 컨트롤러에서 로직 꺼내기](./ch03-modules-and-di.ko.md)

## 실행 성공을 독자의 성공으로 바꾸기

이전 장에서 서버를 켜고 끄는 경로를 확인했다. `/greeting`은 개발 환경이 동작한다는 좋은 신호지만 블로그를 방문한 독자는 인사말 대신 글을 읽고 싶다. 운영자는 첫 게시글의 주소를 동료에게 보내기로 한다. 처음에는 글이 하나뿐이므로 작성 화면도 데이터베이스도 필요하지 않다. 목록에서 글을 발견하고, 글 주소를 복사하고, 잘못된 주소라면 없다는 사실을 알 수 있으면 된다.

여기서 요구를 “JSON을 반환한다”로만 정하면 중요한 부분을 놓친다. `/posts/999`에서도 첫 글을 반환하는 서버는 JSON 반환에는 성공하지만 독자에게 거짓 정보를 보여 준다. 반대로 빈 목록을 서버 오류로 처리하면 게시글이 아직 없는 정상 상태를 장애처럼 보이게 한다. HTTP 계약은 내용뿐 아니라 어떤 경우에 어떤 상태를 돌려줄지도 포함한다.

이번 장에서는 `GET /posts`와 `GET /posts/:id` 두 경로만 만든다. 정상 목록은 배열, 정상 상세는 객체다. 문법이 잘못된 ID에는 `400`, 형식은 올바르지만 존재하지 않는 ID에는 `404`를 사용한다. `POST`로 글을 만드는 기능은 아직 없다. 존재하지 않는 쓰기 동작을 흉내 내기 위해 모든 HTTP 메서드를 하나의 handler로 받지 않는다.

첫 seed는 세 필드로 고정한다. `id`는 숫자 `1`, `title`은 `Hello, Fluo!`, `content`는 `My first post.`이다. 이 단계에서는 작성자, 발행 상태, 버전이 모델에 없다. 필요하지 않은 필드를 임시 값으로 채우는 대신 뒤에서 그 필드를 필요하게 만든 요구와 함께 도입한다. 이 작은 모델을 장마다 이름만 바꾸지 않고 유지해야 이후 테스트와 데이터 저장을 자연스럽게 연결할 수 있다.

## 먼저 주소가 아직 없다는 사실 확인하기

개발 서버가 이전 장 상태로 실행 중일 때 다음 요청을 보낸다.

```bash
curl -i http://127.0.0.1:3000/posts
```

아직 경로를 등록하지 않았다면 예상 결과는 `404`다. 이것은 이번 기능의 출발점이다. 여기서 이미 게시글이 나온다면 오래된 다른 앱을 보고 있는지, 같은 포트의 프로세스가 무엇인지 확인한다. 실패를 확인하지 않은 채 코드를 추가하면 자신이 만든 변경 때문에 성공한 것인지 판별하기 어렵다.

이제 `src/posts/` 디렉터리를 만든다. 아래는 `src/posts/post.ts`의 **완전한 파일**이다.

```ts
export interface Post {
  id: number;
  title: string;
  content: string;
}
```

이 인터페이스는 애플리케이션이 소유한 데이터 형태다. Fluo가 자동으로 생성한 데이터베이스 모델이 아니다. TypeScript는 코드 작성 중 숫자 ID를 잘못 전달하는 실수를 잡아 주지만 네트워크에서 받은 문자열을 숫자로 변환하거나, 이미 배포된 응답을 런타임에 검사해 주지는 않는다.

가장 작은 구현부터 시작하자. 다음은 `src/posts/posts.controller.ts`의 **첫 번째 완전한 파일**이다. 뒤에서 같은 파일을 상세 조회까지 포함하는 구현으로 교체한다.

```ts
import { Controller, Get } from '@fluojs/http';
import type { Post } from './post';

@Controller('/posts')
export class PostsController {
  @Get()
  list(): Post[] {
    return [
      { id: 1, title: 'Hello, Fluo!', content: 'My first post.' },
    ];
  }
}
```

`@Controller('/posts')`는 이 클래스의 경로 접두사다. `@Get()`의 생략된 인수는 빈 상대 경로이므로 최종 경로는 `/posts`다. 접두사를 무시하고 `/`을 만드는 동작이 아니다. 파일명이 `posts.controller.ts`이기 때문에 자동으로 발견되는 것도 아니다. 반드시 모듈에 등록해야 한다.

다음은 생성된 starter 구성을 보존하면서 컨트롤러를 추가한 `src/app.ts`의 **완전한 파일**이다. `ConfigModule`과 `HealthModule`, `GreetingModule`은 CLI가 만든 기존 등록이며 이 장의 새 기능은 `controllers` 한 항목이다.

```ts
import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { HealthModule } from '@fluojs/runtime';
import { GreetingModule } from './greeting/greeting.module';
import { PostsController } from './posts/posts.controller';

@Module({
  global: true,
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: process.env,
    }),
    GreetingModule,
    HealthModule.forRoot(),
  ],
  controllers: [PostsController],
})
export class AppModule {}
```

`src/main.ts`는 이 `AppModule`을 계속 실행한다. 새 컨트롤러에는 아직 의존성이 없으므로 빈 생성자나 의미 없는 `@Inject()`를 붙이지 않는다. 의존성이 생기면 다음 장에서 실제 토큰과 함께 주입한다. 등록만으로 충분한 단계에서 DI를 장식처럼 사용하는 것도, 의존성이 생겼는데 수동 생성으로 숨기는 것도 피한다.

개발 프로세스의 재시작이 끝난 뒤 `/posts`를 다시 요청한다. 기대하는 상태는 `200`이며 본문은 다음과 같다.

```json
[
  {
    "id": 1,
    "title": "Hello, Fluo!",
    "content": "My first post."
  }
]
```

이 JSON은 기대 응답을 읽기 좋게 펼친 것이다. 실제 응답의 공백이나 속성 표시 순서가 같아야 한다는 뜻은 아니다. 클라이언트가 의존할 것은 배열과 객체의 구별, 필드 이름, 값의 타입이다. 프레임워크는 반환된 일반 객체를 응답으로 작성하므로 직접 `JSON.stringify()`해서 문자열을 반환하지 않는다. 문자열로 바꾸면 구조화된 값과 이미 인코딩한 표현을 혼동하기 쉽다.

## 경로의 문자열을 게시글 ID로 바꾸기

동료는 목록 주소보다 특정 글 주소를 원한다. 경로는 `/posts/1`로 정한다. 여기서 `1`은 HTTP 경로 안에서는 문자열이고, 애플리케이션의 `Post.id`는 숫자다. 생성자 타입 추론이 DI 토큰을 대신하지 않았듯, 매개변수 타입 표기도 HTTP 입력 변환을 대신하지 않는다.

`src/posts/post-params.dto.ts`의 **완전한 파일**을 만든다.

```ts
import { FromPath } from '@fluojs/http';

export class PostParamsDto {
  @FromPath('id')
  id = '';
}
```

DTO는 요청에서 무엇을 꺼낼지 선언하는 클래스다. `@FromPath('id')`는 경로 변수의 이름을 선택한다. 상세 handler에 `@RequestDto(PostParamsDto)`를 함께 붙여야 이 클래스의 바인딩 선언을 사용한다. `get(input: PostParamsDto)`라는 타입 표기만 남겨 두는 것은 런타임 바인딩 설정이 아니다.

필드를 `id = ''`로 초기화한 이유도 있다. 이 책의 Babel 표준 데코레이터 설정에서 데코레이터가 붙은 필드를 `id!: string`으로 선언하는 방식은 지원되는 작성 형태가 아니다. 초기값은 바인더가 할당할 필드를 명시하면서 변환 경계를 지킨다. 빈 문자열 자체를 유효한 ID로 받아들인다는 의미는 아니다.

입력 정책은 별도 작은 함수로 둔다. 다음은 `src/posts/post-id.ts`의 **완전한 파일**이다.

```ts
import { BadRequestException } from '@fluojs/http';

export function parsePostId(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new BadRequestException('Post id must be a positive decimal integer.');
  }

  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw new BadRequestException('Post id is outside the supported integer range.');
  }

  return id;
}
```

`Number.parseInt('1garbage', 10)`은 앞의 `1`을 읽을 수 있다. 우리 API는 이를 첫 게시글 요청으로 받아들이지 않는다. `1.5`, `0`, 음수, 앞에 `0`을 붙인 `01`도 이 장에서 정한 ID 표기 밖이다. 특히 `9007199254740992`처럼 JavaScript의 안전 정수 범위를 넘는 값은 숫자로 변환되더라도 정확한 식별자로 사용하지 않는다.

엄격한 표기에는 비용도 있다. 예전에 `/posts/01`을 외부에 배포했다면 이를 거부하는 변경은 기존 링크를 깨뜨린다. 이번 앱은 첫 주소를 정하는 단계이므로 하나의 표기를 선택할 수 있다. 이미 사용자가 있는 서비스라면 기존 입력을 관찰하고 리다이렉트나 마이그레이션 정책부터 정해야 한다. 정규식이 짧다는 이유만으로 기존 API에 그대로 이식하면 안 된다.

이 함수는 모든 DTO 검증을 대체하는 범용 도구가 아니다. 지금은 경로 변수 하나의 정책을 이해하기 위한 작은 HTTP 경계다. 제목 길이, 선택 필드, 여러 입력 출처가 생기면 6장에서 검증과 변환을 체계화한다. 여기서 복잡한 검증 프레임워크를 만들거나 유효하지 않은 값을 무조건 `1`로 보정하지 않는다.

## 상세 조회와 없는 글을 구별하는 최종 컨트롤러

이제 `src/posts/posts.controller.ts`를 다음 **완전한 파일**로 교체한다. 앞에서 만든 `Post`, `PostParamsDto`, `parsePostId`를 사용하며 `src/app.ts`의 등록은 그대로다.

```ts
import { Controller, Get, NotFoundException, RequestDto } from '@fluojs/http';
import type { Post } from './post';
import { parsePostId } from './post-id';
import { PostParamsDto } from './post-params.dto';

@Controller('/posts')
export class PostsController {
  private readonly posts: Post[] = [
    { id: 1, title: 'Hello, Fluo!', content: 'My first post.' },
  ];

  @Get()
  list(): Post[] {
    return this.posts.map((post) => ({ ...post }));
  }

  @Get('/:id')
  @RequestDto(PostParamsDto)
  get(input: PostParamsDto): Post {
    const id = parsePostId(input.id);
    const post = this.posts.find((candidate) => candidate.id === id);

    if (!post) {
      throw new NotFoundException('Post not found.');
    }

    return { ...post };
  }
}
```

배열을 필드로 옮긴 이유는 목록과 상세가 같은 데이터 집합을 보게 하기 위해서다. 두 handler에 seed를 각각 넣으면 한쪽 제목만 수정해서 목록과 상세가 다른 글처럼 보일 수 있다. 다만 컨트롤러가 데이터를 보관하는 구조는 임시 출발점이다. 다음 장에서 이 사실이 어떤 변경을 어렵게 하는지 확인하고 로직을 분리한다.

각 반환값을 복사하는 이유는 호출자에게 내부 객체의 수정 권한까지 넘기지 않기 위해서다. HTTP 응답을 파싱한 클라이언트가 서버 메모리를 직접 바꿀 수 있는 것은 아니다. 문제가 되는 쪽은 같은 프로세스의 직접 호출과 테스트다. 현재 필드는 숫자와 문자열뿐이므로 얕은 복사가 충분하다. 나중에 중첩된 배열이나 객체가 들어오면 같은 복사가 그 내부까지 분리하지는 않는다는 점을 다시 검토해야 한다.

`NotFoundException`은 단순히 이름에 `404`가 들어간 오류가 아니다. 현재 HTTP 패키지의 예외는 상태 `404`와 코드 `NOT_FOUND`를 보유하고, dispatcher가 이를 표준 오류 표현으로 작성한다. 예를 들어 없는 글에 대한 본문은 다음 형태다.

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Post not found.",
    "status": 404
  }
}
```

요청 ID 등을 추가하는 미들웨어가 있으면 부가 필드가 더해질 수 있다. 그래서 테스트는 임의의 진단 필드가 절대로 없다고 단정하기보다 필요한 오류 코드와 상태를 확인해야 한다. 아직 작성자 식별자나 인증 정보가 없으므로 이 응답에 그런 값을 만들지 않는다.

없는 글을 `return null`로 표현하면 정상 `200` 응답과 결합되어 클라이언트가 별도 추론을 해야 할 수 있다. `return { error: 'not found' }` 역시 HTTP 오류를 선언하지 않은 일반 객체다. 반대로 모든 예외를 잡아 `404`로 바꾸면 프로그램 결함이나 저장소 장애까지 “글이 없음”으로 위장한다. 알려진 실패는 의도한 예외로 표현하고 알 수 없는 실패를 없는 데이터로 바꾸지 않는 것이 이번 경계의 핵심이다.

## 정상 응답 하나보다 입력 표가 더 많은 것을 증명한다

개발 서버를 켠 상태에서 경로를 하나씩 확인한다.

```bash
curl -i http://127.0.0.1:3000/posts
curl -i http://127.0.0.1:3000/posts/1
curl -i http://127.0.0.1:3000/posts/999
curl -i http://127.0.0.1:3000/posts/1garbage
curl -i http://127.0.0.1:3000/posts/9007199254740992
```

순서대로 기대하는 상태는 `200`, `200`, `404`, `400`, `400`이다. 목록의 첫 항목과 상세의 객체가 같은 seed를 표현해야 한다. `999`는 입력 문법이 맞으므로 조회까지 진행한 후 없는 데이터로 분류한다. 뒤의 두 요청은 입력 정책을 벗어나므로 게시글을 찾기 전에 거부한다. 이렇게 구분하면 잘못된 링크와 없는 글을 운영 로그에서도 다른 원인으로 해석할 수 있다.

손으로 결과를 비교하는 대신 실제 listener에 대한 작은 검사를 남길 수도 있다. 아래는 생성 프로젝트의 `scripts/check-posts.mjs`에 둘 수 있는 **완전한 Node.js 실험 파일**이다. 추가 테스트 라이브러리가 필요하지 않다.

```js
import assert from 'node:assert/strict';

const origin = process.env.BLOG_ORIGIN ?? 'http://127.0.0.1:3000';
const expected = { id: 1, title: 'Hello, Fluo!', content: 'My first post.' };

async function request(path) {
  return fetch(new URL(path, origin), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
}

const list = await request('/posts');
assert.equal(list.status, 200);
assert.deepEqual(await list.json(), [expected]);

const detail = await request('/posts/1');
assert.equal(detail.status, 200);
assert.deepEqual(await detail.json(), expected);

for (const [path, status, code] of [
  ['/posts/999', 404, 'NOT_FOUND'],
  ['/posts/1garbage', 400, 'BAD_REQUEST'],
  ['/posts/9007199254740992', 400, 'BAD_REQUEST'],
]) {
  const response = await request(path);
  assert.equal(response.status, status);
  const payload = await response.json();
  assert.equal(payload.error.status, status);
  assert.equal(payload.error.code, code);
}

console.log('Post HTTP checks passed.');
```

```bash
node scripts/check-posts.mjs
```

이 파일은 서버를 시작하지 않는다. 이미 시작을 확인한 로컬 서버를 대상으로 요청하므로 임의의 대기 시간을 넣지 않는다. `AbortSignal.timeout(5000)`은 서버가 응답하지 않을 때 검사를 끝내는 상한이지 성공할 때까지 잠시 기다리는 장치가 아니다. 모든 assertion이 통과하면 마지막 문장이 출력되고, 하나라도 어긋나면 오류와 함께 종료된다. 원고는 이 절차의 기대 결과를 제시하며 새로 작성한 실험의 통과 로그를 주장하지 않는다.

이제 의미 있는 실패도 만들 수 있다. `@RequestDto(PostParamsDto)`를 잠깐 제거하면 타입 표기만으로 바인딩이 유지되지 않는다는 사실이 상세 요청에서 드러나야 한다. `controllers`에서 `PostsController`를 제거하면 목록부터 `404`가 되어야 한다. `parsePostId`를 앞부분만 읽는 변환으로 바꾸면 `1garbage` 검사가 실패해야 한다. 확인 후 각각 정상 코드로 복구한다. 세 실패는 서로 다른 경계를 건드리므로 모두 “라우트가 안 된다”로 묶으면 원인을 놓친다.

## 조회 기능의 범위를 작게 유지하기

목록과 상세는 데이터를 변경하지 않는다. 같은 GET을 두 번 보내면 같은 seed를 읽어야 하며 ID가 증가하거나 조회 순서에 따라 글이 사라져서는 안 된다. 이 단계의 동시 요청은 같은 읽기 전용 상태를 관찰한다. 서버를 두 개 켜면 각 프로세스가 자기 메모리의 seed를 가지므로 데이터가 공유되는 구조도 아니다. 현재 결과가 같다는 것은 영속성이나 프로세스 간 정합성의 증거가 아니다.

지금의 목록에는 페이지 크기 제한도 발행 상태 필터도 없다. 글 한 건을 공개하는 목표에는 충분하지만 수천 개의 글과 초안이 생기면 충분하지 않다. 그렇다고 첫 controller에 미래의 모든 필드를 미리 넣지는 않는다. 변경 이유가 생길 때 경계를 추가하고 기존 관찰 결과를 보호하는 편이 어떤 복잡성이 필요한지 판단하기 쉽다.

라우트 문법 역시 작게 사용한다. `/posts/:id`처럼 하나의 세그먼트를 경로 변수로 선언할 수 있지만 `:id.json`, `post-:id`, 정규식처럼 보이는 경로가 모두 지원되는 것은 아니다. Fluo의 controller 경로는 literal 세그먼트와 전체 세그먼트 매개변수를 기본 계약으로 삼는다. 다른 라우터에서 익숙한 문법을 가져오면 시작 시 거부되거나 기대와 다른 경계를 만들 수 있으므로 현재 공개 계약을 확인해야 한다.

이 장을 마치면 독자는 목록과 개별 주소로 첫 글을 읽을 수 있다. 저장소는 아직 없고 seed는 컨트롤러 안에 있으며, ID 해석은 별도 작은 함수다. 다음 요구는 HTTP가 아닌 코드에서도 같은 조회 로직을 쓰는 것이다. 그때 controller를 직접 생성하는 대신, 데이터를 소유한 서비스와 그 서비스를 연결하는 모듈을 만들겠다. 다음 장의 리팩터링은 URL과 JSON을 바꾸지 않고 이 내부 구조만 바꾸는 작업이다.

## 근거와 더 읽기

- [HTTP 데코레이터·DTO·라우트 경로 계약](../../packages/http/README.ko.md), [공개 portable export](../../packages/http/src/index.portable.ts)
- [데코레이터 구현](../../packages/http/src/decorators.ts), [경로 매핑과 매개변수 테스트](../../packages/http/src/mapping.test.ts)
- [HTTP 예외와 오류 응답 타입](../../packages/http/src/exceptions.ts), [요청 dispatcher 테스트](../../packages/http/src/dispatch/dispatcher.test.ts)
- [보존한 CLI starter의 루트 모듈과 greeting 구성](../../packages/cli/src/new/scaffold.ts)

[이전: FluoBlog의 첫 실행 경로 만들기](./ch01-first-app.ko.md) · [1권 목차](./toc.ko.md) · [다음: 컨트롤러에서 로직 꺼내기](./ch03-modules-and-di.ko.md)
