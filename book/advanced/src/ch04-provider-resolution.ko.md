<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis draft for provider normalization and resolution -->

# 4. Provider Normalization and Resolution Algorithms

## 4.1 From public provider syntax to normalized records
Fluo의 컨테이너는 공개 provider 형태를 그대로 해석하지 않습니다.
첫 단계는 항상 정규화입니다.
이 결정 덕분에 실제 resolve 경로는 작고 예측 가능하게 유지됩니다.
런타임은 다섯 가지 공개 API를 반복 분기하는 대신 하나의 내부 레코드 형태만 다루면 되기 때문입니다.

공개 surface는 `path:packages/di/src/types.ts:36-121`에 선언되어 있습니다.
이 경계에서 Fluo는 class constructor, `{ useClass }`, `{ useFactory }`, `{ useValue }`, `{ useExisting }`를 모두 받습니다.
이 형태들은 작성 편의성용 문법입니다.
실행 모델 자체는 아닙니다.

실제 정규화 진입점은 `path:packages/di/src/container.ts:54-115`의 `normalizeProvider()`입니다.
이 함수가 이 장의 첫 번째 핵심 알고리즘입니다.
모든 입력 provider를 `type`, `provide`, `inject`, `scope`, 구현 필드를 갖는 `NormalizedProvider`로 변환합니다.

평범한 class 등록의 경우 컨테이너는 `getClassDiMetadata()`로 constructor 메타데이터를 읽고,
명시적 scope가 없으면 `Scope.DEFAULT`를 사용합니다.
이 흐름은 `path:packages/di/src/container.ts:55-65`에 보입니다.
즉 class 문법은 결국 token이 자기 자신인 normalized class provider의 sugar일 뿐입니다.

factory provider는 조금 더 미묘합니다.
컨테이너는 우선 `provider.scope`를 존중하지만,
`resolverClass`가 있으면 그 클래스의 scope 메타데이터를 읽고,
마지막 fallback으로 singleton default를 사용합니다.
이 우선순위는 `path:packages/di/src/container.ts:78-89`에 드러납니다.
즉 비동기 또는 계산형 provider도 class provider와 같은 scope 언어에 참여합니다.

`{ provide, useClass }`도 같은 상속 패턴을 따릅니다.
`path:packages/di/src/container.ts:91-102`는 컨테이너가 `provider.useClass`의 메타데이터를 읽되,
provider object가 이미 `inject`나 `scope`를 명시한 경우에는 그것을 우선하는 모습을 보여줍니다.
즉 provider object는 최종 권위를 가지면서도,
class decorator는 기본 계약을 제공할 수 있습니다.

두 개의 helper wrapper도 이 정규화 단계와 연결됩니다.
겉으로는 dependency 문법처럼 보이지만 실제로는 나중 resolution을 위한 표시자입니다.
`forwardRef()`와 `optional()`은 `path:packages/di/src/types.ts:137-168`에 선언되어 있습니다.
이 함수들은 직접 resolve를 수행하지 않습니다.
후속 단계가 특별 취급할 수 있도록 token을 감쌀 뿐입니다.

`inject` 배열에 `null`이나 `undefined`가 들어오면 초기에 바로 거절됩니다.
`path:packages/di/src/container.ts:46-52`의 `normalizeInjectToken()`은 forward-reference 힌트와 함께 `InvalidProviderError`를 던집니다.
이것은 중요한 선택입니다.
Fluo는 작성 오류를 등록/정규화 단계에서 드러내고 싶어 합니다.
그래프가 절반쯤 활성화된 뒤 생성 시점에 뒤늦게 터뜨리려 하지 않습니다.

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

여기서 `@fluojs/core`와의 관계가 중요합니다.
`@Inject(...)`와 `@Scope(...)`는 `path:packages/core/src/decorators.ts:37-89`와 `path:packages/core/src/metadata/class-di.ts:33-83`의 `defineClassDiMetadata()`를 통해 class-level DI 메타데이터를 기록합니다.
컨테이너는 emitted metadata로 constructor 타입을 추론하지 않습니다.
항상 명시적으로 기록된 메타데이터 레코드를 소비합니다.
그래서 정규화가 결정적입니다.

또 하나 숨어 있는 규칙은 상속입니다.
`path:packages/core/src/metadata/class-di.ts:50-83`의 `getClassDiMetadata()`는 constructor lineage를 base-to-leaf로 걷고,
하위 클래스가 실제로 재정의한 필드만 덮어쓰게 합니다.
즉 provider normalization은 그 클래스 자신의 로컬 메타데이터가 아니라,
상속을 반영한 최종 계약을 보게 됩니다.

