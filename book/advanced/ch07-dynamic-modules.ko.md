<!-- packages: @fluojs/core, @fluojs/runtime, @fluojs/di, @fluojs/prisma, @fluojs/email, @fluojs/redis, @fluojs/config, @fluojs/queue, @fluojs/socket.io, @fluojs/passport -->
<!-- project-state: T15 Part 2 source-analysis enrichment for dynamic module authoring, async factories, and runtime composition -->

# 7. Dynamic Modules and Factory Providers

## 7.1 In Fluo, a dynamic module is just a module type produced by code
Fluo의 dynamic module 이야기는 의도적으로 담백합니다. `@fluojs/core` 안에 숨겨진 특별한 "dynamic module object" 프로토콜은 없습니다. 대신 dynamic module은 단지 코드로 메타데이터가 생성된 module class일 뿐입니다.

가장 직접적인 단서는 `path:packages/runtime/src/types.ts:18-31`과 `path:packages/runtime/src/bootstrap.ts:350-361`에 있습니다. `ModuleType`은 그저 constructable class type입니다. `defineModule()`은 그 타입에 module metadata를 기록하고 같은 class reference를 반환할 뿐입니다. 이것이 runtime primitive의 전부입니다.

실제 metadata write는 `path:packages/core/src/metadata/module.ts:37-52`의 `defineModuleMetadata()`가 담당합니다. 이 함수는 기존 레코드를 무조건 통째로 교체하지 않고 partial field를 merge합니다. 바로 이 세부 구현 덕분에 programmatic helper composition이 가능합니다. 여러 헬퍼가 동일한 동적 모듈 인스턴스에 서로 다른 공급자(provider)를 기여할 수 있는 이유가 여기에 있습니다.

그래서 Fluo는 두 가지 authoring style을 동시에 지원할 수 있습니다.
- **정적 decorator 스타일**은 `path:packages/core/src/decorators.ts:13-34`의 `@Module(...)`과 `@Global()`을 사용하며, 이는 선언 시점에 메타데이터 세터를 호출하는 문법적 설탕(syntactic sugar)에 불과합니다.
- **programmatic 스타일**은 factory function 내에서 `defineModule(...)` 또는 심지어 `defineModuleMetadata(...)`를 직접 호출합니다.

런타임에서는 둘 다 같은 metadata store로 수렴합니다. 가장 작은 예시는 `ConfigReloadModule.forRoot()`입니다. `path:packages/config/src/reload-module.ts:127-149`는 `ConfigReloadModuleImpl` subclass를 만들고, `defineModuleMetadata(...)`로 module metadata를 기록한 뒤, 그 subclass를 반환합니다. 별도의 runtime wrapper object나 proxy는 생성되지 않습니다.

여기서 서브클래스를 사용하는 것은 타입 식별성(type identity)을 유지하기 위한 영리한 기법입니다. 기본 모듈 클래스를 확장함으로써, 동적 모듈은 정적 메서드나 속성을 상속받는 동시에 자신만의 고유한 메타데이터를 가질 수 있습니다. 이 패턴은 `path:packages/core/src/bootstrap/module-factory.ts:50-75`에서도 확인할 수 있는데, 부트스트래퍼는 클래스 생성자를 모듈 레지스트리의 기본 키로 사용합니다. 즉, 두 동적 모듈이 동일한 프로바이더를 가지고 있더라도 서로 다른 클래스 생성자에서 생성되었다면 별개의 엔티티로 취급됩니다.

이 사실이 곧 Fluo의 dynamic module 정신 모델입니다. dynamic module은 이차적인 escape hatch나 "레거시" 기능이 아닙니다. 선언 시점에 한 번 손으로 적는 대신, factory function이 만들어 내는 ordinary module type입니다. 따라서 dynamic module도 일반 모듈과 똑같이 module-graph compiler, visibility check, provider registration 로직을 모두 통과합니다.

이러한 설계의 핵심 동기는 **투명성(transparency)**입니다. "DynamicModule 객체"(배열을 포함하는 데이터 구조)를 사용하는 프레임워크에서는 정적 모듈 트리와 동적 등록 결과 사이에 단절이 발생합니다. 동적 모듈이 실제 클래스가 되도록 강제함으로써, Fluo는 리플렉션 시스템과 개발자 도구가 애플리케이션의 모든 부분을 일관되게 처리할 수 있도록 보장합니다. 런타임에는 차이가 없기 때문에 "이것이 실제 모듈인지 아니면 동적 모듈 기술자인지" 물어볼 필요가 없습니다. 또한 `instanceof` 체크와 같은 표준 JavaScript 클래스 기능을 그대로 사용할 수 있어 디버깅과 텔레메트리(telemetry)에 매우 유용합니다.

최소 패턴은 다음과 같습니다.

```ts
// path:packages/core/src/metadata/module.ts (Metadata Primitives)
export function defineModule(target: any, metadata: ModuleMetadata) {
  Reflect.defineMetadata(MODULE_METADATA_KEY, metadata, target);
  return target;
}

function createRuntimeModule(options: MyOptions): ModuleType {
  class RuntimeModule {}

  defineModule(RuntimeModule, {
    providers: [
      { provide: MY_OPTIONS, useValue: options },
      MyService
    ],
    exports: [MyService]
  });

  return RuntimeModule;
}
```

데이터 객체가 아닌 클래스를 반환함으로써, Fluo는 DI 컨테이너가 결과를 안정적인 식별자(stable identity)로 취급할 수 있게 합니다. 동일한 팩토리가 여러 번 호출되더라도 반환된 각 클래스는 고유한 메타데이터를 가진 독자적인 타입이 되며, 이는 단일 애플리케이션 내에서 동일한 모듈 로직의 독립된 인스턴스를 여러 개 가질 수 있게 해줍니다.

