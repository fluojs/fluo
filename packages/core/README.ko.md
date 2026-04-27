# @fluojs/core

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

모든 fluo 패키지가 공통으로 사용하는 표준 데코레이터, 공유 계약, 메타데이터 프리미티브를 제공하는 기반 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 기능](#주요-기능)
- [문제 해결](#문제-해결)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/core
```

## 사용 시점

- 표준 데코레이터로 모듈, 프로바이더, 컨트롤러를 선언할 때
- fluo 모듈 그래프에 참여하는 프레임워크 확장이나 내부 라이브러리를 만들 때
- `Constructor<T>`, `Token<T>`, 프레임워크 공통 에러 같은 기본 타입과 계약을 직접 다뤄야 할 때

## 빠른 시작

모든 fluo 애플리케이션은 `@fluojs/core`가 기록하는 모듈 메타데이터에서 시작합니다.

```ts
import { Global, Inject, Module, Scope } from '@fluojs/core';

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

@Inject(DatabaseService)
@Scope('singleton')
class UserService {
  constructor(private readonly db: DatabaseService) {}
}
```

## 주요 기능

### TC39 데코레이터를 사용하는 표준 데코레이터

fluo는 TC39 표준 데코레이터를 사용하므로 `experimentalDecorators: true`나 `emitDecoratorMetadata: true`에 의존하지 않습니다.

core 메타데이터는 fluo가 소유한 저장소와 TC39 `Symbol.metadata` 통합 지점을 통해 기록되며, `reflect-metadata`나 컴파일러가 생성하는 design type 메타데이터를 사용하지 않습니다. 런타임이 사용자 정의 표준 데코레이터를 평가하기 전에 `Symbol.metadata` 폴리필을 설치해야 한다면 테스트나 부트스트랩 경계에서 `ensureMetadataSymbol()`을 호출하세요.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
```

### 명시적인 의존성 메타데이터

`@Inject(...)`는 리플렉션 기반 추론 대신 코드 안에서 의존성 토큰을 직접 드러냅니다. 상속된 constructor 토큰을 명시적으로 비우려면 `@Inject()`를 사용하면 됩니다.

```ts
const CONFIG_TOKEN = Symbol('CONFIG_TOKEN');

@Inject(CONFIG_TOKEN)
class UsesConfigValue {
  constructor(private readonly config: Config) {}
}
```

여러 토큰을 지정할 때는 `@Inject(A, B)`처럼 variadic 호출을 사용하면 됩니다.

마이그레이션 기간 동안 legacy 배열 형식인 `@Inject([A, B])`도 계속 정규화되지만, 새 코드는 constructor 토큰을 표준 데코레이터 사용 방식과 맞추기 위해 variadic 형식을 권장합니다.

### 형제 패키지를 위한 공용 메타데이터 헬퍼

내부 메타데이터 reader/writer는 `@fluojs/core/internal` 아래에 있으며, `@fluojs/di`, `@fluojs/http`, `@fluojs/runtime` 같은 패키지들이 같은 메타데이터 모델을 공유할 수 있게 합니다.

애플리케이션 코드는 공개 데코레이터와 `ensureMetadataSymbol()`을 `@fluojs/core`에서 import해야 합니다. `@fluojs/core/internal` 서브패스는 `getModuleMetadata()`, `getRouteMetadata()`, `getClassDiMetadata()`, `getOwnClassDiMetadata()` 같은 메타데이터 reader가 필요하거나, 명시적 저장소와 `Symbol.metadata`를 병합하거나, 프레임워크 수준 데코레이터를 만드는 fluo 패키지를 위한 경로입니다.

module, route, class DI 메타데이터를 노출하는 internal reader는 frozen snapshot을 반환하므로, 호출자는 반환 객체를 read-only로 취급해야 하며 직접 mutate하면 안 됩니다(`Object.isFrozen(result) === true`). `getModuleMetadata()`, `getClassDiMetadata()`, `getOwnClassDiMetadata()`는 metadata가 바뀌지 않은 상태에서 반복해서 읽을 때 stable snapshot reference를 재사용할 수 있습니다. `getRouteMetadata()`도 stored metadata와 standard decorator metadata를 매번 병합하면서 frozen route snapshot을 반환하며, 중첩된 headers와 redirect metadata도 frozen snapshot입니다. **Migration note:** 기존에 `getModuleMetadata()`, `getRouteMetadata()`, `getClassDiMetadata()`, `getOwnClassDiMetadata()`에서 반환된 metadata를 직접 mutate하던 코드는 먼저 복사본을 만들거나 지원되는 metadata writer 경로로 업데이트하도록 수정해야 합니다.

```ts
import { getModuleMetadata } from '@fluojs/core/internal';

const metadata = getModuleMetadata(AppModule);
console.log(metadata.providers);
```

### 동적 설정을 위한 AsyncModuleOptions

`AsyncModuleOptions<T>`는 외부 `ConfigService` 등에 의존하여 비동기적으로 초기화가 필요한 모듈을 위한 표준 계약입니다.

```ts
import { AsyncModuleOptions, MaybePromise, Token } from '@fluojs/core';

interface Config {
  apiKey: string;
}

class EmailModule {
  static forRootAsync(options: AsyncModuleOptions<Config>) {
    return {
      module: EmailModule,
      providers: [
        {
          provide: 'CONFIG',
          useFactory: options.useFactory,
          inject: options.inject,
        },
      ],
    };
  }
}
```

### @Scope를 이용한 생명주기 제어

`@Scope` 데코레이터는 프로바이더 인스턴스의 생존 범위를 결정합니다. fluo는 세 가지 스코프를 지원합니다.

- `singleton` (기본값): 애플리케이션 전체에서 단 하나의 인스턴스를 공유합니다.
- `request`: 각 HTTP 요청마다 새로운 인스턴스를 생성합니다.
- `transient`: 주입될 때마다 매번 새로운 인스턴스를 생성합니다.

```ts
import { Scope } from '@fluojs/core';

@Scope('request')
class TransactionContext {}

@Scope('transient')
class Logger {}
```

## 문제 해결

### 데코레이터 메타데이터를 찾을 수 없음

표준 TC39 데코레이터를 사용하고 있는지 확인하세요. fluo는 `reflect-metadata`를 사용하지 않습니다. NestJS에서 전환하는 경우, `tsconfig.json`에서 `experimentalDecorators`와 `emitDecoratorMetadata` 설정을 제거하여 표준 데코레이터 동작과 충돌하지 않도록 하세요.

### 모듈 간 순환 참조

두 모듈이 서로를 import하면 모듈 그래프를 컴파일할 수 없습니다. 공통 의존성을 담은 "Common"이나 "Core" 모듈을 만들어 분리하거나, 공유 로직을 별도 패키지로 추출하세요.

### 추상 클래스에 대한 @Inject 누락

표준 데코레이터는 추상 클래스나 인터페이스의 타입을 자동으로 추론할 수 없습니다. 구체적인 클래스 생성자가 아닌 대상을 주입할 때는 반드시 `@Inject(TOKEN)`을 사용하세요.

## 공개 API

- **데코레이터**: `Module`, `Global`, `Inject`, `Scope`
- **에러**: `FluoError`, `InvariantError`, `FluoCodeError`
- **메타데이터 런타임**: `ensureMetadataSymbol`
- **타입**: `Constructor<T>`, `Token<T>`, `MaybePromise<T>`, `AsyncModuleOptions`
- **내부 서브패스**: `@fluojs/core/internal`을 통한 메타데이터 헬퍼

## 관련 패키지

- `@fluojs/di`: 여기서 선언된 토큰과 스코프를 실제 인스턴스로 해석합니다.
- `@fluojs/runtime`: `@Module` 메타데이터로 모듈 그래프를 컴파일합니다.
- `@fluojs/http`: 동일한 메타데이터 프리미티브 위에서 컨트롤러와 라우트 정보를 읽습니다.

## 예제 소스

- `packages/core/src/index.ts`
- `packages/core/src/decorators.ts`
- `packages/core/src/metadata.ts`
