<!-- packages: @fluojs/http, @fluojs/serialization -->
<!-- project-state: FluoBlog v1.4 -->

# Chapter 7. Response Serialization

## Learning Objectives
- 응답 DTO가 요청 DTO와 왜 다른지 이해합니다.
- `@Expose()`, `@Exclude()`, `@Transform()`으로 HTTP 출력 형태를 다듬습니다.
- FluoBlog API에서 내부 필드가 새어 나가지 않도록 막습니다.
- `SerializerInterceptor`가 응답 shaping을 자동으로 적용하는 방식을 배웁니다.
- 내부 엔티티와 전송용 모델의 차이를 인식합니다.
- 더 나은 예외 처리와 API 문서화를 위한 기반을 준비합니다.

## Prerequisites
- 6장을 완료했습니다.
- FluoBlog의 create 및 update DTO에 익숙합니다.
- 클래스 기반 데코레이터에 대한 기본적인 이해가 있습니다.
- API의 응답 측면을 입력과 분리해서 생각해 볼 준비가 되어 있습니다.

## 7.1 Why Successful Responses Need Their Own Design

입력 검증은 잘못된 요청으로부터 애플리케이션을 보호합니다.

응답 직렬화는 의도치 않은 과다 노출로부터 클라이언트를 보호합니다.

두 문제는 서로 관련이 있습니다.

하지만 같은 문제는 아닙니다.

초보자는 서비스 객체를 그대로 반환해도 괜찮다고 쉽게 생각합니다.

하지만 내부 필드가 생기는 순간 그 가정은 위험해집니다.

게시글 레코드에는 draft 정보, 내부 id, 작성자 메모, 구현 세부사항 같은 값이 들어 있을 수 있습니다.

모든 필드가 공개 API에 속하는 것은 아닙니다.

그래서 응답 DTO가 중요합니다.

클라이언트가 실제로 무엇을 보아야 하는지 결정하게 해 주기 때문입니다.

### Request DTO vs Response DTO

요청 DTO는 “어떤 입력이 애플리케이션 안으로 들어올 수 있는가?”에 답합니다.

응답 DTO는 “어떤 출력이 애플리케이션 밖으로 나가야 하는가?”에 답합니다.

두 관심사는 겹칠 수 있습니다.

하지만 동일하다고 가정해서는 안 됩니다.

둘을 분리해 두면 나중에 내부 코드를 바꿀 자유가 더 커집니다.

## 7.2 Building a PublicPostDto

FluoBlog가 공개 API에 그대로 노출하면 안 되는 필드를 포함한 게시글을 저장한다고 가정해 봅시다.

```typescript
class PostRecord {
  id = '';
  title = '';
  body = '';
  published = false;
  authorEmail = '';
  internalNotes = '';
}
```

컨트롤러가 이 객체를 그대로 반환하면 모든 필드가 클라이언트로 새어 나갈 수 있습니다.

대신 공개용 출력 모델을 정의합니다.

```typescript
import { Exclude, Expose, Transform } from '@fluojs/serialization';

@Expose({ excludeExtraneous: true })
export class PublicPostDto {
  @Expose()
  id = '';

  @Expose()
  title = '';

  @Expose()
  body = '';

  @Expose()
  published = false;

  @Expose()
  @Transform((value) => value.trim())
  summary = '';

  @Exclude()
  internalNotes = '';
}
```

이 클래스는 전송 계약을 표현합니다.

노출된 필드만 응답에 포함됩니다.

내부 세부사항은 내부에 남습니다.

### Why `excludeExtraneous` Is Beginner-Friendly

`@Expose({ excludeExtraneous: true })`는 노출 허용 중심의 기본값을 만듭니다.

즉 안전한 기본값은 제외입니다.

앱 밖으로 나가야 하는 필드만 명시적으로 허용합니다.

초보자에게는 숨겨야 할 필드를 모두 기억하는 방식보다 이 기본값이 더 이해하기 쉽습니다.

## 7.3 Serializing Controller Results Automatically

직렬화 패키지는 `serialize(value)`로 값을 직접 가공할 수 있습니다.

HTTP 핸들러에서는 인터셉터를 쓰는 패턴이 더 자연스럽습니다.

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

이제 컨트롤러는 DTO 인스턴스나 직렬화를 의도한 데이터를 반환할 수 있습니다.

인터셉터가 응답 형태 조정 단계를 자동으로 적용합니다.

덕분에 컨트롤러는 포맷팅 세부사항보다 조정 역할에 집중할 수 있습니다.

### Why an Interceptor Is a Good Fit

직렬화는 cross-cutting concern입니다.

여러 라우트가 모두 필요로 할 수 있습니다.

인터셉터는 핸들러 실행과 응답 쓰기 사이에 위치하므로 재사용 가능한 응답 shaping을 넣기에 자연스러운 장소입니다.

이 위치 덕분에 엔드포인트 전반에서 일관된 동작을 만들 수 있습니다.

## 7.4 Updating FluoBlog to Return Public Output

이제 posts 기능이 공개 API처럼 느껴지도록 바꿔 봅시다.

서비스는 여전히 더 풍부한 내부 레코드를 다룰 수 있습니다.

컨트롤러는 응답 지향 DTO를 반환하면 됩니다.

