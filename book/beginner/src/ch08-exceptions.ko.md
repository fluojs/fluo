<!-- packages: @fluojs/http -->
<!-- project-state: FluoBlog v1.5 -->

# Chapter 8. Exception Handling

## Learning Objectives
- 명시적인 예외가 왜 더 분명한 API 동작을 만드는지 이해합니다.
- `BadRequestException`, `NotFoundException` 같은 기본 HTTP 예외를 사용합니다.
- FluoBlog의 not-found 동작을 `null` 반환에서 의도적인 실패 응답으로 바꿉니다.
- 컨트롤러 책임의 끝과 서비스 예외 규칙의 시작을 구분합니다.
- 예상 가능한 오류와 예상 밖 오류를 나누는 초보자용 머릿속 모델을 만듭니다.
- posts API를 보호 라우트와 자동 문서화 단계로 이어질 수 있게 준비합니다.

## Prerequisites
- 7장을 완료했습니다.
- FluoBlog 게시글 라우트와 DTO 검증 흐름에 익숙합니다.
- 짧은 서비스 및 컨트롤러 예제를 읽는 데 익숙합니다.
- HTTP 상태 코드에 대한 기본 이해가 있습니다.

## 8.1 Why Exceptions Improve API Clarity

지금까지 FluoBlog는 요청을 검증하고 성공 응답을 다듬을 수 있게 되었습니다.

하지만 그것은 신뢰할 수 있는 API의 절반에 불과합니다.

클라이언트는 실패 동작도 예측 가능해야 합니다.

라우트가 게시글을 찾지 못했을 때 `null`을 반환하는 것도 기술적으로는 가능합니다.

하지만 강한 API 계약이라고 보기는 어렵습니다.

클라이언트는 `null`이 리소스 부재인지, 일시적 실패인지, 아니면 단순히 설계가 느슨한 것인지 추측해야 합니다.

명시적인 예외는 이 이야기를 훨씬 더 분명하게 전달합니다.

요청은 알려진 이유로 실패했습니다.

HTTP 상태 코드도 그 이유를 전달해야 합니다.

### Expected Failures vs Unexpected Failures

이 구분은 초보자에게 특히 큰 도움이 됩니다.

어떤 실패는 정상적인 애플리케이션 동작의 일부입니다.

예를 들면 잘못된 입력, 없는 리소스, 금지된 접근이 있습니다.

반면 어떤 실패는 우발적입니다.

예를 들면 코드 버그, 깨진 인프라, 처리되지 않은 상태가 있습니다.

예상 가능한 실패는 보통 의도적인 HTTP 예외가 되어야 합니다.

예상 밖 실패는 실제 서버 문제로 드러나야 합니다.

## 8.2 Built-In HTTP Exceptions in fluo

HTTP 패키지는 흔한 API 실패 상황을 위한 예외들을 기본으로 제공합니다.

예를 들면 다음과 같습니다.

- `BadRequestException` (400)
- `UnauthorizedException` (401)
- `ForbiddenException` (403)
- `NotFoundException` (404)
- `InternalServerErrorException` (500)
- `PayloadTooLargeException` (413)

이 예외들은 코드가 의도를 직접 표현하게 해 줍니다.

```typescript
import { NotFoundException } from '@fluojs/http';

function requirePost(post: unknown, id: string) {
  if (!post) {
    throw new NotFoundException(`Post ${id} was not found.`);
  }

  return post;
}
```

이 코드는 전송 계층의 사고처럼 읽히지 않습니다.

알려진 리소스 부재 상황을 애플리케이션이 의도적으로 표현하고 있습니다.

선택한 예외가 HTTP 계층이 어떤 응답을 내려야 하는지도 설명해 줍니다.

### Why Named Exceptions Matter

이름 있는 예외는 흔한 API 실패 상황에서 막연한 generic error보다 낫습니다.

독자가 의도를 더 빨리 이해할 수 있게 해 줍니다.

최종 HTTP 상태 코드와도 더 명확하게 연결됩니다.

