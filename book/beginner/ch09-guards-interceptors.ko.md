<!-- packages: @fluojs/http, @fluojs/serialization -->
<!-- project-state: FluoBlog v1.6 -->

# Chapter 9. Guards and Interceptors

이 장은 FluoBlog 요청 파이프라인에 guard와 interceptor를 배치해 재사용 가능한 보호 규칙과 응답 흐름을 만드는 방법을 설명합니다. Chapter 8이 실패 응답을 명확히 했다면, 이 장은 어떤 요청을 통과시키고 어떻게 감쌀지를 정리합니다.

## Learning Objectives
- HTTP 파이프라인에서 guard와 interceptor의 차이를 이해합니다.
- FluoBlog의 쓰기 라우트를 보호하기 위해 guard를 사용합니다.
- 재사용 가능한 응답 또는 로깅 동작을 적용하기 위해 interceptor를 사용합니다.
- guard는 “이 요청을 진행시켜도 되는가?”에 답하고 interceptor는 “이 요청 흐름을 어떻게 감쌀 것인가?”에 답한다는 점을 배웁니다.
- 개별 컨트롤러 메서드 밖으로 인가 검사와 cross-cutting 동작을 분리합니다.
- 다음 장에서 더 명확한 OpenAPI 문서를 만들 수 있도록 API를 준비합니다.

## Prerequisites
- Chapter 8 완료.
- FluoBlog 게시글 라우트와 예외 처리 흐름에 익숙합니다.
- 공개 엔드포인트와 인증된 엔드포인트의 차이를 기본적으로 이해합니다.
- 데코레이터 중심 예제를 읽는 데 익숙합니다.

## 9.1 Where Guards and Interceptors Fit in the Request Pipeline

이제 FluoBlog는 요청을 라우팅하고, 입력을 검증하고, 출력을 다듬고, 의도적인 예외를 던질 수 있습니다. 다음 질문은 파이프라인 제어입니다. 모든 요청이 그대로 진행되어도 되는가, 그리고 핸들러 주변에서 재사용 가능한 동작을 실행해야 하는가?

이 지점에서 guard와 interceptor가 등장합니다. 이 둘의 차이는 신중하게 익힐 가치가 있습니다. guard는 요청이 계속 진행될 수 있는지 결정하고, interceptor는 핸들러를 감싸면서 전후에 재사용 가능한 로직을 적용할 수 있습니다.

### The Request Lifecycle

정확한 순서를 이해하는 것은 디버깅과 아키텍처 설계에 필수적입니다. 요청이 fluo 애플리케이션에 도달하면 현재 HTTP 런타임은 다음과 같은 흐름으로 요청을 실행합니다.

1.  **Middleware**: 전역 middleware가 먼저 실행되고, 라우트가 매칭되면 해당 핸들러에 연결된 module middleware가 이어집니다.
2.  **Guards**: guard 체인이 요청 계속 여부를 결정합니다.
3.  **Interceptors**: interceptor 체인이 핸들러 실행을 감싸는 형태로 구성됩니다.
4.  **Controller invocation**: 선언된 `@RequestDto(...)`가 있으면 이 단계에서 DTO 바인딩과 validation이 함께 수행됩니다.
5.  **Controller Handler**: 컨트롤러 메서드는 현재 요청 입력과 `RequestContext`를 기준으로 비즈니스 로직을 실행합니다.
6.  **Response writing / error normalization**: 성공 응답은 직렬화되어 기록되고, 중간에 발생한 오류는 HTTP 오류 응답으로 정규화됩니다.

이러한 계층적 접근 방식은 요청이 권한이 없는 경우 Guard 단계에서 조기에 실패하게 하여 시스템 리소스를 절약해 줍니다.

### A Simple Mental Model

다음 두 질문으로 생각해 보세요. 질문이 “이 요청이 허용되는가?”라면 guard를 떠올리면 되고, “이 요청을 어떻게 관찰하고 변형하고 감쌀 것인가?”라면 interceptor를 떠올리면 됩니다. 이 구분은 파이프라인 훅을 고를 때 가장 먼저 확인할 기준입니다.

