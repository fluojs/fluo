# @fluojs/serialization

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 클래스 기반 응답 직렬화 및 데코레이터 인지형 재귀 출력 가공 엔진입니다.

`@fluojs/serialization`은 애플리케이션의 **출력 경계(Output Boundary)**를 담당합니다. 내부 클래스 인스턴스나 복잡한 객체 그래프를 데코레이터 규칙이 반영된 일반 응답 형태로 변환하는 선언적인 방법을 제공합니다. 이를 통해 API 응답에 의도한 데이터만 노출되도록 보장합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
  - [민감한 데이터 제외](#민감한-데이터-제외)
  - [값 변환 (Transforming)](#값-변환-transforming)
  - [순환 참조 처리](#순환-참조-처리)
  - [HTTP 인터셉터와 함께 사용](#http-인터셉터와-함께-사용)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/serialization
```

## 사용 시점

- JSON 응답에 포함될 클래스 속성을 정밀하게 제어하고 싶을 때.
- 비밀번호나 내부 ID와 같은 민감한 필드를 출력에서 숨겨야 할 때.
- 직렬화 과정에서 속성 값을 변환해야 할 때 (예: 날짜 형식 지정, 내부 열거형 매핑).
- 무한 루프를 유발할 수 있는 복잡한 객체 그래프를 안전하게 직렬화해야 할 때.

## 빠른 시작

DTO나 엔티티 클래스에 데코레이터를 적용하고 `serialize` 함수 또는 `SerializerInterceptor`를 사용합니다.

```typescript
import { Expose, Exclude, Transform, serialize } from '@fluojs/serialization';

class UserEntity {
  @Expose()
  id: string = '';

  @Expose()
  @Transform((val) => val.toUpperCase())
  username: string = '';

  @Exclude()
  passwordHash: string = '';

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}

const user = new UserEntity({ id: '1', username: 'fluo', passwordHash: 'secret' });
const result = serialize(user);

console.log(result); 
// 출력: { id: "1", username: "FLUO" }
// passwordHash는 제외됩니다.
```

## 주요 패턴

### 민감한 데이터 제외

`@Exclude()`를 사용하여 특정 속성이 출력에 절대 나타나지 않도록 합니다. 클래스 레벨에서 `@Expose({ excludeExtraneous: true })`를 사용하면 명시적으로 허용된 필드만 포함하는 "화이트리스트" 전략을 구현할 수 있습니다.

```typescript
import { Expose, Exclude } from '@fluojs/serialization';

@Expose({ excludeExtraneous: true })
class SecureDto {
  @Expose()
  publicData: string = 'visible';

  internalData: string = 'hidden'; // excludeExtraneous가 true이므로 숨겨짐
}
```

### 값 변환 (Transforming)

`@Transform()`을 사용하여 직렬화 중에 값을 수정합니다. 변환 함수는 현재 값을 인자로 받아 새로운 값을 반환해야 합니다.

```typescript
import { Transform } from '@fluojs/serialization';

class ProductDto {
  @Transform((price) => `$${price.toFixed(2)}`)
  price: number = 0;
}
```

### 순환 참조 처리

fluo의 직렬화 엔진은 순환 참조를 자동으로 감지하고, 반복되는 참조에 대해 `undefined`를 반환하여 절단함으로써 무한 루프와 스택 오버플로를 방지하고 일반 응답 형태를 유지합니다.

### 비JSON leaf 값

`serialize()`는 데코레이터 메타데이터를 적용하고 배열/일반 객체를 재귀적으로 순회하지만, 모든 leaf 값을 엄격한 JSON 타입으로 강제 변환하지는 않습니다. `Date`, `bigint`, 함수, `symbol` 같은 값은 `@Transform(...)`이나 최종 HTTP 응답 작성 전에 직접 정규화하지 않으면 그대로 통과할 수 있습니다.

### HTTP 인터셉터와 함께 사용

fluo HTTP 애플리케이션에서는 `SerializerInterceptor`를 사용하여 컨트롤러에서 나가는 모든 응답을 자동으로 직렬화할 수 있습니다.

```typescript
import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';

@Controller('/users')
@UseInterceptors(SerializerInterceptor)
class UsersController {
  @Get('/')
  findAll() {
    return [new UserEntity({ ... }), new UserEntity({ ... })];
  }
}
```

## 공개 API 개요

### 데코레이터
- `@Expose(options?)`: 포함할 속성을 표시합니다. 클래스에 사용하여 기본 동작을 설정할 수도 있습니다.
- `@Exclude()`: 직렬화 중에 무시할 속성을 표시합니다.
- `@Transform(fn)`: 속성에 대한 변환 함수를 등록합니다.

### 엔진
- `serialize(value)`: 객체/배열을 재귀적으로 순회하며 직렬화 규칙과 데코레이터를 적용합니다.
- `SerializerInterceptor`: 핸들러의 반환 값에 대해 `serialize`를 호출하는 fluo HTTP 인터셉터입니다.

## 관련 패키지

- `@fluojs/http`: `SerializerInterceptor`를 통한 자동 출력 가공을 지원합니다.
- `@fluojs/validation`: **입력** 측면(일반 객체를 클래스 인스턴스로 변환)을 담당하는 대응 패키지입니다.

## 예제 소스

- `packages/serialization/src/serialize.test.ts`: 다양한 직렬화 시나리오에 대한 상세 예제.
- `packages/serialization/src/serializer-interceptor.test.ts`: HTTP 컨텍스트 내에서의 사용법.
