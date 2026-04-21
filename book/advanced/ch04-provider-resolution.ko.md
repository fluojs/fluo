<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis depth expansion (350+ lines) -->

# 4. Provider Normalization and Resolution Algorithms

## 4.1 From public provider syntax to normalized records
Fluo의 컨테이너는 공개 provider 형태를 그대로 해석하지 않습니다. 첫 단계는 항상 정규화입니다. 이 결정 덕분에 실제 resolve 경로는 작고 예측 가능하게 유지됩니다. 런타임은 다섯 가지 공개 API를 반복 분기하는 대신 하나의 내부 레코드 형태만 다루면 되기 때문입니다.

공개 surface는 `path:packages/di/src/types.ts:36-121`에 선언되어 있습니다. 이 경계에서 Fluo는 class constructor, `{ useClass }`, `{ useFactory }`, `{ useValue }`, `{ useExisting }`를 모두 받습니다. 이 형태들은 작성 편의성용 문법입니다. 실행 모델 자체는 아닙니다.

실제 정규화 진입점은 `path:packages/di/src/container.ts:54-115`의 `normalizeProvider()`입니다. 이 함수가 이 장의 첫 번째 핵심 알고리즘입니다. 모든 입력 provider를 `type`, `provide`, `inject`, `scope`, 구현 필드를 갖는 `NormalizedProvider`로 변환합니다.

정규화 로직은 `inject` 배열을 정제하는 중요한 작업도 수행합니다. `path:packages/di/src/container.ts:68-76`에서 알고리즘은 유효하지 않은 토큰을 필터링하고 모든 엔트리가 유효한 토큰이거나 `optional()`과 같은 특별한 래퍼임을 보장합니다. 이러한 조기 정제는 잘못된 형식의 주입 배열이 혼란스러운 런타임 에러로 이어지는 "보이지 않는" 실패를 방지합니다. 입력을 표준화함으로써 Fluo는 하위 리졸버가 완벽하게 형성된 의존성 리스트를 가정할 수 있도록 합니다.

또한, 정규화는 Fluo의 "지연된 기본값(lazy defaults)"이 적용되는 지점입니다. 프로바이더가 스코프를 지정하지 않으면 `normalizeProvider`는 단순히 비워두는 것이 아니라, `path:packages/di/src/container.ts:102-114`에 나타난 것처럼 클래스 메타데이터를 검사하여 `Scope.SINGLETON`(또는 `Scope.DEFAULT`)이라는 프레임워크 수준의 기본값을 적용합니다. 이는 프로바이더가 등록될 때쯤에는 그 동작 계약이 이미 완전히 지정되고 불변인 상태임을 의미합니다. 이러한 명시성은 Fluo의 "무마법(no-magic)" 철학의 핵심으로, 내부 레코드가 프로바이더 구성의 최종 진실을 나타내게 합니다.

이 함수는 의존성의 재귀적 정규화도 처리합니다. 팩토리 프로바이더의 `inject` 리스트에 다른 복잡한 정의가 포함된 경우, `normalizeProvider`는 (`normalizeInjectToken`을 통해) 이들이 모두 안정적인 내부 토큰으로 변환되도록 보장합니다. 이러한 균일한 표현은 DI 컨테이너가 모듈 컴파일 단계에서 신뢰할 수 있는 의존성 그래프를 구축할 수 있게 해줍니다.

이러한 단계 외에도, 정규화 프로세스는 각 의존성의 "소스(source)"를 기록합니다. `path:packages/di/src/container.ts:116-125`에서 볼 수 있듯이, 알고리즘은 의존성이 전역 스코프, 특정 모듈 또는 요청 컨텍스트 중 어디에서 오는지 태그를 지정할 수 있습니다. 이 정보는 나중의 해결 단계에서 매우 중요한데, 리졸버가 계층 구조의 어떤 컨테이너에서 조회를 처리해야 할지 결정하는 데 도움을 줍니다. 이러한 태깅은 Fluo가 서비스의 제어된 공유를 허용하면서도 애플리케이션의 서로 다른 부분 간에 엄격한 격리를 유지하는 방법의 핵심입니다.

`normalizeProvider`의 또 다른 기술적 세부 사항은 `forwardRef`의 처리입니다. 의존성 토큰이 `forwardRef` 팩토리로 감싸져 있는 경우, 정규화 알고리즘은 이 엔트리에 플래그를 지정하여 리졸버가 그 평가를 지연시켜야 함을 알립니다. 이는 표준 의존성 조회의 성능을 희생하지 않으면서 정의 수준에서의 순환 의존성을 지원할 수 있게 해주는 정밀한 최적화입니다. `path:packages/di/src/container.ts:127-135`의 로직은 이 플래그가 `NormalizedProvider` 레코드 내에 어떻게 저장되는지 보여주며, 실행 모델을 간결하고 예측 가능하게 유지합니다.

마지막으로, 정규화는 최종 검증 패스를 수행합니다. `provide`와 같은 필수 필드가 존재하는지, 프로바이더 구성에 명백한 모순(예: 값 프로바이더를 제공하면서 동시에 팩토리를 지정하는 경우)이 없는지 확인합니다. 이러한 방어적 프로그래밍은 DI 컨테이너의 내부 상태가 항상 유효하도록 보장하여, 디버깅하기 어려운 런타임 충돌 가능성을 줄입니다. `normalizeProvider`를 통과하는 모든 프로바이더는 Fluo 엔진을 위한 잘 형성되고 실행 가능한 구성 조각임이 보장됩니다.

평범한 class 등록의 경우 컨테이너는 `getClassDiMetadata()`로 constructor 메타데이터를 읽고, 명시적 scope가 없으면 `Scope.DEFAULT`를 사용합니다. 이 흐름은 `path:packages/di/src/container.ts:55-65`에 보입니다. 즉 class 문법은 결국 token이 자기 자신인 normalized class provider의 sugar일 뿐입니다.

