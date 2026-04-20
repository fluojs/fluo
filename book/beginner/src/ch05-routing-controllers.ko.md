<!-- packages: @fluojs/http, @fluojs/platform-fastify -->
<!-- project-state: FluoBlog v1.2 -->

# Chapter 5. Routing and Controllers

## Learning Objectives
- `@Controller()`와 HTTP 메서드 데코레이터가 API 표면을 어떻게 정의하는지 이해합니다.
- FluoBlog를 위한 첫 번째 실제 `PostsController`를 만듭니다.
- 경로 파라미터, 쿼리 파라미터, 요청 본문이 컨트롤러 메서드로 들어오는 방식을 배웁니다.
- 서비스로 작업을 위임해 컨트롤러를 얇게 유지합니다.
- Fastify 기반 애플리케이션에 posts 기능을 연결합니다.
- 더 많은 기능을 추가하기 전에 라우트를 검토하는 초보자 습관을 익힙니다.

## Prerequisites
- 1장부터 4장까지 완료했습니다.
- `AppModule`이 있는 FluoBlog 프로젝트를 생성했습니다.
- 모듈, 프로바이더, 데코레이터에 대한 기본 이해가 있습니다.
- 작은 TypeScript 컨트롤러 예제를 읽는 데 익숙합니다.

## 5.1 Why Routing Comes First in HTTP Work

Part 1은 백엔드 애플리케이션이 손에 잡히기 시작하는 지점에서 출발합니다.

사용자는 여러분의 의존성 그래프를 직접 경험하지 않습니다.

사용자가 경험하는 것은 URL, 메서드, 그리고 응답입니다.

그래서 라우팅이 첫 번째 실전 HTTP 주제가 됩니다.

fluo에서 라우팅의 중심은 컨트롤러입니다.

컨트롤러 클래스는 공통 경로 접두사 아래에 관련 엔드포인트를 모읍니다.

그다음 메서드 데코레이터가 개별 메서드를 HTTP 동사와 연결합니다.

이렇게 하면 URL에서 코드로 이어지는 읽기 쉬운 지도가 생깁니다.

```typescript
import { Controller, Get } from '@fluojs/http';

@Controller('/posts')
export class PostsController {
  @Get('/')
  list() {
    return [];
  }
}
```

아주 작은 예제지만 이미 많은 정보를 전달합니다.

이 컨트롤러는 `/posts` 영역을 소유합니다.

`list()` 메서드는 `GET /posts`를 처리합니다.

반환된 배열이 응답 페이로드가 됩니다.

### Routes Are an Application Contract

엔드포인트를 공개하는 순간 다른 코드가 그 경로에 의존할 수 있습니다.

프런트엔드 코드, 모바일 클라이언트, 테스트, 외부 연동이 모두 그 라우트를 안정적인 계약으로 취급할 수 있습니다.

그래서 초보자 프로젝트에서도 라우트 설계는 신중할 가치가 있습니다.

### 라우트 버전 관리 (Route Versioning)

실제 프로덕션 환경에서 API는 시간이 지남에 따라 발전합니다. 이번 장에서 직접 구현하지는 않겠지만, fluo는 라우트 버전 관리(예: `/v1/posts` 대 `/v2/posts`)를 기본적으로 지원합니다. 지금부터 라우트를 하나의 계약으로 생각하는 습관을 들이면, 나중에 애플리케이션이 커졌을 때 이러한 버전들을 훨씬 더 쉽게 관리할 수 있습니다.

### 표준 HTTP 동사 사용하기

fluo에서는 표준 HTTP 메서드를 의도된 목적에 맞게 사용할 것을 권장합니다.

- `@Get()`: 데이터를 조회합니다. 부수 효과(side effect)가 없어야 합니다.
- `@Post()`: 새로운 리소스를 생성합니다.
- `@Put()`: 리소스 전체를 교체합니다.
- `@Patch()`: 리소스의 일부를 업데이트합니다.
- `@Delete()`: 리소스를 삭제합니다.

첫날부터 이러한 표준을 따르면 다른 개발자가 여러분의 API를 직관적으로 이해할 수 있으며, 다양한 HTTP 도구 및 캐시와도 잘 호환됩니다.

### 시맨틱 URL과 계층 구조

좋은 라우팅은 단순히 기술적인 정확성만을 의미하지 않습니다. 시맨틱(semantic)한 명확성도 중요합니다. `/posts/1/comments`와 같은 URL은 특정 게시글에 속한 댓글에 접근하고 있음을 명확하게 전달합니다. fluo의 중첩 컨트롤러 기능(중급편에서 다룰 예정입니다)은 이러한 논리적 계층 구조를 강제하는 데 도움이 됩니다. 지금은 최상위 경로를 설명적이고 단순하게 유지하는 데 집중하세요.

