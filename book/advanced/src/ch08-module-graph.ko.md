<!-- packages: @fluojs/runtime, @fluojs/core, @fluojs/di, @fluojs/http -->
<!-- project-state: T16 Part 3 source-analysis draft for runtime module-graph compilation, validation, and initialization ordering -->

# 8. Module Graph Compilation and Initialization Order

## 8.1 The bootstrap pipeline starts by freezing module topology before constructing anything
Part 3는 Part 2가 멈춘 지점에서 다시 시작합니다.
DI container가 provider를 해석하려면,
그보다 먼저 runtime이 어떤 module이 존재하는지,
어떤 순서로 visible해지는지,
그리고 어떤 token이 module 경계를 넘어도 되는지를 결정해야 합니다.

이 첫 단계는 `path:packages/runtime/src/bootstrap.ts:372-398`에 있습니다.
`bootstrapModule()`은 `Container`를 만들기 전에 먼저 `compileModuleGraph(rootModule, options)`를 호출합니다.
이 순서가 이 장의 첫 번째 구현 사실입니다.
module analysis는 container registration의 부수 효과가 아닙니다.
그 선행 조건입니다.

따라서 runtime은 bootstrap을 두 겹의 graph로 다룹니다.
먼저 module graph가 있고,
그 다음 DI container 내부의 provider graph가 있습니다.
바깥 graph가 잘못되면,
안쪽 graph는 시작조차 하지 않습니다.

같은 phase boundary는 더 높은 application bootstrap에서도 보입니다.
`path:packages/runtime/src/bootstrap.ts:920-1029`의 `bootstrapApplication()`은 module bootstrap,
runtime token registration,
lifecycle singleton resolution,
hook execution을 끝낸 뒤에야 dispatcher를 만듭니다.
runtime은 unresolved module topology 위에 request handling state를 얹지 않습니다.

`compileModuleGraph()` 자체는 `path:packages/runtime/src/module-graph.ts:406-415`에 정의되어 있습니다.
이 함수의 반환값은 container가 아닙니다.
`CompiledModule[]`입니다.
이 반환 타입이 의도적으로 구조적이라는 점이 중요합니다.
각 record는 `type`, `definition`, `providerTokens`, `exportedTokens`를 가집니다.

대응되는 타입 정의인 `path:packages/runtime/src/types.ts:41-54`도 다시 볼 가치가 있습니다.
`CompiledModule`은 runtime이 사용하는 정규화된 module record입니다.
원래 module class,
정규화된 metadata definition,
local ownership을 나타내는 provider token set,
validation 이후의 exported token set을 보관합니다.

이 사실은 Fluo가 module bootstrap을 어떻게 이해하는지 보여 줍니다.
runtime은 나중 단계에서 module decorator를 반복 해석하지 않습니다.
먼저 안정적인 runtime record로 compile하고,
그 뒤의 로직은 그 compiled record를 소비합니다.

실무적으로 bootstrap stack의 시작은 다음과 같습니다.

```text
root module type
  -> compileModuleGraph()
  -> ordered compiled module records
  -> bootstrapModule()
  -> container registration
  -> lifecycle resolution and hook execution
  -> application/context shell assembly
```

이 순서는 테스트에서도 드러납니다.
`path:packages/runtime/src/bootstrap.test.ts:13-39`는 단순한 graph가 dependency order로 module을 돌려준다는 것을 검증합니다.
기대 순서는 `SharedModule`, 그 다음 `AppModule`입니다.
작은 테스트지만,
이 장의 핵심 규칙을 담고 있습니다.
import된 module이 importer보다 먼저 안정화됩니다.

고급 독자가 가져가야 할 정신 모델은 이렇습니다.
Fluo bootstrap은 front-loaded되어 있습니다.
나중 런타임을 지루할 정도로 단순하게 만들기 위해 초반에 많이 검증합니다.
request handling이 시작될 때는,
module order와 token visibility가 이미 증명된 상태입니다.

## 8.2 Graph compilation is a depth-first walk with explicit cycle rejection
핵심 compiler는 `path:packages/runtime/src/module-graph.ts:185-233`의 `compileModule()`입니다.
입력 인자만 봐도 알고리즘의 형태가 드러납니다.
`compiled`,
`visiting`,
`ordered` 컬렉션을 받습니다.

