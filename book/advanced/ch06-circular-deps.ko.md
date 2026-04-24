<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis draft for circular dependency detection and escape hatches -->

# Chapter 6. Circular Dependency Detection and Escape Hatches

이 장은 Fluo 컨테이너가 순환 의존성을 어떻게 탐지하고, 어떤 경우에 `forwardRef()`가 도움이 되며, 어떤 경우에는 구조를 다시 나눠야 하는지를 다룹니다. Chapter 5에서 scope와 캐시 정책을 정리했다면, 이제 DI 그래프가 깨지는 지점을 읽고 복구하는 규칙을 배웁니다.

## Learning Objectives
- active token 집합과 readable chain으로 순환 의존성을 감지하는 방식을 이해합니다.
- `forwardRef()`가 해결하는 문제와 해결하지 못하는 문제를 구분합니다.
- alias chain과 scope validation에서도 cycle이 드러나는 이유를 설명합니다.
- provider cycle과 module import cycle이 서로 다른 실패 단계임을 정리합니다.
- 실제 코드베이스에서 순환을 끊는 리팩터링 전략을 도출합니다.
- 다음 고급 DI 주제로 넘어가기 전에 그래프 안정성 점검 기준을 정리합니다.

## Prerequisites
- Chapter 4와 Chapter 5 완료.
- Fluo resolve 파이프라인, alias 처리, scope 검증 흐름에 대한 이해.
- 생성자 주입 기반 DI 그래프에서 순환 참조가 왜 문제가 되는지에 대한 기본 감각.

## 6.1 The container detects cycles with an active-token set plus a readable chain
Fluo의 circular dependency 로직은 의도적으로 단순하고 노골적입니다. constructor proxy, partially initialized instance, reflection trick에 의존하지 않습니다. 대신 재귀 resolution 동안 두 가지 상태를 유지합니다. 순서를 보존하는 `chain` 배열과, 현재 활성 토큰을 추적하는 `activeTokens` 집합입니다.

공개 `resolve()` 호출은 `path:packages/di/src/container.ts:275-284`에서 두 구조를 빈 상태로 시작합니다. 그 다음 모든 재귀 하강은 `path:packages/di/src/container.ts:389-402`의 `resolveWithChain()`을 통과합니다. cycle 검사가 일어나는 첫 지점이 바로 여기입니다.

실제 detector는 `path:packages/di/src/container.ts:457-475`의 `resolveForwardRefCircularDependency()`입니다. 이름과 달리 ordinary cycle과 `forwardRef()` 이후에 만난 cycle을 모두 처리합니다. 핵심 질문은 단 하나입니다. "이 token이 현재 construction chain 안에서 이미 active한가?"

token이 active하지 않으면 resolution은 계속됩니다. 이미 active라면 Fluo는 `CircularDependencyError`를 던집니다. 그리고 이 재귀 edge가 forward reference에서 왔다면, 에러에는 `forwardRef`가 token lookup만 지연시켰다는 더 구체적인 설명이 추가됩니다.

chain과 active set은 `path:packages/di/src/container.ts:582-597`의 `withTokenInChain()`이 관리합니다. 이 helper는 token을 배열과 집합에 넣고, 중첩 resolution을 수행한 뒤, `finally`에서 둘 다 제거합니다. 이 구조가 바로 Fluo 에러 메시지 품질의 핵심 알고리즘 패턴입니다.

집합은 빠른 membership check를 제공합니다. 배열은 사람이 읽을 수 있는 순서를 보존합니다. 둘 중 하나만 있으면 성능이나 메시지 가독성 중 하나를 포기해야 합니다. Fluo는 아주 작은 복잡성 증가로 둘 다 유지합니다.

기본 cycle 알고리즘은 다음과 같습니다.

```text
before resolving token T:
  if T is already in activeTokens:
    throw CircularDependencyError(chain + T)
  add T to activeTokens
  append T to chain
  resolve nested dependencies
  remove T from activeTokens
  pop T from chain
```

테스트는 이 동작을 점점 더 어려운 그래프에서 검증합니다. `path:packages/di/src/container.test.ts:219-229`는 직접적인 `A -> A` 사례를 다룹니다. `path:packages/di/src/container.test.ts:231-267`는 두 노드 `A -> B -> A` cycle을 다룹니다. `path:packages/di/src/container.test.ts:338-363`는 더 깊은 `A -> B -> C -> A` 체인을 다룹니다.