여기서 중요한 파이프라인 규칙이 있습니다: **Guard는 Interceptor보다 먼저 실행됩니다.** interceptor는 guard를 통과한 뒤에야 핸들러 실행을 감쌀 수 있고, DTO 바인딩과 validation도 그 내부의 컨트롤러 호출 단계에서 일어납니다.

이 모델이 모든 것을 설명하는 것은 아니지만, 지금 단계의 요청 파이프라인을 설계하기에는 충분합니다. 먼저 허용 여부를 판단하고, 그다음 핸들러 주변의 공통 동작을 배치한다고 생각하면 흐름을 읽기 쉽습니다.

## 9.2 Protecting Write Routes with a Guard

FluoBlog가 읽기 라우트는 공개하지만 쓰기 라우트는 간단한 admin 헤더를 요구한다고 가정해 봅시다.

guard의 역할을 설명하기에 적절한 상황입니다.

```typescript
import { ForbiddenException, type RequestContext } from '@fluojs/http';

export class AdminGuard {
  // input은 (있는 경우) 검증된 요청 본문입니다.
  canActivate(input: unknown, ctx: RequestContext) {
    const role = ctx.request.headers['x-role'];

    if (role !== 'admin') {
      // 8장에서 배운 구조화된 예외를 던집니다.
      // 이는 403 Forbidden 응답으로 변환되어 클라이언트에 전달됩니다.
      throw new ForbiddenException('Admin role required.');
    }

    // true를 반환하면 fluo 파이프라인이 계속 진행됩니다.
    return true;
  }
}
```

그다음 이 guard를 컨트롤러나 특정 메서드에 적용합니다.

```typescript
import { Controller, Post, RequestDto, UseGuards } from '@fluojs/http';

@Controller('/posts')
export class PostsController {
  @Post('/')
  @UseGuards(AdminGuard)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }
}
```

이제 라우트 계약이 더 분명해집니다. 게시글 읽기는 공개이고, 게시글 생성이나 수정은 먼저 guard 검사를 통과해야 합니다. 이 차이가 데코레이터 줄에 드러나므로 라우트 본문을 읽기 전에도 보호 여부를 확인할 수 있습니다.

### Why a Guard Is Better Than an Inline Header Check

물론 컨트롤러도 헤더를 직접 검사할 수 있고, 한 라우트만 놓고 보면 동작은 할 것입니다. 하지만 확장성은 좋지 않습니다. guard는 재사용 가능하고, 핸들러 본문에서 인가 스타일 검사를 분리해 주며, 데코레이터 줄에서 의도를 바로 드러내 줍니다.

### Multi-Guard Execution

실제 애플리케이션에서는 여러 가지 검사가 필요할 수 있습니다. fluo는 여러 가드를 체이닝(chaining)할 수 있게 해 줍니다.

```typescript
@Post('/')
@UseGuards(AuthGuard, RoleGuard, BlacklistGuard)
@RequestDto(CreatePostDto)
create(input: CreatePostDto) {
  return this.postsService.create(input);
}
```

이 경우 fluo는 가드들을 순서대로 실행합니다. 만약 **하나라도** 가드가 `false`를 반환하거나 예외를 던지면 요청은 즉시 중단됩니다. 이를 통해 복잡한 인가 규칙을 모듈화하고 관리하기 쉽게 만들 수 있습니다.

## 9.3 Using an Interceptor for Reusable Response Workflow

interceptor는 응답 shaping, 로깅, 타이밍 측정, 그 외 재사용 가능한 요청 흐름 관심사에 유용합니다. 여러분은 이미 7장에서 한 예를 보았습니다. `SerializerInterceptor`는 나가는 응답을 다듬으며, 이 한 가지 사례만으로도 interceptor가 단지 로깅용만은 아니라는 사실을 알 수 있습니다. interceptor는 재사용 가능한 workflow hook 전반을 위한 장치입니다.

```typescript
import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';

@Controller('/posts')
@UseInterceptors(SerializerInterceptor)
export class PostsController {
  @Get('/')
  findAll() {
    return this.postsService.findAllPublic();
  }
}
```

이 구조가 강력한 이유는 컨트롤러가 라우트 의도에 집중할 수 있기 때문입니다. 모든 반환값을 컨트롤러가 일일이 직렬화하지 않아도 되고, interceptor가 핸들러 주변에서 공통 규칙을 적용합니다. 이것이 바로 Part 1이 계속 쌓아 온 재사용 가능한 HTTP 흐름입니다.