이 메커니즘의 핵심은 `Reflect.defineMetadata`가 클래스 생성자와 상호작용하는 방식에 있습니다. 함수 내부에서 선언된 각 `class RuntimeModule {}`은 메모리 상에 새로운 생성자 함수(객체)를 생성하므로, 그와 연관된 메타데이터는 완벽하게 격리됩니다. 이는 일반 객체 구성을 사용하려는 프레임워크와 근본적으로 다른 점으로, 객체 구성 방식은 종종 의도치 않은 싱글톤 상태나 격리를 유지하기 위한 복잡한 "컨텍스트" 객체를 필요로 하게 만듭니다. Fluo에서는 클래스 자체가 곧 컨텍스트입니다.

또한 `defineModuleMetadata()`의 추가적인 성격은 동적 모듈이 "코드로 작성된 데코레이터"들의 연속을 통해 구축될 수 있음을 의미합니다. 텔레메트리 프로바이더를 추가하는 헬퍼, 데이터베이스 구성을 추가하는 헬퍼, API 컨트롤러를 추가하는 헬퍼 등을 동일한 동적 모듈 클래스에 순차적으로 적용한 뒤 부트스트래퍼에 반환할 수 있습니다. 이러한 "조합 가능한(mix-and-match)" 프로그래밍 방식의 구성은 클래스 선언의 고정된 성격에 제한되는 정적 데코레이터보다 훨씬 유연합니다.

다른 생태계에서 온 개발자들에게 중요한 점은 이러한 클래스들이 외부로 내보내질(export) 필요가 없으며 전역적으로 명명될 필요도 없다는 것입니다. 이들은 부트스트랩 과정의 일시적인 산물로서 애플리케이션 컨테이너가 유지되는 동안만 존재합니다. 덕분에 타입 기반 의존성 해결의 모든 이점을 누리면서도 전역 네임스페이스를 깨끗하게 유지할 수 있습니다.

## 7.2 Static forRoot helpers are factories for metadata plus providers

문법을 걷어 내고 보면 `forRoot(...)` helper는 보통 두 가지 일을 합니다. 옵션으로부터 안정적인 provider definition을 계산하고, 그 definition을 새로운 module type에 묶습니다.

`PrismaModule.forRoot()`는 아주 좋은 참고 구현입니다. `path:packages/prisma/src/module.ts:68-84`는 새로운 class를 만들고, `defineModule(...)`을 호출해 고정된 public provider set을 export하며, 정규화된 옵션 value provider를 `PRISMA_NORMALIZED_OPTIONS` 아래에 등록합니다. 나머지 runtime provider(예: 데이터베이스 클라이언트 자체)는 팩토리에 하드코딩되지 않고 모두 이 options token으로부터 DI를 통해 파생됩니다.

이러한 "옵션 생산"과 "서비스 생산"의 분리는 Fluo의 핵심적인 설계 특징입니다. 정규화된 옵션을 실제 프로바이더로 등록함으로써, 모듈의 구성을 관찰 가능하고 주입 가능하게 만듭니다. 애플리케이션의 다른 서비스가 데이터베이스 타임아웃 값을 알아야 한다면, 단순히 `PRISMA_NORMALIZED_OPTIONS` 토큰을 주입받기만 하면 됩니다. 이는 여러 계층의 생성자를 통해 수동으로 옵션 객체를 전달하려는 방식보다 훨씬 견고합니다. 또한 테스트에서 정교한 구성 오버라이딩을 가능하게 하는데, 모듈의 팩토리 로직을 다시 실행할 필요 없이 `PRISMA_NORMALIZED_OPTIONS` 프로바이더 전체를 교체할 수 있기 때문입니다.

정규화 단계는 중요한 검증 경계 역할도 수행합니다. `path:packages/prisma/src/module.ts:27-38`의 `normalizePrismaModuleOptions()`는 단순히 기본값을 채우는 것에 그치지 않고, 제공된 URL이 유효한지, 필수 구성 필드들이 존재하는지 확인합니다. 이러한 체크를 동적 모듈 라이프사이클의 가장 초기 단계에서 수행함으로써, Fluo는 잘못된 구성이 런타임으로 유출되어 훨씬 모호하고 디버깅하기 어려운 실패를 일으키는 것을 방지합니다.

`RedisModule.forRoot()`는 약간 다른 변형을 보여 줍니다. `path:packages/redis/src/module.ts:31-83`은 raw Redis client, 고수준 `RedisService`, lifecycle service를 구성하는 provider 집합을 만듭니다. 그 다음 `path:packages/redis/src/module.ts:108-116`이 이 provider set을 global module export로 감쌉니다. 여기서도 module factory의 본질은 provider assembly와 metadata binding의 오케스트레이션 계층입니다. 라이프사이클 서비스를 사용하는 점이 특히 흥미로운데, 이는 애플리케이션 종료 시 Redis 클라이언트가 적절히 연결 해제되도록 보장하며, 이 모든 과정이 Fluo의 표준 라이프사이클 훅을 통해 관리됩니다. 이는 동적 모듈이 단지 "정적인" 객체를 등록하는 것이 아니라, 애플리케이션의 런타임 라이프사이클에 완전히 참여함을 보여줍니다.

`path:packages/redis/src/module.ts:45-60`을 보면 `RedisService`가 단순히 클라이언트를 래핑하는 것이 아님을 알 수 있습니다. 이는 클라이언트와 구성 모두에 의존하는 관리되는 엔티티입니다. 동적 모듈 내에 이를 등록함으로써, Fluo는 단일 애플리케이션 내에서 여러 Redis 인스턴스가 사용되더라도 `RedisModule`의 모든 인스턴스가 특정 구성에 올바르게 바인딩된 서비스를 생성하도록 보장합니다. 이러한 수준의 인스턴스 격리가 바로 프로그래밍 방식의 모듈 제조가 강력한 주된 이유입니다.