여기에는 중요한 비순환 대조 테스트도 있습니다. `path:packages/di/src/container.test.ts:269-297`은 diamond graph는 합법임을 보여 줍니다. 즉 Fluo는 단순히 과거에 본 token이라고 해서 거부하지 않습니다. 현재 unfinished chain 안에서 다시 등장할 때만 거부합니다.

constructor DI에 필요한 엄격함은 바로 이 정도입니다. 공유 dependency를 여러 경로에서 재사용하는 것은 괜찮습니다. 끝나지 않은 constructor chain 안으로 재진입하는 것은 안 됩니다.

## 6.2 What forwardRef actually solves and what it does not
circular dependency에서 가장 흔한 오해는 `forwardRef()`가 cycle 자체를 해결해 준다고 믿는 것입니다. Fluo에서 `forwardRef()`는 더 좁고 정직한 역할만 수행합니다. token lookup을 resolution 시점까지 지연할 뿐입니다. lazy object를 만들어 주지도 않고, 서로가 서로를 기다리는 constructor 완료를 가능하게 해 주지도 않습니다.

wrapper는 `path:packages/di/src/types.ts:123-149`에 선언되어 있습니다. `forwardRef(fn)`은 `__forwardRef__`와 `forwardRef()` callback을 가진 객체를 반환합니다. 그 안에 숨겨진 다른 메커니즘은 없습니다.

resolution은 이 wrapper를 오직 한 곳에서만 특별 취급합니다. `path:packages/di/src/container.ts:558-579`의 `resolveDepToken()`은 `isForwardRef(depEntry)`를 검사하고, callback을 평가한 뒤, `resolveWithChain(resolvedToken, chain, activeTokens, true)`를 호출합니다. 이 마지막 boolean이 핵심입니다. 지금 들어가는 재귀 edge가 forward reference에서 왔음을 표시합니다.

왜 이것이 중요한가? 나중에 resolved token이 이미 active하다는 사실이 드러나면, `resolveForwardRefCircularDependency()`가 `path:packages/di/src/container.ts:467-471`의 더 정확한 메시지를 낼 수 있기 때문입니다. Fluo는 declaration-time lookup 문제와 construction-time cycle 문제를 분리해서 말하고 있습니다.

테스트는 두 측면을 모두 잡아 냅니다. `path:packages/di/src/container.test.ts:299-318`은 `forwardRef(() => ServiceB)`가 성공하는 사례를 보여 줍니다. Service A가 Service B를 lazy하게 가리키지만, Service B는 constructor 동안 Service A를 다시 요구하지 않습니다.

실패 사례도 그만큼 중요합니다. `path:packages/di/src/container.test.ts:320-336`은 양쪽을 모두 `forwardRef()`로 감싸도 여전히 `CircularDependencyError`가 나야 한다고 검증합니다. 그리고 테스트는 `/forwardRef only defers token lookup/i`라는 메시지 조각까지 확인합니다. 이것이 바로 프레임워크가 전달하려는 교훈입니다.

실무 규칙은 간단합니다. 문제가 declaration order라면 `forwardRef()`를 사용하십시오. 두 constructor가 실제로 서로를 필요로 하는 설계라면, `forwardRef()`는 에러 시점을 늦출 뿐 해결책이 아닙니다.

`forwardRef()` 알고리즘은 이렇게 적을 수 있습니다.

```text
if dependency entry is forwardRef(factory):
  token = factory()
  resolve token with allowForwardRef=true
  if token is already active:
    throw cycle error explaining that lookup deferral was insufficient
```

이 명료함은 Fluo의 큰 장점입니다. 많은 DI 시스템은 lookup indirection과 lifecycle indirection을 흐리게 섞습니다. Fluo는 둘을 분리하기 때문에 circular-dependency 디버깅이 훨씬 덜 신비해집니다.

## 6.3 Alias chains and scope validation can also surface cycles
대부분의 독자는 cycle을 class-to-class injection loop로만 생각합니다. 하지만 Fluo 구현을 보면 alias도 cycle을 만들 수 있음을 알 수 있습니다. `useExisting`은 얼핏 무해해 보이기 때문에 이 부분이 특히 중요합니다.

alias provider는 `path:packages/di/src/container.ts:104-111`에서 정규화되고, 런타임에는 `path:packages/di/src/container.ts:451-455`의 `resolveAliasTarget()`을 통해 다른 token lookup으로 redirect됩니다. 보통 resolution에서 이 동작은 단순한 위임처럼 보입니다.

