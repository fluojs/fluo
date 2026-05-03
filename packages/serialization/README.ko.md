# @fluojs/serialization

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 클래스 기반 응답 직렬화 및 데코레이터 인지형 재귀 출력 가공 엔진입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/serialization
```

## 사용 시점

- output DTO가 제어된 일부 필드만 노출해야 할 때
- password hash나 내부 identifier 같은 민감한 값이 response boundary를 벗어나면 안 될 때
- response data가 serialization 중 lightweight synchronous transform을 거쳐야 할 때
- HTTP interceptor가 같은 serialization rule을 자동으로 적용하게 하고 싶을 때

## 빠른 시작

```ts
import { Expose, Exclude, Transform, serialize } from '@fluojs/serialization';

class UserEntity {
  @Expose()
  id = '';

  @Expose()
  @Transform((value) => value.toUpperCase())
  username = '';

  @Exclude()
  passwordHash = '';
}

const user = Object.assign(new UserEntity(), {
  id: '1',
  username: 'fluo',
  passwordHash: 'secret',
});

console.log(serialize(user));
// { id: '1', username: 'FLUO' }
```

## 주요 패턴

### 노출 전용 출력 DTO

```ts
import { Expose } from '@fluojs/serialization';

@Expose({ excludeExtraneous: true })
class SecureDto {
  @Expose()
  publicData = 'visible';

  internalData = 'hidden';
}
```

### 값 변환

```ts
import { Transform } from '@fluojs/serialization';

class ProductDto {
  @Transform((price) => `$${price.toFixed(2)}`)
  price = 0;
}
```

같은 필드가 base class와 derived class 모두에서 decorate되면 transform은 base에서 derived 순서로 실행됩니다.

### HTTP 인터셉터와 함께 사용

```ts
import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';

@Controller('/users')
@UseInterceptors(SerializerInterceptor)
class UsersController {
  @Get('/')
  findAll() {
    return [new UserEntity()];
  }
}
```

`SerializerInterceptor`는 일반 HTTP 응답 writer가 아직 소유한 값만 직렬화합니다. 핸들러나 응답 헬퍼가 SSE 스트림처럼 `RequestContext.response`를 직접 커밋한 경우, 인터셉터는 해당 핸들러 소유 값을 그대로 반환하여 request pipeline의 응답 소유권을 보존합니다.

### 순환 참조 처리

fluo의 직렬화 엔진은 활성 순환 참조를 자동으로 감지하고 `undefined`로 절단하여 무한 루프와 스택 오버플로를 방지합니다. 이미 직렬화가 끝난 공유 참조는 삭제하지 않고 직렬화된 그래프 안에서 재사용합니다. 예를 들어 두 sibling 필드가 같은 원본 객체를 가리키면 두 직렬화 결과도 같은 직렬화 객체를 가리키며, 현재 직렬화 중인 객체를 다시 만나는 활성 cycle만 `undefined`로 절단됩니다.

### 상속된 데코레이터 계약

기반 클래스에 선언한 직렬화 메타데이터는 파생 DTO에도 상속됩니다. 공통 필드에 적용한 `@Expose()`, `@Exclude()`, `@Transform()` 규칙은 서브클래스 인스턴스를 직렬화할 때도 그대로 반영됩니다.

Decorated metadata가 없는 class instance도 재귀적으로 순회하므로, parent object에 serialization metadata가 없어도 decorated nested descendant는 반영됩니다.

### 일반 객체 안전성

`serialize()`는 일반 객체와 null-prototype 레코드를 데코레이터가 붙은 클래스 인스턴스로 오인하지 않습니다. Enumerable symbol key도 직렬화하며, own `__proto__`, `constructor`, `prototype` key는 prototype mutation이 아니라 data로 취급합니다. 사용자 정의 `constructor` 필드나 안전하지 않은 `constructor` 값을 가진 객체도 예외 없이 안전하게 순회합니다.

### 비JSON leaf 값

`serialize()`는 데코레이터 메타데이터를 적용하고 배열/일반 객체를 재귀적으로 순회하지만, 모든 leaf 값을 엄격한 JSON 타입으로 강제 변환하지는 않습니다. `Date`, `Map`, `Set`, `URL`, `URLSearchParams`, `RegExp`, `Error`, `ArrayBuffer`, typed array, `WeakMap`, `WeakSet`, `Promise` 같은 opaque built-in은 DTO 같은 클래스 인스턴스로 펼치지 않고 그대로 통과합니다. `bigint`, 함수, `symbol` 같은 값도 `@Transform(...)`이나 최종 HTTP 응답 작성 전에 직접 정규화하지 않으면 그대로 통과할 수 있습니다.

## 공개 API 개요

- **데코레이터**: `Expose`, `Exclude`, `Transform`
- **엔진**: `serialize(value)`
- **HTTP 통합**: `SerializerInterceptor`

`Expose`는 class와 field에 적용할 수 있습니다. `Exclude`와 `Transform`은 field에 적용합니다.

## 관련 패키지

- `@fluojs/http`: HTTP handler에 `SerializerInterceptor`를 적용합니다.
- `@fluojs/validation`: input-side DTO materialization과 validation을 담당합니다.

## 예제 소스

- `packages/serialization/src/serialize.test.ts`
- `packages/serialization/src/serializer-interceptor.test.ts`