운영 관점에서 보면 4.1의 의미는 분명합니다.
Fluo의 DI 컨테이너가 런타임에 단순하게 보이는 이유는,
복잡성 대부분을 초반 정규화 단계에서 미리 소화하기 때문입니다.
`resolve()`가 시작될 때쯤이면 provider는 이미 하나의 내부 형태로 정리되어 있습니다.

## 4.2 Registration semantics, duplicate checks, and scope guardrails
정규화가 끝나면 `register()`가 정책을 적용합니다.
구현은 `path:packages/di/src/container.ts:152-191`에 있습니다.
이 메서드는 단순히 map에 append하는 함수가 아닙니다.
이후 resolution이 예측 가능하도록 그래프 규칙을 강제합니다.

첫 번째 규칙은 disposal 안전성입니다.
컨테이너가 이미 닫혀 있으면 등록은 `ContainerResolutionError`로 중단됩니다.
이는 `path:packages/di/src/container.ts:153-158`에서 확인할 수 있습니다.
이 가드는 이미 폐기된 그래프 위에 stale cache를 가진 새 provider를 얹는 상황을 막습니다.

두 번째 규칙은 request-scope 위생입니다.
`requestScopeEnabled`가 true인 child container에서 default-scope non-multi provider를 직접 등록하면 `ScopeMismatchError`가 발생합니다.
코드는 `path:packages/di/src/container.ts:163-172`에 있습니다.
이것은 실수로 request-local singleton을 만드는 것을 막기 위한 보호장치입니다.

왜 이것이 중요한가?
컨테이너는 `cacheFor()` 쪽에 이미 문서화된 footgun을 가지고 있기 때문입니다.
`path:packages/di/src/container.ts:613-645`는 request scope에 locally registered singleton이 들어오면,
실제로는 root singleton cache가 아니라 request cache에 저장되어 request-scoped처럼 동작하게 됨을 설명합니다.
Fluo는 이 동작을 조용히 허용하기보다,
가장 흔한 실수 경로를 등록 단계에서 차단합니다.

중복 검사는 single-provider와 multi-provider 경로로 나뉩니다.
`path:packages/di/src/container.ts:331-351`의 `assertNoRegistrationConflict()`는 token이 로컬 또는 ancestor에 이미 호환되지 않는 형태로 존재하는지 검사합니다.
단순한 `Map.has()`보다 훨씬 강한 정책입니다.
부모-자식 계층 간 충돌도 실제 충돌로 취급합니다.

ancestor helper인 `path:packages/di/src/container.ts:353-371`을 보면 정확한 정책이 드러납니다.
single provider는 같은 token이 visible 범위 어딘가에서 multi로 존재하면 추가할 수 없습니다.
multi provider도 visible 범위 어딘가에서 single로 존재하면 추가할 수 없습니다.
이 규칙 덕분에 `container.resolve(token)`의 의미가 어느 계층에서 호출하느냐에 따라 바뀌지 않습니다.

테스트도 이 동작을 고정합니다.
`path:packages/di/src/container.test.ts:414-431`은 두 방향의 금지된 교차 등록을 모두 검증합니다.
token이 single로 시작했다면 intentional override 없이는 계속 single입니다.
multi로 시작했다면 이후 등록도 multi를 유지하거나 override 의미를 사용해야 합니다.

multi-provider 등록 자체는 additive입니다.
`path:packages/di/src/container.ts:176-185`는 normalized provider를 token별 배열에 push합니다.
나중에 `collectMultiProviders()`가 바로 이 자료구조를 사용합니다.
반면 single provider는 `registrations.set()`으로 `path:packages/di/src/container.ts:185-187`에서 한 번만 local slot을 차지합니다.

override semantics는 의도적으로 destructive합니다.
`path:packages/di/src/container.ts:193-206`의 주석은 multi override가 해당 token의 기존 전체 집합을 갈아치운다고 명시합니다.
실제 코드도 `path:packages/di/src/container.ts:215-231`에서 single과 multi 등록을 모두 지운 뒤 새 값을 넣습니다.
multi-provider 묶음 안의 특정 엔트리만 부분적으로 바꾸는 API는 없습니다.

