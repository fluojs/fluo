# @konekti/core

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti의 공유 기반 레이어 — 다른 모든 패키지가 사용하는 기본 타입, 공통 에러 클래스, 메타데이터 헬퍼.

## 관련 문서

- `../../docs/concepts/architecture-overview.md`
- `../../docs/concepts/decorators-and-metadata.md`

## 이 패키지가 하는 일

`@konekti/core`는 기능을 직접 실행하지 않습니다. 다른 모든 패키지가 사용하는 공통 언어를 정의합니다:

- **기본 타입** — `Constructor`, `Token`, `MaybePromise`, 메타데이터 프리미티브
- **공통 에러** — 프레임워크 레벨 계약 위반을 위한 `KonektiError`, `InvariantError`
- **데코레이터** — `@Module()`, `@Global()`, `@Inject()`, `@Scope()`
- **메타데이터 헬퍼** — WeakMap 저장소를 기반으로 한 타입 write/read 헬퍼

Konekti 모듈/DI/HTTP 시스템에 참여하는 패키지를 작성할 때, 공유 계약을 위해 의존해야 하는 유일한 패키지입니다.

## 설치

```bash
npm install @konekti/core
```

## 빠른 시작

```typescript
import {
  Module,
  Global,
  Inject,
  Scope,
  KonektiError,
  type Constructor,
  type Token,
} from '@konekti/core';

// 모듈 정의
@Module({ providers: [MyService] })
class AppModule {}

// 전역으로 사용 가능하게 표시
@Global()
@Module({ providers: [ConfigService] })
class CoreModule {}

// 명시적 주입 토큰
@Inject([CONFIG_TOKEN])
class MyService {
  constructor(private config: Config) {}
}

// 요청 스코프
@Scope('request')
class RequestScopedService {}
```

## 핵심 API

### 기본 타입 (`src/types.ts`)

| 타입 | 설명 |
|---|---|
| `Constructor<T>` | `new (...args: any[]) => T` — 클래스 생성자 |
| `Token<T>` | `Constructor<T> \| string \| symbol` — DI 토큰 |
| `MaybePromise<T>` | `T \| Promise<T>` |
| `MetadataPropertyKey` | `string \| symbol` |
| `MetadataSource` | 메타데이터 소스 위치 마커 |

### 공통 에러 (`src/errors.ts`)

```typescript
class KonektiError extends Error {
  constructor(message: string, options?: { code?: string; cause?: unknown; meta?: Record<string, unknown> })
}

class InvariantError extends KonektiError {}
```

비즈니스 에러가 아닌 프레임워크 레벨 계약 위반을 알릴 때 사용합니다.

### 데코레이터 (`src/decorators.ts`)

| 데코레이터 | 대상 | 설명 |
|---|---|---|
| `@Module(options)` | 클래스 | providers, controllers, imports, exports가 있는 모듈 선언 |
| `@Global()` | 클래스 | 명시적 import 없이 모듈의 exports를 전역으로 노출 |
| `@Inject(tokens)` | 클래스 | 명시적 주입 토큰 목록 선언 |
| `@Scope(scope)` | 클래스 | lifetime을 `'singleton'`(기본값), `'request'`, `'transient'`로 설정 |

### 메타데이터 헬퍼 (`src/metadata.ts`)

이 헬퍼들은 `@konekti/di`, `@konekti/http`, `@konekti/runtime` 등에서 내부적으로 사용됩니다. 애플리케이션 코드에서 직접 호출하는 경우는 일반적으로 없습니다.

| 헬퍼 쌍 | 목적 |
|---|---|
| `defineModuleMetadata()` / `getModuleMetadata()` | 모듈 imports/exports/providers |
| `defineClassDiMetadata()` / `getClassDiMetadata()` | 상속 fallback을 포함한 최종 DI 주입 토큰 및 스코프 |
| `getOwnClassDiMetadata()` / `getInheritedClassDiMetadata()` | DI own-only 조회와 상속 포함 최종 조회를 명시적으로 구분 |
| `defineControllerMetadata()` / `getControllerMetadata()` | HTTP 컨트롤러 기본 경로 |
| `defineRouteMetadata()` / `getRouteMetadata()` | 라우트 method/path/guards |
| `defineDtoFieldBindingMetadata()` / `getDtoBindingSchema()` | 요청 DTO 필드 바인딩 |
| `defineInjectionMetadata()` / `getInjectionSchema()` | 주입 메타데이터 스키마 |

모든 메타데이터는 class/prototype을 키로 하는 WeakMap에 저장되므로 객체의 lifetime에 맞게 스코프가 지정되고 전역 레지스트리를 오염시키지 않습니다.

DI 메타데이터에서는 `getOwnClassDiMetadata()`가 현재 클래스에 직접 기록된 값만 반환하고, `getInheritedClassDiMetadata()`와 `getClassDiMetadata()`는 runtime/DI 정규화에서 사용하는 상속 포함 최종 뷰를 반환합니다.

`@konekti/core`는 `src/metadata.ts`의 추가 메타데이터 헬퍼와 타입도 함께 re-export합니다. 위 표는 가장 중요한 헬퍼 요약이지 전체 public surface 목록은 아닙니다.

## 구조

```
데코레이터 / 부트스트랩 코드
  → core 메타데이터 헬퍼
      → WeakMap 메타데이터 저장소
          ← 나중에 di / http / runtime / passport가 읽음
```

WeakMap 방식은 메타데이터가 클래스별로 격리되고, 전역 레지스트리 충돌을 피하며, 테스트 격리에도 잘 맞습니다.

## 파일 읽기 순서 (기여자용)

1. `src/types.ts` — 공유 프리미티브 타입
2. `src/errors.ts` — 기본 에러 클래스
3. `src/metadata.ts` — 메타데이터 write/read 헬퍼
4. `src/metadata.test.ts` — 메타데이터 round-trip 테스트
5. `src/decorators.ts` — public 데코레이터 surface
6. `src/decorators.test.ts` — 데코레이터 write 테스트
7. `src/decorator-transform.test.ts` — 툴체인 데코레이터 문법 테스트

## 관련 패키지

- **`@konekti/di`** — `Token`과 injection schema를 사용해 인스턴스 resolve
- **`@konekti/runtime`** — module metadata를 사용해 모듈 그래프 컴파일
- **`@konekti/http`** — route/DTO metadata를 사용해 요청 실행 체인 구성

## 한 줄 mental model

```
@konekti/core = 다른 모든 패키지가 공유하는 타입, base error, metadata schema를 고정하는 바닥층
```