하지만 scope validation은 더 깊은 시야를 필요로 합니다. singleton을 instantiate하기 전에, `path:packages/di/src/container.ts:827-847`의 `assertSingletonDependencyScopes()`는 각 dependency token을 effective provider까지 추적합니다. 이 작업은 `path:packages/di/src/container.ts:849-876`의 `resolveEffectiveProvider()`가 담당합니다.

`resolveEffectiveProvider()`는 루프 안에서 alias chain을 따라갑니다. 그리고 main resolver의 cycle detector처럼 `visited` set과 `chain` 배열을 유지합니다. 이미 본 token으로 다시 돌아오면 즉시 `CircularDependencyError`를 던집니다.

이 동작은 테스트로 직접 검증됩니다. `path:packages/di/src/container.test.ts:570-585`는 `useExisting`만으로 `TOKEN_A -> TOKEN_B -> TOKEN_A`를 만들고, 그 뒤 `TOKEN_A`를 service에 주입합니다. 컨테이너는 singleton scope 검사 단계에서 그래프를 거부합니다.

여기에는 또 하나의 뉘앙스가 있습니다. scope validation은 cycle 때문만이 아니라 진짜 lifetime semantics를 보기 위해 alias chain을 따라갑니다. `path:packages/di/src/container.test.ts:587-635`는 alias chain의 최종 목적지가 request-scoped provider면, singleton consumer는 여전히 `ScopeMismatchError`를 받는다는 것을 증명합니다. Fluo는 aliasing이 짧은 lifetime을 다른 token 이름 뒤에 숨기는 것을 허용하지 않습니다.

alias traversal은 이렇게 이해할 수 있습니다.

```text
resolveEffectiveProvider(token):
  while provider for token is useExisting:
    if token already visited:
      throw CircularDependencyError
    token = provider.useExisting
  return final non-alias provider
```

작은 알고리즘이지만 두 가지 미묘한 버그를 막습니다. 첫째, alias loop가 조용히 컨테이너를 멈춰 세우지 못합니다. 둘째, scope check가 작성자가 붙인 token 이름이 아니라 effective provider reality를 기준으로 수행됩니다.

고급 사용자라면 여기서 일관성을 읽어야 합니다. Fluo는 alias를 first-class graph edge로 취급합니다. visibility, scope, lifetime에 참여하는 edge라면, cycle detection에도 동일하게 참여합니다.

## 6.4 Provider cycles and module import cycles are separate failure phases
Fluo에서 가장 유용한 구분 중 하나는 provider-level circular dependency와 module-level import cycle을 분리한다는 점입니다. 개념적으로는 비슷해 보여도, 서로 다른 위치에서 서로 다른 이유로 실패합니다.

provider cycle은 DI container 내부 token resolution 단계에서 발생합니다. 관련 코드는 이미 본 `path:packages/di/src/container.ts:389-597`입니다. 이 에러는 컨테이너가 하나 이상의 provider constructor를 끝까지 완료할 수 없다는 뜻입니다.

반면 module import cycle은 runtime module-graph compilation 단계에서 더 일찍 거부됩니다. 핵심 알고리즘은 `path:packages/runtime/src/module-graph.ts:185-233`의 `compileModule()`입니다. 모듈을 컴파일하기 전에 runtime은 `moduleType`이 이미 `visiting` set 안에 있는지 검사합니다. 있다면 `Circular module import detected` 메시지와 함께 `ModuleGraphError`를 던집니다.

정확한 throw site는 `path:packages/runtime/src/module-graph.ts:200-208`입니다. 거기에 들어 있는 hint도 주목할 만합니다. 공유 provider를 분리된 제3의 모듈로 추출해 두 원래 모듈이 서로가 아니라 그 모듈을 가져오라고 권장합니다. 이것은 DI workaround가 아니라 module topology refactoring 가이드입니다.

이 실패는 `bootstrapModule()`이 provider를 container에 등록하기 전에 일어납니다. `path:packages/runtime/src/bootstrap.ts:372-398`을 보면 module graph compilation이 먼저, container creation이 두 번째, module provider registration이 세 번째입니다. 즉 module compilation 단계에서 실패했다면 DI container는 아직 resolution을 시작조차 하지 않았습니다.

