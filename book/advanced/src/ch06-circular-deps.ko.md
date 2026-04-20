<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis draft for circular dependency detection and escape hatches -->

# 6. Circular Dependency Detection and Escape Hatches

## 6.1 The container detects cycles with an active-token set plus a readable chain
Fluo의 circular dependency 로직은 의도적으로 단순하고 노골적입니다.
constructor proxy, partially initialized instance, 또는 내부 그래프 상태를 가리는 reflection trick에 의존하지 않습니다.
대신 재귀 resolution 동안 두 가지 상태를 유지합니다. 순서를 보존하는 `chain` 배열과 현재 활성 토큰을 추적하는 `activeTokens` 집합(Set)입니다.

공개 `resolve()` 호출은 `path:packages/di/src/container.ts:275-284`에서 이 두 구조를 빈 상태로 시작합니다.
그 다음 모든 재귀 하강은 `path:packages/di/src/container.ts:389-402`의 `resolveWithChain()`을 통과합니다.
이 메서드는 컨테이너가 토큰 인스턴스화를 시도하기 전에 cycle을 가로채는 게이트키퍼 역할을 합니다.

실제 detector는 `path:packages/di/src/container.ts:457-475`의 `resolveForwardRefCircularDependency()`입니다.
이름과 달리 ordinary cycle과 `forwardRef()` 이후에 만난 cycle을 모두 처리합니다.
핵심 질문은 단 하나입니다: "이 토큰이 현재 construction chain 안에서 이미 active한가?"

토큰이 active하지 않으면 resolution은 계속됩니다.
이미 active하다면(즉, `activeTokens`에 존재하면) Fluo는 `CircularDependencyError`를 던집니다.
이때 현재 재귀 edge가 forward reference에서 왔다면(즉, `allowForwardRef: true`), 에러에는 `forwardRef`가 토큰 조회(lookup)만 지연시켰을 뿐 근본적인 construction-time cycle은 해결할 수 없다는 더 구체적인 설명이 추가됩니다.

chain과 active set은 `path:packages/di/src/container.ts:582-597`의 `withTokenInChain()`이 정밀하게 관리합니다.
이 헬퍼는 토큰을 배열과 집합에 넣고 중첩 resolution을 수행한 뒤, `finally` 블록에서 둘 다 제거합니다. 이를 통해 resolution이 실패하더라도 상태가 올바르게 유지되도록 보장합니다. 이 구조가 바로 Fluo 에러 메시지 품질을 지탱하는 핵심 알고리즘 패턴입니다.

`Set`은 $O(1)$의 빠른 membership check를 제공합니다.
배열은 `A -> B -> C -> A`와 같이 사람이 읽을 수 있는 정확한 경로를 진단 메시지에 담기 위해 사용됩니다.
이 두 구조 중 하나만 있다면 성능이나 에러 메시지 가독성 중 하나를 포기해야 했을 것입니다. Fluo는 최소한의 복잡성으로 두 이점을 모두 유지합니다.

기본 cycle 알고리즘은 다음과 같습니다:

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

테스트는 이 동작을 점점 더 복잡한 그래프에서 검증합니다.
`path:packages/di/src/container.test.ts:219-229`는 직접적인 `A -> A` 사례를 다룹니다.
`path:packages/di/src/container.test.ts:231-267`은 두 노드 `A -> B -> A` cycle을 다룹니다.
`path:packages/di/src/container.test.ts:338-363`은 더 깊은 `A -> B -> C -> A` 체인을 다룹니다.

여기에는 중요한 비순환 대조 테스트도 있습니다.
`path:packages/di/src/container.test.ts:269-297`은 다이아몬드 그래프(A가 B와 C에 의존하고, B와 C가 모두 D에 의존하는 형태)가 합법임을 보여줍니다.
이는 "과잉 탐지"를 방지합니다. Fluo는 단순히 과거에 본 토큰이라고 해서 거부하지 않고, 오직 *현재* 재귀 브랜치 안에서 다시 등장할 때만 거부합니다.

