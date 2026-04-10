# 데코레이터와 메타데이터

<p><a href="./decorators-and-metadata.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti는 **TC39 Standard Decorators**를 기반으로 처음부터 구축되었습니다. 우리는 레거시 `experimentalDecorators` 및 `emitDecoratorMetadata` 모델을 완전히 버리고, 깔끔하고 성능이 높으며 표준에 부합하는 metadata system을 채택했습니다.

## 이 개념이 중요한 이유

오랫동안 TypeScript 생태계는 표준이 되지 못한 “proposal” 버전의 decorators에 의존해 왔습니다. 이 레거시 시스템은 compiler가 타입을 “추측”하고 이를 숨겨진 metadata(`reflect-metadata`)로 내보내야 했기 때문에 다음과 같은 문제가 있었습니다:
- **숨겨진 성능 비용**: 사용하지 않더라도 모든 class에 대해 많은 metadata가 생성됩니다.
- **취약한 타입 추측**: 순환 의존성은 종종 “metadata emit”을 깨뜨려, 런타임의 `undefined` 오류로 이어졌습니다.
- **종속성 고착**: 코드가 특정 TypeScript compiler flag에 의존하게 되어, 복잡한 plugin 없이는 `esbuild`, `swc`, native engine 등에서 실행하기 어려워졌습니다.

Konekti가 **Standard Decorators**로 전환한 것은 백엔드를 이식 가능하고 명시적으로 만들며, JavaScript의 미래에 대비시키기 위함입니다.

## 핵심 아이디어

### 표준 데코레이터 (TC39)
Konekti의 모든 decorator—`@Module`, `@Controller`, `@Inject`—는 표준 JavaScript decorator입니다. 잘 정의된 context를 받고, 자신이 장식하는 요소의 수정된 버전을 반환하는 함수입니다.
- **Reflect Metadata 없음**: `reflect-metadata`를 사용하지 않습니다. metadata는 구조화된 프레임워크 소유 registry에 저장됩니다.
- **네이티브 속도**: 무거운 reflection library에 의존하지 않기 때문에 애플리케이션 시작과 dependency resolution이 훨씬 빠릅니다.

### 명시적 방식이 암시적 방식보다 우선
레거시 프레임워크는 constructor type을 보고 의존성을 “추측”하는 경우가 많았습니다. Konekti는 **명시성**을 중시합니다.
- `@Inject(UsersService)`를 사용해 의존성을 명확히 선언합니다.
- 이 방식은 코드를 검색 가능하고 감사 가능하게 만들며, 디버깅이 어려운 DI 문제를 만드는 “마법”을 제거합니다.

### 프레임워크 소유 registry
Konekti의 decorator는 중앙 **Framework Registry**를 채우는 “선언” 역할을 합니다. 이 registry는 다음의 단일 진실 공급원입니다:
1. **Dependency Graph**: 어떤 class가 어떤 token에 의존하는지
2. **Routing Table**: 어떤 method가 어떤 HTTP path를 처리하는지
3. **Validation Schema**: 들어오는 JSON을 어떻게 파싱하고 검사해야 하는지

## 데코레이터 계열

- **Structural (`@Module`)**: feature의 경계와 export된 provider를 정의합니다.
- **Component (`@Controller`, `@Service`)**: class가 framework lifecycle의 참여자임을 표시합니다.
- **Dependency (`@Inject`, `@Optional`)**: class와 그 의존성 사이의 계약을 명시적으로 선언합니다.
- **Behavioral (`@Get`, `@Post`, `@UseMiddleware`)**: 특정 method나 class에 runtime logic을 연결합니다.

## 경계

- **Magic Discovery 없음**: Konekti는 파일 시스템을 “스캔”하지 않습니다. metadata는 class가 import되고 decorator가 실행될 때만 등록됩니다.
- **Runtime에서 불변**: 애플리케이션이 bootstrap된 후에는 framework registry가 일반적으로 잠깁니다. 실행 중인 class에 decorator를 동적으로 추가할 수는 없습니다.
- **Type Safety 우선**: decorator가 metadata를 추가하더라도 class의 type signature는 바꾸지 않습니다. IDE와 compiler는 여전히 원래의 깔끔한 TypeScript class를 봅니다.

## 관련 문서

- [Architecture Overview](./architecture-overview.ko.md)
- [DI and Modules](./di-and-modules.ko.md)
- [HTTP Runtime](./http-runtime.ko.md)
- [Core README](../../packages/core/README.ko.md)