`QueueModule.forRoot()`는 더 노골적입니다. `path:packages/queue/src/module.ts:9-42`는 옵션을 정규화하고 별도의 헬퍼 함수에서 provider를 만듭니다. 그 뒤 `path:packages/queue/src/module.ts:69-77`은 `QueueLifecycleService`와 `QUEUE`를 export하는 module definition을 반환할 뿐입니다.

`path:packages/queue/src/module.ts:15-30`의 정규화 로직은 이름이 제공되지 않았을 때 고유한 연결 이름을 생성하는 과정을 명시적으로 처리합니다. 이는 동적 모듈이 어떻게 런타임 컨텍스트를 사용하여 의존성 그래프에 영향을 줄 수 있는지 보여주는 완벽한 사례입니다. 부트스트랩 시점에 안정적인 이름을 생성함으로써, `QueueModule`은 복잡한 멀티 큐 설정에서도 이름 충돌 없이 컨테이너에 프로바이더들이 올바르게 등록되도록 보장할 수 있습니다.

프로바이더 생성을 `createQueueProviders()` (`path:packages/queue/src/module.ts:32-42`)로 분리한 것은 이러한 접근 방식의 모듈러한 성격을 더욱 강조합니다. 모듈 팩토리 자체는 이러한 저수준 빌딩 블록들을 조합하는 고수준 오케스트레이터가 됩니다. 이는 코드 유지보수를 훨씬 쉽게 만듭니다. 큐 초기화 방식이 변경되더라도 프로바이더 팩토리만 업데이트하면 되고, 모듈 구조는 안정적으로 유지되기 때문입니다.

이러한 오케스트레이션은 조건부 프로바이더 등록도 가능하게 합니다. 예를 들어, 동적 모듈은 옵션의 `test: true` 플래그를 기반으로 실제 서비스 대신 모의(mock) 서비스를 등록하기로 결정할 수 있습니다. Fluo는 일반적으로 테스트에서의 명시적인 프로바이더 오버라이드를 선호하지만, 모듈 제조 단계에서 이러한 유연성을 갖는 것은 진정으로 적응력 있는 인프라 모듈을 구축하는 데 강력한 도구가 됩니다.

여기서 얻어야 할 설계 교훈은 간단합니다. dynamic module 자체가 복잡한 비즈니스 로직을 담아서는 안 됩니다. 복잡성이 있다면 대부분 **pure option normalization**과 **provider construction helper**로 내려가야 합니다. 실제 module factory 함수는 최종적인 "바인더(binder)" 역할만 수행하며 아주 작게 유지되어야 합니다.

이 분리는 여러 패키지에서 반복됩니다.
- `PrismaModule`은 `path:packages/prisma/src/module.ts:27-66`에 `normalizePrismaModuleOptions()`와 `createPrismaRuntimeProviders()`를 둡니다.
- `QueueModule`은 `path:packages/queue/src/module.ts:9-42`에 `normalizeQueueModuleOptions()`와 `createQueueProviders()`를 둡니다.
- `RedisModule`은 `path:packages/redis/src/module.ts:24-83`에 `createRedisProviders()`를 둡니다.

`forRoot(...)` helper가 읽기 어렵다면, 문제는 dynamic-module 개념 자체가 아니라 provider derivation과 option normalization이 충분히 분리되지 않았기 때문일 가능성이 높습니다. 이들을 분리함으로써 Fluo의 모듈 등록은 매우 투명해집니다. "이 모듈이 무엇을 등록하는가?"라는 질문에 답하려면 복잡한 로직을 추적하는 대신 provider factory만 읽으면 되기 때문입니다.

정적 모듈 헬퍼의 전형적인 실행 흐름은 다음과 같습니다.

1. 사용자 옵션을 **수신**합니다.
2. 옵션을 안정적인 내부 형태(예: 기본값 병합)로 **정규화**합니다.
3. 정규화된 옵션으로부터 provider 배열을 **파생**합니다.
4. 새로운 모듈 클래스를 **생성**합니다(필요시 서브클래싱).
5. `defineModule`을 사용하여 exports, imports, providers, global 메타데이터를 **바인딩**합니다.
6. 모듈 클래스를 **반환**합니다.

이 패턴은 모듈 등록 과정을 완전히 감사 가능하게 만듭니다. 여러 파일에 흩어진 수많은 데코레이터를 추적하는 대신, 단일 헬퍼 파일에서 전체 등록 표면적을 확인할 수 있습니다.

이 과정을 실제로 보려면 `ConfigModule.forRoot()`가 복잡한 환경 변수 파싱을 어떻게 처리하는지 살펴보십시오. 단순히 문자열을 전달하는 것이 아니라 타입 강제(coercion), 스키마 검증을 수행한 뒤 검증된 단일 `CONFIG_OBJECT`를 생성합니다. 동적 모듈은 이 객체를 프로바이더로 감쌉니다. 이 모든 과정이 제어된 팩토리 함수 내에서 일어나기 때문에, 전체 애플리케이션 컨테이너와 독립적으로 "모듈 생산" 로직을 단위 테스트할 수 있습니다. 이는 인프라 안정성 측면에서 큰 이점입니다.