Constructor DI에 필요한 엄격함은 바로 이 정도입니다.
공유 dependency를 여러 경로에서 재사용하는 것은 유효한 DAG(Directed Acyclic Graph) 패턴입니다.
반면 끝나지 않은 constructor chain 안으로 재진입하는 것은 인스턴스 생성을 불가능하게 만드는 cycle입니다.

## 6.2 What forwardRef actually solves and what it does not
Circular dependency에서 가장 흔한 오해는 `forwardRef()`가 마법처럼 cycle 자체를 해결해 준다고 믿는 것입니다.
Fluo에서 `forwardRef()`는 훨씬 좁고 정직한 역할을 수행합니다. 바로 **선언 시점(declaration-time)**의 순환 참조 문제를 해결하는 것입니다.
토큰 조회를 resolution 시점까지 지연할 뿐이며, lazy object proxy를 만들거나 서로가 서로를 기다리는 constructor 완료를 가능하게 해주지는 않습니다.

Wrapper는 `path:packages/di/src/types.ts:123-149`에 선언되어 있습니다.
`forwardRef(fn)`은 `__forwardRef__` 마커와 `forwardRef()` 콜백을 가진 단순한 객체를 반환합니다. 그 안에 숨겨진 프록시나 바이트코드 조작 같은 메커니즘은 전혀 없습니다.

Resolution은 이 wrapper를 오직 한 곳에서만 특별 취급합니다:
`path:packages/di/src/container.ts:558-579`의 `resolveDepToken()`은 `isForwardRef(depEntry)`를 검사하고, 콜백을 평가해 실제 토큰을 얻은 뒤, `resolveWithChain(resolvedToken, chain, activeTokens, true)`를 호출합니다.
마지막 인자인 `true`가 핵심 신호입니다. 지금 들어가는 재귀 edge가 forward reference에서 왔음을 표시합니다.

왜 이 표시가 중요한가?
나중에 resolved 토큰이 이미 active하다는 사실이 탐지되면, `resolveForwardRefCircularDependency()`가 `path:packages/di/src/container.ts:468-471`의 더 정확한 메시지를 낼 수 있기 때문입니다:
*"forwardRef only defers token lookup and does not resolve true circular construction."*
Fluo는 지연된 토큰 조회 문제와 생성 시점의 cycle 문제가 서로 다른 문제이며, 서로 다른 해결책이 필요하다는 사실을 개발자에게 명확히 전달합니다.

테스트는 이 동작의 두 측면을 모두 잡아냅니다.
`path:packages/di/src/container.test.ts:299-318`은 `forwardRef(() => ServiceB)`가 성공하는 사례를 보여줍니다. 이는 진정한 cycle이 아니라 단지 Service A가 Service B보다 먼저 선언된 파일 순서 문제일 뿐입니다. Service A는 Service B를 lazy하게 가리키지만, Service B는 자신의 생성 동안 Service A를 다시 요구하지 않습니다.

실패 사례도 그만큼 중요합니다.
`path:packages/di/src/container.test.ts:320-336`은 양쪽을 모두 `forwardRef()`로 감싸도 여전히 `CircularDependencyError`가 나야 함을 검증합니다.
테스트는 `/forwardRef only defers token lookup/i`라는 메시지 조각까지 확인합니다. 이는 프레임워크가 전달하려는 핵심 교훈입니다: wrapper로 생성자 cycle을 "속일" 수는 없습니다.

따라서 실무 규칙은 간단합니다:
문제가 **선언 순서(declaration order)**라면(예: 서로 다른 파일의 두 클래스가 서로를 참조) `forwardRef()`를 사용하십시오.
하지만 두 생성자가 인스턴스 완료를 위해 서로를 실제로 필요로 하는 **설계 문제**라면, `forwardRef()`는 해결책이 아닙니다.

`forwardRef()` 알고리즘은 이렇게 정리할 수 있습니다:

```text
if dependency entry is forwardRef(factory):
  token = factory()
  resolve token with allowForwardRef=true
  if token is already active:
    throw cycle error explaining that lookup deferral was insufficient
```