이 설계는 테스트와 교체 전략에 유리합니다.
override는 하나의 token에 대해 새 진실을 만드는 연산입니다.
컨테이너는 multi cluster 내부 개별 entry의 안정적인 identity를 만들 필요가 없습니다.
`path:packages/di/src/container.test.ts:375-412`는 single 교체와 multi 교체를 모두 확인합니다.

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

핵심 구현 포인트는 이렇습니다.
Fluo는 인스턴스가 생기기 전에 provider shape invariant를 강제합니다.
그래서 에러가 런타임 미스터리가 아니라 설정 단계의 명확한 위반으로 드러납니다.
이것이 뒤이어 나오는 resolution 알고리즘을 간결하게 유지하는 중요한 이유입니다.

## 4.3 The resolve pipeline: token lookup, chain tracking, and instantiation
공개 API는 매우 작습니다.
`path:packages/di/src/container.ts:275-284`의 `resolve()`는 disposal만 검사한 뒤 `resolveWithChain(token, [], new Set())`로 위임합니다.
재미있는 내용은 모두 그 아래에 있습니다.

`path:packages/di/src/container.ts:389-402`의 `resolveWithChain()`은 트래픽 디렉터입니다.
먼저 `resolveForwardRefCircularDependency()`로 현재 token이 이미 active chain 안에 있는지 검사합니다.
그다음에야 `resolveFromRegisteredProviders()`로 내려갑니다.
즉 순환 의존성 검사는 나중에 덧붙인 부가기능이 아니라,
재귀 resolution의 첫 분기입니다.

`path:packages/di/src/container.ts:404-432`의 `resolveFromRegisteredProviders()`가 실질적인 pipeline입니다.
순서가 중요합니다.
우선 local single registration을 확인합니다.
없으면 collected multi providers를 확인합니다.
multi가 있으면 배열로 resolve합니다.
그 이후에야 single provider를 반드시 요구합니다.

이 순서는 token 의미를 설명해 줍니다.
직접 single provider가 있으면 token은 single로 해석됩니다.
그렇지 않고 multi set이 비어 있지 않으면 multi로 해석됩니다.
그래서 registration conflict 검사가 엄격해야 합니다.
resolver는 token의 의미가 이미 애매하지 않다고 가정하고 있기 때문입니다.

alias는 scope cache보다 먼저 처리됩니다.
`path:packages/di/src/container.ts:451-525`의 `resolveExistingProviderTarget()`과 `resolveAliasTarget()`은 chain tracking을 유지한 채 다른 token으로 resolution을 redirect합니다.
즉 `{ useExisting }`는 복사된 인스턴스가 아닙니다.
기존 token에 대한 위임 조회입니다.

transient provider는 cache를 의도적으로 건너뛰는 유일한 경로입니다.
`path:packages/di/src/container.ts:426-428`은 transient를 `withTokenInChain()` 아래에서 바로 `instantiate()`로 보냅니다.
그 외의 non-alias provider는 결국 `path:packages/di/src/container.ts:527-548`의 `resolveScopedOrSingletonInstance()`로 갑니다.

`path:packages/di/src/container.ts:582-597`의 `withTokenInChain()`은 작지만 결정적인 helper입니다.
현재 token을 chain 배열과 active set에 넣고,
`finally`에서 반드시 제거합니다.
이 구조 덕분에 Fluo는 두 가지를 동시에 얻습니다.
하나는 사람이 읽는 dependency chain입니다.
다른 하나는 O(1) membership 검사로 동작하는 cycle detector입니다.

실제 객체 생성은 `path:packages/di/src/container.ts:796-825`의 `instantiate()`에서 일어납니다.
이 메서드는 먼저 `assertSingletonDependencyScopes()`를 호출합니다.
그다음 provider type별로 분기합니다.
value provider는 값을 그대로 반환합니다.
factory provider는 dependency를 resolve한 뒤 `useFactory`를 호출합니다.
class provider는 dependency를 resolve한 뒤 `new useClass(...deps)`를 수행합니다.

dependency resolution 자체는 순차 루프입니다.
`path:packages/di/src/container.ts:890-898`의 `resolveProviderDeps()`는 `provider.inject.length`에 맞는 배열을 만들고,
각 token을 순서대로 resolve합니다.
여기에는 speculative parallelism이 없습니다.
그 덕분에 chain ordering과 error reporting이 안정적으로 유지됩니다.

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

`path:packages/di/src/container.test.ts:10-40`과 `path:packages/di/src/container.test.ts:638-679`는 바깥에서 보이는 의도를 고정합니다.
singleton은 같은 인스턴스를 재사용하고,
factory provider는 주입받은 dependency를 인자로 받으며,
multi provider는 등록 순서를 보존한 배열을 반환합니다.

