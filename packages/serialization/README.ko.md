# @konekti/serialization

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti를 위한 응답값 가공(Shaping) 및 직렬화(Serialization) 엔진입니다.

`@konekti/serialization`은 애플리케이션의 **출력** 경계를 담당합니다. 내부 클래스 인스턴스나 복잡한 객체 그래프를 깨끗하고 JSON 안전한 plain 객체로 변환하는 역할을 수행합니다. `@konekti/validation`이 들어오는 데이터의 안전성을 보장한다면, 이 패키지는 나가는 데이터의 형태를 가공하고 민감한 정보가 노출되지 않도록 보장합니다.

## 핵심 개념 (The Mental Model)

Konekti는 데이터 핸들링을 두 가지 뚜렷한 단계로 나눕니다:

1. **검증 (Validation/Input)**: raw 데이터를 클래스 인스턴스로 실체화하고 규칙을 강제합니다.
2. **직렬화 (Serialization/Output)**: 클래스 인스턴스를 다시 응답용 plain 데이터로 가공합니다.

`@konekti/serialization`은 도메인 모델이나 비즈니스 로직을 수정하지 않고도 최종 응답 형태를 제어할 수 있도록 `@Exclude()`, `@Expose()`, `@Transform()` 등의 데코레이터를 제공합니다.

## @konekti/http와의 관계

이 패키지는 컨트롤러 핸들러의 반환값을 자동으로 가공하는 인터셉터를 제공합니다.

Konekti 애플리케이션에서:
1. 컨트롤러가 클래스 인스턴스(또는 그 배열)를 반환합니다.
2. `SerializerInterceptor`가 설정되어 있다면 결과를 가로챕니다.
3. `serialize()` 엔진을 실행하여 데코레이터 규칙을 적용합니다.
4. 결과물인 plain 객체가 최종적으로 HTTP JSON Body로 전송됩니다.

## 설치

```bash
pnpm add @konekti/serialization
```

## 빠른 시작

### 기본 사용법

```typescript
import { Controller, Get, UseInterceptors } from '@konekti/http';
import { Exclude, Expose, SerializerInterceptor } from '@konekti/serialization';

// @Expose({ excludeExtraneous: true })를 사용하여 명시된 필드만 포함합니다.
@Expose({ excludeExtraneous: true })
class UserView {
  @Expose()
  id: string;

  @Expose()
  email: string;

  @Exclude() // excludeExtraneous가 false이더라도 명시적으로 제외됩니다.
  passwordHash: string;

  constructor(id: string, email: string, passwordHash: string) {
    this.id = id;
    this.email = email;
    this.passwordHash = passwordHash;
  }
}

@Controller('/users')
class UsersController {
  @Get('/')
  @UseInterceptors(SerializerInterceptor)
  async getUser() {
    return new UserView('u-1', 'hello@example.com', 'shhhh');
  }
}
```

### 직렬화 전후 비교 (Before vs After)

위 컨트롤러가 `UserView` 인스턴스를 반환할 때, 직렬화된 결과물은 다음과 같습니다:

**직렬화 전 (Class Instance):**
```typescript
UserView {
  id: 'u-1',
  email: 'hello@example.com',
  passwordHash: 'shhhh'
}
```

**직렬화 후 (JSON Output):**
```json
{
  "id": "u-1",
  "email": "hello@example.com"
}
```

## 주요 API

### 데코레이터

- `@Exclude()`: 직렬화 출력에서 해당 필드를 제거합니다.
- `@Expose(options?)`: 포함할 필드를 표시합니다. 클래스 레벨에서 `{ excludeExtraneous: true }`를 사용하면 `@Expose()`가 붙은 필드만 남습니다.
- `@Transform(({ value, obj }) => newValue)`: 직렬화 과정에서 값을 동적으로 변환합니다. 반드시 동기적으로 반환해야 합니다.

### SerializerInterceptor

Konekti 앱에서 이 패키지를 사용하는 권장 방법입니다. 컨트롤러, 라우트, 또는 전역으로 등록할 수 있습니다.

**전역 등록:**
```typescript
import { bootstrapApplication } from '@konekti/runtime';
import { SerializerInterceptor } from '@konekti/serialization';

await bootstrapApplication({
  rootModule: AppModule,
  interceptors: [SerializerInterceptor],
});
```

### serialize()

인터셉터 내부에서 사용되는 수동 직렬화 헬퍼입니다.

```typescript
import { serialize } from '@konekti/serialization';

const plainObject = serialize(myClassInstance);
```

## 직렬화 규칙 (Contract)

1. **JSON 안전성**: 무한 루프를 방지하기 위해 순환 참조는 자동으로 `undefined`로 절단됩니다.
2. **참조 보존**: 같은 객체가 그래프 내 여러 번 등장하더라도 일관되게 직렬화됩니다.
3. **심볼**: 일반 객체의 열거 가능한 심볼 키(symbol-keyed) 속성도 포함됩니다.
4. **클래스**: 클래스 인스턴스의 경우 문자열 키(string-keyed) 속성만 직렬화됩니다.

## 의도된 제한 사항 (Intentional Limitations)

- **심층 인스턴스화 없음**: 직렬화는 클래스를 plain 객체로 바꿉니다. 그 반대 과정(plain 객체를 클래스로 바꾸기)은 `@konekti/validation`의 역할입니다.
- **스키마 검증 없음**: 이 패키지는 데이터를 가공할 뿐, 데이터의 옳고 그름을 검증하지 않습니다.
- **동기 방식만 지원**: 직렬화 순회 중 비동기 작업은 지원되지 않습니다. 모든 트랜스포머는 동기적이어야 합니다.