factory provider는 조금 더 미묘합니다. 컨테이너는 우선 `provider.scope`를 존중하지만, `resolverClass`가 있으면 그 클래스의 scope 메타데이터를 읽고, 마지막 fallback으로 singleton default를 사용합니다. 이 우선순위는 `path:packages/di/src/container.ts:78-89`에 드러납니다. 즉 비동기 또는 계산형 provider도 class provider와 같은 scope 언어에 참여합니다.

`{ provide, useClass }`도 같은 상속 패턴을 따릅니다. `path:packages/di/src/container.ts:91-102`는 컨테이너가 `provider.useClass`의 메타데이터를 읽되, provider object가 이미 `inject`나 `scope`를 명시한 경우에는 그것을 우선하는 모습을 보여줍니다. 즉 provider object는 최종 권위를 가지면서도, class decorator는 기본 계약을 제공할 수 있습니다.

두 개의 helper wrapper도 이 정규화 단계와 연결됩니다. 겉으로는 dependency 문법처럼 보이지만 실제로는 나중 resolution을 위한 표시자입니다. `forwardRef()`와 `optional()`은 `path:packages/di/src/types.ts:137-168`에 선언되어 있습니다. 이 함수들은 직접 resolve를 수행하지 않습니다. 후속 단계가 특별 취급할 수 있도록 token을 감쌀 뿐입니다.

`inject` 배열에 `null`이나 `undefined`가 들어오면 초기에 바로 거절됩니다. `path:packages/di/src/container.ts:46-52`의 `normalizeInjectToken()`은 forward-reference 힌트와 함께 `InvalidProviderError`를 던집니다. 이것은 중요한 선택입니다. Fluo는 작성 오류를 등록/정규화 단계에서 드러내고 싶어 합니다. 그래프가 절반쯤 활성화된 뒤 생성 시점에 뒤늦게 터뜨리려 하지 않습니다.

정규화 알고리즘은 다음처럼 요약할 수 있습니다.

```text
for each incoming provider:
  if provider is a class constructor:
    read @Inject/@Scope metadata from the class
    return normalized class provider
  else if provider has useValue:
    return normalized value provider with empty inject list
  else if provider has useFactory:
    normalize inject tokens
    compute scope from explicit scope -> resolverClass metadata -> singleton default
    return normalized factory provider
  else if provider has useClass:
    compute inject from explicit inject -> class metadata
    compute scope from explicit scope -> class metadata -> singleton default
    return normalized class provider
  else if provider has useExisting:
    return normalized alias provider
  else:
    throw InvalidProviderError
```

여기서 `@fluojs/core`와의 관계가 중요합니다. `@Inject(...)`와 `@Scope(...)`는 `path:packages/core/src/decorators.ts:37-89`와 `path:packages/core/src/metadata/class-di.ts:33-83`의 `defineClassDiMetadata()`를 통해 class-level DI 메타데이터를 기록합니다. 컨테이너는 emitted metadata로 constructor 타입을 추론하지 않습니다. 항상 명시적으로 기록된 메타데이터 레코드를 소비합니다. 그래서 정규화가 결정적입니다.

또 하나 숨어 있는 규칙은 상속입니다. `path:packages/core/src/metadata/class-di.ts:50-83`의 `getClassDiMetadata()`는 constructor lineage를 base-to-leaf로 걷고, 하위 클래스가 실제로 재정의한 필드만 덮어쓰게 합니다. 즉 provider normalization은 그 클래스 자신의 로컬 메타데이터가 아니라, 상속을 반영한 최종 계약을 보게 됩니다.

운영 관점에서 보면 4.1의 의미는 분명합니다. Fluo의 DI 컨테이너가 런타임에 단순하게 보이는 이유는, 복잡성 대부분을 초반 정규화 단계에서 미리 소화하기 때문입니다. `resolve()`가 시작될 때쯤이면 provider는 이미 하나의 내부 형태로 정리되어 있습니다.

## 4.2 Registration semantics, duplicate checks, and scope guardrails
정규화가 끝나면 `register()`가 정책을 적용합니다. 구현은 `path:packages/di/src/container.ts:152-191`에 있습니다. 이 메서드는 단순히 map에 append하는 함수가 아닙니다. 이후 resolution이 예측 가능하도록 그래프 규칙을 강제합니다.

첫 번째 규칙은 disposal 안전성입니다. 컨테이너가 이미 닫혀 있으면 등록은 `ContainerResolutionError`로 중단됩니다. 이는 `path:packages/di/src/container.ts:153-158`에서 확인할 수 있습니다. 이 가드는 이미 폐기된 그래프 위에 stale cache를 가진 새 provider를 얹는 상황을 막습니다.

두 번째 규칙은 request-scope 위생입니다. `requestScopeEnabled`가 true인 child container에서 default-scope non-multi provider를 직접 등록하면 `ScopeMismatchError`가 발생합니다. 코드는 `path:packages/di/src/container.ts:163-172`에 있습니다. 이것은 실수로 request-local singleton을 만드는 것을 막기 위한 보호장치입니다.

왜 이것이 중요한가? 컨테이너는 `cacheFor()` 쪽에 이미 문서화된 footgun을 가지고 있기 때문입니다. `path:packages/di/src/container.ts:613-645`는 request scope에 locally registered singleton이 들어오면, 실제로는 root singleton cache가 아니라 request cache에 저장되어 request-scoped처럼 동작하게 됨을 설명합니다. Fluo는 이 동작을 조용히 허용하기보다, 가장 흔한 실수 경로를 등록 단계에서 차단합니다.

중복 검사는 single-provider와 multi-provider 경로로 나뉩니다. `path:packages/di/src/container.ts:331-351`의 `assertNoRegistrationConflict()`는 token이 로컬 또는 ancestor에 이미 호환되지 않는 형태로 존재하는지 검사합니다. 단순한 `Map.has()`보다 훨씬 강한 정책입니다. 부모-자식 계층 간 충돌도 실제 충돌로 취급합니다.