형식적으로는 전형적인 DFS지만,
이 장에서 중요한 것은 라벨보다 구현입니다.
module type이 이미 `compiled`에 있으면,
함수는 기존 compiled record를 재사용합니다.
module type이 `visiting`에 있으면,
runtime은 즉시 예외를 던집니다.

정확한 throw site는 `path:packages/runtime/src/module-graph.ts:200-208`입니다.
에러는 `ModuleGraphError`이고,
메시지는 `Circular module import detected for ${moduleType.name}.`입니다.
hint는 shared provider를 별도 module로 추출하라고 권장합니다.

이 hint는 그냥 친절한 문구가 아닙니다.
runtime이 module cycle을 구조 문제로 본다는 뜻입니다.
lazy token trick으로 때우는 문제가 아닙니다.
이 점은 DI 패키지의 provider-level `forwardRef()`와 분명히 다릅니다.

module이 cycle 검사를 통과하면,
compiler는 `path:packages/runtime/src/module-graph.ts:170-183`의 `normalizeModuleDefinition()`으로 metadata를 정규화합니다.
이 단계는 빠진 field를 빈 배열이나 `false`로 채웁니다.
그래서 이후 단계는 `imports`나 `exports`가 undefined인지 계속 물어볼 필요가 없습니다.

그 다음 재귀는 imported module을 전부 먼저 순회합니다.
모든 import가 compile된 뒤에야 현재 module이 `CompiledModule` record로 만들어집니다.
그리고 마지막에 `ordered`에 push됩니다.
이 push 시점이 관찰되는 순서를 설명합니다.
dependency가 dependent보다 먼저 append됩니다.

순서를 의사코드로 요약하면 다음과 같습니다.

```text
compileModule(AppModule)
  compile imports first
  create compiled record for current module
  append current module to ordered list last
```

즉 반환 배열은 임의의 discovery order가 아닙니다.
도달 가능한 import graph에 대한 post-order traversal입니다.
이것이 나중 registration 단계가 필요로 하는 순서와 정확히 맞습니다.

compiled record는 `path:packages/runtime/src/module-graph.ts:219-226`에서 `providerTokens`도 미리 계산합니다.
이 역시 작은데 중요한 선택입니다.
export validation은 어떤 token이 local ownership인지 알아야 합니다.
provider identity를 반복 계산하는 대신,
compiler가 한 번 계산해 보관합니다.

한 번의 성공적인 compile 흐름은 이렇게 그릴 수 있습니다.

```text
enter module
  if already compiled -> reuse existing record
  if currently visiting -> throw ModuleGraphError
  mark visiting
  normalize metadata
  recursively compile imports
  compute local provider token set
  create CompiledModule
  unmark visiting
  append to ordered output
```

`path:packages/runtime/src/bootstrap.test.ts:13-39`가 positive case를 고정합니다.
negative case는 runtime source 자체에 문서화되어 있고,
error hint가 의도된 recovery path를 직접 알려 줍니다.

핵심 결과는 deterministic initialization order입니다.
`bootstrapModule()`이 compiled array를 받을 때,
배열 앞에서 뒤로 순회해도 안전한 이유는 모든 imported module이 importer보다 먼저 compile되었기 때문입니다.

이 단계는 아직 모든 provider instance를 만든다는 뜻은 아닙니다.
다만 runtime이 provider ownership과 export를 해석할 수 있는 유일한 합법 순서를 확정했다는 뜻입니다.

## 8.3 Validation is where visibility, exports, and constructor metadata become runtime law
compile만으로는 충분하지 않습니다.
DAG라도 여전히 invalid할 수 있습니다.
잘못된 import를 했거나,
자기 소유가 아닌 token을 export했거나,
DI가 만족시킬 수 없는 constructor를 선언했을 수 있기 때문입니다.

Fluo는 이 검사를 `path:packages/runtime/src/module-graph.ts:360-397`의 `validateCompiledModules()`에서 수행합니다.
이 함수가 `compileModuleGraph()`의 두 번째 절반입니다.
이 pass가 성공해야만 module graph가 승인됩니다.

validation pipeline은 크게 네 조각으로 나뉩니다.
첫째,
runtime bootstrap provider의 injection metadata를 검증합니다.
둘째,
global exported token을 수집합니다.
셋째,
각 module이 접근 가능한 token 집합을 계산합니다.
넷째,
provider visibility,
controller visibility,
export legality를 강제합니다.