```typescript
// src/posts/public-post.dto.ts
import { Expose } from '@fluojs/serialization';

@Expose({ excludeExtraneous: true })
export class PublicPostDto {
  @Expose()
  id = '';

  @Expose()
  title = '';

  @Expose()
  body = '';

  @Expose()
  published = false;
}
```

```typescript
// src/posts/posts.service.ts
import { PublicPostDto } from './public-post.dto';

findAllPublic() {
  return this.posts.map((post) =>
    Object.assign(new PublicPostDto(), {
      id: post.id,
      title: post.title,
      body: post.body,
      published: post.published,
    }),
  );
}
```

이 구조는 FluoBlog에 더 나은 관심사 분리를 제공합니다.

내부 레코드 구조는 나중에 바뀔 수 있습니다.

공개 응답 계약은 안정적으로 유지할 수 있습니다.

### Where `@Transform()` Helps

가끔 공개 응답에는 가벼운 마무리 변환이 필요합니다.

summary 값을 trim해야 할 수도 있습니다.

사용자 이름을 대문자로 보여 주고 싶을 수도 있습니다.

파생된 표시 값을 포맷해야 할 수도 있습니다.

`@Transform()`은 이런 동기식 경계 변환을 위해 존재합니다.

도메인 로직을 대신하는 기능은 아닙니다.

응답 경계용 도구입니다.

## 7.5 Safe Serialization Details Worth Knowing

직렬화기는 애플리케이션이 커질수록 중요해지는 몇 가지 성질을 갖고 있습니다.

재귀적인 객체 순회를 처리합니다.

무한 재귀를 피하기 위해 순환 참조를 안전하게 끊습니다.

기반 클래스의 데코레이터 계약을 상속합니다.

모든 것을 데코레이터 인스턴스로 가정하지 않고 일반 객체도 신중하게 다룹니다.

이 디테일은 다소 고급스럽게 들릴 수 있습니다.

초보자에게는 하나의 실용적인 결론으로 충분합니다.

직렬화기는 단순 편의 함수가 아니라 신뢰할 수 있는 경계 도구로 설계되었습니다.

### What It Does Not Promise

직렬화가 모든 값을 자동으로 엄격한 JSON 원시값으로 바꾸어 준다는 뜻은 아닙니다.

`Date`나 `bigint` 같은 값은 클라이언트 계약에 따라 별도 정규화가 필요할 수 있습니다.

이 점은 전송 설계가 여전히 고민이 필요한 문제라는 사실을 상기시켜 줍니다.

데코레이터는 도움을 줍니다.

하지만 명확한 API 설계를 대신해 주지는 않습니다.

## 7.6 Common Beginner Patterns and Mistakes

팀이 응답 DTO를 처음 도입하면 몇 가지 패턴이 빠르게 나타납니다.

좋은 패턴은 서비스나 매퍼가 공개 DTO 생성을 인지하도록 하는 것입니다.

약한 패턴은 내부 객체를 아무 생각 없이 반환하고 민감한 필드가 안 새길 바라기만 하는 것입니다.

다음 체크리스트를 써 보세요.

1. 이 라우트는 전송용 DTO를 반환하는가, 아니면 내부 레코드를 반환하는가?
2. 민감한 필드는 기본적으로 제외되는가?
3. 응답 shaping은 여러 엔드포인트에서 재사용 가능한가?
4. 작은 표시용 변환은 컨트롤러가 아니라 경계에서 일어나는가?

흔한 실수는 다음과 같습니다.

- 생각 없이 요청 DTO를 응답 DTO로도 사용하는 실수.
- 내부 구현 필드를 우연히 노출하는 실수.
- 응답 포맷팅 로직을 모든 컨트롤러 메서드 안에 직접 넣는 실수.
- 저장 모델이 바뀌어도 공개 계약은 안정적으로 유지되어야 한다는 점을 잊는 실수.

### What FluoBlog Gains Here

이제 FluoBlog는 더 깔끔한 공개 얼굴을 갖게 되었습니다.

앱이 더 이상 “내부 객체가 이렇게 생겼으니 API도 이렇게 보이면 된다”라고 말하지 않습니다.

대신 “API는 의도적으로 설계된 응답 계약을 가진다”라고 말합니다.

초보자 프로젝트로서는 아주 성숙한 진전입니다.

그리고 다음 장들도 더 쉬워집니다.

성공 응답이 정돈되면 오류 처리와 API 문서화도 훨씬 더 분명해집니다.

## Summary
- 응답 DTO는 의도치 않은 필드 노출로부터 클라이언트를 보호합니다.
- `@Expose()`, `@Exclude()`, `@Transform()`은 외부로 나가는 API 데이터를 다듬습니다.
- `SerializerInterceptor`는 자동 응답 shaping을 위한 자연스러운 HTTP 통합 지점입니다.
- 이제 FluoBlog는 내부 게시글 레코드와 공개 게시글 응답을 구분합니다.
- 직렬화는 단순 포맷팅이 아니라 경계 관심사입니다.
- 이제 프로젝트는 성공과 실패 응답을 모두 더 의도적으로 설계할 준비가 되었습니다.

## Next Chapter Preview
8장에서는 예외 처리에 집중합니다. FluoBlog가 성공 응답을 더 깔끔하게 만들었으니, 이제 not-found, bad request, server error 같은 실패 응답도 같은 수준으로 의도적으로 다룰 수 있습니다.