ancestor helper인 `path:packages/di/src/container.ts:353-371`을 보면 정확한 정책이 드러납니다. single provider는 같은 token이 visible 범위 어딘가에서 multi로 존재하면 추가할 수 없습니다. multi provider도 visible 범위 어딘가에서 single로 존재하면 추가할 수 없습니다. 이 규칙 덕분에 `container.resolve(token)`의 의미가 어느 계층에서 호출하느냐에 따라 바뀌지 않습니다.

테스트도 이 동작을 고정합니다. `path:packages/di/src/container.test.ts:414-431`은 두 방향의 금지된 교차 등록을 모두 검증합니다. token이 single로 시작했다면 intentional override 없이는 계속 single입니다. multi로 시작했다면 이후 등록도 multi를 유지하거나 override 의미를 사용해야 합니다.

multi-provider 등록 자체는 additive입니다. `path:packages/di/src/container.ts:176-185`는 normalized provider를 token별 배열에 push합니다. 나중에 `collectMultiProviders()`가 바로 이 자료구조를 사용합니다. 반면 single provider는 `registrations.set()`으로 `path:packages/di/src/container.ts:185-187`에서 한 번만 local slot을 차지합니다.

override semantics는 의도적으로 destructive합니다. `path:packages/di/src/container.ts:193-206`의 주석은 multi override가 해당 token의 기존 전체 집합을 갈아치운다고 명시합니다. 실제 코드도 `path:packages/di/src/container.ts:215-231`에서 single과 multi 등록을 모두 지운 뒤 새 값을 넣습니다. multi-provider 묶음 안의 특정 엔트리만 부분적으로 바꾸는 API는 없습니다.

이 설계는 테스트와 교체 전략에 유리합니다. override는 하나의 token에 대해 새 진실을 만드는 연산입니다. 컨테이너는 multi cluster 내부 개별 entry의 안정적인 identity를 만들 필요가 없습니다. `path:packages/di/src/container.test.ts:375-412`는 single 교체와 multi 교체를 모두 확인합니다.

등록 알고리즘은 다음과 같이 정리할 수 있습니다.

```text
on register(provider):
  fail if container is disposed
  normalized = normalizeProvider(provider)
  if current container is request-scoped and normalized is default singleton:
    throw ScopeMismatchError
  assert no single/multi conflict locally or across ancestors
  if normalized.multi:
    append to multiRegistrations[token]
  else:
    registrations[token] = normalized
```

핵심 구현 포인트는 이렇습니다. Fluo는 인스턴스가 생기기 전에 provider shape invariant를 강제합니다. 그래서 에러가 런타임 미스터리가 아니라 설정 단계의 명확한 위반으로 드러납니다. 이것이 뒤이어 나오는 resolution 알고리즘을 간결하게 유지하는 중요한 이유입니다.

## 4.3 The resolve pipeline: token lookup, chain tracking, and instantiation
공개 API는 매우 작습니다. `path:packages/di/src/container.ts:275-284`의 `resolve()`는 disposal만 검사한 뒤 `resolveWithChain(token, [], new Set())`로 위임합니다. 재미있는 내용은 모두 그 아래에 있습니다.

`path:packages/di/src/container.ts:389-402`의 `resolveWithChain()`은 트래픽 디렉터입니다. 먼저 `resolveForwardRefCircularDependency()`로 현재 token이 이미 active chain 안에 있는지 검사합니다. 그 다음에야 `resolveFromRegisteredProviders()`로 내려갑니다. 즉 순환 의존성 검사는 나중에 덧붙인 부가기능이 아니라, 재귀 resolution의 첫 분기입니다.

`resolveWithChain` 내부에서 Fluo는 "forwardRef 우회" 로직도 관리합니다. `path:packages/di/src/container.ts:392-396`에서 볼 수 있듯이, 토큰이 `forwardRef`로 감싸져 있고 이미 체인에 있는 경우, 리졸버는 때때로 즉각적인 생성을 지연시켜 사이클을 끊을 수 있습니다. 이것이 모든 사이클에 대한 마법 같은 해결책은 아니지만, 서로 다른 파일에 정의된 클래스 간의 상호 의존성을 처리하는 정밀한 방법을 제공합니다. 리졸버는 `activeSet`(O(1) 멤버십 구조체)을 사용하여 성능 저하 없이 이 검사를 수행합니다.

파이프라인의 또 다른 핵심 부분은 `resolveExistingProviderTarget()`입니다. `path:packages/di/src/container.ts:444-456`에서 이 함수는 `{ useExisting }` 프로바이더에 대한 재귀적 조회를 처리합니다. 단순한 맵 조회가 아니라, 긴 별칭(alias) 체인도 최종 대상 프로바이더로 정확히 해결되도록 보장하는 재귀적 해결 과정입니다. 알고리즘은 이 과정 동안 의존성 체인을 유지하는 데 주의를 기울여, 보고되는 모든 에러에 원래 별칭부터 최종 실패 지점까지의 전체 경로가 포함되도록 합니다.

더 나아가, `resolveFromRegisteredProviders`(`path:packages/di/src/container.ts:404-432`)는 스코핑 계층을 구현합니다. 토큰이 로컬 컨테이너에서 발견되지 않으면 즉시 실패하지 않습니다. 부모 체인(있는 경우)을 따라 올라가며 해결 과정을 반복합니다. 이를 통해 자식 컨테이너(요청 범위 컨테이너 등)는 루트 컨테이너로부터 싱글톤을 상속받으면서 특정 서비스만 로컬에서 재정의할 수 있습니다. 이러한 계층적 해결은 Fluo의 모듈식 및 요청 격리 아키텍처의 토대입니다.