### Another Beginner-Friendly Interceptor Example

아주 단순한 타이밍 또는 로깅 interceptor를 상상해 볼 수도 있습니다.

```typescript
export class RequestLogInterceptor {
  // next는 핸들러(또는 다음 interceptor)의 실행 결과를 반환하는 함수입니다.
  async intercept(next: () => Promise<unknown>) {
    const startedAt = Date.now();
    
    // 핸들러를 실행하고 결과를 기다립니다.
    const result = await next();
    
    // 핸들러 실행이 끝난 후 걸린 시간을 관찰할 수 있습니다.
    console.log(`Request finished in ${Date.now() - startedAt}ms`);
    
    // 결과(또는 변형된 결과)를 반드시 반환해야 합니다.
    return result;
  }
}
```

### Transforming the Response

인터셉터의 가장 강력한 기능 중 하나는 반환된 데이터를 변형하는 능력입니다. 모든 성공적인 응답을 표준 "데이터 봉투(envelope)"로 감싸고 싶다고 가정해 봅시다.

```typescript
export class TransformInterceptor {
  async intercept(next: () => Promise<unknown>) {
    const data = await next();
    
    // 원래 결과를 일관된 객체로 감쌉니다.
    return {
      success: true,
      timestamp: new Date().toISOString(),
      data,
    };
  }
}
```

이제 단순히 게시글 객체만 반환하는 대신, API는 다음과 같이 반환하게 됩니다.

```json
{
  "success": true,
  "timestamp": "2026-04-21T10:00:00Z",
  "data": { "id": "1", "title": "Hello Fluo" }
}
```

이렇게 하면 애플리케이션 전체에 걸쳐 프론트엔드 개발자들에게 일관된 응답 계약(contract)을 보장할 수 있습니다.

## 9.4 Applying Guards and Interceptors to FluoBlog
이제 이 개념들을 posts 기능에 적용해 봅시다.

`GET /posts`, `GET /posts/:id` 같은 공개 조회 라우트는 열어 둡니다.

`POST /posts`, `PATCH /posts/:id` 같은 쓰기 라우트는 보호합니다.

응답이 계속 깔끔하게 유지되도록 컨트롤러에는 직렬화 interceptor를 유지합니다.

```typescript
import {
  Controller,
  Get,
  Patch,
  Post,
  RequestDto,
  type RequestContext,
  UseGuards,
  UseInterceptors,
} from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';

@Controller('/posts')
@UseInterceptors(SerializerInterceptor)
export class PostsController {
  @Get('/')
  findAll() {
    return this.postsService.findAllPublic();
  }

  @Get('/:id')
  findById(id: string) {
    return this.postsService.findPublicById(id);
  }

  @Post('/')
  @UseGuards(AdminGuard)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }

  @Patch('/:id')
  @UseGuards(AdminGuard)
  @RequestDto(UpdatePostDto)
  update(input: UpdatePostDto, ctx: RequestContext) {
    return this.postsService.update(ctx.request.params.id, input);
  }
}
```

이 구조는 초기 아키텍처로도 충분히 건강합니다. 공개 라우트의 가독성이 유지되고, 보호 규칙도 명확하며, cross-cutting 출력 동작은 재사용 가능한 형태로 남습니다. 즉 라우트 본문은 핵심 작업에 집중하고 파이프라인 concern은 데코레이터와 훅으로 분리됩니다.

### Why This Is Better Than Manual Repetition

guard와 interceptor가 없다면 모든 쓰기 핸들러가 같은 헤더 검사를 반복해야 하고, 모든 읽기 핸들러가 같은 직렬화 로직을 반복해야 할 수도 있습니다. 그 반복은 쉽게 drift를 만듭니다. 어떤 라우트는 업데이트되고 어떤 라우트는 뒤처지기 때문입니다. 데코레이터 기반 파이프라인 훅은 이런 불일치를 줄여 줍니다.

## 9.5 Request Context and Deep Helpers

HTTP 패키지 문서에서 특히 도움이 되는 디테일이 하나 있습니다.