접근 가능한 token의 공식은 `path:packages/runtime/src/module-graph.ts:263-275`의 `createAccessibleTokenSet()`에 명시되어 있습니다.
한 module의 accessible set은 다음 네 종류의 합집합입니다.
runtime provider token,
자기 own local provider token,
직접 import한 module들의 exported token,
global module이 export한 token입니다.

이 공식을 문장으로 다시 적는 이유가 있습니다.
이것이 실제 module contract이기 때문입니다.
token이 앱 어딘가에 존재한다고 해서 visible한 것이 아닙니다.
반드시 이 네 경로 중 하나로 현재 module에 들어와야 합니다.

provider visibility 검사는 `path:packages/runtime/src/module-graph.ts:277-303`의 `validateProviderVisibility()`에서 수행됩니다.
각 provider마다,
runtime은 먼저 constructor metadata를 검증하고,
그 다음 dependency token을 순회하며,
접근 불가능한 token이 있으면 `ModuleVisibilityError`를 던집니다.

controller visibility는 `path:packages/runtime/src/module-graph.ts:305-331`에서 같은 패턴을 따릅니다.
Fluo는 controller에 provider보다 느슨한 privilege model을 주지 않습니다.
controller도 같은 import/export topology를 따라야 합니다.

이 파일의 에러 메시지는 특히 교육적입니다.
token이 보이지 않으면,
runtime은 owning module에서 export하고 그 module을 import하라고 제안합니다.
또는 universal visibility가 목적이라면 owner를 `@Global()`로 표시하라고 안내합니다.
즉 validation은 단순 방어가 아니라,
프레임워크의 architectural teaching을 코드로 담은 계층입니다.

constructor metadata validation도 필수 계층입니다.
`path:packages/runtime/src/module-graph.ts:103-129`의 `validateClassInjectionMetadata()`는 required constructor arity와 configured injection token 개수를 비교합니다.
metadata가 부족하면,
provider instantiation이 시작되기 전에 `ModuleInjectionMetadataError`를 던집니다.

테스트가 이 규칙들을 고정합니다.
`path:packages/runtime/src/bootstrap.test.ts:41-59`는 export되지 않은 provider가 module 경계를 넘지 못함을 보여 줍니다.
`path:packages/runtime/src/bootstrap.test.ts:61-75`는 `@Inject(...)` metadata 누락을 거부합니다.
`path:packages/runtime/src/bootstrap.test.ts:105-120`은 같은 규칙을 controller에도 적용합니다.

export validation은 `path:packages/runtime/src/module-graph.ts:333-358`의 `createExportedTokenSet()`에서 수행됩니다.
규칙은 엄격합니다.
module은 token이 local provider이거나,
import한 module에서 re-export된 경우에만 export할 수 있습니다.
그 외는 허용되지 않습니다.

이 규칙은 미묘한 문서 drift를 막습니다.
module이 실제로 등록하지 않은 token을 자기 public surface처럼 주장할 수 없게 합니다.
public surface는 실제 graph edge와 일치해야 합니다.

validation 흐름은 다음과 같이 그릴 수 있습니다.

```text
for each compiled module:
  resolve imported modules
  collect imported exported tokens
  merge runtime + local + imported + global tokens
  validate provider metadata and visibility
  validate controller metadata and visibility
  validate exports and store exported token set
```

`compileModuleGraph()`가 반환될 때는 세 가지가 보장됩니다.
import graph는 acyclic입니다.
현재 module에서 보이는 모든 dependency token은 합법입니다.
모든 exported token은 실제 ownership 또는 valid re-export에 대응합니다.

그래서 이후 bootstrap 코드는 비교적 단순할 수 있습니다.
이미 coherence가 증명된 graph를 넘겨받기 때문입니다.

## 8.4 Container registration replays the compiled order and applies duplicate-provider policy
graph가 compile되면,
`path:packages/runtime/src/bootstrap.ts:372-398`의 `bootstrapModule()`이 새로운 `Container`를 만듭니다.
그리고 그 뒤에야 실제로 어떤 provider를 등록할지 결정합니다.