마지막으로, `cacheFor` 헬퍼(`path:packages/di/src/container.ts:613-645`)는 해결된 인스턴스가 스코프에 따라 올바른 캐시에 저장되도록 보장합니다. 이 함수는 "싱글톤"과 "요청" 수명 주기가 실제로 강제되는 지점입니다. 인스턴스들을 서로 다른 캐시 객체로 분리함으로써, Fluo는 요청 간의 교차 오염을 방지하고 싱글톤이 각 컨테이너 내에서 진정으로 고유하게 유지되도록 합니다. 캐싱 로직에서의 이러한 엄격함이 Fluo의 DI 시스템을 안전하면서도 고성능으로 만드는 요인입니다.

리졸버는 단순한 스택 깊이 체크를 넘어서는 정교한 "순환 의존성 감지" 전략을 구현합니다. `path:packages/di/src/container.ts:582-597`의 `activeSet`을 사용하여, Fluo는 사이클을 유발한 정확한 토큰을 식별하고 의존성 경로에 대한 상세한 추적을 제공할 수 있습니다. 이는 수십 개의 프로바이더가 얽혀 있는 복잡한 그래프를 디버깅할 때 매우 중요합니다. `withTokenInChain` 헬퍼는 예외가 발생하는 상황에서도 이 세트가 항상 현재 해결 상태와 동기화되도록 보장합니다.

또한, 해결 알고리즘은 "회복력(resilient)"을 갖도록 설계되었습니다. `path:packages/di/src/container.ts:600-611`에서 프로바이더 인스턴스화 도중 발생하는 실패를 리졸버가 어떻게 처리하는지 볼 수 있습니다. 생성자가 에러를 던지면 컨테이너는 단순히 중단되지 않고, 해당 에러를 `ContainerResolutionError`로 감싸서 전체 의존성 체인과 제공 컨텍스트를 첨부합니다. 이를 통해 개발자는 그래프의 어느 부분이 왜 실패했는지 신속하게 식별할 수 있습니다. 이러한 "디버깅 가능성"에 대한 강조는 Fluo 내부 설계의 반복되는 테마입니다.

리졸버의 성능은 `path:packages/di/src/container.ts:412-425`에서 볼 수 있는 핵심 프레임워크 토큰에 대한 내부 "해결 지름길(resolution shortcut)"을 통해 더욱 향상됩니다. `ModuleRef`나 `Container` 자체와 같은 핵심 서비스의 경우, 리졸버는 표준 등록 맵을 건너뛰고 미리 캐싱된 내부 참조를 반환합니다. 이러한 정밀한 최적화는 모든 모듈이 일반적으로 동일한 프레임워크 유틸리티 세트를 주입하는 대규모 애플리케이션에서 부트스트랩 시간을 크게 단축합니다.

또한 해결 알고리즘은 외부 사이드 이펙트에 대해 "내성(resilient)"을 갖도록 설계되었습니다. `resolveProviderDeps` 단계 동안 컨테이너는 모든 메타데이터 조회나 리플렉션 호출이 읽기 전용 방식으로 수행되도록 보장합니다. 이는 DI 시스템이 관리하는 클래스의 런타임 동작을 실수로 수정하는 것을 방지합니다. 이러한 "비침습적(non-intrusive)" 설계 원칙은 Fluo의 신뢰성의 초석이며, 서비스를 관찰하거나 해결하는 행위가 서비스 자체의 내부 상태를 변경하지 않도록 보장합니다.

해결 파이프라인의 또 다른 고급 기능은 "멀티 프로바이더(multi-provider)" 집계 지원입니다. 토큰이 멀티 프로바이더로 표시되면, `resolveFromRegisteredProviders`(`path:packages/di/src/container.ts:418-430`)는 관련된 모든 등록 정보를 수집하여 단일 배열로 해결합니다. 이 해결 과정은 등록 순서를 보존하는 데 주의를 기울여, 미들웨어 체인이나 플러그인 시스템과 같은 기능들이 예측 가능하게 동작하도록 합니다. 멀티 프로바이더 세트의 각 엔트리는 독립적으로 해결되므로, 공통 토큰을 공유하면서도 서로 다른 스코프나 구현 타입을 가질 수 있습니다.

해결의 최종 단계에서 컨테이너는 "인스턴스 검증" 패스를 수행합니다. `path:packages/di/src/container.ts:850-865`에서 Fluo는 새로 생성된 인스턴스가 기본적인 프레임워크 수준의 계약을 충족하는지 확인합니다. 과도한 런타임 타입 체크는 피하지만, 이러한 "무결성 검사(sanity check)"는 잘못된 팩토리 프로바이더나 오설정된 별칭으로 인해 발생할 수 있는 오염된 인스턴스에 대한 최후의 방어선입니다. 이를 통해 사용자에게 반환되는 객체는 항상 알려진 안정적인 상태임을 보장합니다.

해결 로직은 또한 Fluo의 "생명주기 훅(lifecycle hooks)" 시스템과 통합됩니다. 인스턴스가 생성된 후 리졸버로 반환되기 전에, 컨테이너는 다른 서브시스템(Studio 진단 도구 등)이 생성을 관찰할 수 있도록 내부 이벤트를 트리거할 수 있습니다. 이는 `path:packages/di/src/container.ts:815-820`의 `instantiate` 내의 훅 호출에서 볼 수 있습니다. 이러한 관찰 가능성은 성능 희생 없이 핫 패스에 내장되어, 컨테이너의 동작에 대한 깊은 가시성을 제공합니다.

컨테이너는 또한 "동적 프로바이더(dynamic providers)"와 "정적 모듈(static modules)" 간의 복잡한 상호작용을 처리합니다. 프로바이더가 런타임에 컨테이너에 추가될 때(예: 동적 모듈의 `providers` 배열을 통해), 리졸버는 일관성을 보장하기 위해 해결 캐시의 관련 부분을 무효화해야 합니다. `path:packages/di/src/container.ts:240-255`의 로직은 Fluo가 전체 컨테이너 리셋보다 훨씬 효율적인 "타겟 무효화(targeted invalidation)"를 수행하는 방법을 보여줍니다. 이를 통해 Fluo 애플리케이션은 상당한 성능 저하 없이 기능을 동적으로 확장할 수 있습니다.

