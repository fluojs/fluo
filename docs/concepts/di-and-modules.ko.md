# DI와 모듈

<p><a href="./di-and-modules.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti는 **명시적 토큰 기반 Dependency Injection (DI) 시스템**과 계층적 **Module Graph**를 통해 애플리케이션 복잡성을 관리합니다. “마법” 같은 reflection에 의존하는 프레임워크와 달리, Konekti는 모든 provider와 consumer 사이에 명확한 계약을 요구합니다.

## 이 개념이 중요한 이유

대규모 애플리케이션에서 프레임워크가 constructor type을 바탕으로 필요한 것을 “추측”하는 암시적 DI는 재앙의 지름길입니다. 이는 다음을 초래합니다:
- **보이지 않는 결합**: 깨지기 전까지 의존성 트리가 얼마나 깊은지 알기 어렵습니다.
- **어려운 테스트**: 무엇이 주입되는지 100% 확실하지 않으면 mocking이 번거롭습니다.
- **런타임의 놀라움**: 순환 의존성이나 누락된 provider는 종종 런타임에서 난해한 `undefined` 오류로 이어집니다.

Konekti는 의존성 그래프를 **감사 가능하고 명시적으로** 만들어 이러한 문제를 제거합니다. 어떤 class를 보더라도 그것이 무엇을 필요로 하는지, 그 요구사항이 어디에서 오는지, 어떤 scope에 속하는지 정확히 확인할 수 있습니다.

## 핵심 아이디어

### 토큰 기반 DI
Konekti에서 모든 의존성은 **Token**으로 식별됩니다. token은 다음이 될 수 있습니다:
- **Class**: 가장 일반적인 경우입니다. class constructor 자체가 고유 식별자 역할을 합니다.
- **Symbol 또는 String**: consumer를 바꾸지 않고 구현을 교체하고 싶을 때 사용하는 추상 인터페이스(예: `ILogger`)용입니다.
- **Configuration Key**: 특정 설정 값을 service에 직접 주입할 때 사용합니다.

명시적 token을 사용함으로써 `emitDecoratorMetadata`가 필요 없어지고, 코드가 최신 JavaScript 빌드 도구와 호환되도록 보장합니다.

### “경계”로서의 module
Konekti의 **Module**은 단순한 정리 도구가 아니라 **보안과 캡슐화의 경계**입니다.
- **기본값은 비공개**: `UserModule`에 정의된 service는 `UserModule`이 `exports` 배열에 명시적으로 포함하고, `AuthModule`이 `imports`에 `UserModule`을 포함하지 않는 한 `AuthModule`에서 보이지 않습니다.
- **캡슐화된 구현**: 이를 통해 시스템의 다른 부분에서 실수로 사용되거나 결합될 수 없는 내부 “helper” service를 둘 수 있습니다.

### 생성자 주입 패턴
우리는 **Constructor Injection**을 기본 패턴으로 권장합니다. 이는 표준 class 기반 프로그래밍과 잘 맞고, 단위 테스트를 매우 단순하게 만듭니다. mock object를 생성자에 그대로 전달하면 됩니다.

```ts
@Inject([UsersRepository, 'APP_CONFIG'])
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly config: any
  ) {}
}
```

## provider 유형

- **Class Provider**: 프레임워크가 인스턴스화하는 표준 service입니다.
- **Value Provider**: 상수, configuration, 외부 library 인스턴스를 주입합니다.
- **Factory Provider**: 다른 service나 environment state를 기반으로 동적으로 생성되는 로직 기반 provider입니다.
- **Alias Provider**: 하나의 token을 다른 token에 매핑합니다(예: `ILogger`를 `PinoLogger`에 매핑).

## injection scope

- **Singleton (Default)**: 앱 전체에서 공유되는 하나의 인스턴스입니다. stateless service와 connection pool에 가장 적합합니다.
- **Request**: 들어오는 각 HTTP request마다 새 인스턴스가 생성됩니다. 현재 사용자 같은 request별 상태를 저장할 때 유용합니다.
- **Transient**: 주입 지점마다 새 인스턴스가 생성됩니다.

## 경계

- **전역 scope 없음**: 명시적으로 표시되지 않은 한 “global” provider는 없습니다. 우리는 import/export 체인의 안전성을 선호합니다.
- **순환 의존성 감지**: Konekti의 DI container는 bootstrap 시점에 순환 의존성을 감지하고 명확한 오류를 발생시켜 stack overflow를 방지합니다.
- **엄격한 검증**: 필요한 의존성이 module graph에서 빠져 있으면 애플리케이션은 **시작에 실패**합니다. 운영 중 충돌보다 부트 시점의 실패를 선호합니다.

## 관련 문서

- [Architecture Overview](./architecture-overview.ko.md)
- [Decorators and Metadata](./decorators-and-metadata.ko.md)
- [HTTP Runtime](./http-runtime.ko.md)
- [DI Package README](../../packages/di/README.ko.md)