고급 독자에게 중요한 결론은 이것입니다.
Fluo의 resolver는 재귀적이지만 결코 마법적이지 않습니다.
모든 재귀 단계는 `container.ts`에 그대로 드러나 있고,
모든 분기는 runtime reflection이 아니라 normalized provider 데이터로부터 결정됩니다.

## 4.4 Optional tokens, forward references, aliases, and multi providers
Fluo 설계의 우아한 지점은 special case가 한곳에 모인다는 점입니다.
모두 `path:packages/di/src/container.ts:558-579`의 `resolveDepToken()`으로 흘러갑니다.
이 helper 하나가 optional wrapper, forward reference, ordinary token을 해석합니다.

optional injection은 가장 작은 분기입니다.
dependency entry가 `OptionalToken`이면 컨테이너는 먼저 `has(innerToken)`을 검사합니다.
token이 없으면 에러 없이 `undefined`를 반환합니다.
있으면 평범하게 resolve합니다.
정확한 코드는 `path:packages/di/src/container.ts:563-571`에 있고,
테스트는 `path:packages/di/src/container.test.ts:494-532`에 있습니다.

forward reference도 의도적으로 단순합니다.
`isForwardRef(depEntry)`가 참이면 wrapper는 `depEntry.forwardRef()`로 lazy evaluation 되고,
그 결과 token을 `resolveWithChain(..., allowForwardRef=true)`에 넘깁니다.
이는 `path:packages/di/src/container.ts:573-577`에 보입니다.
이 wrapper는 token lookup 시점을 늦출 뿐입니다.
proxy 인스턴스나 lazy object를 만들어 주지 않습니다.

이 구분이 중요합니다.
실제 constructor cycle이 남아 있으면 `resolveForwardRefCircularDependency()`는 여전히 예외를 던집니다.
다만 이번에는 `forwardRef only defers token lookup and does not resolve true circular construction`라는 detail string을 함께 붙입니다.
근거는 `path:packages/di/src/container.ts:457-475`와 `path:packages/di/src/container.test.ts:320-336`입니다.

alias는 dependency-entry 수준이 아니라 provider 수준 기능입니다.
`useExisting` provider는 `path:packages/di/src/container.ts:104-111`에서 정규화되고,
나중에 `path:packages/di/src/container.ts:451-455`의 `resolveAliasTarget()`이 실제 target token으로 redirect합니다.
즉 alias token은 target token의 resolved value에 대한 또 다른 이름입니다.

그래서 alias chain도 허용됩니다.
`path:packages/di/src/container.test.ts:552-568`은 여러 단계를 거친 alias chain이 결국 원래 인스턴스를 반환함을 보여 줍니다.
하지만 alias cycle은 허용되지 않습니다.
`path:packages/di/src/container.ts:849-876`의 `resolveEffectiveProvider()`는 request-scope mismatch를 확인하기 위해 alias chain을 따라가다가,
token이 반복되면 `CircularDependencyError`를 던집니다.
회귀 테스트는 `path:packages/di/src/container.test.ts:570-585`입니다.

multi provider는 또 다른 층위를 추가합니다.
`path:packages/di/src/container.ts:373-387`의 `collectMultiProviders()`는 child scope에서 explicit override가 없는 한,
부모와 로컬 배열을 병합합니다.
그래서 request child는 root plugin list를 이어받으면서 자신의 plugin을 추가할 수 있습니다.

동작은 정밀합니다.
`path:packages/di/src/container.test.ts:657-679`는 child registration이 parent multi set 뒤에 append됨을 증명합니다.
`path:packages/di/src/container.test.ts:669-691`는 `override()`가 해당 token에 대한 parent collection을 끊는다는 점을 증명합니다.
replacement가 여전히 multi든 single로 바뀌든 동일합니다.

multi entry의 resolution은 single resolution과 다릅니다.
`path:packages/di/src/container.ts:491-517`의 `resolveMultiProviderInstance()`는 token이 아니라 normalized provider object를 key로 cache합니다.
그래서 동일 token 아래 여러 entry가 있더라도,
각 entry는 자기 자신의 singleton/request identity를 유지할 수 있습니다.

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

