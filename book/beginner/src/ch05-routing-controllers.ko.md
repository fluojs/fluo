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

FluoBlog에서 게시글 API는 첫 기능으로 매우 자연스럽습니다.

독자가 빠르게 이해할 수 있습니다.

또한 이후 장에서 검증, 직렬화, 예외, 가드, OpenAPI를 차근차근 붙일 공간도 제공합니다.

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

이 한 가지 습관만으로도 이후의 많은 정리 작업을 예방할 수 있습니다.

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

이 점은 Part 0에서 본 fluo의 더 큰 철학과도 이어집니다.

중요한 연결은 읽을 수 있어야 합니다.

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

하지만 이것은 실수가 아닙니다.

다음 장들에서 순서대로 배울 계획된 빈칸입니다.

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