fluo는 request context 유틸리티를 통해 현재 활성 요청에 접근할 수 있게 해 줍니다. 즉 깊은 헬퍼 함수까지 매번 request 객체를 직접 전달하지 않아도 되는 경우가 있습니다. 이 기능은 요청과 밀접한 공통 로직을 더 정돈된 위치에 둘 수 있게 해 줍니다.

### Why This Matters for Guards and Interceptors

guard와 interceptor는 전송 세부사항에 가까운 위치에서 동작하는 경우가 많고, 헤더, request id, 그 밖의 context-aware 값을 필요로 할 수 있습니다. 프레임워크는 그런 정보를 구조적으로 꺼낼 수 있는 방식을 제공합니다. 덕분에 cross-cutting 코드를 더 정돈해서 배치할 수 있고, 서비스 계층 전체가 raw transport concern으로 오염되는 것도 막을 수 있습니다.

### Beginner Caution

request context에 접근할 수 있다고 해서 모든 헬퍼가 transport-aware가 되어야 하는 것은 아닙니다. 정말로 요청 지향적인 concern에서만 사용하고, 가능한 한 핵심 비즈니스 로직은 도메인 동작에 집중시키세요. 그 절제가 깔끔한 경계를 지켜 주며, 나중에 런타임이나 전송 계층이 바뀌어도 서비스 코드를 덜 흔들리게 합니다.

## 9.6 A Practical Review Checklist for Pipeline Hooks

이 시점의 FluoBlog는 꽤 의미 있는 요청 파이프라인을 갖게 되었습니다.

guard, interceptor, 일반 서비스 로직 중 무엇을 써야 할지 고민할 때 다음 체크리스트를 활용해 보세요.

1. 핸들러가 실행되기 전에 허용/거부를 판단하는 문제인가?
2. 핸들러 실행을 감싸는 재사용 가능한 동작인가?
3. 사실은 서비스에 있어야 할 비즈니스 로직인가?
4. 여러 라우트가 같은 규칙을 필요로 하는가?
5. 데코레이터 줄이 라우트 계약을 더 읽기 쉽게 만드는가?

흔한 실수는 다음과 같습니다.

- 모든 컨트롤러 메서드에 인가 검사를 직접 작성하는 실수.
- guard가 맡아야 할 허용/거부 판단을 interceptor로 처리하려는 실수.
- 핵심 도메인 규칙을 요청 파이프라인 헬퍼 안에 넣는 실수.
- 응답 직렬화가 이미 훌륭한 interceptor 예제라는 점을 잊는 실수.
- transport concern을 관련 없는 서비스 깊숙이 섞어 넣는 실수.

### What FluoBlog Gains Here

이제 FluoBlog는 더 현실적인 HTTP 파이프라인을 갖습니다. 공개 조회 라우트는 단순하게 유지되고, 쓰기 라우트는 보호할 수 있으며, 응답 shaping은 중앙화된 상태로 유지할 수 있습니다. 이 API는 점점 단순 데모보다 작지만 유지보수 가능한 백엔드에 가까워지고 있습니다.

## Summary
- guard는 요청이 계속 진행될 수 있는지 결정합니다.
- interceptor는 핸들러 실행을 감싸 재사용 가능한 요청/응답 동작을 적용합니다.
- fluo 요청 파이프라인에서 guard는 interceptor보다 먼저 실행됩니다.
- FluoBlog는 이제 공개 조회를 열어 두면서 쓰기 라우트를 보호할 수 있습니다.
- `SerializerInterceptor`는 응답 측 파이프라인 재사용의 실용적인 예시로 계속 남아 있습니다.
- request context를 사용하는 헬퍼는 유용하지만 좋은 서비스 경계를 대신할 수는 없습니다.
- 이제 프로젝트는 이러한 라우트와 동작을 반영한 자동 API 문서를 만들 준비가 되었습니다.

## Next Chapter Preview
10장에서는 FluoBlog용 OpenAPI 문서를 생성합니다. 이제 라우트, DTO, 예외, 보호 엔드포인트가 하나의 일관된 API 서사를 이루었으니, 다음 단계는 그 작업을 기계가 읽을 수 있는 문서와 Swagger UI로 드러내는 일입니다.