여기서 가장 흥미로운 helper는 `path:packages/runtime/src/bootstrap.ts:262-312`의 `collectProvidersForContainer()`입니다.
이 함수는 runtime provider와 module provider를 token 기준의 selected-provider map으로 합칩니다.
여기서는 multi-version 공존을 시도하지 않습니다.
token마다 승자 하나만 선택합니다.

duplicate policy는 `path:packages/runtime/src/types.ts:33-39`의 `BootstrapModuleOptions`에서 옵니다.
허용 값은 `'warn'`, `'throw'`, `'ignore'`입니다.
`bootstrapModule()`은 `path:packages/runtime/src/bootstrap.ts:375`에서 기본값을 `'warn'`으로 둡니다.

두 module이 같은 token을 등록하면,
runtime은 `path:packages/runtime/src/bootstrap.ts:257-260`의 `createDuplicateProviderMessage()`를 사용한 뒤 policy에 따라 분기합니다.
`'throw'`는 `DuplicateProviderError`를 던지고,
`'warn'`은 로그를 남기고 계속 진행하며,
`'ignore'`는 조용히 나중 registration을 승자로 둡니다.

여기서 중요한 구현 포인트는 selection order입니다.
`collectProvidersForContainer()`는 compiled module을 dependency order로 순회하지만,
map에 나중 write가 이전 write를 덮어쓰기 때문에,
마지막에 만난 provider token이 승리합니다.
즉 설계가 좋지 않을 수는 있어도,
동작은 deterministic합니다.

테스트가 이를 분명하게 보여 줍니다.
`path:packages/runtime/src/bootstrap.test.ts:291-317`은 warning path를 검증합니다.
`path:packages/runtime/src/bootstrap.test.ts:319-343`은 warning mode에서 나중 provider가 실제로 승리함을 증명합니다.
runtime은 duplicate를 merge하지 않습니다.
token당 selected provider 하나만 남깁니다.

selection 이후,
`bootstrapModule()`은 `createRuntimeTokenSet()`과 `providerToken()`을 사용해 module provider 목록에서 runtime provider token을 제거합니다.
이 단계 덕분에 bootstrap-scoped runtime token이 중복 등록되지 않습니다.

그 다음 registration은 의도적으로 단순한 순서로 진행됩니다.

```text
register runtime providers first
register selected module providers second
register controllers third
register middleware constructor tokens last
```

controller 단계는 `path:packages/runtime/src/bootstrap.ts:314-320`의 `registerControllers()`가 담당합니다.
middleware 단계는 `path:packages/runtime/src/bootstrap.ts:330-348`의 `registerModuleMiddleware()`가 담당합니다.
이 마지막 helper가 중요한 이유는 middleware constructor도 DI에 참여할 수 있기 때문입니다.

`path:packages/runtime/src/bootstrap.test.ts:223-287`은 이 동작을 고정합니다.
middleware class token은 container에 등록되고,
`{ middleware, routes }` 형태의 route-scoped middleware도 마찬가지입니다.
반면 plain object middleware는 건너뜁니다.
이 덕분에 factory-style middleware를 유지하면서도 모든 middleware를 DI type인 척하지 않습니다.

여기서의 module-order analysis는 단순하지만 중요합니다.
compiled module list는 dependency-first이므로,
provider selection은 importer보다 imported module을 먼저 봅니다.
따라서 duplicate policy가 허용할 경우,
나중의 importer module이 imported token을 의도적으로 덮어쓸 수 있습니다.
runtime은 임의가 아닙니다.
dependency-ordered traversal 위에서 last-write-wins를 수행합니다.

따라서 8장의 중간 결론은 이렇습니다.
graph compiler가 합법적인 topology를 결정하고,
`bootstrapModule()`은 그 topology를 explicit duplicate semantics와 함께 container에 재생합니다.

## 8.5 Initialization order continues after registration through lifecycle resolution and hook execution
module graph order는 initialization order의 절반에 불과합니다.
registration 이후 runtime은 어떤 singleton instance를 eager하게 만들지,
어떤 hook을 실행할지,
언제 app이 ready해지는지도 결정해야 합니다.

이 연속 단계는 `path:packages/runtime/src/bootstrap.ts:920-1029`의 `bootstrapApplication()`과,
`path:packages/runtime/src/bootstrap.ts:1059-1153`의 `FluoFactory.createApplicationContext()`에 있습니다.
두 흐름은 같은 lifecycle skeleton을 공유합니다.