### The Beginner Goal in This Chapter

아직 완벽한 프로덕션 API가 필요한 것은 아닙니다.

지금 필요한 것은 분명한 머릿속 모델입니다.

그 모델은 다음과 같습니다.

1. 컨트롤러는 라우트 선언을 소유합니다.
2. 서비스는 재사용 가능한 게시글 로직을 소유합니다.
3. 모듈은 둘 다 등록합니다.
4. 런타임 어댑터는 완성된 HTTP 서버를 외부에 노출합니다.

이 네 단계가 분명해지면 나머지 Part 1이 훨씬 쉬워집니다.

## 5.2 Creating the First PostsController

이제 3장에서 만든 게시글 기능 스켈레톤을 실제 HTTP 진입점으로 바꿔 보겠습니다.

먼저 아주 작은 인메모리 서비스를 사용하겠습니다.

이렇게 하면 이번 장의 초점이 영속성보다 라우팅에 머무를 수 있습니다.

```typescript
// src/posts/posts.service.ts
import { Injectable } from '@fluojs/di';

@Injectable()
export class PostsService {
  private readonly posts = [
    { id: '1', title: 'Hello fluo', body: 'First post', published: true },
  ];

  findAll() {
    return this.posts;
  }
}
```

그다음 이 서비스를 컨트롤러에 연결합니다.

```typescript
// src/posts/posts.controller.ts
import { Controller, Get } from '@fluojs/http';
import { PostsService } from './posts.service';

@Controller('/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get('/')
  findAll() {
    return this.postsService.findAll();
  }
}
```

이제 FluoBlog는 처음으로 API처럼 느껴집니다.

HTTP 요청이 애플리케이션으로 들어와 게시글 데이터를 응답으로 돌려줄 수 있습니다.

### Why the Controller Stays Small

컨트롤러가 하지 않는 일을 눈여겨보세요.

배열을 직접 만들지 않습니다.

게시글 저장 방식을 결정하지 않습니다.

라우트 매핑과 비즈니스 규칙을 한데 섞지 않습니다.

대신 위임합니다.

### 요청 생명주기 (단순 버전)

사용자가 `GET /posts`에 접속하면 내부적으로 다음과 같은 일이 일어납니다.

1.  **Fastify**가 OS 레벨에서 HTTP 요청을 받습니다.
2.  **Fluo 어댑터**가 URL `/posts`를 `PostsController`와 매칭합니다.
3.  **Fluo DI**가 `PostsService`를 인스턴스화하고 주입합니다.
4.  **findAll() 메서드**가 호출됩니다.
5.  **서비스**가 데이터를 반환합니다.
6.  **Fluo**가 결과를 직렬화하여 Fastify에 다시 넘깁니다.
7.  **Fastify**가 최종 HTTP 응답을 사용자에게 보냅니다.

이 흐름을 이해하면 왜 코드를 여러 파일로 나누는지 알 수 있습니다. 시스템의 각 부분은 이 여정에서 각자 맡은 역할이 있습니다.

### 미들웨어 vs 컨트롤러 (개념)

학습이 진행되면서 로깅이나 인증 같은 기능은 어디에 위치해야 하는지 궁금할 수 있습니다. 많은 프레임워크에서 이러한 기능은 "미들웨어(Middleware)"라고 불립니다. fluo에서는 인증을 위한 **가드(Guards)**나 로깅을 위한 **인터셉터(Interceptors)**와 같이 더 구체적인 도구를 주로 사용합니다. 하지만 이들 모두 컨트롤러 앞뒤의 요청 파이프라인에 위치한다는 점은 같습니다. 컨트롤러가 라우팅에만 집중하게 함으로써, 나중에 핵심 로직을 수정하지 않고도 이러한 추가 기능들을 쉽게 끼워 넣을 수 있습니다.

### Controller Review Questions

컨트롤러를 처음 읽을 때는 다음을 질문해 보세요.

1. 이 클래스는 어떤 경로 접두사를 소유하는가?
2. 각 메서드는 어떤 HTTP 동사를 처리하는가?
3. 이 메서드는 어떤 서비스나 프로바이더에 위임하는가?
4. 컨트롤러 안에 비즈니스 로직이 너무 커지고 있지는 않은가?

이 질문들은 단순하지만 HTTP 계층을 읽기 쉽게 유지해 줍니다.

## 5.3 Path Params, Query Params, and Request Bodies

실제 API는 목록 조회만 하지 않습니다.