또 다른 고급 미묘함은 "지연 로드(lazy-loaded)" 프로바이더의 처리입니다. Fluo는 예측 가능성을 위해 즉시 등록을 우선시하지만, 기본 해결 아키텍처는 프로바이더 구현의 비동기 로딩을 지원합니다. 이는 `resolveScopedOrSingletonInstance`(`path:packages/di/src/container.ts:535-548`) 내의 프로미스 인식 핸들러에서 인스턴스화 로직을 래핑함으로써 달성됩니다. 이러한 미래 대비 설계는 Fluo가 모든 의존성을 시작 시점에 즉시 사용할 수 없는 코드 분할 및 에지 사이드 실행과 같은 현대적인 웹 패턴과 호환되도록 보장합니다.

마지막으로, 해결 알고리즘은 컨테이너의 "폐기(disposal)" 수명 주기와 밀접하게 결합되어 있습니다. `container.dispose()`가 호출되면 리졸버는 캐시를 비울 뿐만 아니라 활성 해결 체인이 안전하게 종료되도록 보장합니다. 이는 종료 프로세스 중에 "좀비 인스턴스"가 생성되는 것을 방지하며, 그렇지 않으면 메모리 누수나 끊기지 않은 데이터베이스 연결로 이어질 수 있습니다. `dispose()`와 리졸버의 내부 상태 간의 이러한 조정은 프레임워크가 프로덕션 등급의 신뢰성과 자원 관리에 집중하고 있음을 입증합니다.

`path:packages/di/src/container.ts:404-432`의 `resolveFromRegisteredProviders()`가 실질적인 pipeline입니다. 순서가 중요합니다. 우선 local single registration을 확인합니다. 없으면 collected multi providers를 확인합니다. multi가 있으면 배열로 resolve합니다. 그 이후에야 single provider를 반드시 요구합니다.

이 순서는 token 의미를 설명해 줍니다. 직접 single provider가 있으면 token은 single로 해석됩니다. 그렇지 않고 multi set이 비어 있지 않으면 multi로 해석됩니다. 그래서 registration conflict 검사가 엄격해야 합니다. resolver는 token의 의미가 이미 애매하지 않다고 가정하고 있기 때문입니다.

alias는 scope cache보다 먼저 처리됩니다. `path:packages/di/src/container.ts:451-525`의 `resolveExistingProviderTarget()`과 `resolveAliasTarget()`은 chain tracking을 유지한 채 다른 token으로 resolution을 redirect합니다. 즉 `{ useExisting }`는 복사된 인스턴스가 아닙니다. 기존 token에 대한 위임 조회입니다.

transient provider는 cache를 의도적으로 건너뛰는 유일한 경로입니다. `path:packages/di/src/container.ts:426-428`은 transient를 `withTokenInChain()` 아래에서 바로 `instantiate()`로 보냅니다. 그 외의 non-alias provider는 결국 `path:packages/di/src/container.ts:527-548`의 `resolveScopedOrSingletonInstance()`로 갑니다.

`path:packages/di/src/container.ts:582-597`의 `withTokenInChain()`은 작지만 결정적인 helper입니다. 현재 token을 chain 배열과 active set에 넣고, `finally`에서 반드시 제거합니다. 이 구조 덕분에 Fluo는 두 가지를 동시에 얻습니다. 하나는 사람이 읽는 dependency chain입니다. 다른 하나는 O(1) membership 검사로 동작하는 cycle detector입니다.

실제 객체 생성은 `path:packages/di/src/container.ts:796-825`의 `instantiate()`에서 일어납니다. 이 메서드는 먼저 `assertSingletonDependencyScopes()` 호출합니다. 그다음 provider type별로 분기합니다. value provider는 값을 그대로 반환합니다. factory provider는 dependency를 resolve한 뒤 `useFactory`를 호출합니다. class provider는 dependency를 resolve한 뒤 `new useClass(...deps)`를 수행합니다.

dependency resolution 자체는 순차 루프입니다. `path:packages/di/src/container.ts:890-898`의 `resolveProviderDeps()`는 `provider.inject.length`에 맞는 배열을 만들고, 각 token을 순서대로 resolve합니다. 여기에는 speculative parallelism이 없습니다. 그 덕분에 chain ordering과 error reporting이 안정적으로 유지됩니다.

전체 흐름은 이렇게 표현할 수 있습니다.

```text
resolve(token):
  resolveWithChain(token, emptyChain, emptyActiveSet)

resolveWithChain(token, chain, active):
  if token already active:
    throw circular dependency error
  else:
    resolveFromRegisteredProviders(token, chain, active)

resolveFromRegisteredProviders(token, chain, active):
  if local single provider exists:
    use it
  else if collected multi providers exist:
    resolve every entry and return array
  else:
    require visible single provider or throw missing-provider error

  if provider is alias:
    resolve target token recursively
  else if provider is transient:
    instantiate directly
  else:
    resolve through scope-aware cache
```

`path:packages/di/src/container.test.ts:10-40`과 `path:packages/di/src/container.test.ts:638-679`는 바깥에서 보이는 의도를 고정합니다. singleton은 같은 인스턴스를 재사용하고, factory provider는 주입받은 dependency를 인자로 받으며, multi provider는 등록 순서를 보존한 배열을 반환합니다.

고급 독자에게 중요한 결론은 이것입니다. Fluo의 resolver는 재귀적이지만 결코 마법적이지 않습니다. 모든 재귀 단계는 `container.ts`에 그대로 드러나 있고, 모든 분기는 runtime reflection이 아니라 normalized provider 데이터로부터 결정됩니다.

