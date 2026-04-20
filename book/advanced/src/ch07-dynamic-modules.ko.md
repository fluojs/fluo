<!-- packages: @fluojs/core, @fluojs/runtime, @fluojs/di, @fluojs/prisma, @fluojs/email, @fluojs/redis, @fluojs/config -->
<!-- project-state: T15 Part 2 source-analysis draft for dynamic module authoring, async factories, and runtime composition -->

# 7. Dynamic Modules and Factory Providers

## 7.1 In Fluo, a dynamic module is just a module type produced by code
Fluo의 dynamic module 이야기는 의도적으로 담백합니다. `@fluojs/core` 안에 숨겨진 특별한 "dynamic module object" 프로토콜은 없습니다. 대신 dynamic module은 단지 코드로 메타데이터가 생성된 module class일 뿐입니다.

가장 직접적인 단서는 `path:packages/runtime/src/types.ts:18-31`과 `path:packages/runtime/src/bootstrap.ts:350-361`에 있습니다. `ModuleType`은 그저 생성 가능한 클래스 타입(Constructable class type)이며, `defineModule()`은 그 타입에 module metadata를 기록하고 같은 클래스 참조를 반환할 뿐입니다. 이 단 하나의 런타임 프리미티브가 전체 메커니즘의 전부입니다.

실제 metadata write는 `path:packages/core/src/metadata/module.ts:37-52`의 `defineModuleMetadata()`가 담당합니다. 이 함수는 기존 레코드를 무조건 통째로 교체하지 않고 partial field를 merge합니다. 바로 이 **병합(Merge) 동작** 덕분에 programmatic helper composition이 가능해집니다.

그래서 Fluo는 두 가지 authoring style을 동시에 지원할 수 있습니다:
- **정적 데코레이터 스타일**: `path:packages/core/src/decorators.ts:13-34`의 `@Module(...)`과 `@Global()`을 사용합니다.
- **프로그래밍 방식 스타일**: `defineModule(...)` 또는 심지어 `defineModuleMetadata(...)`를 직접 호출합니다.

런타임에서는 둘 다 같은 metadata store로 수렴합니다. 가장 작은 예시는 `ConfigReloadModule.forRoot()`입니다. `path:packages/config/src/reload-module.ts:127-149`는 `ConfigReloadModuleImpl` subclass를 만들고, `defineModuleMetadata(...)`로 module metadata를 기록한 뒤 그 subclass를 반환합니다. 별도의 runtime wrapper object는 존재하지 않습니다.

이 사실이 곧 Fluo의 dynamic module 정신 모델입니다: dynamic module은 이차적인 escape hatch가 아닙니다. 선언 시점에 한 번 손으로 적는 대신, factory function이 만들어 내는 **일반적인 모듈 타입**입니다. dynamic module도 결국 module type이기 때문에, static module과 똑같이 module-graph compiler, visibility check, export check, provider registration 로직을 모두 통과하며 런타임 거버넌스 규칙을 우회하지 않습니다.

## 7.2 Static forRoot helpers are factories for metadata plus providers
문법을 걷어 내고 보면 `forRoot(...)` helper는 보통 두 가지 일을 합니다: 옵션으로부터 provider definition을 계산하고, 그 definition을 새로운 module type에 묶는 것입니다.

`PrismaModule.forRoot()`는 아주 좋은 참고 구현입니다. `path:packages/prisma/src/module.ts:68-84`는 새로운 class를 만들고, `defineModule(...)`을 호출해 고정된 public provider set을 export하며, 정규화된 옵션 value provider를 `PRISMA_NORMALIZED_OPTIONS` 아래에 등록합니다. 나머지 runtime provider는 모두 이 options token으로부터 파생됩니다.

`RedisModule.forRoot()`는 약간 다른 변형을 보여 줍니다. `path:packages/redis/src/module.ts:31-83`은 raw Redis client, 고수준 `RedisService`, lifecycle service를 구성하는 provider 집합을 만듭니다. 그 다음 `path:packages/redis/src/module.ts:108-116`이 이 provider set을 global module export로 감쌉니다. 여기서도 module factory의 본질은 provider assembly와 metadata binding입니다.