하나의 리소스를 id로 조회합니다.

결과를 필터링합니다.

클라이언트가 보낸 페이로드를 받습니다.

fluo는 이런 입력을 명시적인 바인딩 데코레이터로 드러냅니다.

```typescript
import { Controller, FromBody, FromPath, FromQuery, Get, Post } from '@fluojs/http';

@Controller('/posts')
export class PostsController {
  @Get('/:id')
  findOne(@FromPath('id') id: string) {
    return { id };
  }

  @Get('/')
  search(@FromQuery('published') published?: string) {
    return { published };
  }

  @Post('/')
  create(@FromBody() input: { title: string; body: string }) {
    return input;
  }
}
```

각 데코레이터는 전송 계층의 질문에 직접 답합니다.

`@FromPath('id')`는 값이 URL 세그먼트에서 온다고 말합니다.

`@FromQuery('published')`는 값이 쿼리 문자열에서 온다고 말합니다.

`@FromBody()`는 값이 요청 본문에서 온다고 말합니다.

### Why Explicit Binding Matters

명시적인 바인딩은 초보자에게 특히 큰 도움이 됩니다.

핸들러 파라미터가 보이면 그 값의 출처를 같은 줄에서 확인할 수 있기 때문입니다.

숨겨진 규칙을 기억할 필요가 없습니다.

### 바인딩 vs 로우 객체 (Raw Objects)

다른 프레임워크에서 볼 수 있는 것처럼 `@Req()`나 `@Res()` 같은 로우 객체를 직접 쓰고 싶은 유혹이 생길 수 있습니다. fluo도 고급 사례를 위해 이를 지원하기는 하지만, 일반적인 개발에서는 강력히 지양할 것을 권장합니다. `@FromBody()` 같은 명시적인 데코레이터를 사용하면, 거대하고 복잡한 요청 객체 전체를 뒤지는 대신 메서드에 정확히 어떤 데이터가 필요한지 선언하게 되므로 코드를 훨씬 더 읽기 쉽고 테스트하기 좋게 만들어 줍니다.

### A Route Path Contract to Remember

서로 다른 출처에서 여러 값이 필요하다면 어떻게 할까요? fluo에서는 매우 간단합니다.

```typescript
@Patch('/:id')
update(
  @FromPath('id') id: string,
  @FromBody() body: UpdatePostDto,
  @FromHeader('x-api-key') apiKey: string
) {
  // 세 가지 값을 모두 함께 사용합니다.
}
```

이러한 명시적 스타일은 메서드 파라미터를 깔끔하게 유지하며, 각 데이터가 어디에서 오는지 정확히 알 수 있기 때문에 테스트하기도 훨씬 쉽습니다.

### 기본값에 대하여 (A Note on Default Values)

가끔 쿼리 파라미터나 헤더가 선택 사항일 수 있습니다. 이럴 때는 표준 TypeScript 기본값을 사용할 수 있습니다.

```typescript
@Get('/')
search(@FromQuery('limit') limit: string = '10') {
  // URL에 'limit'이 없으면 기본적으로 '10'이 됩니다.
}
```

이 방식은 fluo의 데코레이터와 완벽하게 결합되어, 코드를 관용적(idiomatic)이면서도 명확하게 유지해 줍니다.

### 바인딩에서의 타입 안전성

전송 계층은 항상 문자열을 다루지만, fluo의 바인딩 시스템은 파이프(Pipe) 기반의 변환과 함께 작동하도록 설계되었습니다. 즉, 파라미터를 `number`로 선언하고 파이프를 적용하면 URL의 문자열 ID를 적절한 TypeScript 숫자로 자동 변환할 수 있습니다. 이에 대해서는 7장에서 더 자세히 다루겠지만, 지금은 여러분의 메서드 시그니처가 매우 안전한 데이터 파이프라인의 시작점이라는 것을 기억하세요.

### A Route Path Contract to Remember

HTTP 패키지는 `/:id`처럼 리터럴 경로 세그먼트와 전체 세그먼트 파라미터를 받습니다.

`*` 같은 와일드카드나 `:id.json` 같은 혼합 패턴은 일반적인 라우트 선언으로 다루지 않습니다.

이 제약은 오히려 도움이 됩니다.

라우트 매칭을 더 단순하고 예측 가능하게 유지해 주기 때문입니다.

초보자 프로젝트에서는 영리한 라우트 기교보다 명확한 라우트 형태가 더 중요합니다.

## 5.4 Expanding FluoBlog with Read and Create Endpoints

이제 FluoBlog에 작지만 그럴듯한 게시글 흐름을 추가해 봅시다.