이러한 "제조(manufacturing)" 방식의 또 다른 장점은 모듈 경계에서 엄격한 아키텍처 규칙을 강제할 수 있다는 점입니다. 예를 들어, 동적 모듈은 인스턴스화가 허용되기 전에 사용자 옵션이 글로벌 애플리케이션 정책과 충돌하지 않는지 확인할 수 있습니다. `path:packages/core/src/validation/options.ts:12-28`의 `validateModuleOptions()`는 종종 `forRoot` 헬퍼의 시작 부분에서 호출되어 빠른 실패(fail-fast) 동작을 보장합니다. 이는 에러를 "런타임 서비스 실패"에서 "부트스트랩 시점의 설정 에러"로 옮겨주어 디버깅을 훨씬 쉽게 만듭니다.

이러한 검증은 피어 의존성(peer dependencies)의 존재 여부를 확인하는 것으로 확장될 수 있습니다. AWS 서비스를 위한 동적 모듈은 프로바이더를 등록하기 전에 런타임에 `@aws-sdk/client-s3` 패키지가 사용 가능한지 확인할 수 있습니다. `path:packages/core/src/utils/peer-deps.ts:5-20`에서 Fluo는 특히 이 목적을 위한 유틸리티를 제공하여, 동적 모듈이 "필수 피어 의존성 누락: @aws-sdk/client-s3. S3Module을 사용하려면 설치하십시오."와 같은 유익한 에러 메시지를 제공할 수 있게 합니다.

또한 `defineModule`의 프로그래밍적 성격은 모듈 임포트의 동적인 구성을 가능하게 합니다. 모듈은 제공된 구성에 따라 서로 다른 서브 모듈 세트를 임포트하도록 선택할 수 있습니다. 예를 들어 `DatabaseModule`은 로컬 개발을 위해 `SqliteModule`을, 프로덕션을 위해 `PostgresModule`을 임포트할 수 있습니다. 이러한 결정은 부트스트랩 시점에 단 한 번 내려지며, 결과적으로 특정 환경에 최적화되고 안정적인 모듈 그래프를 생성합니다.

## 7.3 Async module helpers are factory providers with memoized option resolution
비동기 사례는 많은 프레임워크가 불투명해지는 지점입니다. 많은 경우 복잡한 상태 머신 뒤에 "어떻게"를 숨기곤 합니다. 하지만 Fluo는 여기서도 의외로 직접적입니다. async module helper도 여전히 module factory이며, 차이는 options provider 중 하나가 실행이 지연되고 결과가 메모이제이션(memoization)되는 **factory provider**라는 점뿐입니다.

공유 계약은 `path:packages/core/src/types.ts:29-37`의 `AsyncModuleOptions<T>`에서 옵니다. 필드는 의존성 해결을 위한 `inject?: Token[]`와 실제 구성 로직을 담은 `useFactory`뿐입니다.

`EmailModule.forRootAsync()`는 아주 읽기 좋은 예시입니다. `path:packages/email/src/module.ts:114-138`은 user factory를 로컬 변수에 저장하고, `cachedResult` promise를 만들고, 처음 한 번만 promise를 초기화하는 `memoizedFactory(...deps)`를 정의한 뒤, `EMAIL_OPTIONS`에 대한 singleton factory provider를 등록합니다.

이 memoization은 cosmetic이 아닙니다. 이것은 시스템의 정확성을 위한 핵심 기능입니다. 메모이제이션이 없다면 options token을 소비하는 downstream consumer마다 별도의 비동기 구성 로드(파일 읽기나 API 호출 등)가 중복해서 일어날 수 있습니다. memoization이 있으므로 resolution은 module instance당 정확히 한 번만 일어납니다.

`PrismaModule.forRootAsync()`도 `path:packages/prisma/src/module.ts:86-120`에서 볼 수 있듯이 정규화된 Prisma 옵션에 대해 정확히 같은 방식을 사용합니다. 비동기 해결을 단일 프로바이더로 중앙화함으로써, 시스템의 나머지 부분은 해당 옵션을 동기적으로 소비할 수 있게 됩니다.

여기서 미묘하지만 중요한 관찰이 나옵니다. async helper는 static helper와 본질적으로 다르지 않습니다. options provider가 `useValue` 대신 `useFactory` singleton이 된 것뿐입니다. 그 아래에 있는 다른 provider는 여전히 평범한 DI token을 동기적으로 봅니다.

알고리즘은 따라서 다음과 같습니다.

```text
forRootAsync(options):
  1. 메모이제이션을 위해 로컬 cachedResult promise를 캡처합니다.
  2. 사용자의 useFactory를 정확히 한 번만 호출하는 factory function을 정의합니다.
  3. 해당 팩토리와 주입된 의존성을 사용하여 singleton options provider를 등록합니다.
  4. 다른 모든 런타임 프로바이더가 해당 options token에 의존하도록 등록합니다.
  5. 제조된 모듈 타입을 반환합니다.
```

이 지점에서 장 제목의 두 번째 절반인 "factory providers"가 구체화됩니다. dynamic module은 단지 클래스를 만들어 내는 것만이 아닙니다. 런타임 configuration으로부터 provider graph를 만들어 내는 규율 있는 방식이기도 합니다. 비동기 구성을 하나의 토큰으로 중앙화함으로써, 여러 서비스가 동일한 원시 설정을 각자 파싱하려고 시도하는 "구성 팬아웃(configuration fan-out)" 현상을 방지할 수 있습니다.

`path:packages/email/src/module.ts:74-95`와 `path:packages/prisma/src/module.ts:40-66`를 비교해 보면 이 반복 패턴이 잘 보입니다. 프로바이더 하나가 정규화된 옵션을 실체화(materialize)하고, 다른 프로바이더들이 그 하나의 소스로부터 파생값과 서비스를 팬아웃합니다.

