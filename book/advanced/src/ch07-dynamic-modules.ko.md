<!-- packages: @fluojs/core, @fluojs/runtime, @fluojs/di, @fluojs/prisma, @fluojs/email, @fluojs/redis, @fluojs/config -->
<!-- project-state: T15 Part 2 source-analysis draft for dynamic module authoring, async factories, and runtime composition -->

# 7. Dynamic Modules and Factory Providers

## 7.1 In Fluo, a dynamic module is just a module type produced by code
Fluo의 dynamic module 이야기는 의도적으로 담백합니다.
`@fluojs/core` 안에 숨겨진 특별한 "dynamic module object" 프로토콜은 없습니다.
대신 dynamic module은 단지 코드로 메타데이터가 생성된 module class일 뿐입니다.

가장 직접적인 단서는 `path:packages/runtime/src/types.ts:18-31`과 `path:packages/runtime/src/bootstrap.ts:350-361`에 있습니다.
`ModuleType`은 그저 constructable class type입니다.
`defineModule()`은 그 타입에 module metadata를 기록하고 같은 class reference를 반환할 뿐입니다.
이것이 runtime primitive의 전부입니다.

실제 metadata write는 `path:packages/core/src/metadata/module.ts:37-52`의 `defineModuleMetadata()`가 담당합니다.
이 함수는 기존 레코드를 무조건 통째로 교체하지 않고 partial field를 merge합니다.
바로 이 세부 구현 덕분에 programmatic helper composition이 가능합니다.

그래서 Fluo는 두 가지 authoring style을 동시에 지원할 수 있습니다.
정적 decorator 스타일은 `path:packages/core/src/decorators.ts:13-34`의 `@Module(...)`과 `@Global()`을 사용합니다.
programmatic 스타일은 `defineModule(...)` 또는 심지어 `defineModuleMetadata(...)`를 직접 호출합니다.
런타임에서는 둘 다 같은 metadata store로 수렴합니다.

가장 작은 예시는 `ConfigReloadModule.forRoot()`입니다.
`path:packages/config/src/reload-module.ts:127-149`는 `ConfigReloadModuleImpl` subclass를 만들고,
`defineModuleMetadata(...)`로 module metadata를 기록한 뒤,
그 subclass를 반환합니다.
별도의 runtime wrapper object는 없습니다.

이 사실이 곧 Fluo의 dynamic module 정신 모델입니다.
dynamic module은 이차적인 escape hatch가 아닙니다.
선언 시점에 한 번 손으로 적는 대신,
factory function이 만들어 내는 ordinary module type입니다.

최소 패턴은 다음과 같습니다.

```text
function forRoot(options): ModuleType {
  class RuntimeModule {}
  defineModule(RuntimeModule, {
    providers: [...derived from options...],
    exports: [...],
    global: maybeTrue,
  })
  return RuntimeModule
}
```

고급 독자에게 중요한 함의도 분명합니다.
dynamic module도 결국 module type이기 때문에,
static module과 똑같이 module-graph compiler,
visibility check,
export check,
provider registration 로직을 모두 통과합니다.
즉 dynamic module이라고 해서 runtime governance rule을 우회하지 않습니다.

## 7.2 Static forRoot helpers are factories for metadata plus providers
문법을 걷어 내고 보면 `forRoot(...)` helper는 보통 두 가지 일을 합니다.
옵션으로부터 provider definition을 계산하고,
그 definition을 새로운 module type에 묶습니다.

`PrismaModule.forRoot()`는 아주 좋은 참고 구현입니다.
`path:packages/prisma/src/module.ts:68-84`는 새로운 class를 만들고,
`defineModule(...)`을 호출해 고정된 public provider set을 export하며,
정규화된 옵션 value provider를 `PRISMA_NORMALIZED_OPTIONS` 아래에 등록합니다.
나머지 runtime provider는 모두 이 options token으로부터 파생됩니다.