`QueueModule.forRoot()`는 더 노골적입니다. `path:packages/queue/src/module.ts:9-42`는 옵션을 정규화하고 provider를 만듭니다. 그 뒤 `path:packages/queue/src/module.ts:69-77`은 `QueueLifecycleService`와 `QUEUE`를 export하는 module definition을 반환할 뿐입니다. 패턴이 놀라울 정도로 일정하게 반복됩니다.

여기서 얻어야 할 설계 교훈은 간단합니다: dynamic module이 복잡한 제어 흐름을 요구하는 것은 아닙니다. 복잡성이 있다면 대부분 pure option normalization과 provider construction helper로 내려가야 합니다. 실제 module helper는 작아야 합니다. 이 분리는 여러 패키지에서 반복됩니다:
- `PrismaModule`: `path:packages/prisma/src/module.ts:27-66`의 `normalizePrismaModuleOptions()`와 `createPrismaRuntimeProviders()`.
- `QueueModule`: `path:packages/queue/src/module.ts:9-42`의 `normalizeQueueModuleOptions()`와 `createQueueProviders()`.
- `RedisModule`: `path:packages/redis/src/module.ts:24-83`의 `createRedisProviders()`.

정적 module helper의 구현 흐름은 대체로 다음과 같습니다:
```text
receive user options
  ──▶ 옵션을 안정적인 내부 형태(Stable internal shape)로 정규화
  ──▶ 정규화된 옵션으로부터 provider 배열 파생
  ──▶ 새로운 모듈 클래스 생성
  ──▶ defineModule()을 통해 metadata 바인딩
  ──▶ 생성된 모듈 클래스 참조 반환
```

## 7.3 Async module helpers are factory providers with memoized option resolution
비동기 사례는 많은 프레임워크가 불투명해지는 지점입니다. 하지만 Fluo는 여기서도 의외로 직접적입니다. async module helper도 여전히 module factory이며, 차이는 provider 중 하나가 **메모이제이션된 결과(Memoized result)**를 내는 factory provider라는 점뿐입니다.

공유 계약은 `path:packages/core/src/types.ts:29-37`의 `AsyncModuleOptions<T>`에서 옵니다. 필드는 `inject?: Token[]`와 `useFactory: (...deps) => MaybePromise<T>`뿐입니다.

`EmailModule.forRootAsync()`는 아주 읽기 좋은 예시입니다. `path:packages/email/src/module.ts:114-138`은 user factory를 로컬 변수에 저장하고, `cachedResult` promise를 만들고, 처음 한 번만 promise를 초기화하는 `memoizedFactory(...deps)`를 정의한 뒤, `EMAIL_OPTIONS`에 대한 singleton factory provider를 등록합니다. 다른 runtime provider는 모두 이 options token을 소비합니다.

`PrismaModule.forRootAsync()`도 normalized Prisma options에 대해 정확히 같은 방식을 사용합니다. 근거는 `path:packages/prisma/src/module.ts:86-120`입니다. 이 memoization은 cosmetic이 아닙니다. 없다면 options token을 소비하는 downstream consumer마다 별도의 async configuration load가 일어날 수 있습니다. memoization이 있으므로 module instance당 한 번만 resolve됩니다.

`forRootAsync` 구현 알고리즘의 핵심 예시:
```typescript
// EmailModule.forRootAsync()의 개념적 흐름
function forRootAsync(options: EmailAsyncOptions): ModuleType {
  class EmailRuntimeModule {}
  let cachedOptions: Promise<EmailOptions> | undefined;

  const optionsProvider = {
    provide: EMAIL_OPTIONS,
    inject: options.inject || [],
    useFactory: async (...args: any[]) => {
      if (!cachedOptions) {
        // 중복 실행 방지를 위한 메모이제이션
        cachedOptions = Promise.resolve(options.useFactory(...args));
      }
      return cachedOptions;
    }
  };

  defineModule(EmailRuntimeModule, {
    providers: [optionsProvider, ...EmailProviders],
    exports: [EmailService],
  });

  return EmailRuntimeModule;
}
```

이 설계 덕분에 async configuration은 중앙화되고 중복 호출이 제거됩니다. 그 아래에 있는 다른 provider는 경계에서 일어나는 비동기 해소 과정을 알 필요 없이 평범한 DI token을 소비하게 됩니다.

## 7.4 Global exports, named registrations, and alias-based public surfaces
Fluo의 dynamic module은 public API 디자인이 드러나는 자리이기도 합니다. module helper가 어떤 provider를 internal로 숨기고, 어떤 token을 supported surface로 노출할지 결정하기 때문입니다.