이 "팬아웃" 아키텍처는 깨끗한 의존성 그래프를 유지하는 핵심입니다. `EmailModule`의 모든 서비스가 원시 `AsyncEmailOptions`에 직접 의존하는 대신, 모두 안정적이고 이미 해결된 `EMAIL_CONFIG` 토큰에 의존합니다. 즉, 이메일 구성을 로드하는 방식(예: 정적 파일에서 AWS Secrets Manager 같은 비밀 관리자로 전환)을 변경하기로 결정했다면 `forRootAsync` 팩토리만 업데이트하면 됩니다. 메일러, 템플릿, 큐 핸들러 등 나머지 모듈 부분은 의존성(즉, `EMAIL_CONFIG` 토큰)이 안정적으로 유지되므로 변경할 필요가 없습니다.

이러한 구성들을 위한 토큰 선택도 중요합니다. `path:packages/email/src/tokens.ts:10-25`에서 볼 수 있듯이 일반적인 문자열 대신 서술적인 심볼이나 클래스를 사용하면 의존성 그래프에서의 의도치 않은 충돌을 방지할 수 있습니다. 이는 특히 여러 인스턴스가 공존할 수 있는 동적 모듈에서 중요한데, 각 동적 모듈의 고유한 클래스 생성자가 프로바이더들을 위한 "네임스페이스" 역할을 하기 때문입니다.

내부적으로 Fluo의 DI 컨테이너는 부트스트랩 단계에서 이러한 promise들의 "awaiting"을 투명하게 처리합니다. `path:packages/runtime/src/bootstrap.ts:400-425`가 Promise를 반환하는 팩토리 프로바이더를 만나면, 해당 promise가 해결될 때까지 기다린 후 의존하는 프로바이더들을 초기화합니다. 덕분에 `EmailService` 생성자가 호출될 시점에는 모든 의존성이 이미 실체화되어 준비되어 있습니다. 서비스 생성자 내부에서 `async/await`를 사용할 필요가 없으므로 핵심 비즈니스 로직을 깨끗하고 동기적인 상태로 유지할 수 있습니다.

이러한 동기화는 특정 순서로 발생합니다. 먼저 모든 모듈 임포트가 해결되고, 그 다음 해당 모듈 내의 모든 프로바이더의 의존성 순서가 분석됩니다. 순환 의존성이 감지되면(6장에서 논의한 것처럼) 시스템은 즉시 실패합니다. 그래프가 방향성 비순환 그래프(DAG)라면, 시스템은 "리프(leaf)"부터 "루트(root)" 방향으로 프로바이더를 초기화하여 모든 비동기 팩토리가 사용되기 전에 먼저 해결되도록 보장합니다.

또한 메모이제이션 패턴은 여러 모듈이 동일한 "설정 공유" 모듈을 임포트하는 복잡한 모듈 그래프에서도 고비용 비동기 로직이 단 한 번만 수행되도록 보장합니다. `cachedResult` promise는 동기화 지점 역할을 하여, 잠재적으로 혼란스러울 수 있는 일련의 비동기 호출을 구조화되고 결정론적인 초기화 시퀀스로 효과적으로 변환합니다. 이러한 수준의 결정론적 동작은 "시작 시점의 레이스 컨디션"이 용납되지 않는 미션 크리티컬한 프로덕션 환경에 Fluo가 적합한 이유입니다.

## 7.4 Global exports, named registrations, and alias-based public surfaces
Fluo의 dynamic module은 public API 디자인이 드러나는 주된 자리이기도 합니다. module helper가 어떤 provider를 internal 세부 사항으로 숨기고, 어떤 token을 지원되는 public surface로 노출할지 결정하기 때문입니다.

`RedisModule`은 강력한 사례 연구입니다. `path:packages/redis/src/module.ts:108-116`은 기본 등록을 global로 만들고 `REDIS_CLIENT`와 `RedisService` 토큰을 export합니다. 반면 `path:packages/redis/src/module.ts:160-170`의 `forRootNamed()` 헬퍼는 사용자가 제공한 `name`으로부터 파생된 특화된 토큰 헬퍼를 내보내는 비전역(non-global) 모듈을 생성합니다. 여기서 dynamic module은 단지 프로바이더를 만드는 것이 아니라, 안정적이고 주소 지정이 가능한(addressable) 공개 토큰 표면을 도려내고 있는 것입니다.

`SocketIoModule.forRoot()`도 유사한 패턴을 따릅니다. `path:packages/socket.io/src/module.ts:11-31`은 내부 옵션 토큰, lifecycle service, 원시 서버를 위한 팩토리 프로바이더를 정의합니다. 그 다음 **alias provider** (`useExisting`)를 사용하여 `SOCKETIO_ROOM_SERVICE` 토큰을 노출합니다. 마지막으로 `path:packages/socket.io/src/module.ts:54-61`이 내부 구현 세부 사항은 숨긴 채 public room-service와 raw-server 토큰만 export합니다.

`PassportModule.forRoot()`는 `path:packages/passport/src/module.ts:29-44`에서 strategy registry를 내부로 유지하고, `path:packages/passport/src/module.ts:75-85`에서는 `AuthGuard`만 내보냅니다. 무엇을 내보내지 *않을지* 결정하는 것은 무엇을 포함할지 결정하는 것만큼이나 중요합니다.

runtime은 이러한 경계(boundary)를 엄격히 강제합니다. `path:packages/runtime/src/module-graph.ts:333-358`의 `createExportedTokenSet()`은 로컬 프로바이더도 아니고 가져온 모듈의 re-export도 아닌 토큰 export를 거부합니다. 그리고 `path:packages/runtime/src/module-graph.ts:360-415`의 `validateCompiledModules()`는 검증된 이러한 export들을 소비 모듈의 접근 가능 토큰 집합(accessible-token set)에 합칩니다.