첫째,
runtime context token이 등록됩니다.
`path:packages/runtime/src/bootstrap.ts:783-795`의 `registerRuntimeBootstrapTokens()`는 full application에 대해 `HTTP_APPLICATION_ADAPTER`와 `PLATFORM_SHELL`을 추가합니다.
`path:packages/runtime/src/bootstrap.ts:811-816`의 `registerRuntimeApplicationContextTokens()`는 context-only bootstrap에 대해 `PLATFORM_SHELL`만 추가합니다.

둘째,
runtime은 `path:packages/runtime/src/bootstrap.ts:818-828`의 `resolveBootstrapLifecycleInstances()`를 통해 lifecycle-bearing singleton instance를 해석합니다.
이 helper는 runtime provider와 module provider를 합친 뒤,
`resolveLifecycleInstances()`에 위임합니다.

`path:packages/runtime/src/bootstrap.ts:666-688`의 `resolveLifecycleInstances()`가 바로 eager instantiation policy를 명시하는 곳입니다.
request scope와 transient provider는 건너뜁니다.
token 기준으로 중복을 제거합니다.
그리고 singleton provider만 즉시 resolve합니다.

즉 Fluo의 bootstrap order는 "모든 module의 모든 provider를 instantiate한다"가 아닙니다.
"lifecycle hook에 참여할 수 있는 unique singleton provider를 eager하게 instantiate한다"에 가깝습니다.
이 정책이 더 제한적이고,
더 감사 가능하며,
무엇보다 구현 추적이 쉽습니다.

셋째,
`path:packages/runtime/src/bootstrap.ts:830-840`의 `runBootstrapLifecycle()`이 실제 start sequence를 조율합니다.
readiness marker를 reset하고,
bootstrap hook을 실행하고,
platform shell을 시작하고,
readiness를 표시하고,
compiled module 로그를 남깁니다.

내부 hook ordering은 `path:packages/runtime/src/bootstrap.ts:693-705`의 `runBootstrapHooks()`에 있습니다.
모든 `onModuleInit()` hook이 먼저 실행됩니다.
그 pass가 끝난 뒤에야 모든 `onApplicationBootstrap()` hook이 실행됩니다.
즉 전역적인 phase barrier가 있습니다.
instance별 interleave가 아닙니다.

shutdown ordering은 거울상입니다.
`path:packages/runtime/src/bootstrap.ts:710-722`의 `runShutdownHooks()`는 instance를 역순으로 순회하면서,
먼저 모든 `onModuleDestroy()`를 실행하고,
그 다음 모든 `onApplicationShutdown()`을 실행합니다.

application test가 이 계약을 증명합니다.
`path:packages/runtime/src/application.test.ts:175-235`는 정확한 순서를 기록합니다.
`module:init`,
`app:bootstrap`,
그리고 close 시 `module:destroy`,
`app:shutdown:SIGTERM`,
마지막으로 adapter close입니다.

전체 runtime-order diagram은 다음과 같습니다.

```text
compile module graph
  -> validate visibility and exports
  -> register providers/controllers/middleware
  -> register runtime tokens
  -> eagerly resolve singleton lifecycle instances
  -> run all onModuleInit hooks
  -> run all onApplicationBootstrap hooks
  -> start platform shell
  -> create dispatcher/application shell
  -> later: listen() binds adapter
```

`path:packages/runtime/src/bootstrap.test.ts:522-629`의 application-context 테스트는 HTTP adapter가 없어도 같은 lifecycle sequence가 유지됨을 보여 줍니다.
즉 initialization order는 transport startup에 속한 것이 아니라,
runtime shell 자체에 속합니다.

이 구분이 바로 8장의 진짜 마무리입니다.
Fluo에서 "module initialization order"는 단순한 topological sorting이 아닙니다.
먼저 module의 compile-time order가 있고,
그 다음 token registration order가 있으며,
그 다음 singleton lifecycle bootstrap order가 있고,
그 모든 것이 끝난 뒤에야 transport readiness가 옵니다.

고급 디버깅에서는 이 layered model을 머릿속에 유지해야 합니다.
container가 생기기 전에 실패하면 module graph compilation을 보십시오.
`listen()` 전에 실패하면 lifecycle resolution이나 platform start를 보십시오.
`listen()` 중에 실패했다면,
graph와 lifecycle phase는 이미 성공한 상태입니다.