이 phase 구분은 실전에서 매우 유용합니다. 에러가 `ServiceA -> ServiceB -> ServiceA` 같은 token chain을 말하면 provider injection을 보십시오. 에러가 module type과 import array를 말하면 `@Module({ imports: [...] })` 또는 `defineModule(...)` 구성을 보십시오.

두 알고리즘은 겉으로 비슷하지만 질문 자체가 다릅니다.

```text
provider cycle question:
  can constructor resolution finish without revisiting an active token?

module cycle question:
  can the runtime topologically order imported modules without revisiting a module currently being compiled?
```

Fluo가 둘을 분리하는 이유는 recovery strategy도 다르기 때문입니다. provider cycle은 constructor responsibility를 재설계하거나, 정말 declaration ordering만 문제라면 `forwardRef()`로 해결할 수 있습니다. 반면 module cycle은 구조 문제이므로 보통 shared module로 export를 이동해야 합니다.

이 분리는 아키텍처 성숙도의 신호입니다. 프레임워크는 모든 그래프 에러를 하나의 generic "dependency cycle" 버킷으로 뭉개지 않습니다. 어느 그래프가 깨졌는지 구체적으로 알려 줍니다.

## 6.5 Practical strategies for breaking cycles without hiding design problems
이제 Fluo가 cycle을 어디서 탐지하는지 알았으니, 다음 질문은 설계 문제를 숨기지 않으면서 cycle을 어떻게 제거하느냐입니다. 프레임워크가 직접 주는 힌트와 구현 구조를 보면 세 가지 패턴이 보입니다.

첫 번째 패턴은 shared logic을 제3의 provider로 추출하는 것입니다. 이 방향은 `path:packages/di/src/errors.ts:113-123`의 `CircularDependencyError`가 직접 권장합니다. 예를 들어 `UserService`와 `AuditService`가 서로를 직접 주입해야 한다면, 실제 필요한 것은 서로가 아니라 `UserPolicyService`나 `AuditFacade`일 수 있습니다.

두 번째 패턴은 constructor-time dependency를 더 늦은 interaction boundary로 바꾸는 것입니다. 예를 들어 한 서비스가 다른 서비스를 직접 들고 있기보다, event를 발행하거나 callback을 받는 구조로 바꿀 수 있습니다. Fluo 컨테이너는 partially initialized object graph를 허용하지 않기 때문에, 자연스럽게 이런 분리를 유도합니다.

세 번째 패턴은 declaration order만 진짜 문제일 때에만 `forwardRef()`를 사용하는 것입니다. 두 파일이 서로를 참조하지만, 실제 construction 동안 한쪽만 상대를 필요로 한다면 `forwardRef()`가 적절합니다. 반대로 두 constructor가 즉시 서로를 필요로 한다면, 그것은 에러 시점만 늦출 뿐입니다.

module cycle에 대해서는 runtime hint가 대응되는 구조적 수정을 제안합니다. `path:packages/runtime/src/module-graph.ts:200-208`의 메시지처럼, 공유 provider를 제3의 모듈로 옮기고, 그 모듈에서 export한 뒤, 원래 두 모듈이 서로 대신 그 shared module을 import하게 만드십시오.

구현 관점의 decision tree는 다음과 같습니다.

```text
if cycle is in provider resolution:
  check whether one edge is only declaration-order sensitive
  if yes, consider forwardRef()
  if no, extract shared logic or move interaction to runtime/event boundary

if cycle is in module imports:
  do not use forwardRef()
  move shared exports into a third module
  let both original modules import the shared module instead
```

테스트는 이 권고를 간접적으로 뒷받침합니다. 컨테이너는 `path:packages/di/src/container.test.ts:269-297`의 non-circular diamond graph를 허용합니다. shared dependency를 제대로 추출하고 나면 자주 나타나는 형태가 바로 이것입니다.

이 장의 마지막 교훈은 이렇습니다. Fluo의 cycle handling은 의도적으로 보수적입니다. partially initialized object나 implicit proxy로 그래프를 억지로 만들기보다, 그래프를 거부합니다. 고급 사용자에게 이것은 제약만이 아니라 설계 신호입니다. 실제 ownership과 dependency boundary를 container magic 뒤에 숨기지 않고, 코드베이스가 그대로 드러내도록 만들기 때문입니다.