이 점은 디버깅과 클라이언트 기대치 모두에 중요합니다.

## 8.3 Making FluoBlog Not-Found Behavior Explicit

5장에서는 `findById()`가 게시글이 없을 때 `null`을 반환했습니다.

이제 그 동작을 명시적으로 바꿔 봅시다.

```typescript
// src/posts/posts.service.ts
import { NotFoundException } from '@fluojs/http';
import { Injectable } from '@fluojs/di';

@Injectable()
export class PostsService {
  private readonly posts = [
    { id: '1', title: 'Hello fluo', body: 'First post', published: true },
  ];

  findById(id: string) {
    const post = this.posts.find((item) => item.id === id);

    if (!post) {
      // 이 예외를 던지면 실행이 즉시 중단되고
      // fluo의 예외 처리 흐름이 시작됩니다.
      throw new NotFoundException(`Post ${id} was not found.`);
    }

    return post;
  }
}
```

이제 컨트롤러는 `null`을 해석할 필요가 없습니다.

게시글이 없다는 규칙을 서비스가 직접 소유합니다.

이런 방식이 여러 라우트에서 같은 동작을 재사용하기도 더 쉽습니다.

### Why the Service Owns This Rule

물론 컨트롤러도 예외를 던질 수 있습니다.

그렇다고 모든 예외가 컨트롤러에 있어야 하는 것은 아닙니다.

여러 라우트가 같은 조회 동작에 의존한다면 서비스가 더 적절한 위치인 경우가 많습니다.

서비스는 “게시글은 반드시 존재해야 한다”는 의미를 이해합니다.

컨트롤러는 라우트 진입점을 이해합니다.

이 역시 앞선 장에서 반복해 온 관심사 분리 패턴입니다.

## 8.4 Validation Errors and Bad Requests

검증 실패도 흔한 예상 가능 오류 경로입니다.

요청이 서비스에 도달하기 전에 DTO 검증이 이미 입력 경계를 보호해야 합니다.

6장이 이번 장보다 먼저 온 이유가 바로 이것입니다.

이제 API는 잘못된 페이로드를 더 자신 있게 거절할 수 있습니다.

### What Makes a Request “Bad”?

bad request는 서버 크래시가 아닙니다.

클라이언트가 라우트 계약을 만족하지 않는 데이터를 보냈다는 뜻입니다.

예를 들면 다음과 같습니다.

- 필수 필드 누락,
- 잘못된 스칼라 타입,
- 잘못된 길이,
- 잘못된 페이로드 구조.

`@fluojs/validation`에서 에러를 발견하면 단순히 멈추지 않습니다. 구조화된 예외(주로 `BadRequestException` 계열)를 던지고, HTTP 계층은 이를 읽기 쉬운 응답으로 변환합니다 (`docs/concepts/error-responses.md` 참고).

핵심은 책임 소재입니다.

클라이언트가 요청을 고쳐서 다시 시도할 수 있어야 합니다.

이 점이 내부 서버 문제와 다릅니다.

### A Useful Beginner Habit

API 호출이 실패했을 때는 다음을 질문해 보세요.

1. 클라이언트가 계약을 어겼는가?
2. 애플리케이션이 알려진 비즈니스 규칙을 거절했는가?
3. 아니면 서버 내부에서 예상 밖 문제가 터졌는가?

이 세 질문이 올바른 예외 스타일을 선택하는 데 큰 도움이 됩니다.

## 8.5 Translating Business Rules into HTTP Failures

모든 예외가 존재 여부와 관련된 것은 아닙니다.

정책과 관련된 예외도 있습니다.

예를 들어 FluoBlog가 초보자용 update 라우트에서는 이미 published된 게시글을 수정할 수 없다고 정했다고 해 봅시다.

이것은 비즈니스 규칙입니다.

서비스가 그 규칙을 분명하게 표현할 수 있습니다.