이 명료함은 Fluo의 큰 장점입니다. 많은 DI 시스템은 lookup indirection과 lifecycle indirection을 모호하게 섞습니다. Fluo는 둘을 분리하기 때문에 circular-dependency 디버깅이 훨씬 덜 신비로워집니다.

## 6.3 Alias chains and scope validation can also surface cycles
대부분의 독자는 cycle을 클래스 간의 주입 루프로만 생각합니다.
하지만 Fluo의 구현을 보면 **별칭(aliasing)**도 cycle을 만들 수 있음을 알 수 있습니다.
`useExisting`은 얼핏 무해해 보이지만, 프로바이더 그래프에서 엄연한 방향성 엣지(edge)를 정의하기 때문입니다.

Alias 프로바이더는 `path:packages/di/src/container.ts:104-111`에서 정규화되고, 런타임에는 `path:packages/di/src/container.ts:451-455`의 `resolveAliasTarget()`을 통해 다른 토큰 조회로 redirect됩니다. 일반적인 resolution 과정에서는 `withTokenInChain` 보호 아래 단순한 위임처럼 동작합니다.

하지만 alias cycle이 체크되는 두 번째, 더 미묘한 지점이 있습니다: 바로 **Scope Validation** 단계입니다.
싱글톤을 인스턴스화하기 전에, `path:packages/di/src/container.ts:827-847`의 `assertSingletonDependencyScopes()`는 각 의존성 토큰을 *실제 프로바이더(effective provider)*까지 추적하여 싱글톤이 요청 범위(request-scoped) 인스턴스에 의존하지 않는지 확인합니다. 이 조회 작업은 `path:packages/di/src/container.ts:849-876`의 `resolveEffectiveProvider()`가 담당합니다.

`resolveEffectiveProvider()`는 동기 루프 안에서 alias chain을 따라갑니다.
중요한 점은 여기서도 메인 resolver의 cycle detector처럼 자체적인 `visited` 집합과 `chain` 배열을 유지한다는 것입니다. 만약 alias chain이 루프를 형성하면(예: `useExisting`을 통한 `A -> B -> A`), `path:packages/di/src/container.ts:858`에서 즉시 `CircularDependencyError`를 던집니다.

이 동작은 테스트로 직접 검증됩니다.
`path:packages/di/src/container.test.ts:570-585`는 `useExisting`만으로 `TOKEN_A -> TOKEN_B -> TOKEN_A` 루프를 만들고 이를 서비스에 주입합니다. 컨테이너는 초기 싱글톤 스코프 검사 단계에서 이 그래프를 정확히 거부합니다.

여기에는 또 하나의 뉘앙스가 있습니다. 스코프 검증은 cycle뿐만 아니라 실제 수명 주기(lifetime) 시맨틱을 보기 위해 alias chain을 끝까지 추적합니다.
`path:packages/di/src/container.test.ts:587-635`는 alias chain의 최종 목적지가 요청 범위 프로바이더인 경우, 싱글톤 소비자가 여전히 `ScopeMismatchError`를 받는다는 것을 증명합니다. Fluo는 aliasing이 짧은 수명의 의존성을 겉으로만 안정적으로 보이는 다른 토큰 이름 뒤에 숨기는 것을 허용하지 않습니다.

Alias 순회 알고리즘은 다음과 같이 이해할 수 있습니다:

```text
resolveEffectiveProvider(token):
  while provider for token is useExisting:
    if token already visited:
      throw CircularDependencyError
    token = provider.useExisting
  return final non-alias provider
```

이 작은 알고리즘은 두 가지 미묘한 버그를 막습니다:
1. Alias 루프가 컨테이너를 조용히 멈춰 세우거나 스택 오버플로를 일으키지 못하게 합니다.
2. 스코프 체크가 작성자가 붙인 토큰 이름이 아니라 **실제 프로바이더의 현실(effective provider reality)**을 기준으로 수행되도록 합니다.

고급 사용자라면 여기서 일관성을 읽어야 합니다. Fluo는 alias를 1급 그래프 엣지로 취급합니다. Visibility, scope, lifetime에 참여하는 엣지라면 cycle detection에도 동일하게 참여해야 하기 때문입니다.