이 보수적인 접근을 제대로 쓰려면 컨테이너가 순환 그래프 안의 트랜지언트(transient)와 요청 스코프(request-scoped) 프로바이더도 같은 기준으로 다룬다는 점을 이해해야 합니다. 싱글톤은 부트스트랩 단계에서 일찍 드러나는 경우가 많지만, 수명이 짧은 프로바이더는 resolve 시점까지 늦게 평가될 수 있습니다. Fluo는 여기서도 동일한 순환 감지 규칙을 적용합니다. `activeTokens` 세트는 모든 해결 경로를 감시해, transient provider가 singleton이나 다른 transient와 재귀 루프를 만들면 즉시 드러나게 합니다. 그래서 provider scope가 달라도 DI 시스템의 실패 모델은 동일하게 유지됩니다.

`path:packages/di/src/container.ts:582-597`의 `withTokenInChain` 구현은 이 예측 가능성을 지탱하는 핵심입니다. 스택과 비슷한 구조로 해결 깊이를 추적하므로, Fluo는 감지된 순환의 전체 경로를 포함하는 에러 메시지를 만들 수 있습니다. 순환이 여러 모듈과 서비스에 걸쳐 있을 때 특히 중요합니다. 메시지는 단순히 "순환이 있습니다"라고 말하는 대신 정확한 token 경로를 보여 주어, 문제가 되는 의존성을 좁힐 수 있게 합니다.

`forwardRef()` 없이 순환을 끊는 또 다른 고급 기법은 `OnModuleInit` 라이프사이클 훅을 사용하는 것입니다. 의존성을 생성자에 주입하는 대신, 서비스가 `ModuleRef`나 `Container`를 주입받고 초기화 단계에서 의존성을 해결할 수 있습니다. Fluo는 정적 그래프 분석을 우회하는 수동 해결을 기본 패턴으로 권장하지 않습니다. 다만 생성자 기반 DI가 논리적으로 맞지 않는 경계에서는 제한적인 탈출구가 될 수 있습니다. 이 방식은 의존성을 "생성(construction)" 단계에서 "초기화(initialization)" 단계로 옮겨 cycle edge를 약하게 만듭니다.

순환은 `ModuleGraph`의 최적화 단계에도 영향을 줍니다. 런타임이 모듈 그래프를 컴파일할 때 각 provider의 가시성(visibility)도 함께 분석합니다. 모듈 간 순환 import가 허용되면 provider가 내부용인지 외부용인지 판단하는 규칙이 흔들릴 수 있습니다. Fluo가 module import를 방향성 비순환 그래프(DAG)로 강제하는 이유도 여기에 있습니다. 그래야 가시성 규칙이 결정론적으로 유지되고, 이후 분석 단계도 같은 전제를 공유할 수 있습니다.

여러 provider가 공통 의존성을 공유하는 "다이아몬드 의존성(diamond dependencies)" 상황도 다시 볼 필요가 있습니다. `path:packages/di/src/container.test.ts:269-297`에서 프레임워크는 이 형태가 유효함을 증명합니다. 다이아몬드의 각 분기가 해결을 마치면 `activeTokens` 세트에서 빠지기 때문입니다. "방문함(visited)"과 "활성 상태(active)"를 구분하는 이 규칙 덕분에 Fluo는 실제 재귀에는 엄격하면서도, 공유 의존성을 가진 정상 그래프는 허용합니다.

마지막으로, 재사용 가능한 라이브러리 모듈을 만들 때는 더 엄격한 기준이 필요합니다. `forwardRef()`를 쓸 수 있더라도 순환 의존성은 가능하면 설계에서 제거하십시오. 소비자가 내부 순환을 이해하고 관리해야 하는 라이브러리는 인지 부하가 높습니다. "공유 모듈로 추출" 패턴을 따르면 모듈은 구성과 테스트가 쉬운 상태로 남습니다. 이 구조적 명료함은 Fluo 생태계에서 순환 의존성 감지가 요구하는 기본 규율입니다.

정리하면 Fluo의 DI 시스템은 프록시나 부분 초기화 뒤에 설계 결함을 숨기지 않습니다. 대신 순환을 명확한 실패로 드러내고, 모듈화와 낮은 결합도, 테스트 가능한 경계를 요구합니다. 이 규율을 받아들이면 시스템이 "거대한 진흙덩어리(big ball of mud)"로 커지는 것을 막고, 규모가 커져도 의존성 그래프를 설명 가능한 상태로 유지할 수 있습니다.
