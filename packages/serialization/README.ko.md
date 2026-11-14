# @fluojs/serialization

이 공통 런타임 패키지는 Bun/Workers consumer에 Node 설치 제약을 전파하지 않도록 `engines.node`를 생략합니다. 기능별 지원과 Node 버전 범위는 [런타임 정책](../../docs/reference/node-support.ko.md#portable-package-boundaries)을 따릅니다.

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Node.js 지원 범위는 `>=24.0.0 <27`입니다. 업그레이드 절차는 [Node.js 지원 및 마이그레이션](../../docs/reference/node-support.ko.md)을 참조하세요.

fluo를 위한 클래스 기반 응답 직렬화 및 데코레이터 인지형 재귀 출력 가공 엔진입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [데코레이터 메타데이터 사전 로드](#데코레이터-메타데이터-사전-로드)
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

## 데코레이터 메타데이터 사전 로드

`@fluojs/serialization`은 import side effect로 `Symbol.metadata`를 설치하지 않습니다. 대상 runtime이 이를 기본 제공하지 않는다면 `@Expose()`, `@Exclude()`, `@Transform()`으로 decorate한 클래스를 평가하는 module을 import하기 전에 설치하세요.

```ts
// preload.ts — 이 파일을 애플리케이션 entrypoint로 설정합니다.
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
await import('./bootstrap.js');
```

## 빠른 시작

```ts
import { Expose, Exclude, Transform, serialize } from '@fluojs/serialization';

class UserEntity {
  @Expose()
  id = '';

  @Expose()
  @Transform((value) => String(value).toUpperCase())
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

`ExposeClassOptions`는 `Expose(...)`가 받는 class-level option을 표현하는 export 타입입니다. DTO가 field-level `@Expose()` metadata가 있는 instance field만 내보내야 할 때 `excludeExtraneous: true`를 사용하세요. Static field에만 `@Expose()`를 적용해도 같은 이름의 instance field가 노출되거나 output key가 생성되지 않습니다.

### 값 변환

```ts
import { Transform } from '@fluojs/serialization';

class ProductDto {
  @Transform((price) => `$${Number(price).toFixed(2)}`)
  price = 0;
}
```

같은 필드가 base class와 derived class 모두에서 decorate되면 transform은 base에서 derived 순서로 실행됩니다.
`TransformFunction`은 동기식 `(value: unknown) => unknown` callback입니다. 현재 field value만 전달받으므로 async 작업이나 DTO, property metadata, serialization context 접근이 아니라 value-only transform에 사용하세요.

### HTTP 인터셉터와 함께 사용

`@UseInterceptors(...)`에 `SerializerInterceptor`를 class token으로 전달하면 request container에서 resolve합니다. 컨트롤러의 module에 provider로 등록하세요.

```ts
import { Module } from '@fluojs/core';
import { Controller, Get, type RequestContext, UseInterceptors } from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';

@Controller('/users')
@UseInterceptors(SerializerInterceptor)
class UsersController {
  @Get('/')
  findAll() {
    return [new UserEntity()];
  }

  @Get('/export.csv')
  async exportCsv(_input: undefined, context: RequestContext) {
    context.response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    await context.response.send('id,username\n1,fluo');
  }
}

@Module({
  controllers: [UsersController],
  providers: [SerializerInterceptor],
})
class UsersModule {}
```

두 route는 서로 다른 응답 소유자를 사용합니다.

- **Framework-managed response**: `findAll()`은 `RequestContext.response`가 아직 commit되지 않은 상태에서 반환합니다. `SerializerInterceptor`가 반환된 DTO를 직렬화한 뒤 runtime response writer가 결과를 commit합니다.
- **Handler-owned response**: `exportCsv()`는 최종 payload를 `RequestContext.response.send(...)`로 직접 씁니다. `send(...)`, `redirect(...)`, 또는 수동 streaming helper가 response를 commit하면 `SerializerInterceptor`는 `serialize(...)`를 건너뛰고 `next.handle()`에서 받은 값을 그대로 반환합니다. 이 보장은 `SerializerInterceptor`에만 해당하며, 다른 interceptor는 chain 결과를 계속 변환할 수 있습니다. 이와 별개로 dispatcher는 commit된 response를 확인하고 두 번째 success-response write를 건너뜁니다.

직접 쓰는 payload는 최종 결과로 취급하세요. 필요한 field filtering이나 encoding을 commit 전에 적용해야 합니다. Handler/runtime response ownership이 commit된 뒤에는 serialization이 응답을 후처리할 수 없습니다.

### 순환 참조 처리

fluo의 직렬화 엔진은 활성 순환 참조를 자동으로 감지하고 `undefined`로 절단하여 무한 루프와 스택 오버플로를 방지합니다. 같은 reference tracker가 class instance, plain object, 배열, mixed object-array graph 전체에서 공유됩니다. 자기 자신을 참조하는 배열과 object-array cycle은 활성 back edge에서 절단되고, 이미 직렬화가 끝난 공유 참조는 삭제하지 않고 직렬화된 그래프 안에서 재사용합니다. 예를 들어 두 sibling 필드 또는 객체 필드와 배열 항목이 같은 원본 객체를 가리키면 두 직렬화 결과도 같은 직렬화 객체를 가리키며, 현재 직렬화 중인 값을 다시 만나는 활성 cycle만 `undefined`로 절단됩니다.

### 상속된 데코레이터 계약

기반 클래스에 선언한 직렬화 메타데이터는 파생 DTO에도 상속됩니다. 공통 필드에 적용한 `@Expose()`, `@Exclude()`, `@Transform()` 규칙은 서브클래스 인스턴스를 직렬화할 때도 그대로 반영됩니다.
Field decorator는 instance field만 대상으로 합니다. Static field에 적용하면 상속 관계에서도 무시되므로 같은 이름의 instance field를 노출하거나 제외하거나 변환하지 않습니다.
파생 클래스의 데코레이터 갱신은 해당 클래스만 소유하므로 field나 class option을 override해도 base DTO나 sibling DTO의 이후 직렬화는 바뀌지 않습니다.

Class-level `excludeExtraneous`도 일반 상속 규칙을 따릅니다. 파생 클래스에 option 없는 `@Expose()`를 붙여도 가장 가까운 상속 설정이 유지되므로, expose-only 기반 DTO는 subclass에서도 expose-only 상태를 유지합니다. 일반 enumerable field를 다시 포함하려는 의도가 있을 때만 파생 클래스에 `@Expose({ excludeExtraneous: false })`를 명시하세요. 이 경우에도 상속된 field-level `@Exclude()` metadata는 계속 적용됩니다.

Decorated metadata가 없는 class instance도 재귀적으로 순회하므로, parent object에 serialization metadata가 없어도 decorated nested descendant는 반영됩니다.

### 일반 객체 안전성

`serialize()`는 일반 객체와 null-prototype 레코드를 데코레이터가 붙은 클래스 인스턴스로 오인하지 않습니다. Enumerable symbol key도 직렬화하며, own `__proto__`, `constructor`, `prototype` key는 prototype mutation이 아니라 data로 취급합니다. 사용자 정의 `constructor` 필드나 안전하지 않은 `constructor` 값을 가진 객체도 예외 없이 안전하게 순회합니다.

### 비JSON leaf 값

`serialize()`는 데코레이터 메타데이터를 적용하고 배열/일반 객체를 재귀적으로 순회하지만, 모든 leaf 값을 엄격한 JSON 타입으로 강제 변환하지는 않습니다. `Date`, `Map`, `Set`, `URL`, `URLSearchParams`, `RegExp`, `Error`, `ArrayBuffer`, typed array, `WeakMap`, `WeakSet`, `Promise`, `ReadableStream`, `Blob` 같은 opaque built-in은 DTO 같은 클래스 인스턴스로 펼치지 않고 그대로 통과합니다. Built-in은 내부 brand check로 realm에 관계없이 판별하므로 다른 realm(예: `node:vm`, iframe, 격리된 test runner)에서 만든 값도 참조 동일성을 유지한 채 통과하며, built-in과 비슷해 보이기만 하는 일반 DTO는 계속 레코드로 순회합니다. 호출 가능한 `toJSON()`을 정의한 undecorated class instance도 그대로 통과하므로 최종 JSON writer가 해당 값 자체의 표현을 적용합니다(예: private state를 가진 money, decimal, id value object). Serialization metadata(`@Expose()`, `@Exclude()`, `@Transform()`, `excludeExtraneous`)를 가진 클래스는 `toJSON()`을 정의해도 metadata 기반 shaping을 유지합니다. `bigint`, 함수, `symbol` 같은 값도 `@Transform(...)`이나 최종 HTTP 응답 작성 전에 직접 정규화하지 않으면 그대로 통과할 수 있습니다.

## 공개 API 개요

- **데코레이터**: `Expose`, `Exclude`, `Transform`
- **엔진**: `serialize(value)`는 class instance, 배열, plain object, mixed graph를 재귀적으로 순회하며, 직접 transform하지 않은 opaque built-in 및 non-JSON leaf 값은 보존합니다.
- **HTTP 통합**: `SerializerInterceptor`는 아직 commit되지 않은 handler 결과를 직렬화합니다. Response가 commit된 뒤에는 `next.handle()`에서 받은 값을 그대로 반환하지만, 다른 interceptor는 chain 결과를 계속 변환할 수 있습니다.
- **타입**: `ExposeClassOptions`는 class-level `Expose(...)` option 타입으로 root entrypoint에서 export되며, `TransformFunction`은 `Transform(...)`에 전달하는 callback 타입으로 export됩니다.

`Expose`는 class와 instance field에 적용할 수 있습니다. `Exclude`와 `Transform`은 instance field에 적용합니다. 세 데코레이터 모두 static field에 적용하면 예외 없이 무시합니다. Static 값은 그대로 유지되고 static transform callback은 실행되지 않습니다.

## 관련 패키지

- `@fluojs/http`: HTTP handler에 `SerializerInterceptor`를 적용합니다.
- `@fluojs/validation`: input-side DTO materialization과 validation을 담당합니다.

## 예제 소스

- `packages/serialization/src/serialize.test.ts`
- `packages/serialization/src/serializer-interceptor.test.ts`