실무적으로 보면 Fluo는 여러 고급 authoring pattern을 지원하면서도 정신 모델을 지나치게 넓히지 않습니다.
special wrapper는 token lookup 규칙을 바꾸고,
alias는 token identity를 바꾸며,
multi provider는 결과 cardinality를 바꿉니다.
하지만 모두 같은 recursive resolver 위에서 동작합니다.

## 4.5 Error contracts and why they are part of the algorithm
Fluo에서 에러 보고는 사후 포장이 아닙니다.
`path:packages/di/src/errors.ts:1-154`의 error class들은 컨테이너 계약의 일부입니다.
깨진 module graph나 provider declaration을 운영자가 어떻게 추적하는지 자체를 규정합니다.

`path:packages/di/src/errors.ts:14-42`의 `formatDiContext()`는 token, scope, module, dependency chain, hint를 최종 메시지에 조합합니다.
즉 throw site는 구조화된 context만 붙이면 되고,
한 formatter가 사람 읽기 좋은 형태로 정리해 줍니다.

`ContainerResolutionError`는 missing provider, disposed-container operation, 기타 lifecycle failure를 담당합니다.
missing-provider 분기는 `path:packages/di/src/container.ts:435-449`의 `requireProvider()`에서 던져집니다.
거기 들어 있는 hint 문구를 보십시오.
이미 reader를 module `providers`, `exports`, `imports` 관계 쪽으로 유도하고 있습니다.

`RequestScopeResolutionError`는 request-scoped provider를 request scope 밖에서 resolve할 때 `cacheFor()`와 `multiCacheFor()`에서 발생합니다.
근거는 `path:packages/di/src/container.ts:633-645`와 `path:packages/di/src/container.ts:656-668`입니다.
이것은 단순 생성 실패가 아니라 아키텍처 위반을 설명하는 런타임 에러입니다.

`ScopeMismatchError`는 한 단계 더 위의 검증입니다.
`path:packages/di/src/container.ts:827-847`의 `assertSingletonDependencyScopes()`는 singleton 생성 전에 dependency token을 순회하고,
request-scoped provider를 가리키는 edge를 거부합니다.
이 검사는 effective provider를 따라가기 때문에 alias를 거쳐도 동일하게 적용됩니다.

`CircularDependencyError`는 의도적으로 매우 노골적입니다.
`path:packages/di/src/errors.ts:106-125`의 constructor는 full chain과 함께,
shared logic 분리 또는 `forwardRef()` 사용을 권장하는 first-party hint를 넣습니다.
즉 cycle detector는 recovery path와 함께 설계되어 있습니다.

`path:packages/di/src/container.test.ts:1075-1201`의 테스트는 이 메시지들이 token 이름, hint, machine-readable meta field를 포함함을 확인합니다.
이것은 테스트 장식이 아닙니다.
Fluo가 진단 품질을 호환성 약속으로 취급한다는 뜻입니다.

여기서 runtime module system과의 연결도 중요합니다.
`bootstrapModule()`이 module graph를 컴파일할 때,
provider visibility와 injection metadata validation은 module providers를 컨테이너에 등록하기 전에 먼저 실행됩니다.
근거는 `path:packages/runtime/src/bootstrap.ts:372-398`와 `path:packages/runtime/src/module-graph.ts:360-415`입니다.
그래서 겉으로는 "DI 에러"처럼 보이는 문제 중 상당수는,
사실 컨테이너보다 한 단계 앞선 module-graph 단계에서 잡히도록 설계되어 있습니다.

구현 관점의 디버깅 체크리스트는 다음과 같습니다.

- 등록 직후 실패하면 normalization과 duplicate check를 먼저 본다.
- 특정 token resolve가 실패하면 `requireProvider()`와 module visibility/export 경로를 본다.
- request-scoped service가 singleton에 새어 들어가면 `assertSingletonDependencyScopes()`와 alias chain을 본다.
- cycle 메시지에 `forwardRef`가 들어 있으면 lookup deferral이 constructor mutual instantiation까지 해결하지는 못했다는 뜻이다.
- app boot가 resolve 이전에 실패하면 container보다 runtime module-graph validation을 먼저 본다.

이 장의 중심 교훈은 명확합니다.
Fluo의 provider resolution은 `Map.get()` 다음에 `new`를 호출하는 정도가 아닙니다.
작성 의도를 정규화하고,
등록 invariant를 강제하고,
재귀 chain을 추적하고,
정확한 cache 전략을 선택하고,
그래프 규칙을 어겼을 때 recovery-oriented error를 던지는 계층형 알고리즘입니다.