## 6.4 Provider cycles and module import cycles are separate failure phases
Fluo에서 가장 유용한 구분 중 하나는 **프로바이더 레벨**의 순환 의존성과 **모듈 레벨**의 임포트 사이클을 분리한다는 점입니다.
개념적으로는 비슷해 보여도 서로 다른 시점에 서로 다른 이유로 실패하며, 이를 이해하면 디버깅 시간을 획기적으로 줄일 수 있습니다.

**프로바이더 사이클(Provider cycles)**은 DI 컨테이너 내부의 토큰 resolution 단계에서 발생합니다. 이미 살펴본 `path:packages/di/src/container.ts`의 로직이 이를 담당합니다. 이 에러는 컨테이너가 하나 이상의 프로바이더 생성자를 끝까지 완료할 수 없음을 의미합니다.

**모듈 임포트 사이클(Module import cycles)**은 훨씬 앞선 단계인 런타임 모듈 그래프 컴파일 단계에서 거부됩니다. 관련 알고리즘은 `path:packages/runtime/src/module-graph.ts:185-233`의 `compileModule()`에 있습니다. 모듈을 컴파일하기 전에 런타임은 해당 `moduleType`이 이미 `visiting` 집합 안에 있는지 검사합니다. 있다면 *"Circular module import detected"* 메시지와 함께 `ModuleGraphError`를 던집니다.

정확한 발생 지점은 `path:packages/runtime/src/module-graph.ts:200-208`입니다. 에러 메시지에 포함된 힌트를 주목하십시오: 공유 프로바이더를 별도의 모듈로 추출하여 양쪽에서 독립적으로 임포트할 것을 권장합니다. 이는 단순한 DI 우회책이 아니라 **모듈 토폴로지 리팩토링(module-topology refactoring)** 가이드라인입니다.

정확한 발생 지점은 `path:packages/runtime/src/module-graph.ts:200-208`입니다. 에러 메시지에 포함된 힌트를 주목하십시오: 공유 프로바이더를 별도의 모듈로 추출하여 양쪽에서 독립적으로 임포트할 것을 권장합니다. 이는 단순한 DI 우회책이 아니라 **모듈 토폴로지 리팩토링(module-topology refactoring)** 가이드라인입니다.

이 실패는 `bootstrapModule()`이 프로바이더를 컨테이너에 등록하기 훨씬 전에 일어납니다. `path:packages/runtime/src/bootstrap.ts:372-398`은 다음과 같은 엄격한 순서를 보여줍니다:
1. 모듈 그래프 컴파일 (토폴로지 확립)
2. 컨테이너 생성 (컨텍스트 구축)
3. 모듈 프로바이더 등록 (내용 채우기)
4. 싱글톤 사전 인스턴스화 (의존성 해결)

만약 앱이 모듈 컴파일 단계에서 실패했다면, DI 컨테이너는 아직 resolution을 시작조차 하지 못한 상태입니다. 문제는 생성자가 아니라 `@Module({ imports: [...] })` 또는 `defineModule(...)` 구조에 있습니다.

이 단계 구분은 실전에서 매우 유용합니다:
- 에러가 `ServiceA -> ServiceB` 같은 **토큰(token)** 이름을 언급하면 생성자의 `@Inject()` 호출을 점검하십시오.
- 에러가 `AppModule -> UserModule` 같은 **모듈 타입(module type)**을 언급하면 `imports` 배열을 점검하십시오.

두 알고리즘은 겉으로 비슷해 보이지만 답하려는 질문이 다릅니다:

```text
provider cycle question:
  활성 토큰을 다시 방문하지 않고 생성자 resolution을 끝낼 수 있는가?

module cycle question:
  현재 컴파일 중인 모듈을 다시 방문하지 않고 모듈의 위상 정렬(topological order)이 가능한가?
```