dynamic module이 `global: true`를 선언할 때, 그것은 어떤 마법의 전역 레지스트리를 호출하는 것이 아닙니다. 정적 `@Global()` 모듈과 같은 module-graph validation 흐름에 참여하는 것입니다. 차이는 metadata가 코드로 설정되었다는 점뿐입니다. 이러한 일관성 덕분에 `useExisting` 별칭을 사용하여 내부 객체에 안정적인 공개 이름을 부여하거나, 명명된 토큰 헬퍼(named token helper)를 사용하여 동일한 컨테이너 내에서 충돌 없이 여러 모듈 인스턴스(예: 두 개의 별도 데이터베이스 연결)가 공존하도록 할 수 있습니다.

여기서 유용한 설계 휴리스틱이 나옵니다.
- 소비자가 구성 형태(shape)에 직접 의존해서는 안 될 때는 원시 옵션 토큰을 **내부(internal)**로 유지하십시오.
- 대신 파사드(facade) 서비스나 안정적인 심볼릭 토큰을 **내보내기(export)** 하십시오.
- 서로 다른 두 공개 이름이 동일한 기저의 lifecycle 객체를 가리켜야 할 때는 `useExisting`을 **사용**하십시오.
- 여러 모듈 인스턴스가 충돌 없이 공존해야 할 때는 명명된 토큰 헬퍼를 **사용**하십시오.

이 마지막 항목이 바로 `RedisModule.forRootNamed()`가 중요한 이유입니다. 새로운 컨테이너 개념을 발명하지 않고도 단지 서로 다른 토큰을 파생시킴으로써 독립적으로 주소 지정이 가능한 여러 인스턴스를 만들 수 있음을 보여주기 때문입니다.

이 명명된 등록(named registration) 패턴은 프라이머리 및 세컨더리 데이터베이스, 또는 로컬 캐시와 글로벌 세션 저장소처럼 동일한 인프라의 여러 인스턴스와 통신해야 하는 복잡한 백엔드에서 필수적입니다. `path:packages/redis/src/tokens.ts:5-15`를 보면 Fluo가 단순한 문자열 연결이나 심볼 파생을 통해 어떻게 `REDIS_CLIENT_PRIMARY` 및 `REDIS_CLIENT_SECONDARY`와 같은 고유 토큰을 생성하는지 알 수 있습니다. 동적 모듈은 자신의 내부 서비스들을 이 고유한 이름들에 매핑합니다.

`useExisting` 별칭을 사용하면 모듈은 리소스에 대한 "기본" 이름을 제공하면서도 숙련된 사용자가 필요한 특정 인스턴스에 접근할 수 있도록 허용할 수 있습니다. 예를 들어 `SocketIoModule`은 메인 서버 인스턴스를 가리키는 일반적인 `SOCKET_SERVER` 토큰을 내보내면서도, 동시에 `SOCKET_SERVER_CHAT`을 구체적으로 주입받을 수 있게 할 수 있습니다. 이러한 "표준 이름(canonical names)" 위에 "인스턴스 이름(instance names)"을 레이어링하는 것은 성숙한 프레임워크 아키텍처의 특징입니다.

마지막으로 `ModuleGraph`에 의해 강제되는 가시성 규칙은 내부 구현 세부 사항이 실수로 유출되지 않도록 보장합니다. 프로바이더가 등록되었지만 내보내기(export)되지 않았다면, 해당 동적 모듈의 트리 외부에 있는 모듈이 이를 주입받는 것은 물리적으로 불가능합니다. 이러한 "기본적인 캡슐화"는 Fluo 애플리케이션이 수백 개의 모듈로 확장되어도 전역 의존성의 엉망진창인 상태가 되지 않도록 해줍니다. 오직 모듈 작성자가 명시적으로 의도한 것만 볼 수 있기 때문입니다.

## 7.5 A practical checklist for authoring Fluo dynamic modules
이제 내부 모델이 충분히 분명해졌으니, 이를 authoring checklist로 바꿔 볼 수 있습니다. 목표는 Nest 비슷한 API 모양을 표면적으로 흉내 내는 것이 아닙니다. Fluo의 explicit DI rule 아래에서도 투명하게 읽히는 모듈을 만드는 것입니다.

첫째, 그 모듈이 정말 dynamic해야 하는지부터 판단하십시오. 등록에 런타임 옵션도 없고 계산된 프로바이더 집합도 없다면, 평범한 `@Module(...)` 메타데이터가 더 단순할 수 있습니다. 동적 모듈은 코드가 메타데이터나 프로바이더를 실제로 계산해야 할 때만 사용하십시오. 정적 모듈은 분석과 린트(lint)가 더 쉽기 때문에, 유연성이 꼭 필요한 경우에만 동적 모듈을 사용해야 합니다.

둘째, 프로바이더 그래프를 만들기 전에 옵션을 정규화하십시오. `path:packages/prisma/src/module.ts:27-38`의 `normalizePrismaModuleOptions()`, `path:packages/queue/src/module.ts:9-25`의 `normalizeQueueModuleOptions()`, `path:packages/email/src/module.ts:48-72`의 `normalizeEmailModuleOptions()`가 모두 이 규칙을 보여 줍니다. 이 단계가 있어야 프로바이더 팩토리가 작게 유지되고 검증 로직이 중복되지 않습니다. 좋은 정규화 함수는 모든 기본값(defaults)을 처리해야 하며, 이를 통해 프로바이더 팩토리들이 "깨끗하고" 완전한 데이터로 작업하고 있다고 가정할 수 있게 해줍니다.

