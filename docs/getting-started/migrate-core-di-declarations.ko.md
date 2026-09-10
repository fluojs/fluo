# Core and DI Declaration Migration

<p><a href="./migrate-core-di-declarations.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 #3738의 breaking 선언 통합을 다룹니다. API 소유 문서는
[Core README](../../packages/core/README.ko.md)와
[DI README](../../packages/di/README.ko.md)이며, 공유 보장은
[DI Resolution Rules](../architecture/di-and-modules.ko.md)와
[TC39 Decorator Contract](../architecture/decorators-and-metadata.ko.md)에 있습니다.
이번 release의 first-party 소비자와 함께 Core와 DI를 업그레이드하세요.
예시는 변경된 checkout을 설명하며 이미 배포된 버전을 뜻하지 않습니다.

## Changed Public Surface

| 제거된 표면 | Canonical 대체 경로 |
| --- | --- |
| `@fluojs/core`의 `Global` | 같은 클래스의 `@Module({...})`에 `global: true`를 추가합니다. |
| `Inject(tokens)` / `Inject([A, B])` | `Inject(...tokens)` / `Inject(A, B)`. |
| DI runtime `Scope.DEFAULT`, `Scope.REQUEST`, `Scope.TRANSIENT` | `'singleton'`, `'request'`, `'transient'`. DI의 `Scope` 타입 union은 유지됩니다. |
| DI `forwardRef(fn)` | `@fluojs/di`의 `ForwardRef.create(fn)`. |
| DI `optional(token)` | `@fluojs/di`의 `Optional.create(token)`. |
| DI `ForwardRefFn<T>` / `OptionalToken<T>` | Core와 이름이 같은 `ForwardRefToken<T>` / `OptionalInjectToken<T>`. |

Package root, public subpath, emitted JavaScript, declaration에 호환 alias를
남기지 않습니다. Static 메서드가 wrapper 생성 구현을 소유하며 제거된 자유 함수를
호출하지 않습니다. 반환값은 factory 클래스 인스턴스가 아닌 frozen plain record입니다.
Resolver 함수와 내부 class/string/symbol token identity는 보존합니다. Metadata와
provider normalization은 계속 wrapper를 snapshot하므로 해당 경계를 통과하는
wrapper 객체 자체의 identity를 보장하지는 않습니다.

## Canonical Recipe

```ts
import { Inject, Module, Scope } from '@fluojs/core';
import { ForwardRef, Optional, type Scope as ProviderScope } from '@fluojs/di';

class Cache {}
const scope: ProviderScope = 'request';

@Scope(scope)
@Inject(ForwardRef.create(() => Logger), Optional.create(Cache))
class Service {
  constructor(readonly logger: Logger, readonly cache: Cache | undefined) {}
}
class Logger {}

@Module({ global: true, providers: [Logger, Service], exports: [Service] })
class ServicesModule {}
```

전역 module도 application graph에 한 번 이상 import해야 합니다. 그 module의
export만 전역으로 보이며 export하지 않은 provider는 비공개입니다. Framework는
import하지 않은 클래스를 자동 탐색하지 않습니다. `Service`는 root가 아닌 request
container에서 resolve하세요. Request scope의 disposal은 계속 caller가 소유합니다.

## Preserved Semantics and Failures

- `@Inject()`는 subclass에서도 명시적인 빈 목록입니다. 상속 scope를 지우지 않고
  상속 token을 지웁니다. Decorator 생략으로 바꾸지 마세요.
- `Inject`에 중첩 배열을 전달하면 타입 검사에서 거부되고 factory 경계에서
  `TypeError`를 던집니다. Provider `inject` 필드는 계속 배열입니다. Mutable 또는
  readonly token 목록을 spread하면 decorator factory 호출 시 내용을 캡처합니다.
- Module과 DI write는 평가 순서대로 부분 필드를 병합합니다. `global: false`와 빈
  inject 목록을 포함해 마지막 명시적 값이 우선합니다. `Module()`과
  `Module(undefined)`는 metadata 등록, 부분 필드 보존, version 증가를 유지합니다.
  `null`을 유효한 definition으로 바꾸지 않습니다.
- `ForwardRef.create`는 객체 생성이 아니라 token 조회를 지연합니다. 실제 constructor
  cycle은 계속 `CircularDependencyError`로 실패하고 module import cycle은 지원하지
  않습니다. `Optional.create`는 등록이 없을 때 `undefined`를 반환하게 할 뿐,
  scope mismatch나 등록된 provider의 오류를 숨기지 않습니다.
- `useValue`, `useClass`, `useFactory`, `useExisting`은 서로 다른 전략으로 유지됩니다.
  Class token, 상속, `instanceof`, `new Container()`, container instance 작업,
  scope cache, disposal ownership은 바뀌지 않습니다.
- `isForwardRef`와 `isOptionalToken`은 대체 생성 경로가 아닌 inspection guard로
  유지합니다. Core typed symbol API `publicToken`과 DI normalized provider
  introspection 타입은 이번 선언 wrapper migration 범위 밖입니다.

## Entrypoint Audiences and Evidence

Application은 Core root로 선언하고 DI root로 wrapper를 생성합니다. Core root는
`ensureMetadataSymbol`과 read-only `getModuleMetadata`를 유지합니다. First-party
metadata reader/writer는 `core/internal`, DTO validation/binding 통합은
`core/request-pipeline`을 사용합니다. 두 subpath는 application 선언의 대체 API가
아닙니다. DI `internal` seam은 first-party validation과 순서가 있는
multi-contribution resolution 용도로 유지합니다.

`getOwnClassDiMetadata`는 대상 자체의 record만 읽습니다. `getClassDiMetadata`와
`getInheritedClassDiMetadata`는 대상 override를 포함한 base-to-leaf effective
metadata를 읽습니다. Own constructor metadata-bag reader는 상속 조회를 하지 않으며
request-pipeline effective reader는 상속 조회를 합니다. Module metadata는
class-local입니다. Frozen snapshot과 write 이후 cache invalidation은 보존됩니다.

자동 회귀 근거:

- `packages/core/src/canonical-declarations.test.ts`: 배열 거부, write 순서,
  version, identity, 상속, 명시적 override.
- `packages/di/src/canonical-injection.test.ts`: static 생성, resolution, freeze,
  lazy resolver identity, scope, 등록이 없는 optional 의존성.
- `packages/di/src/canonical-public-entrypoints.test.ts`와
  `packages/di/typecheck/canonical-injection.ts`: emitted JavaScript와 public 타입.
- `packages/core/src/request-pipeline-public-api.test.ts`: own/effective metadata bag.
- `packages/cli/src/new/scaffold.test.ts`: 생성된 module recipe.

집중 검사 전에 declaration을 빌드하세요.

```sh
pnpm --filter '@fluojs/di...' build
pnpm --filter @fluojs/core typecheck
pnpm --filter @fluojs/di typecheck
pnpm --filter @fluojs/core test
pnpm --filter @fluojs/di test
pnpm verify:platform-consistency-governance
pnpm verify:docs
```