Fluo가 둘을 분리하는 이유는 복구 전략이 다르기 때문입니다. 프로바이더 사이클은 생성자 책임을 재설계하거나 선언 순서 문제일 경우 `forwardRef()`로 해결할 수 있지만, 모듈 사이클은 구조적인 문제이므로 보통 공유 엑스포트를 제3의 "공통(common)" 모듈로 이동해야 합니다.

## 6.5 Practical strategies for breaking cycles without hiding design problems
이제 Fluo가 사이클을 어디서 탐지하는지 알았으니, 마지막 단계는 설계 문제를 숨기지 않으면서 사이클을 제거하는 방법을 아는 것입니다. 프레임워크의 힌트와 내부 구조는 세 가지 주요 패턴을 가리킵니다.

**패턴 1: 공유 로직을 제3의 프로바이더로 추출하기**
이는 `path:packages/di/src/errors.ts:113-123`의 `CircularDependencyError`가 직접 권장하는 방식입니다. 만약 `UserService`와 `AuditService`가 서로를 직접 주입해야 한다면, 실제로는 상호 주입이 아니라 두 서비스가 모두 의존하는 `UserPolicyService`나 `AuditFacade`가 필요한 상황일 가능성이 높습니다.

**패턴 2: 생성 시점의 의존성을 더 늦은 상호작용 경계로 교체하기**
한 서비스가 다른 서비스에 대한 생성자 참조를 직접 들고 있기보다, 이벤트를 발행하거나 콜백을 받는 구조로 바꿀 수 있습니다. Fluo 컨테이너는 부분적으로 초기화된 객체 그래프(half-constructed object graphs)를 허용하지 않기 때문에, 자연스럽게 생성 이후 시점에 동작하는 이벤트 이미터나 setter/init 메서드 사용을 유도합니다.

**패턴 3: forwardRef()는 오직 선언 순서 문제에만 사용하기**
두 파일이 서로를 참조하지만 실제 생성 동안 한쪽만 상대를 필요로 한다면 `forwardRef()`가 정답입니다. 하지만 두 생성자가 상태 계산을 위해 즉시 서로를 필요로 한다면, 그것은 설계상의 사이클이며 `forwardRef()`는 에러 시점만 늦출 뿐 근본적인 해결책이 되지 못합니다.

**모듈 사이클**의 경우, `path:packages/runtime/src/module-graph.ts:200-208`의 런타임 힌트가 대응되는 구조적 수정을 제안합니다:
1. `SharedModule`을 만듭니다.
2. 공통 프로바이더/엑스포트를 그곳으로 옮깁니다.
3. 원래의 두 모듈에서 `SharedModule`을 임포트합니다.
4. 두 모듈 사이의 직접적인 임포트를 제거합니다.

구현 관점의 의사결정 트리는 다음과 같습니다:

```text
if cycle is in provider resolution:
  한쪽 엣지가 선언 순서에만 민감한지 확인합니다.
  Yes -> forwardRef()를 사용합니다.
  No -> 공유 로직을 추출하거나 생성 이후 시점의 상호작용 경계로 이동합니다.

if cycle is in module imports:
  forwardRef()를 사용하지 마십시오.
  공유 엑스포트를 제3의 모듈로 이동하십시오.
  두 원래 모듈이 그 공유 모듈을 임포트하게 만드십시오.
```

테스트는 이러한 권고를 뒷받침합니다. 컨테이너는 `path:packages/di/src/container.test.ts:269-297`의 비순환 다이아몬드 그래프를 허용하는데, 이는 공유 의존성을 제대로 추출했을 때 얻게 되는 전형적인 형태입니다.

이 장의 마지막 교훈은 Fluo의 사이클 처리가 **의도적으로 보수적**이라는 점입니다. 부분적으로 초기화된 객체나 암시적인 프록시로 그래프를 억지로 만들기보다, 차라리 그래프를 거부하는 쪽을 택합니다. 고급 사용자에게 이러한 보수성은 장점입니다. 아키텍처상의 악취를 컨테이너 마법 뒤에 숨기지 않고, 실제 소유권과 의존성 경계가 코드베이스에 그대로 드러나도록 강제하기 때문입니다.