셋째, 구성을 하나의 options 토큰으로 중앙화하십시오. `EmailModule`과 `PrismaModule`은 모두 정규화된 옵션 프로바이더 하나를 만들고, 나머지 프로바이더를 전부 그 토큰에서 파생합니다. 이 덕분에 구성 팬아웃 로직이 여러 팩토리에 흩어지지 않습니다. 또한 모듈이 사용하고 있는 최종 구성을 로깅하거나 감사(audit)하는 것을 사소한 일로 만들어 줍니다.

넷째, 비동기 옵션 팩토리는 반드시 메모이제이션하십시오. 안전한 패턴은 `path:packages/email/src/module.ts:117-136`과 `path:packages/prisma/src/module.ts:97-114`에 있습니다. 메모이제이션이 없으면 비동기 `useFactory` 작업이 예기치 않게 반복될 수 있습니다. 이는 동일한 모듈 내에 해당 옵션 토큰에 의존하는 여러 프로바이더가 있을 때 특히 중요합니다.

다섯째, export와 global 가시성을 의식적으로 설계하십시오. `path:packages/runtime/src/module-graph.ts:333-415`의 런타임 검증은 내보낸 모든 토큰이 실제로 유효하고 가시적임을 강제한다는 점을 기억하십시오. 전역 모듈은 접근 범위를 넓히지만, 그래프 컴파일러를 우회하게 해 주지는 않습니다. 모듈의 서비스들이 시스템의 거의 모든 모듈에 의해 소비될 의도(`LoggerModule`이나 `ConfigModule` 등)인 경우에만 전역으로 표시하십시오.

여섯째, 작은 헬퍼 계층을 선호하십시오. 하나는 옵션을 정규화하고, 다른 하나는 프로바이더를 빌드하며, 아주 작은 `forRoot(...)` 또는 `forRootAsync(...)`가 새로운 모듈 타입에 메타데이터를 바인딩하도록 하십시오. 이 패턴이 저장소 전반에서 반복되는 이유는 확장성이 좋기 때문입니다. 이러한 함수들을 작게 유지함으로써 단위 테스트를 훨씬 쉽게 만들 수 있습니다. 정규화 로직을 프로바이더 생성 로직과 분리하여 테스트할 수 있고, 두 가지 모두를 모듈 메타데이터 바인딩과 분리하여 테스트할 수 있습니다.

마지막으로 동적 모듈도 나머지 DI 규칙과 완전히 연결되어 있다는 점을 잊지 마십시오. 그 모듈이 등록한 프로바이더는 여전히 컨테이너 정규화를 거칩니다. 스코프는 여전히 5장의 규칙을 따릅니다. 별칭(alias)은 여전히 6장의 순환/스코프 체크에 참여합니다. 그리고 내보내기(export)는 여전히 모듈 그래프 검증을 통과해야 합니다.

동적 모듈과 6장의 순환 의존성 처리 사이의 시너지는 특히 주목할 만합니다. 동적 모듈은 모든 구성에 대해 고유한 모듈 클래스를 생성하므로, 그래프에서 의도치 않은 순환으로 이어질 수 있는 단일 "전역" 식별자를 공유하지 않습니다. 각 `forRoot()` 호출은 그래프에 새로운 노드를 생성하여, 런타임이 진정한 논리적 순환을 감지하고 보고하는 것을 훨씬 쉽게 만들면서도 복잡한 재귀적 구성들이 안전하게 공존할 수 있게 해줍니다.

마찬가지로 5장의 스코프 규칙도 동적으로 등록된 프로바이더들에 똑같이 엄격하게 적용됩니다. 서비스가 `TRANSIENT`, `REQUEST`, `SINGLETON` 중 어느 것인지는 해당 메타데이터가 데코레이터에 의해 작성되었든 `defineModule()` 호출에 의해 작성되었든 상관없이 프로바이더 메타데이터에 의해 결정됩니다. "탄생 비화"와 관계없이 모든 프로바이더를 이처럼 통일되게 처리하는 것이 바로 Fluo 아키텍처의 무결성(integrity)을 부여하는 요소입니다.

동적 모듈이 11장의 요청 파이프라인(request pipeline)과 상호작용할 수 있다는 점도 주목할 만합니다. 미들웨어나 인터셉터를 동적으로 등록함으로써, 모듈은 자신의 구성에 따라 요청 처리 동작을 맞춤화할 수 있습니다. 예를 들어, `AuthModule`은 제공된 옵션에 따라 서로 다른 인증 전략(JWT, OAuth 등)과 그에 연결된 가드들을 동적으로 등록할 수 있습니다. 이는 프레임워크의 모든 계층에 걸친 동적 모듈의 깊은 통합을 보여줍니다.

또한 8장에서 다루는 모듈 그래프(ModuleGraph)의 인트로스펙션(introspection) 기능은 동적 모듈 구성을 시각화하고 디버깅할 수 있게 해줍니다. 어떤 프로바이더가 어떤 동적 모듈 인스턴스에 의해 등록되었는지 정확히 확인할 수 있어, 대규모 애플리케이션에서의 구성 문제를 훨씬 쉽게 추적할 수 있습니다. 이러한 수준의 관찰 가능성은 동적 모듈을 위한 Fluo의 "클래스 기반 식별성" 설계의 직접적인 결과입니다.

종합 체크리스트는 다음과 같습니다.

```text
정적 등록과 동적 등록 중 결정하기
옵션을 내부 형태로 정규화하기 (기본값 + 검증)
하나의 표준적인 옵션 토큰/프로바이더 생성하기
해당 토큰에서 런타임 프로바이더 파생하기
로컬 프로미스 캐시를 사용하여 비동기 옵션 팩토리 메모이제이션하기
defineModule() 또는 defineModuleMetadata()로 새로운 모듈 클래스에 메타데이터 바인딩하기
의도한 공개 파사드(facade) 토큰만 내보내기
애플리케이션 전체에서의 가시성이 진정으로 필요할 때만 global로 표시하기
내부 상세 토큰들이 export되지 않았는지 확인하기
컨테이너와 격리하여 모듈 생산 로직 테스트하기
부트스트랩 시점에 필수 피어 의존성 확인하기
```