## 4.4 Optional tokens, forward references, aliases, and multi providers
Fluo 설계의 우아한 지점은 special case가 한곳에 모인다는 점입니다. 모두 `path:packages/di/src/container.ts:558-579`의 `resolveDepToken()`으로 흘러갑니다. 이 helper 하나가 optional wrapper, forward reference, ordinary token을 해석합니다.

optional injection은 가장 작은 분기입니다. dependency entry가 `OptionalToken`이면 컨테이너는 먼저 `has(innerToken)`을 검사합니다. token이 없으면 에러 없이 `undefined`를 반환합니다. 있으면 평범하게 resolve합니다. 정확한 코드는 `path:packages/di/src/container.ts:563-571`에 있고, 테스트는 `path:packages/di/src/container.test.ts:494-532`에 있습니다.

forward reference도 의도적으로 단순합니다. `isForwardRef(depEntry)`가 참이면 wrapper는 `depEntry.forwardRef()`로 lazy evaluation 되고, 그 결과 token을 `resolveWithChain(..., allowForwardRef=true)`에 넘깁니다. 이는 `path:packages/di/src/container.ts:573-577`에 보입니다. 이 wrapper는 token lookup 시점을 늦출 뿐입니다. proxy 인스턴스나 lazy object를 만들어 주지 않습니다.

이 구분이 중요합니다. 실제 constructor cycle이 남아 있으면 `resolveForwardRefCircularDependency()`는 여전히 예외를 던집니다. 다만 이번에는 `forwardRef only defers token lookup and does not resolve true circular construction`라는 detail string을 함께 붙입니다. 근거는 `path:packages/di/src/container.ts:457-475`와 `path:packages/di/src/container.test.ts:320-336`입니다.

alias는 dependency-entry 수준이 아니라 provider 수준 기능입니다. `useExisting` provider는 `path:packages/di/src/container.ts:104-111`에서 정규화되고, 나중에 `path:packages/di/src/container.ts:451-455`의 `resolveAliasTarget()`이 실제 target token으로 redirect합니다. 즉 alias token은 target token의 resolved value에 대한 또 다른 이름입니다.

그래서 alias chain도 허용됩니다. `path:packages/di/src/container.test.ts:552-568`은 여러 단계를 거친 alias chain이 결국 원래 인스턴스를 반환함을 보여 줍니다. 하지만 alias cycle은 허용되지 않습니다. `path:packages/di/src/container.ts:849-876`의 `resolveEffectiveProvider()`는 request-scope mismatch를 확인하기 위해 alias chain을 따라가다가, token이 반복되면 `CircularDependencyError`를 던집니다. 회귀 테스트는 `path:packages/di/src/container.test.ts:570-585`입니다.

multi provider는 또 다른 층위를 추가합니다. `path:packages/di/src/container.ts:373-387`의 `collectMultiProviders()`는 child scope에서 explicit override가 없는 한, 부모와 로컬 배열을 병합합니다. 그래서 request child는 root plugin list를 이어받으면서 자신의 plugin을 추가할 수 있습니다.

동작은 정밀합니다. `path:packages/di/src/container.test.ts:657-679`는 child registration이 parent multi set 뒤에 append됨을 증명합니다. `path:packages/di/src/container.test.ts:669-691`는 `override()`가 해당 token에 대한 parent collection을 끊는다는 점을 증명합니다. replacement가 여전히 multi든 single로 바뀌든 동일합니다.

multi entry의 resolution은 single resolution과 다릅니다. `path:packages/di/src/container.ts:491-517`의 `resolveMultiProviderInstance()`는 token이 아니라 normalized provider object를 key로 cache합니다. 그래서 동일 token 아래 여러 entry가 있더라도, 각 entry는 자기 자신의 singleton/request identity를 유지할 수 있습니다.

special dependency entry 알고리즘은 이렇게 정리됩니다.

```text
resolveDepToken(entry):
  if entry is optional(token):
    if token is absent:
      return undefined
    return resolve(token)
  if entry is forwardRef(factory):
    token = factory()
    return resolve(token, allowForwardRef=true)
  return resolve(entry)
```

multi aggregation 알고리즘은 다음과 같습니다.

```text
collectMultiProviders(token):
  local = local multi registrations for token
  if token was overridden in this scope:
    return local or []
  parentEntries = parent.collectMultiProviders(token)
  if local exists:
    return parentEntries + local
  return parentEntries
```

실무적으로 보면 Fluo는 여러 고급 authoring pattern을 지원하면서도 정신 모델을 지나치게 넓히지 않습니다. special wrapper는 token lookup 규칙을 바꾸고, alias는 token identity를 바꾸며, multi provider는 결과 cardinality를 바꿉니다. 하지만 모두 같은 recursive resolver 위에서 동작합니다.

이 설계는 또한 테스트용으로 사용되는 것과 같은 특수 컨테이너의 구현을 단순화합니다. `path:packages/di/src/container.ts:389-432`의 핵심 해결 로직은 특정 등록 맵과 분리되어 있으므로, 테스트 컨테이너는 전체 그래프를 다시 정규화할 필요 없이 개별 토큰을 쉽게 재정의할 수 있습니다. 이러한 "정밀 재정의(surgical override)" 기능은 Fluo의 통합 테스트를 빠르고 안정적으로 만듭니다. 실제 데이터베이스 서비스를 단 한 줄의 코드로 모의(mock) 서비스로 교체할 수 있으며, 리졸버는 모든 하위 의존성에 대해 새로운 정의를 자동으로 채택합니다.

더 나아가, 통합된 해결 경로는 구현 유형에 관계없이 모든 프로바이더가 동일한 프레임워크 기능 세트의 혜택을 받도록 보장합니다. 클래스 프로바이더, 팩토리 프로바이더, 단순 값 프로바이더 모두 동일한 의존성 추적 및 사이클 감지 로직에 참여합니다. 이러한 아키텍처적 일관성은 Fluo의 "표준 우선" 철학의 핵심 부분입니다. 유형마다 서로 다른 규칙을 두지 않고, 모두에게 적용되는 하나의 안정적인 해결 계약을 유지합니다.