`RedisModule.forRoot()`는 약간 다른 변형을 보여 줍니다.
`path:packages/redis/src/module.ts:31-83`은 raw Redis client, 고수준 `RedisService`, lifecycle service를 구성하는 provider 집합을 만듭니다.
그 다음 `path:packages/redis/src/module.ts:108-116`이 이 provider set을 global module export로 감쌉니다.
여기서도 module factory의 본질은 provider assembly와 metadata binding입니다.

`QueueModule.forRoot()`는 더 노골적입니다.
`path:packages/queue/src/module.ts:9-42`는 옵션을 정규화하고 provider를 만듭니다.
그 뒤 `path:packages/queue/src/module.ts:69-77`은 `QueueLifecycleService`와 `QUEUE`를 export하는 module definition을 반환할 뿐입니다.
패턴이 놀라울 정도로 일정하게 반복됩니다.

여기서 얻어야 할 설계 교훈은 간단합니다.
dynamic module이 복잡한 제어 흐름을 요구하는 것은 아닙니다.
복잡성이 있다면 대부분 pure option normalization과 provider construction helper로 내려가야 합니다.
실제 module helper는 작아야 합니다.

이 분리는 여러 패키지에서 반복됩니다.
`PrismaModule`은 `path:packages/prisma/src/module.ts:27-66`에 `normalizePrismaModuleOptions()`와 `createPrismaRuntimeProviders()`를 둡니다.
`QueueModule`은 `path:packages/queue/src/module.ts:9-42`에 `normalizeQueueModuleOptions()`와 `createQueueProviders()`를 둡니다.
`RedisModule`은 `path:packages/redis/src/module.ts:24-83`에 `createRedisProviders()`를 둡니다.

실무 규칙으로 바꾸면 이렇습니다.
`forRoot(...)` helper가 읽기 어렵다면,
문제는 dynamic-module 개념 자체가 아니라,
provider derivation과 option normalization이 충분히 분리되지 않았기 때문일 가능성이 높습니다.

정적 module helper의 구현 흐름은 대체로 다음과 같습니다.

```text
receive user options
normalize options into stable internal shape
derive provider array from normalized options
create fresh module class
bind exports/imports/providers/global metadata
return module class
```

이 패턴이 일정하기 때문에,
Fluo 패키지의 module registration은 매우 감사 가능(auditable)해집니다.
대부분의 경우 "이 모듈이 무엇을 등록하는가?"라는 질문에 답하려면,
decorator를 추적하기보다 helper 파일 하나만 읽으면 됩니다.

## 7.3 Async module helpers are factory providers with memoized option resolution
비동기 사례는 많은 프레임워크가 불투명해지는 지점입니다.
하지만 Fluo는 여기서도 의외로 직접적입니다.
async module helper도 여전히 module factory이며,
차이는 provider 중 하나가 memoized result를 내는 factory provider라는 점뿐입니다.

공유 계약은 `path:packages/core/src/types.ts:29-37`의 `AsyncModuleOptions<T>`에서 옵니다.
필드는 `inject?: Token[]`와 `useFactory: (...deps) => MaybePromise<T>`뿐입니다.
core type 수준에서 `forRootAsync(...)`에 필요한 것은 이것이 전부입니다.

`EmailModule.forRootAsync()`는 아주 읽기 좋은 예시입니다.
`path:packages/email/src/module.ts:114-138`은 user factory를 로컬 변수에 저장하고,
`cachedResult` promise를 만들고,
처음 한 번만 promise를 초기화하는 `memoizedFactory(...deps)`를 정의한 뒤,
`EMAIL_OPTIONS`에 대한 singleton factory provider를 등록합니다.
다른 runtime provider는 모두 이 options token을 소비합니다.

`PrismaModule.forRootAsync()`도 normalized Prisma options에 대해 정확히 같은 방식을 사용합니다.
근거는 `path:packages/prisma/src/module.ts:86-120`입니다.
이 memoization은 cosmetic이 아닙니다.
없다면 options token을 소비하는 downstream consumer마다 별도의 async configuration load가 일어날 수 있습니다.
memoization이 있으므로 module instance당 한 번만 resolve됩니다.

