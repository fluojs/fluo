# DI Resolution Rules

<p><a href="./di-and-modules.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Provider Registration

- fluo 모듈은 `@Module({ providers: [...] })`를 통해 애플리케이션 공급자를 선언해야 합니다.
- 공급자 토큰은 `UsersService` 같은 클래스 단축 표기나 `provide`를 포함한 명시적 공급자 객체로 등록될 수 있습니다.
- 지원되는 명시적 공급자 형식은 `{ provide, useClass }`, `{ provide, useValue }`, `{ provide, useFactory }`, `{ provide, useExisting }`입니다.
- 클래스 단축 표기는 클래스 생성자를 공개 토큰이자 구현으로 등록합니다.
- `{ provide, useClass }`는 `provider.inject`가 있으면 그 값을 사용해 생성자 의존성을 해석해야 하며, 없으면 `useClass`에 선언된 `@Inject(...)` 메타데이터를 사용해야 합니다.
- `{ provide, useFactory }`는 `inject` 배열만을 기준으로 의존성을 해석해야 합니다.
- `{ provide, useValue }`는 준비된 값을 등록해야 하며, 생성자 의존성을 선언해서는 안 됩니다.
- `{ provide, useExisting }`는 한 토큰을 다른 기존 토큰에 대한 별칭으로 연결해야 합니다.
- 공급자 범위의 기본값은 `singleton`입니다. 클래스 공급자나 팩토리 공급자는 `scope` 또는 구현 클래스의 `@Scope(...)` 메타데이터로 이를 재정의할 수 있습니다.
- 모듈은 `imports`와 `exports`를 통해 교차 모듈 가시성을 선언해야 합니다.
- 모듈은 자신의 공급자 토큰을 export할 수 있습니다.
- 모듈은 import한 모듈이 export한 토큰을 다시 export할 수 있습니다.
- 모듈은 로컬 토큰도 아니고 import한 모듈의 재export 대상도 아닌 토큰을 export해서는 안 됩니다.
- `@Global()` 또는 `global: true`로 표시된 모듈은 자신의 exported 토큰을 직접 import 없이 보이게 만듭니다. export되지 않은 공급자는 계속 비공개입니다.

## Injection Rules

- fluo는 명시적 토큰 기반 주입을 사용합니다. 생성자 해석은 선언된 토큰을 사용해야 하며, 방출된 타입 메타데이터에 의존해서는 안 됩니다.
- 필수 생성자 매개변수가 있는 클래스나 컨트롤러는 공급자 객체가 `inject`를 명시적으로 제공하지 않는 한, 이에 대응하는 `@Inject(...)` 메타데이터를 제공해야 합니다.
- `@Inject(...)` 토큰은 모든 필수 생성자 매개변수를 덮어야 합니다. 누락된 항목은 모듈 그래프 검증 단계에서 `ModuleInjectionMetadataError`를 발생시킵니다.
- 토큰 없이 호출된 `@Inject()`는 명시적 빈 override를 기록하며, 상속된 생성자 토큰 메타데이터를 비웁니다.
- 생성자 토큰은 클래스, 문자열, 심볼, `forwardRef(...)` 래퍼, `optional(...)` 래퍼가 될 수 있습니다.
- 선언 시점 순환 때문에 토큰이 데코레이션 시점에 정의되지 않았다면 `forwardRef(...)`를 사용해야 합니다.
- `optional(token)`은 해당 의존성을 선택 사항으로 표시합니다. 선택적 토큰이 없으면 예외 대신 `undefined`로 해석됩니다.
- 공급자나 컨트롤러는 현재 모듈에 로컬로 선언된 토큰을 주입할 수 있습니다.
- 공급자나 컨트롤러는 직접 import한 모듈이 export한 토큰을 주입할 수 있습니다.
- 공급자나 컨트롤러는 전역 모듈이 export한 토큰을 주입할 수 있습니다.
- 공급자나 컨트롤러는 로컬도 아니고, import한 모듈의 export 대상도 아니고, 전역 모듈을 통해 보이지도 않는 토큰을 주입해서는 안 됩니다. 이 실패는 부트스트랩 단계에서 `ModuleVisibilityError`를 발생시킵니다.

## Scope Model

| Scope | Registration rule | Resolution rule |
| --- | --- | --- |
| `singleton` | 클래스, 값, 별칭, 팩토리 공급자의 기본 범위이며 명시적으로 재정의하지 않으면 유지됩니다. | 루트 컨테이너 캐시에서 하나의 인스턴스를 공유합니다. |
| `request` | `@Scope('request')` 또는 `scope: 'request'`로 선언됩니다. | `createRequestScope()`로 생성된 요청 컨테이너마다 하나의 인스턴스를 생성합니다. |
| `transient` | `@Scope('transient')` 또는 `scope: 'transient'`로 선언됩니다. | 해석할 때마다 새 인스턴스를 생성합니다. |

- 요청 범위 공급자는 요청 컨테이너에서 해석되어야 합니다. 루트 컨테이너에서 해석하면 `RequestScopeResolutionError`가 발생합니다.
- 싱글톤 공급자는 요청 범위 공급자에 의존해서는 안 됩니다. 이 불일치는 `ScopeMismatchError`를 발생시킵니다.
- 요청 범위 컨테이너는 싱글톤 공급자를 직접 등록해서는 안 됩니다. 루트 수준 싱글톤 등록은 요청 범위를 만들기 전에 수행됩니다.
- `createRequestScope()`는 루트 컨테이너와 싱글톤 캐시를 공유하고 요청 범위 인스턴스는 분리하는 자식 컨테이너를 생성합니다.

## Constraints

- fluo는 DI 해석을 위해 `emitDecoratorMetadata`나 암시적 생성자 타입 리플렉션에 의존해서는 안 됩니다.
- 공급자 토큰은 등록 메타데이터를 정규화하는 시점에 정의되어 있어야 합니다. `null` 또는 `undefined` inject 토큰은 유효하지 않습니다.
- 공급자 순환 의존성 체인은 `CircularDependencyError`로 해석 실패합니다. `forwardRef(...)`는 선언 시점의 토큰 조회만 지연하며 실제 생성자 순환을 해석 가능하게 만들지 않으므로, 그런 순환은 리팩터링으로 제거해야 합니다.
- 하나의 컨테이너 안에서 같은 토큰을 중복 등록하는 행위는 의도적인 교체가 `container.override(...)`로 수행되지 않는 한 실패해야 합니다.
- 모듈 간 중복 공급자 토큰은 부트스트랩 시 `duplicateProviderPolicy`로 관리되며, 기본 정책은 `warn`입니다.
- 모듈 가시성의 기본값은 비공개입니다. 교차 모듈 접근은 명시적 `exports`와 `imports`, 또는 전역 모듈의 export를 통해서만 허용됩니다.
- 이 규칙 문서는 `@Module(...)`, `@Inject(...)`, `@Scope(...)`, `@fluojs/di`, 런타임 모듈 그래프 검증기가 정의한 현재 fluo 모델만을 다룹니다.