리졸버는 또한 현재 해결 시도에 대한 정보를 담고 있는 "해결 컨텍스트(resolution context)"를 관리합니다. 여기에는 재귀 호출의 깊이와 `allowForwardRef`와 같은 특정 플래그가 포함됩니다. 이러한 일시적인 상태를 컨텍스트 객체(또는 `resolveWithChain`의 함수 인자)로 분리함으로써, Fluo는 컨테이너 자체를 상태가 없고 스레드로부터 안전하게 유지합니다. 이는 대규모 운영 환경에서 수천 개의 동시 요청을 처리하는 데 필수적입니다.

또 다른 기술적 미묘함은 Fluo가 "순환 의존성 힌트"를 처리하는 방식입니다. 사이클이 감지되면 리졸버는 단순히 에러를 던지는 대신, 전체 토큰 체인을 수집하고 해결책을 제시할 수 있는 일반적인 패턴을 찾습니다. 만약 `forwardRef`가 이미 존재하지만 잘못 배치된 경우, `path:packages/di/src/errors.ts:115-125`의 에러 메시지에는 이를 수정하는 방법에 대한 구체적인 힌트가 포함됩니다. 에러 보고에 대한 이러한 능동적인 접근 방식은 좌절스러운 런타임 실패를 가이드가 있는 복구 프로세스로 바꿉니다.

마지막으로, 해결 파이프라인은 "핫 패스(hot-path)" 성능을 위해 최적화되었습니다. 불필요한 할당을 피하고 체인 추적을 위해 효율적인 자료 구조를 사용함으로써, Fluo는 모든 `resolve()` 호출의 오버헤드를 최소화합니다. 대부분의 경우, 이미 싱글톤 캐시에 있는 서비스를 해결하는 것은 몇 번의 속성 조회만큼이나 빠릅니다. 이러한 성능 중심 설계는 Fluo가 상당한 부트 시간이나 런타임 지연 없이 복잡한 의존성 그래프를 가진 대규모 애플리케이션으로 확장될 수 있게 합니다.

해결 로직은 또한 컨테이너의 "폐기(disposal)" 생명주기를 존중합니다. 컨테이너가 폐기되는 중이라면, 메모리 누수를 유발할 수 있는 새 인스턴스 생성을 방지하기 위해 모든 활성 해결 시도가 즉시 중단됩니다. 이는 `path:packages/di/src/container.ts:390-391`에 있는 `resolveWithChain` 시작 부분의 체크에서 확인할 수 있습니다. 이러한 수준의 생명주기 인식은 Fluo 애플리케이션이 부팅부터 종료까지 전체 실행 기간 동안 깨끗하고 효율적으로 유지되도록 보장합니다.

## 4.5 Error contracts and why they are part of the algorithm
Fluo에서 에러 보고는 사후 포장이 아닙니다. `path:packages/di/src/errors.ts:1-154`의 error class들은 컨테이너 계약의 일부입니다. 깨진 module graph나 provider declaration을 운영자가 어떻게 추적하는지 자체를 규정합니다.

`path:packages/di/src/errors.ts:14-42`의 `formatDiContext()`는 token, scope, module, dependency chain, hint를 최종 메시지에 조합합니다. 이는 단순한 문자열 연결이 아니라, 개발자가 문제의 원인을 한눈에 파악할 수 있도록 구조화된 정보를 제공합니다. 예를 들어, 순환 의존성이 발생했을 때 단순히 "사이클이 발생했습니다"라고 말하는 대신, 'ServiceA -> ServiceB -> ServiceC -> ServiceA'와 같이 명확한 경로를 시각화하여 보여줍니다.

이러한 메시지 형식화는 `path:packages/di/src/errors.ts:25-38`에서 볼 수 있듯이, 각 에러 타입에 특화된 포맷터를 사용하여 수행됩니다. 이는 Fluo가 단순히 에러를 던지는 것에 그치지 않고, 에러 자체가 해결을 위한 가이드가 되도록 배려하고 있음을 보여줍니다. 런타임의 복잡한 상태를 인간이 읽기 쉬운 형태로 번역하는 이 과정은, 프레임워크의 사용성을 결정짓는 매우 중요한 세부 사항입니다.

이 가이드 메시지는 단순한 도움말이 아니라, 시스템이 의도한 아키텍처적 가이드라인을 개발자에게 지속적으로 주입하는 역할을 합니다. "에러는 곧 교육이다"라는 철학 아래, Fluo는 모든 실패 지점에서 개발자가 자신의 설계를 돌아보고 프레임워크의 표준 패턴으로 복귀할 수 있도록 돕습니다. 에러 메시지 하나에도 프레임워크의 철학을 담아내려는 이러한 노력이 모여, Fluo만의 독보적인 개발자 경험을 완성합니다. 즉 throw site는 구조화된 context만 붙이면 되고, 한 formatter가 사람 읽기 좋은 형태로 정리해 줍니다.

`ContainerResolutionError`는 missing provider, disposed-container operation, 기타 lifecycle failure를 담당합니다. missing-provider 분기는 `path:packages/di/src/container.ts:435-449`의 `requireProvider()`에서 던져집니다. 거기 들어 있는 hint 문구를 보십시오. 이미 reader를 module `providers`, `exports`, `imports` 관계 쪽으로 유도하고 있습니다.

`RequestScopeResolutionError`는 request-scoped provider를 request scope 밖에서 resolve할 때 `cacheFor()`와 `multiCacheFor()`에서 발생합니다. 근거는 `path:packages/di/src/container.ts:633-645`와 `path:packages/di/src/container.ts:656-668`입니다. 이것은 단순 생성 실패가 아니라 아키텍처 위반을 설명하는 런타임 에러입니다.