여기서 미묘하지만 중요한 관찰이 나옵니다.
async helper는 static helper와 본질적으로 다르지 않습니다.
options provider가 value provider 대신 singleton factory provider가 된 것뿐입니다.
그 아래에 있는 다른 provider는 여전히 평범한 DI token을 봅니다.

알고리즘은 따라서 다음과 같습니다.

```text
forRootAsync(options):
  keep a local cachedResult promise
  define memoizedFactory that calls user useFactory only once
  register singleton options provider using inject + memoizedFactory
  register all other runtime providers against that options token
  return generated module type
```

이 지점에서 장 제목의 두 번째 절반인 "factory providers"가 구체화됩니다.
dynamic module은 단지 module을 만들어 내는 것만이 아닙니다.
런타임 configuration으로부터 provider graph를 만들어 내는 규율 있는 방식이기도 합니다.
module helper는 하나 이상의 factory provider를 제조합니다.

`path:packages/email/src/module.ts:74-95`와 `path:packages/prisma/src/module.ts:40-66`를 비교해 보면 반복 패턴이 잘 보입니다.
provider 하나가 normalized options를 materialize하고,
다른 provider들이 그 하나의 source로부터 파생값과 service를 fan-out합니다.
이 설계 덕분에 async configuration은 중앙화되고 중복 호출이 제거됩니다.

## 7.4 Global exports, named registrations, and alias-based public surfaces
Fluo의 dynamic module은 public API 디자인이 드러나는 자리이기도 합니다.
module helper가 어떤 provider를 internal로 숨기고,
어떤 token을 supported surface로 노출할지 결정하기 때문입니다.

`RedisModule`은 좋은 예시입니다.
`path:packages/redis/src/module.ts:108-116`은 default registration을 global로 만들고 `REDIS_CLIENT`와 `RedisService`를 export합니다.
`path:packages/redis/src/module.ts:160-170`은 named registration에도 같은 패턴을 적용하되,
`name`으로부터 파생된 token helper를 export합니다.
여기서 dynamic module은 단지 provider를 만드는 것이 아니라,
안정적인 public token surface를 잘라 내고 있습니다.

`SocketIoModule.forRoot()`도 유사한 패턴을 따릅니다.
`path:packages/socket.io/src/module.ts:11-31`은 internal options token,
lifecycle service,
raw server를 노출하는 factory provider,
`useExisting`으로 `SOCKETIO_ROOM_SERVICE`를 노출하는 alias provider를 정의합니다.
그 다음 `path:packages/socket.io/src/module.ts:54-61`이 public room-service와 raw-server token만 export합니다.

`PassportModule.forRoot()`는 또 다른 변형입니다.
`path:packages/passport/src/module.ts:29-44`는 strategy registry를 internal로 유지하고,
`path:packages/passport/src/module.ts:75-85`에서는 `AuthGuard`만 export합니다.
즉 dynamic-module 설계는 무엇을 export할지뿐 아니라 무엇을 export하지 않을지도 결정합니다.

runtime은 이러한 선택을 실제로 강제합니다.
`path:packages/runtime/src/module-graph.ts:333-358`의 `createExportedTokenSet()`은 local provider도 아니고 imported module의 re-export도 아닌 token export를 거부합니다.
그리고 `path:packages/runtime/src/module-graph.ts:360-415`의 `validateCompiledModules()`는 global exported token을 모든 모듈의 accessible-token set에 합칩니다.

즉 dynamic module이 `global: true`를 선언할 때,
그것은 어떤 마법의 전역 레지스트리를 호출하는 것이 아닙니다.
정적 `@Global()` 모듈과 같은 module-graph validation 흐름에 참여하는 것입니다.
차이는 metadata가 코드로 조립되었다는 점뿐입니다.

여기서 유용한 설계 휴리스틱이 나옵니다.

- consumer가 configuration shape에 직접 의존하면 안 될 때는 raw options token을 internal로 유지한다.
- 대신 facade service나 안정적인 symbolic token을 export한다.
- 서로 다른 public 이름이 같은 lifecycle object를 가리켜야 하면 `useExisting`을 사용한다.
- 여러 module instance가 충돌 없이 공존해야 하면 named token helper를 사용한다.