우선 세 가지 엔드포인트가 필요합니다.

1. `GET /posts`
2. `GET /posts/:id`
3. `POST /posts`

이 정도면 컬렉션 조회, 단일 리소스 조회, 생성까지 모두 보여 줄 수 있습니다.

```typescript
// src/posts/posts.service.ts
import { Injectable } from '@fluojs/di';

@Injectable()
export class PostsService {
  private readonly posts = [
    { id: '1', title: 'Hello fluo', body: 'First post', published: true },
  ];

  findAll() {
    return this.posts;
  }

  findById(id: string) {
    return this.posts.find((post) => post.id === id) ?? null;
  }

  create(input: { title: string; body: string }) {
    const post = {
      id: String(this.posts.length + 1),
      title: input.title,
      body: input.body,
      published: false,
    };

    this.posts.push(post);
    return post;
  }
}
```

```typescript
// src/posts/posts.controller.ts
import { Controller, FromBody, FromPath, Get, Post } from '@fluojs/http';
import { PostsService } from './posts.service';

@Controller('/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get('/')
  findAll() {
    return this.postsService.findAll();
  }

  @Get('/:id')
  findById(@FromPath('id') id: string) {
    return this.postsService.findById(id);
  }

  @Post('/')
  create(@FromBody() input: { title: string; body: string }) {
    return this.postsService.create(input);
  }
}
```

아직은 단순합니다.

그 단순함이 장점입니다.

너무 많은 새 개념을 섞지 않고도 라우트 소유권과 요청 흐름을 이야기할 수 있습니다.

### What Is Still Missing?

지금 코드는 학습용 예제로는 충분하지만 아직 견고하지는 않습니다.

본문은 아직 느슨한 객체입니다.

검증이 없습니다.

명시적인 not-found 처리도 없습니다.

응답 형태 역시 서비스 결과를 그대로 노출합니다.

### 반환값의 중요성

fluo에서는 컨트롤러 메서드에서 반환하는 것이 클라이언트로 전송됩니다. 객체를 반환하면 fluo가 자동으로 JSON으로 직렬화하고 `content-type` 헤더를 `application/json`으로 설정합니다. 문자열을 반환하면 일반 텍스트로 전송됩니다. 이러한 자동 처리 덕분에 일반적인 상황에서 수동으로 응답을 작성하는 걱정 없이 로직에 집중할 수 있습니다.

### 기본 내장된 비동기(Async) 지원

실제 애플리케이션은 데이터베이스나 외부 API를 기다려야 하는 경우가 많습니다. fluo 컨트롤러는 `Promise` 반환을 기본적으로 처리합니다. 서비스 메서드가 `async`라면 컨트롤러에서 단순히 `await`하거나 프로미스를 직접 반환하세요. fluo는 응답을 보내기 전에 비동기 처리가 완료될 때까지 기다려 주므로, 여러분의 비동기 코드를 깔끔하고 동기 코드처럼 보이게 유지할 수 있습니다.

## 5.5 Wiring the Feature into the Fastify Application

컨트롤러는 애플리케이션이 그것을 실제로 부트스트랩할 때 의미가 있습니다.

이를 위해서는 모듈 등록과 런타임 어댑터가 필요합니다.

```typescript
// src/posts/posts.module.ts
import { Module } from '@fluojs/core';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
```

```typescript
// src/app.module.ts
import { Module } from '@fluojs/core';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [PostsModule],
})
export class AppModule {}
```

```typescript
// src/main.ts
import { bootstrapFastifyApplication } from '@fluojs/platform-fastify';
import { AppModule } from './app.module';

async function main() {
  const app = await bootstrapFastifyApplication(AppModule, {
    port: 3000,
  });

  await app.listen();
}

void main();
```

Fastify 어댑터는 초보자 기본값으로 매우 좋습니다.

성능이 좋습니다.

레포 전반의 예제와도 잘 맞습니다.

또한 부트스트랩 옵션을 통해 런타임 설정을 명시적으로 유지하게 해 줍니다.

### What the Adapter Owns

어댑터는 HTTP 서버의 기계적인 부분을 담당합니다.

컨트롤러는 여전히 라우트 의도를 소유합니다.

모듈은 여전히 구성을 소유합니다.

서비스는 여전히 게시글 로직을 소유합니다.

이 분리가 바로 아키텍처적인 이점입니다.

### 왜 Fastify 어댑터인가요?