```typescript
import { BadRequestException, NotFoundException } from '@fluojs/http';

update(id: string, input: UpdatePostDto) {
  const post = this.posts.find((item) => item.id === id);

  if (!post) {
    throw new NotFoundException(`Post ${id} was not found.`);
  }

  if (post.published) {
    throw new BadRequestException('Published posts cannot be edited here.');
  }

  Object.assign(post, input);
  return post;
}
```

이렇게 하면 API 계약이 더 강해집니다.

클라이언트는 “그 게시글이 없다”와 “이 라우트에서는 그 작업이 허용되지 않는다”를 구분할 수 있습니다.

서로 다른 실패는 같은 generic error 뒤에 숨어서는 안 됩니다.

### What About `InternalServerErrorException`?

이 예외는 신중하게 써야 합니다.

예상 가능한 비즈니스 결과라면 더 구체적인 예외 타입이 적합한 경우가 많습니다.

`InternalServerErrorException`은 유효한 요청을 서버가 정말 처리하지 못했을 때를 위해 남겨 두는 편이 좋습니다.

모든 것을 internal error로 만들면 클라이언트는 유용한 정보를 잃습니다.

## 8.6 Building a Practical Beginner Error Checklist

이제 FluoBlog에는 작은 오류 정책을 세울 만큼의 동작이 쌓였습니다.

새 라우트를 추가할 때마다 다음 체크리스트를 써 보세요.

1. 리소스가 없으면 어떻게 해야 하는가?
2. 페이로드가 DTO 계약을 어기면 어떻게 해야 하는가?
3. 비즈니스 규칙이 동작을 막으면 어떻게 해야 하는가?
4. 어떤 오류는 클라이언트에게 분명히 설명되어야 하는가?
5. 어떤 실패가 진짜 예상 밖 서버 문제인가?

이 체크리스트가 유용한 이유는 오류 처리를 설계 활동으로 바꾸어 주기 때문입니다.

실패를 사후 처리로 취급하지 않게 됩니다.

대신 HTTP 계약의 일부로 다루게 됩니다.

### Common Beginner Mistakes with Exceptions

- 모든 상황에 `null`을 반환하고 명시적 실패를 고르지 않는 실수.
- 예상 가능한 클라이언트 실수에 generic `Error`를 던지는 실수.
- 모든 오류 결정을 컨트롤러 안에 몰아넣는 실수.
- 검증 실패와 비즈니스 규칙 실패를 같은 것으로 다루는 실수.
- 예측 가능한 조건에 internal error 응답을 사용하는 실수.

### What FluoBlog Gains Here

이제 FluoBlog는 일이 잘못되었을 때도 더 분명하게 말합니다.

그 중요성은 happy path 못지않습니다.

클라이언트는 게시글이 없는 상황을 더 잘 해석할 수 있습니다.

잘못된 입력과 없는 리소스를 구분할 수 있습니다.

서비스 계층도 자신이 강제하는 규칙을 더 정직하게 드러내게 됩니다.

## Summary
- 명시적인 HTTP 예외는 API 실패를 더 이해하기 쉽고 문서화하기 쉽게 만듭니다.
- 없는 리소스에 대해 조용히 `null`을 반환하는 것보다 `NotFoundException`이 더 강한 계약입니다.
- 검증 오류와 비즈니스 규칙 오류는 mysterious crash가 아니라 예상 가능한 실패로 다뤄야 합니다.
- 재사용 가능한 예외 규칙은 컨트롤러보다 서비스가 더 잘 소유하는 경우가 많습니다.
- FluoBlog는 이제 게시글 조회와 수정 실패 상황을 더 의도적으로 표현합니다.
- 이제 프로젝트는 라우트 보호와 재사용 가능한 요청/응답 파이프라인 훅을 배울 준비가 되었습니다.

## Next Chapter Preview
9장에서는 가드와 인터셉터를 추가합니다. 이를 통해 FluoBlog는 특정 라우트를 보호하고, 재사용 가능한 요청 파이프라인 동작을 도입하며, 보안 스타일 검사를 API 흐름에 연결할 수 있게 됩니다.