이 마지막 항목이 바로 `RedisModule.forRootNamed()`가 중요한 이유입니다.
새로운 container 개념을 발명하지 않고도,
서로 다른 token을 파생시킴으로써 독립적으로 addressable한 여러 instance를 만들 수 있음을 보여 줍니다.

## 7.5 A practical checklist for authoring Fluo dynamic modules
이제 내부 모델이 충분히 분명해졌으니,
이를 authoring checklist로 바꿔 볼 수 있습니다.
목표는 Nest 비슷한 API 모양을 흉내 내는 것이 아닙니다.
Fluo의 explicit DI rule 아래에서도 투명하게 읽히는 모듈을 만드는 것입니다.

첫째, 그 모듈이 정말 dynamic해야 하는지부터 판단하십시오.
등록에 runtime option도 없고 computed provider set도 없다면,
평범한 `@Module(...)` metadata가 더 단순할 수 있습니다.
dynamic module은 코드가 metadata나 provider를 실제로 계산해야 할 때 사용하십시오.

둘째, provider graph를 만들기 전에 옵션을 정규화하십시오.
`path:packages/prisma/src/module.ts:27-38`의 `normalizePrismaModuleOptions()`,
`path:packages/queue/src/module.ts:9-25`의 `normalizeQueueModuleOptions()`,
`path:packages/email/src/module.ts:48-72`의 `normalizeEmailModuleOptions()`가 모두 이 규칙을 보여 줍니다.
이 단계가 있어야 provider factory가 작게 유지되고 validation logic이 중복되지 않습니다.

셋째, configuration을 하나의 options token으로 중앙화하십시오.
`EmailModule`과 `PrismaModule`은 모두 normalized-options provider 하나를 만들고,
나머지 provider를 전부 그 token에서 파생합니다.
이 덕분에 configuration fan-out 로직이 여러 factory에 흩어지지 않습니다.

넷째, async option factory는 반드시 memoize하십시오.
안전한 패턴은 `path:packages/email/src/module.ts:117-136`과 `path:packages/prisma/src/module.ts:97-114`에 있습니다.
memoization이 없으면 async `useFactory` 작업이 예기치 않게 반복될 수 있습니다.

다섯째, export와 global visibility를 의식적으로 설계하십시오.
`path:packages/runtime/src/module-graph.ts:333-415`의 runtime validation은 export된 모든 token이 실제로 유효하고 visible함을 강제합니다.
global module은 접근 범위를 넓히지만,
graph compiler를 우회하게 해 주지는 않습니다.

여섯째, helper layer를 작게 유지하십시오.
하나는 option normalization,
하나는 provider construction,
그리고 아주 작은 `forRoot(...)` 또는 `forRootAsync(...)`가 fresh module type에 metadata를 묶도록 하십시오.
이 패턴이 저장소 전반에서 반복되는 이유는 확장성이 좋기 때문입니다.

마지막으로 dynamic module도 나머지 DI 규칙과 완전히 연결되어 있다는 점을 잊지 마십시오.
그 모듈이 등록한 provider는 여전히 container normalization을 거칩니다.
scope는 여전히 5장의 규칙을 따릅니다.
alias는 여전히 6장의 cycle/scope check에 참여합니다.
export는 여전히 module-graph validation을 통과해야 합니다.

종합 체크리스트는 다음과 같습니다.

```text
decide static vs dynamic registration
normalize options into an internal shape
create one canonical options token/provider
derive runtime providers from that token
memoize async option factories
bind metadata to a fresh module class with defineModule() or defineModuleMetadata()
export only the intended public tokens
mark global only when cross-app visibility is truly desired
```

이것이 Fluo dynamic-module API의 실제 내부 그림입니다.
추가적인 container subsystem이 아닙니다.
module metadata와 factory provider를 위한 규율 있는 코드 생성 패턴이며,
프레임워크의 다른 부분과 똑같은 explicit token, provider, module-graph machinery 위에 서 있습니다.
