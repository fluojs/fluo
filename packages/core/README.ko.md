# @konekti/core

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

모든 Konekti 패키지가 공통으로 사용하는 표준 데코레이터, 공유 계약, 메타데이터 프리미티브를 제공하는 기반 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 기능](#주요-기능)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @konekti/core
```

## 사용 시점

- 표준 데코레이터로 모듈, 프로바이더, 컨트롤러를 선언할 때
- Konekti 모듈 그래프에 참여하는 프레임워크 확장이나 내부 라이브러리를 만들 때
- `Constructor<T>`, `Token<T>`, 프레임워크 공통 에러 같은 기본 타입과 계약을 직접 다뤄야 할 때

## 빠른 시작

모든 Konekti 애플리케이션은 `@konekti/core`가 기록하는 모듈 메타데이터에서 시작합니다.

```ts
import { Global, Inject, Module, Scope } from '@konekti/core';

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
class CoreModule {}

@Module({
  imports: [CoreModule],
  providers: [UserService],
})
class AppModule {}

@Inject([DatabaseService])
@Scope('singleton')
class UserService {
  constructor(private readonly db: DatabaseService) {}
}
```

## 주요 기능

### 레거시 TypeScript 플래그 없이 쓰는 표준 데코레이터

Konekti는 TC39 표준 데코레이터를 사용하므로 `experimentalDecorators: true`나 `emitDecoratorMetadata: true`에 의존하지 않습니다.

### 명시적인 의존성 메타데이터

`@Inject([...])`는 리플렉션 기반 추론 대신 코드 안에서 의존성 토큰을 직접 드러냅니다.

```ts
const CONFIG_TOKEN = Symbol('CONFIG_TOKEN');

@Inject([CONFIG_TOKEN])
class UsesConfigValue {
  constructor(private readonly config: Config) {}
}
```

### 형제 패키지를 위한 공용 메타데이터 헬퍼

내부 메타데이터 reader/writer는 `@konekti/core/internal` 아래에 있으며, `@konekti/di`, `@konekti/http`, `@konekti/runtime` 같은 패키지들이 같은 메타데이터 모델을 공유할 수 있게 합니다.

```ts
import { getModuleMetadata } from '@konekti/core/internal';

const metadata = getModuleMetadata(AppModule);
console.log(metadata.providers);
```

## 공개 API 개요

- **데코레이터**: `Module`, `Global`, `Inject`, `Scope`
- **에러**: `KonektiError`, `InvariantError`, `KonektiCodeError`
- **타입**: `Constructor<T>`, `Token<T>`, `MaybePromise<T>`, `AsyncModuleOptions`
- **내부 서브패스**: `@konekti/core/internal`을 통한 메타데이터 헬퍼

## 관련 패키지

- `@konekti/di`: 여기서 선언된 토큰과 스코프를 실제 인스턴스로 해석합니다.
- `@konekti/runtime`: `@Module` 메타데이터로 모듈 그래프를 컴파일합니다.
- `@konekti/http`: 동일한 메타데이터 프리미티브 위에서 컨트롤러와 라우트 정보를 읽습니다.

## 예제 소스

- `packages/core/src/index.ts`
- `packages/core/src/decorators.ts`
- `packages/core/src/metadata.ts`