테스트 지점을 설명하기 위해, 동적 모듈을 위한 견고한 테스트 스위트는 다음과 같은 모습일 수 있습니다.

```ts
// path:packages/prisma/src/module.test.ts
describe('PrismaModule', () => {
  it('should produce a module with normalized options', async () => {
    const module = PrismaModule.forRoot({ databaseUrl: 'sqlite://file.db' });
    const metadata = getModuleMetadata(module);

    const optionsProvider = metadata.providers.find(p => p.provide === PRISMA_NORMALIZED_OPTIONS);
    expect(optionsProvider.useValue.databaseUrl).toBe('sqlite://file.db');
    expect(optionsProvider.useValue.timeout).toBe(5000); // 기본값 확인
  });

  it('should handle async configuration with memoization', async () => {
    let callCount = 0;
    const module = PrismaModule.forRootAsync({
      useFactory: async () => {
        callCount++;
        return { databaseUrl: 'sqlite://file.db' };
      }
    });

    const metadata = getModuleMetadata(module);
    const factory = metadata.providers.find(p => p.provide === PRISMA_NORMALIZED_OPTIONS).useFactory;

    await Promise.all([factory(), factory()]);
    expect(callCount).toBe(1); // 메모이제이션 확인
  });
});
```

이러한 "메타 테스트(meta-testing)" 패턴—코드 생성 결과를 테스트하는 방식—은 Fluo에서 인프라를 검증하는 가장 높은 수준의 방법입니다. 이는 동적 모듈이 단지 "동작하는" 것을 넘어, 프레임워크의 구조적 계약(structural contracts)을 준수하고 있음을 보장합니다.

이것이 Fluo dynamic-module API의 실제 내부 그림입니다. 추가적인 컨테이너 서브시스템이 아닙니다. 모듈 메타데이터와 팩토리 프로바이더를 위한 규율 있는 코드 생성 패턴이며, 프레임워크의 다른 부분과 똑같은 명시적 토큰, 프로바이더, 모듈 그래프 메커니즘 위에 서 있습니다.

나아가, 이러한 테스트는 동일한 구성으로 여러 번 호출했을 때 생성된 모듈의 식별자가 최적화를 위해 안정적으로 유지되는지, 아니면 격리가 목표인 경우 고유하게 유지되는지를 확인해야 합니다. Fluo에서는 격리를 우선시하므로, 모든 `forRoot` 호출은 새롭고 고유한 클래스를 생성합니다. 이는 약간 다른 풀링 설정을 가진 여러 데이터베이스 연결을 관리할 때와 같이, 동일한 인프라 모듈의 서로 다른 인스턴스 간에 의도치 않은 상태 유출이 발생하는 것을 방지합니다.

테스트 계층은 또한 모든 필수 프로바이더가 올바르게 내보내졌는지 확인하기에 완벽한 기회를 제공합니다. 모듈 메타데이터의 `exports` 배열을 간단히 루프 돌며 확인하는 것만으로도, 구현 세부 사항이 외부로 유출되지 않았고 공개 API가 일관되게 유지되고 있음을 확신할 수 있습니다. 이러한 아키텍처 경계의 자동화된 강제는 대규모 Fluo 코드베이스가 수년간의 개발 과정에서도 유지보수 가능하게 유지될 수 있도록 돕습니다. 또한 `OnModuleInit` 또는 `OnModuleDestroy`를 구현하는 토큰에 대해 프로바이더를 검사하여 올바른 라이프사이클 훅이 등록되었는지도 확인할 수 있습니다.

기본적인 프로바이더 체크를 넘어, 정교한 동적 모듈은 `ModuleGraph`와의 통합을 스스로 검증할 수도 있습니다. 등록된 프로바이더의 의존성을 프로그래밍 방식으로 분석함으로써, 모든 필수 토큰이 런타임에 사용 가능할 것임을 보장할 수 있으며, 이는 본질적으로 런타임에 생성되는 구조체에 대해 "컴파일 타임" 수준의 안전성을 제공합니다. 이러한 동적 제조와 정적 그래프 분석 간의 시너지는 Fluo 아키텍처를 매우 견고하게 만듭니다.

마지막으로, 동적 모듈은 특화된 텔레메트리(telemetry) 프로바이더를 등록함으로써 관찰 가능성(observability) 측면에서도 핵심적인 역할을 할 수 있습니다. 이러한 프로바이더들은 고유한 모듈 이름이나 식별자를 사용하도록 구성될 수 있으며, 이를 통해 개별 모듈 인스턴스 수준에서 지표와 로그를 세밀하게 추적할 수 있습니다. 이는 복잡한 시스템의 어떤 구체적인 부분에서 문제가 발생하고 있는지 찾아내는 것을 훨씬 쉽게 만들어 주며, 프로덕션 장애의 평균 복구 시간(MTTR)을 단축시킵니다.

요약하자면, Fluo에서 동적 모듈을 작성한다는 것은 프레임워크의 핵심 프리미티브를 숨기려 하기보다 이를 포용하는 것을 의미합니다. 모듈을 일등 시민이자 제조된 결과물로 취급함으로써, 전통적인 데코레이터 기반 접근 방식으로는 불가능한 수준의 유연성과 투명성을 얻을 수 있습니다. 더 많은 규율이 필요하지만, 그 보상은 시스템이 복잡해짐에 따라 근본적으로 이해하고 테스트하고 유지보수하기 쉬워진다는 점입니다.