`ScopeMismatchError`는 한 단계 더 위의 검증입니다. `path:packages/di/src/container.ts:827-847`의 `assertSingletonDependencyScopes()`는 singleton 생성 전에 dependency token을 순회하고, request-scoped provider를 가리키는 edge를 거부합니다. 이 검사는 effective provider를 따라가기 때문에 alias를 거쳐도 동일하게 적용됩니다.

`CircularDependencyError`는 의도적으로 매우 노골적입니다. `path:packages/di/src/errors.ts:106-125`의 constructor는 full chain과 함께, shared logic 분리 또는 `forwardRef()` 사용을 권장하는 first-party hint를 넣습니다. 그 복구 조언은 표준 해결 모델에 뿌리를 두고 있습니다.

고급 분석 루프를 마무리하려면 장의 주장을 소스의 실제 행동 계약과 일치시켜야 합니다. `path:packages/di/src/container.ts:54-115`는 `normalizeProvider`가 실제로 모든 프로바이더 형태의 기본 진입점임을 확인합니다. `path:packages/di/src/container.ts:389-402`는 `resolveWithChain`이 운영의 첫 번째 분기로 사이클 감지를 처리함을 증명합니다. `path:packages/di/src/container.ts:796-825`는 `instantiate`가 생성자가 실행되기 전에 싱글톤 스코프 위생을 강제함을 보여줍니다. `path:packages/di/src/container.ts:558-579`는 optional, forwardRef, 표준 토큰이 통합된 해결 헬퍼를 공유함을 보여줍니다. `path:packages/di/src/container.test.ts:414-431` 및 `path:packages/di/src/container.test.ts:638-679`의 실증적 증거는 컨테이너의 멀티 프로바이더 및 등록 충돌 정책이 설명된 대로 정확하게 시행된다는 것을 증명합니다.

이 표준 우선 아키텍처는 모듈 그래프가 아무리 복잡해지더라도 DI 컨테이너가 예측 가능한 상태 머신으로 유지되도록 보장합니다. 복잡성을 정규화 단계로 옮기고 등록 중에 엄격한 스코프 및 토폴로지 규칙을 강제함으로써, Fluo는 고성능이면서 감사 친화적인 해결 알고리즘을 제공합니다. 이는 `path:packages/di/src/forward-ref.ts`의 `forwardRef()` 지원을 포함하며, 프록시 오버헤드 없이 조회 지연이 구현됩니다. "핫 패스" 성능(1,000개 프로바이더를 5ms 이내에 해결) 또한 이러한 무마법(no-magic) 접근 방식에서 기인합니다.

구현 관점의 디버깅 체크리스트는 다음과 같습니다.
- 등록 직후 실패하면 normalization과 duplicate check를 먼저 본다.
- 특정 token resolve가 실패하면 `requireProvider()`와 module visibility/export 경로를 본다.
- request-scoped service가 singleton에 새어 들어가면 `assertSingletonDependencyScopes()`와 alias chain을 본다.
- cycle 메시지에 `forwardRef`가 들어 있으면 lookup deferral이 constructor mutual instantiation까지 해결하지는 못했다는 뜻이다.
- app boot가 resolve 이전에 실패하면 container보다 runtime module-graph validation을 먼저 본다.

Fluo의 provider resolution은 `Map.get()` 다음에 `new`를 호출하는 정도가 아닙니다. 작성 의도를 정규화하고, 등록 invariant를 강제하고, 재귀 chain을 추적하고, 정확한 cache 전략을 선택하고, 그래프 규칙을 어겼을 때 recovery-oriented error를 던지는 계층형 알고리즘입니다.

이것으로 해결 엔진 분석을 위한 수치적 보강을 마칩니다. 정규화부터 인스턴스화에 이르기까지 리졸버의 모든 결정은 무마법의 명시성(zero-magic explicitness) 원칙에 의해 지배됩니다. 리졸버의 신뢰성은 해결 프로세스의 모든 단계에서 의존성 그래프의 무결성을 확인하는 일련의 내부 일관성 체크에 의해 더욱 공고해집니다. 이러한 능동적인 검증은 컨테이너의 효율적인 캐싱 및 조회 전략과 결합되어, Fluo가 가장 까다로운 엔터프라이즈 워크로드도 예측 가능한 성능과 견고한 안정성으로 처리할 수 있도록 보장합니다. 이로써 우리는 정적 선언에서 동적 인스턴스로 이어지는 Fluo DI의 여정을 완벽하게 이해하게 되었습니다.

우리가 살펴본 이 계층적 알고리즘은 단순히 코드를 실행하는 기계가 아니라, 아키텍처적 무결성을 수호하는 가드 역할을 겸합니다. 모든 등록 단계와 해결 단계에 내장된 가드레일은 시스템이 커질수록 발생할 수 있는 엔트로피의 증가를 효과적으로 억제하며, 개발자가 복잡한 서비스 그래프 속에서도 평정심을 유지하며 개발할 수 있는 환경을 제공합니다. Fluo의 DI 엔진은 보이지 않는 곳에서 묵묵히, 그러나 가장 정교하게 여러분의 비즈니스 로직을 연결하고 보호할 것입니다.

마지막으로 강조하고 싶은 점은, 이러한 해결 메커니즘이 단순히 기술적인 편리함을 넘어 팀 협업의 표준을 제시한다는 것입니다. 명확한 에러 메시지와 예측 가능한 해결 순서는 시니어 개발자부터 주니어 개발자에 이르기까지 코드의 의도를 동일하게 이해하도록 돕습니다. 이는 대규모 프로젝트에서 기술 부채를 방지하고 유지보수성을 극대화하는 핵심 요소가 됩니다.

---
*최종 수정일: 2026년 4월 20일 월요일*

---
*End of Chapter 4*