Fastify는 매우 빠르고 오버헤드가 적은 것으로 잘 알려져 있습니다. `@fluojs/platform-fastify`를 사용하면 Fastify의 모든 장점(고성능 라우팅, 풍부한 플러그인 생태계 등)을 누리면서도 깔끔한 fluo 스타일의 코드를 작성할 수 있습니다. 나중에 실력이 쌓이면, 컨트롤러나 서비스 로직을 고치지 않고도 이 어댑터를 다른 것(Bun이나 Cloudflare Workers 등)으로 교체할 수 있다는 사실을 배우게 될 것입니다.

### 환경 설정 (Environment Configuration) 예고

현재 `main.ts`에서 포트 번호를 `3000`으로 하드코딩했지만, 실제 애플리케이션은 환경 변수를 사용합니다. fluo에는 이를 쉽게 만들어 주는 전용 `@fluojs/config` 패키지가 있습니다. 지금은 단순하게 유지하되, "포트 3000"이 개발 환경을 위한 시작점일 뿐이라는 사실을 기억해 두세요.

### 첫 번째 라우트 문제 해결하기

만약 라우트가 동작하지 않는다면 다음을 확인해 보세요.

- **포트가 맞나요?** `http://localhost:3000/posts`로 접속하고 있는지 확인하세요.
- **서버를 재시작했나요?** "watch" 모드를 사용하지 않는다면 코드를 고친 후 `main.ts`를 다시 실행해야 합니다.
- **모듈이 임포트되었나요?** `AppModule`이 `PostsModule`을 임포트하고 있는지 확인하세요.
- **데코레이터가 잘 적용되었나요?** `@Controller()`와 `@Get()`이 빠지지는 않았는지 확인하세요.

이런 초기 문제들을 디버깅해 보는 과정은 요청 파이프라인이 어떻게 동작하는지에 대한 강한 직관을 기르는 데 도움이 됩니다.

## 5.6 A Beginner Route Review Checklist

검증으로 넘어가기 전에 라우트 계층을 한 번 멈추고 점검해 보세요.

이제 다음 질문에 답할 수 있어야 합니다.

1. `/posts` 접두사는 어디에서 선언되는가?
2. `GET /posts/:id`는 어떤 메서드가 처리하는가?
3. id를 경로에서 읽는 데코레이터는 무엇인가?
4. 현재 인메모리 게시글 저장을 소유한 클래스는 무엇인가?
5. posts 기능을 루트 애플리케이션에 연결하는 파일은 무엇인가?

이 답을 쉽게 찾을 수 있다면 라우트 설계는 읽기 쉬운 상태입니다.

API가 커져도 그 기준을 지키는 것이 중요합니다.

### Common Beginner Mistakes

- 컨트롤러가 위임하지 않고 하드코딩된 값을 직접 반환하는 실수.
- 하나의 메서드에 너무 많은 라우트 책임을 섞는 실수.
- 모듈에 컨트롤러를 등록하는 것을 잊는 실수.
- 검증이 생기기 전인데도 요청 페이로드를 믿어 버리는 실수.
- 나중에 직렬화가 맡아야 할 데이터 형태 문제를 컨트롤러에서 해결하려는 실수.

### Why This Chapter Stops Here

업데이트, 삭제, 인증, 문서화, 오류 처리를 한꺼번에 넣고 싶을 수 있습니다.

하지만 그러면 학습 경계가 흐려집니다.

초보자에게는 HTTP 관심사를 하나씩 더해 가는 편이 낫습니다.

먼저 라우팅.

그다음 검증.

그다음 응답 형태 조정입니다.

이 층층이 쌓는 방식이 한 번에 모든 것을 보여 주는 예제보다 더 튼튼한 머릿속 모델을 만듭니다.

## Summary
- 컨트롤러는 URL과 HTTP 동사를 읽기 쉬운 클래스 메서드에 매핑합니다.
- `@FromPath()`, `@FromQuery()`, `@FromBody()` 같은 바인딩 데코레이터는 요청 값의 출처를 명시적으로 보여 줍니다.
- 이제 FluoBlog는 게시글 목록 조회, 단건 조회, 생성 라우트를 노출합니다.
- 서비스는 재사용 가능한 게시글 로직을 맡고 컨트롤러는 얇게 유지됩니다.
- Fastify 어댑터는 기능 아키텍처를 바꾸지 않고 HTTP 서버를 부트스트랩합니다.
- 이제 프로젝트는 DTO 기반 검증을 배울 준비가 되었습니다.

## Next Chapter Preview
6장에서는 느슨한 요청 페이로드를 DTO와 검증 규칙으로 바꿉니다. 그 단계가 추가되면 FluoBlog는 들어오는 데이터를 서비스에 전달하기 전에 먼저 형태를 맞추고 검사하게 됩니다.