`RedisModule`은 좋은 예시입니다. `path:packages/redis/src/module.ts:108-116`은 default registration을 global로 만들고 `REDIS_CLIENT`와 `RedisService`를 export합니다. `path:packages/redis/src/module.ts:160-170`은 named registration에도 같은 패턴을 적용하되, `name`으로부터 파생된 token helper를 export합니다. 여기서 dynamic module은 단지 provider를 만드는 것이 아니라, 안정적인 public token surface를 잘라 내고 있습니다.

`SocketIoModule.forRoot()`도 유사한 패턴을 따릅니다. `path:packages/socket.io/src/module.ts:11-31`은 internal options token, lifecycle service, raw server를 노출하는 factory provider, 그리고 `useExisting`으로 `SOCKETIO_ROOM_SERVICE`를 노출하는 alias provider를 정의합니다. 그 다음 `path:packages/socket.io/src/module.ts:54-61`이 public room-service와 raw-server token만 export합니다.

runtime은 이러한 선택을 실제로 강제합니다. `path:packages/runtime/src/module-graph.ts:333-358`의 `createExportedTokenSet()`은 local provider도 아니고 imported module의 re-export도 아닌 token export를 거부합니다. 그리고 `path:packages/runtime/src/module-graph.ts:360-415`의 `validateCompiledModules()`는 global exported token을 모든 모듈의 accessible-token set에 합칩니다.

동적 모듈 표면 설계를 위한 유용한 휴리스틱:
1. **옵션 내재화**: consumer가 configuration shape에 직접 의존하면 안 될 때는 raw options token을 internal로 유지한다.
2. **파사드 노출**: 대신 facade service나 안정적인 symbolic token을 export한다.
3. **별칭 사용**: 서로 다른 public 이름이 같은 lifecycle object를 가리켜야 하면 `useExisting`을 사용한다.
4. **인스턴스 격리**: 여러 module instance가 충돌 없이 공존해야 하면 named token helper를 사용한다.

## 7.5 A practical checklist for authoring Fluo dynamic modules
이제 내부 모델이 충분히 분명해졌으니, 이를 실무 체크리스트로 바꿔 볼 수 있습니다. 목표는 Fluo의 explicit DI rule 아래에서도 투명하게 읽히는 모듈을 만드는 것입니다.

- **동적 모듈 필요성 판단**: 등록에 runtime option도 없고 computed provider set도 없다면, `@Module(...)`이 더 단순할 수 있습니다. 코드가 metadata나 provider를 실제로 계산해야 할 때만 사용하십시오.
- **조기 정규화**: `path:packages/prisma/src/module.ts:27-38`의 `normalizePrismaModuleOptions()`를 참고하십시오. 이 단계가 있어야 provider factory가 작게 유지되고 중복 검증 로직이 제거됩니다.
- **설정 중앙화**: `EmailModule`과 `PrismaModule`처럼 하나의 normalized-options provider를 만들고 나머지를 거기서 파생하십시오. 설정 로직이 여러 factory에 흩어지는 것을 방지합니다.
- **비동기 메모이제이션**: async factory는 반드시 메모이제이션된 promise로 감싸 예기치 않은 중복 실행을 방지하십시오.
- **내보내기 감사**: `path:packages/runtime/src/module-graph.ts:333-415`의 런타임 검증이 모든 export된 토큰의 유효성을 강제한다는 점을 기억하십시오.
- **작은 헬퍼 계층**: 옵션 정규화, provider 빌드, 그리고 `defineModule` 바인딩을 각각의 작은 헬퍼로 분리하십시오. 이 패턴이 저장소 전반에서 반복되는 이유는 확장성이 좋기 때문입니다.

마지막으로 dynamic module도 나머지 DI 규칙과 완전히 연결되어 있다는 점을 잊지 마십시오. 그 모듈이 등록한 provider는 여전히 container normalization을 거치며, scope는 5장의 규칙을 따르고, alias는 6장의 cycle/scope check에 참여합니다. Dynamic module은 추가적인 컨테이너 서브시스템이 아니라, 프레임워크의 다른 부분과 똑같은 explicit token 및 module-graph machinery 위에 선 규율 있는 메타데이터 생성 패턴입니다.
