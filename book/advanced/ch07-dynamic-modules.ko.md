<!-- packages: @fluojs/core, @fluojs/runtime, @fluojs/di, @fluojs/prisma, @fluojs/email, @fluojs/redis, @fluojs/config, @fluojs/queue, @fluojs/socket.io, @fluojs/passport -->
<!-- project-state: T15 Part 2 source-analysis enrichment for dynamic module authoring, async factories, and runtime composition -->

# Chapter 7. Dynamic Modules and Factory Providers

이 장은 Fluo의 동적 모듈이 별도의 특수 객체가 아니라, 코드가 만들어 내는 일반적인 모듈 타입이라는 사실을 설명합니다. Chapter 6이 순환 의존성과 DI 제약을 정리했다면, 이 장은 그 위에서 구성 가능한 모듈 등록과 팩토리 기반 프로바이더 설계로 넘어갑니다.

## Learning Objectives
- Fluo의 동적 모듈이 클래스 기반 메타데이터 조합으로 동작하는 이유를 이해합니다.
- `forRoot()`와 `forRootAsync()` 헬퍼가 옵션 정규화와 프로바이더 조립을 어떻게 수행하는지 분석합니다.
- 비동기 옵션 팩토리에서 메모이제이션이 필요한 이유를 설명합니다.
- 전역 export, named registration, alias provider가 공개 API 표면을 어떻게 형성하는지 살펴봅니다.
- 동적 모듈 작성 시 옵션 토큰, 공개 토큰, 내부 토큰을 어떻게 분리할지 정리합니다.
- Fluo 저장소의 실제 모듈 구현에서 재사용되는 authoring checklist를 적용합니다.

## Prerequisites
- Chapter 4부터 Chapter 6까지 완료.
- Fluo의 모듈 메타데이터와 DI 토큰 기본 구조 이해.
- 팩토리 프로바이더와 비동기 설정 패턴에 대한 기초 지식.

## 7.1 In Fluo, a dynamic module is just a module type produced by code
Fluo의 dynamic module 이야기는 의도적으로 담백합니다. `@fluojs/core` 안에 숨겨진 특별한 "dynamic module object" 프로토콜은 없습니다. 대신 dynamic module은 단지 코드로 메타데이터가 생성된 module class일 뿐입니다.

가장 직접적인 단서는 `path:packages/runtime/src/types.ts:18-31`과 `path:packages/runtime/src/bootstrap.ts:350-361`에 있습니다. `ModuleType`은 그저 constructable class type입니다. `defineModule()`은 그 타입에 module metadata를 기록하고 같은 class reference를 반환할 뿐입니다. 이것이 runtime primitive의 전부입니다.

런타임 쪽 계약은 모듈 타입과 메타데이터 payload를 분리해서 정의합니다. `defineModule()`은 그 둘을 연결하지만, 반환값은 여전히 입력받은 class reference입니다.

`path:packages/runtime/src/types.ts:18-31`
```typescript
/** Module class accepted by bootstrap and module-graph compilation helpers. */
export type ModuleType = Constructor & { definition?: ModuleDefinition };
/** Controller class discovered inside one compiled module definition. */
export type ControllerType = Constructor;

/** Programmatic module definition consumed by `defineModule()` and bootstrap. */
export interface ModuleDefinition {
  imports?: ModuleType[];
  providers?: Provider[];
  controllers?: ControllerType[];
  exports?: Token[];
  middleware?: MiddlewareLike[];
  global?: boolean;
}
```

`path:packages/runtime/src/bootstrap.ts:350-361`
```typescript
/**
 * Associates module metadata with a module type.
 *
 * @param moduleType Module class that should receive runtime module metadata.
 * @param definition Module definition contract (`imports`, `providers`, `controllers`, `exports`, etc.).
 * @returns The same `moduleType` reference for fluent helper composition.
 */
export function defineModule<T extends ModuleType>(moduleType: T, definition: ModuleDefinition): T {
  defineModuleMetadata(moduleType, definition);

  return moduleType;
}
```

첫 발췌는 모듈이 결국 constructor와 metadata record의 조합임을 보여 줍니다. 두 번째 발췌는 programmatic helper가 별도 dynamic object를 만들지 않고, metadata를 쓴 뒤 같은 class를 반환한다는 점을 고정합니다.

실제 metadata write는 `path:packages/core/src/metadata/module.ts:37-52`의 `defineModuleMetadata()`가 담당합니다. 이 함수는 기존 레코드를 무조건 통째로 교체하지 않고 partial field를 merge합니다. 바로 이 세부 구현 덕분에 programmatic helper composition이 가능합니다. 여러 헬퍼가 동일한 동적 모듈 인스턴스에 서로 다른 공급자(provider)를 기여할 수 있는 이유가 여기에 있습니다.

부분 merge 동작은 아래처럼 필드별로 기존 값을 보존합니다.

`path:packages/core/src/metadata/module.ts:37-52`
```typescript
/**
 * Defines module metadata while preserving previously written fields for partial decorator passes.
 *
 * @param target Module class receiving metadata.
 * @param metadata Partial or complete module metadata payload.
 */
export function defineModuleMetadata(target: Function, metadata: ModuleMetadata): void {
  moduleMetadataStore.update(target, (existing) => ({
    controllers: metadata.controllers ?? existing?.controllers,
    exports: metadata.exports ?? existing?.exports,
    global: metadata.global !== undefined ? metadata.global : existing?.global,
    imports: metadata.imports ?? existing?.imports,
    middleware: metadata.middleware ?? existing?.middleware,
    providers: metadata.providers ?? existing?.providers,
  }));
}
```

이 발췌가 보여 주는 핵심은 overwrite가 아니라 field-level composition입니다. 그래서 정적 decorator와 동적 helper가 같은 class metadata store를 공유해도 마지막 호출 하나가 모든 이전 정보를 지워 버리지 않습니다.

그래서 Fluo는 두 가지 authoring style을 동시에 지원할 수 있습니다.
- **정적 decorator 스타일**은 `path:packages/core/src/decorators.ts:13-34`의 `@Module(...)`과 `@Global()`을 사용하며, 이는 선언 시점에 메타데이터 세터를 호출하는 문법적 설탕(syntactic sugar)에 불과합니다.
- **programmatic 스타일**은 factory function 내에서 `defineModule(...)` 또는 심지어 `defineModuleMetadata(...)`를 직접 호출합니다.

런타임에서는 둘 다 같은 metadata store로 수렴합니다. 가장 작은 예시는 `ConfigReloadModule.forRoot()`입니다. `path:packages/config/src/reload-module.ts:127-149`는 `ConfigReloadModuleImpl` subclass를 만들고, `defineModuleMetadata(...)`로 module metadata를 기록한 뒤, 그 subclass를 반환합니다. 별도의 runtime wrapper object나 proxy는 생성되지 않습니다.

`ConfigReloadModule`은 subclass identity와 metadata binding이 한 함수 안에서 어떻게 만나는지 보여 주는 짧은 예입니다.

`path:packages/config/src/reload-module.ts:127-149`
```typescript
export class ConfigReloadModule {
  static forRoot(options?: ConfigLoadOptions): new () => ConfigReloadModule {
    const loadOptions = options ?? {};

    class ConfigReloadModuleImpl extends ConfigReloadModule {}

    defineModuleMetadata(ConfigReloadModuleImpl, {
      exports: [CONFIG_RELOADER],
      providers: [
        {
          provide: CONFIG_RELOAD_OPTIONS,
          useValue: loadOptions,
        },
        ConfigReloadManager,
        {
          provide: CONFIG_RELOADER,
          useExisting: ConfigReloadManager,
        },
      ],
    });

    return ConfigReloadModuleImpl;
  }
}
```

여기서 동적 결과물은 `ConfigReloadModuleImpl` class입니다. 옵션 값, manager, alias provider는 모두 그 class의 module metadata에 붙고, 반환된 class가 이후 module graph의 노드가 됩니다.

여기서 subclass를 사용하는 것은 type identity를 유지하기 위한 실용적인 기법입니다. 기본 모듈 클래스를 확장하면 동적 모듈은 정적 메서드나 속성을 상속받으면서도 자신만의 메타데이터를 가질 수 있습니다. 위 `ConfigReloadModuleImpl`처럼 factory 호출 안에서 새 constructor를 만들면, 두 동적 모듈이 같은 provider를 갖더라도 서로 다른 class constructor에서 생성된 별개의 entity로 취급됩니다.

이 사실이 곧 Fluo의 dynamic module 정신 모델입니다. dynamic module은 이차적인 escape hatch나 "레거시" 기능이 아닙니다. 선언 시점에 한 번 손으로 적는 대신, factory function이 만들어 내는 ordinary module type입니다. 따라서 dynamic module도 일반 모듈과 똑같이 module-graph compiler, visibility check, provider registration 로직을 모두 통과합니다.

이 설계의 핵심 동기는 **투명성(transparency)**입니다. "DynamicModule 객체"(배열을 포함하는 데이터 구조)를 사용하는 프레임워크에서는 정적 모듈 트리와 동적 등록 결과 사이에 단절이 생기기 쉽습니다. Fluo는 동적 모듈도 실제 class가 되게 하므로, reflection system과 개발자 도구가 애플리케이션의 모든 모듈을 같은 방식으로 다룰 수 있습니다. 런타임에는 차이가 없기 때문에 "이것이 실제 모듈인지 동적 모듈 기술자인지"를 따로 구분할 필요가 없습니다. `instanceof` 같은 표준 JavaScript class 기능도 그대로 남아 디버깅과 telemetry에 활용할 수 있습니다.

위 발췌들을 합치면 최소 패턴은 분명합니다. factory가 새 class를 만들고, 그 class에 `providers`와 `exports` metadata를 붙인 뒤, class 자체를 반환합니다. 데이터 객체가 아니라 class를 반환하므로, Fluo는 DI 컨테이너가 결과를 안정적인 식별자(stable identity)로 취급할 수 있게 합니다. 동일한 factory가 여러 번 호출되더라도 반환된 각 class는 고유한 metadata를 가진 독자적인 type이 됩니다. 이 구조 덕분에 단일 애플리케이션 안에서도 같은 모듈 로직의 독립 인스턴스를 여러 개 둘 수 있습니다.

이 메커니즘의 핵심은 metadata store가 class constructor를 key로 사용한다는 점에 있습니다. 함수 내부에서 선언된 각 `class RuntimeModule {}`은 메모리상 새로운 constructor function 객체를 만들고, 그 객체에 연결된 metadata는 다른 호출과 분리됩니다. 일반 객체 구성을 쓰는 방식은 종종 의도치 않은 singleton 상태나 별도의 context 객체를 필요로 합니다. Fluo에서는 class 자체가 context 역할을 합니다.

또한 `defineModuleMetadata()`가 partial field를 merge한다는 점은 동적 모듈을 "코드로 작성된 데코레이터"의 연속처럼 구성할 수 있음을 의미합니다. telemetry provider를 추가하는 helper, database 구성을 추가하는 helper, API controller를 추가하는 helper를 같은 동적 모듈 class에 순서대로 적용한 뒤 bootstrapper에 반환할 수 있습니다. 이런 조합형 programmatic 구성은 정적 decorator만으로 표현하기 어려운 등록 표면을 다룰 때 유용합니다.

다른 생태계에서 온 개발자가 특히 주의할 점은, 이런 class가 반드시 외부로 export되거나 전역 이름을 가질 필요는 없다는 사실입니다. 동적 모듈 class는 bootstrap 과정에서 만들어진 산물이며, 애플리케이션 컨테이너가 유지되는 동안 식별자로 쓰입니다. 타입 기반 의존성 해결의 장점을 유지하면서도 전역 namespace를 불필요하게 넓히지 않는 방식입니다.

## 7.2 Static forRoot helpers are factories for metadata plus providers

문법을 걷어 내고 보면 `forRoot(...)` helper는 보통 두 가지 일을 합니다. 옵션으로부터 안정적인 provider definition을 계산하고, 그 definition을 새로운 module type에 묶습니다.

`PrismaModule.forRoot()`는 아주 좋은 참고 구현입니다. `path:packages/prisma/src/module.ts:68-84`는 새로운 class를 만들고, `defineModule(...)`을 호출해 고정된 public provider set을 export하며, 정규화된 옵션 value provider를 `PRISMA_NORMALIZED_OPTIONS` 아래에 등록합니다. 나머지 runtime provider(예: 데이터베이스 클라이언트 자체)는 팩토리에 하드코딩되지 않고 모두 이 options token으로부터 DI를 통해 파생됩니다.

정적 helper의 핵심 형태는 `buildPrismaModule()`에서 바로 보입니다.

`path:packages/prisma/src/module.ts:68-84`
```typescript
function buildPrismaModule<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = InferPrismaTransactionClient<TClient>,
  TTransactionOptions = InferPrismaTransactionOptions<TClient>,
>(
  options: PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>,
): ModuleType {
  class PrismaRootModuleDefinition {}

  return defineModule(PrismaRootModuleDefinition, {
    exports: PRISMA_MODULE_EXPORTS,
    providers: createPrismaRuntimeProviders<TClient, TTransactionClient, TTransactionOptions>({
      provide: PRISMA_NORMALIZED_OPTIONS,
      useValue: normalizePrismaModuleOptions(options),
    }),
  });
}
```

이 코드는 `forRoot()`가 실질적으로 options provider를 먼저 만들고, 그 provider를 포함한 runtime provider 배열을 새 module class에 묶는 함수임을 보여 줍니다. public export 목록도 같은 자리에서 고정되므로, helper 호출 하나가 등록 표면 전체를 설명합니다.

이 "옵션 생산"과 "서비스 생산"의 분리는 Fluo의 중요한 설계 특징입니다. 정규화된 옵션을 실제 provider로 등록하면, 모듈 구성이 관찰 가능하고 주입 가능한 값이 됩니다. 애플리케이션의 다른 서비스가 데이터베이스 타임아웃 값을 알아야 한다면 `PRISMA_NORMALIZED_OPTIONS` token을 주입받으면 됩니다. 여러 계층의 생성자를 통해 옵션 객체를 수동으로 전달하는 방식보다 추적하기 쉽고, 테스트에서는 module factory를 다시 실행하지 않고 `PRISMA_NORMALIZED_OPTIONS` provider 전체를 교체할 수 있습니다.

정규화 단계는 중요한 안정화 경계이기도 합니다. `path:packages/prisma/src/module.ts:27-38`의 `normalizePrismaModuleOptions()`는 caller가 넘긴 client를 보존하면서 `strictTransactions` 기본값을 명시적인 내부 값으로 바꿉니다. 이런 기본값 고정이 동적 모듈 생명주기의 초기에 일어나면, 뒤의 provider factory들은 partial options 대신 완성된 내부 형태만 다루면 됩니다.

`RedisModule.forRoot()`는 약간 다른 변형을 보여 줍니다. `path:packages/redis/src/module.ts:31-83`은 raw Redis client, 고수준 `RedisService`, lifecycle service를 구성하는 provider 집합을 만듭니다. 그 다음 `path:packages/redis/src/module.ts:108-116`이 이 provider set을 global module export로 감쌉니다. 여기서도 module factory의 본질은 provider assembly와 metadata binding의 orchestration 계층입니다. lifecycle service를 함께 등록하기 때문에, 애플리케이션 종료 시 Redis client 연결 해제도 Fluo의 표준 lifecycle hook 안에서 처리됩니다. 즉 동적 모듈은 정적인 객체 등록에 그치지 않고 런타임 lifecycle에도 참여합니다.

Redis의 기본 등록은 provider factory와 global metadata binding을 분리합니다.

`path:packages/redis/src/module.ts:31-46`
```typescript
function createRedisProviders(options: RedisModuleOptions, name?: string): Provider[] {
  const clientToken = getRedisClientToken(name);

  if (clientToken === REDIS_CLIENT) {
    return [
      {
        scope: 'singleton',
        provide: REDIS_CLIENT,
        useFactory: () => new Redis({
          ...options,
          lazyConnect: true,
        }),
      },
      RedisService,
      RedisLifecycleService,
    ];
  }
```

`path:packages/redis/src/module.ts:108-116`
```typescript
static forRoot(options: RedisModuleOptions): ModuleType {
  class RedisModuleDefinition {}

  return defineModule(RedisModuleDefinition, {
    global: true,
    exports: [REDIS_CLIENT, RedisService],
    providers: createRedisProviders(options),
  });
}
```

첫 발췌는 client, facade, lifecycle service가 같은 provider set으로 묶이는 지점을 보여 줍니다. 두 번째 발췌는 그 provider set이 global module metadata에 붙으면서 public token surface가 `REDIS_CLIENT`와 `RedisService`로 제한되는 과정을 보여 줍니다.

`path:packages/redis/src/module.ts:55-82`의 named branch를 보면 같은 provider factory가 이름이 붙은 client token, service token, lifecycle token을 함께 만들어 냅니다. 이를 동적 모듈 안에 등록하면, 단일 애플리케이션에서 여러 Redis instance가 쓰이더라도 `RedisModule`의 각 instance가 특정 token surface에 바인딩된 service를 만들 수 있습니다. 이 instance 격리가 programmatic module construction의 핵심 이점입니다.

`QueueModule.forRoot()`는 더 노골적입니다. `path:packages/queue/src/module.ts:9-42`는 옵션을 정규화하고 별도의 헬퍼 함수에서 provider를 만듭니다. 그 뒤 `path:packages/queue/src/module.ts:69-77`은 `QueueLifecycleService`와 `QUEUE`를 export하는 module definition을 반환할 뿐입니다.

Queue는 정규화, provider assembly, metadata binding이 가장 짧게 분리된 사례입니다.

`path:packages/queue/src/module.ts:27-42`
```typescript
function createQueueProviders(options: QueueModuleOptions = {}): Provider[] {
  return [
    {
      provide: QUEUE_OPTIONS,
      useValue: normalizeQueueModuleOptions(options),
    },
    QueueLifecycleService,
    {
      inject: [QueueLifecycleService],
      provide: QUEUE,
      useFactory: (service: unknown) => ({
        enqueue: (job: object) => (service as QueueLifecycleService).enqueue(job),
      }),
    },
  ];
}
```

`path:packages/queue/src/module.ts:69-77`
```typescript
static forRoot(options: QueueModuleOptions = {}): ModuleType {
  class QueueModuleDefinition {}

  return defineModule(QueueModuleDefinition, {
    exports: [QueueLifecycleService, QUEUE],
    global: true,
    providers: createQueueProviders(options),
  });
}
```

`QUEUE_OPTIONS`는 값 provider로 고정되고, `QUEUE`는 lifecycle service에서 파생되는 factory provider가 됩니다. `forRoot()`는 이 결과를 그대로 module metadata에 붙이는 얇은 바인더입니다.

`path:packages/queue/src/module.ts:9-25`의 정규화 로직은 attempts, concurrency, dead-letter 보존 개수, rate limiter 기본값을 내부 형태로 맞춥니다. 동적 모듈이 caller options를 그대로 흘려보내지 않고, bootstrap 전에 provider들이 읽을 안정적인 설정 객체로 바꾸는 사례입니다.

provider 생성을 `createQueueProviders()` (`path:packages/queue/src/module.ts:32-42`)로 분리한 것은 이 접근의 모듈성을 잘 보여 줍니다. module factory 자체는 저수준 building block을 조합하는 얇은 orchestration 계층이 됩니다. queue 초기화 방식이 바뀌어도 provider factory를 조정하면 되고, module metadata binding 구조는 안정적으로 유지됩니다.

이 orchestration은 조건부 provider 등록도 가능하게 합니다. 예를 들어 동적 모듈은 옵션의 `test: true` 플래그를 보고 실제 service 대신 mock service를 등록할 수 있습니다. Fluo는 일반적으로 테스트에서 명시적인 provider override를 선호하지만, module construction 단계에서 이런 유연성을 갖는 것은 인프라 모듈을 환경별로 조정할 때 유용합니다.

여기서 얻어야 할 설계 교훈은 간단합니다. dynamic module 자체가 복잡한 비즈니스 로직을 담아서는 안 됩니다. 복잡성이 있다면 대부분 **pure option normalization**과 **provider construction helper**로 내려가야 합니다. 실제 module factory 함수는 최종적인 "바인더(binder)" 역할만 수행하며 아주 작게 유지되어야 합니다.

이 분리는 여러 패키지에서 반복됩니다.
- `PrismaModule`은 `path:packages/prisma/src/module.ts:27-66`에 `normalizePrismaModuleOptions()`와 `createPrismaRuntimeProviders()`를 둡니다.
- `QueueModule`은 `path:packages/queue/src/module.ts:9-42`에 `normalizeQueueModuleOptions()`와 `createQueueProviders()`를 둡니다.
- `RedisModule`은 `path:packages/redis/src/module.ts:24-83`에 `createRedisProviders()`를 둡니다.

`forRoot(...)` helper가 읽기 어렵다면, 문제는 dynamic-module 개념 자체가 아니라 provider derivation과 option normalization이 충분히 분리되지 않았기 때문일 가능성이 높습니다. 이들을 분리하면 Fluo의 module registration이 투명해집니다. "이 모듈이 무엇을 등록하는가?"라는 질문에 답할 때 복잡한 분기 전체를 추적하기보다 provider factory를 중심으로 읽을 수 있기 때문입니다.

정적 모듈 헬퍼의 전형적인 실행 흐름은 다음과 같습니다.

1. 사용자 옵션을 **수신**합니다.
2. 옵션을 안정적인 내부 형태(예: 기본값 병합)로 **정규화**합니다.
3. 정규화된 옵션으로부터 provider 배열을 **파생**합니다.
4. 새로운 모듈 클래스를 **생성**합니다(필요시 서브클래싱).
5. `defineModule`을 사용하여 exports, imports, providers, global 메타데이터를 **바인딩**합니다.
6. 모듈 클래스를 **반환**합니다.

이 패턴은 module registration 과정을 감사 가능하게 만듭니다. 여러 파일에 흩어진 decorator를 추적하는 대신, 단일 helper 파일에서 전체 registration surface를 확인할 수 있습니다.

이 과정을 실제로 보려면 `ConfigModule.forRoot()`가 구성 로딩 결과를 `ConfigService` provider로 감싸는 방식을 보면 됩니다. 동적 모듈은 환경 파일, 기본값, 검증 함수를 직접 전역 상태로 흘리지 않고, 제어된 factory function 안에서 service provider로 묶습니다.

`path:packages/config/src/module.ts:30-45`
```typescript
static forRoot(options?: ConfigModuleOptions): new () => ConfigModule {
  class ConfigModuleImpl extends ConfigModule {}

  defineModuleMetadata(ConfigModuleImpl, {
    global: options?.isGlobal ?? true,
    exports: [ConfigService],
    providers: [
      {
        provide: ConfigService,
        useFactory: () => new ConfigService(loadConfig(options ?? {})),
      },
    ],
  });

  return ConfigModuleImpl;
}
```

이 발췌도 같은 흐름입니다. 새 module class를 만들고, public export는 `ConfigService`로 좁히며, 실제 로딩은 factory provider 내부로 넣습니다. 그래서 전체 애플리케이션 컨테이너와 분리해 module production 로직을 테스트할 수 있습니다.

이 "제조(manufacturing)" 방식의 또 다른 장점은 module boundary에서 아키텍처 규칙을 강제할 수 있다는 점입니다. 예를 들어 동적 모듈은 instance 생성이 허용되기 전에 사용자 옵션이 전역 애플리케이션 정책과 충돌하지 않는지 확인할 수 있습니다. 이런 검사를 `forRoot` helper의 시작 부분에 두면, 에러를 "런타임 서비스 실패"가 아니라 "부트스트랩 시점의 설정 에러"로 옮길 수 있습니다.

이 검증은 peer dependencies 존재 여부 확인으로 확장될 수 있습니다. AWS 서비스를 위한 동적 모듈은 provider를 등록하기 전에 런타임에 `@aws-sdk/client-s3` 패키지가 사용 가능한지 확인할 수 있습니다. 핵심은 이런 검사를 provider 해석 도중 흩뿌리지 않고 module factory boundary에 모아, 실패 위치를 구성 단계로 앞당기는 것입니다.

또한 `defineModule`의 programmatic 성격은 module import 구성도 동적으로 만들 수 있습니다. 모듈은 제공된 구성에 따라 서로 다른 submodule 집합을 import하도록 선택할 수 있습니다. 예를 들어 `DatabaseModule`은 로컬 개발에서는 `SqliteModule`을, 프로덕션에서는 `PostgresModule`을 import할 수 있습니다. 이 결정은 bootstrap 시점에 한 번 내려지고, 이후에는 안정적인 module graph로 고정됩니다.

## 7.3 Async module helpers are factory providers with memoized option resolution
비동기 사례는 많은 프레임워크가 불투명해지는 지점입니다. 많은 경우 복잡한 상태 머신 뒤에 "어떻게"를 숨기곤 합니다. 하지만 Fluo는 여기서도 의외로 직접적입니다. async module helper도 여전히 module factory이며, 차이는 options provider 중 하나가 실행이 지연되고 결과가 메모이제이션(memoization)되는 **factory provider**라는 점뿐입니다.

공유 계약은 `path:packages/core/src/types.ts:29-37`의 `AsyncModuleOptions<T>`에서 옵니다. 필드는 의존성 해결을 위한 `inject?: Token[]`와 실제 구성 로직을 담은 `useFactory`뿐입니다.

`EmailModule.forRootAsync()`는 아주 읽기 좋은 예시입니다. `path:packages/email/src/module.ts:114-138`은 user factory를 로컬 변수에 저장하고, `cachedResult` promise를 만들고, 처음 한 번만 promise를 초기화하는 `memoizedFactory(...deps)`를 정의한 뒤, `EMAIL_OPTIONS`에 대한 singleton factory provider를 등록합니다.

비동기 helper의 차이는 options provider가 `useValue`가 아니라 singleton `useFactory`라는 점에 모입니다.

`path:packages/email/src/module.ts:114-138`
```typescript
function buildEmailModuleAsync(options: AsyncModuleOptions<EmailModuleOptions>): ModuleType {
  class EmailAsyncModuleDefinition {}

  const factory = options.useFactory as (...args: unknown[]) => MaybePromise<EmailModuleOptions>;
  let cachedResult: Promise<NormalizedEmailModuleOptions> | undefined;

  const memoizedFactory = (...deps: unknown[]): Promise<NormalizedEmailModuleOptions> => {
    if (!cachedResult) {
      cachedResult = Promise.resolve(factory(...deps)).then((resolved) => normalizeEmailModuleOptions(resolved));
    }

    return cachedResult;
  };

  return defineModule(EmailAsyncModuleDefinition, {
    exports: [EmailService, EmailChannel, EMAIL, EMAIL_CHANNEL],
    global: true,
    providers: createEmailRuntimeProviders({
      inject: options.inject,
      provide: EMAIL_OPTIONS,
      scope: 'singleton',
      useFactory: (...deps: unknown[]) => memoizedFactory(...deps),
    }),
  });
}
```

`cachedResult`는 module factory 호출 안의 지역 상태입니다. 그래서 같은 module instance 안에서는 options resolution이 공유되지만, 다른 `forRootAsync()` 호출이 만든 class와는 캐시가 섞이지 않습니다.

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

이 반복 패턴은 위의 Prisma와 Email 발췌가 대표합니다. `path:packages/email/src/module.ts:74-95`와 `path:packages/prisma/src/module.ts:40-66`은 같은 구조를 공유하므로, 여기서는 두 파일을 모두 풀어 붙이지 않고 citation으로 남깁니다. 중요한 공통점은 하나의 options token을 기준으로 public facade provider가 파생된다는 점입니다.

이 "팬아웃" 아키텍처는 의존성 그래프를 깨끗하게 유지하는 핵심입니다. `EmailModule`의 provider들은 원시 `AsyncEmailOptions`에 직접 의존하는 대신, 안정적이고 이미 해결된 `EMAIL_OPTIONS` token을 기준으로 파생됩니다. 이메일 구성을 로드하는 방식이 정적 파일에서 AWS Secrets Manager 같은 비밀 관리자로 바뀌더라도 `forRootAsync` factory만 조정하면 됩니다. mailer, template, queue handler 같은 나머지 provider는 안정적인 `EMAIL_OPTIONS` token을 계속 바라봅니다.

이러한 구성들을 위한 토큰 선택도 중요합니다. `path:packages/email/src/tokens.ts:6-11`에서 볼 수 있듯이 일반적인 문자열 대신 서술적인 심볼이나 클래스를 사용하면 의존성 그래프에서의 의도치 않은 충돌을 방지할 수 있습니다. 이는 특히 여러 인스턴스가 공존할 수 있는 동적 모듈에서 중요한데, 각 동적 모듈의 고유한 클래스 생성자가 프로바이더들을 위한 "네임스페이스" 역할을 하기 때문입니다.

내부적으로 Fluo의 DI 컨테이너는 factory provider가 반환한 promise를 resolution promise로 보관하고, 그 token을 소비하는 provider가 같은 promise를 기다리게 합니다. `path:packages/di/src/container.ts:796-812`의 factory branch는 의존성을 먼저 해결한 뒤 `useFactory(...deps)` 결과를 반환합니다. 따라서 `EmailService` 생성자가 호출될 시점에는 필요한 의존성이 이미 실체화되어 있습니다. service constructor 안에 `async/await`를 끌어들이지 않아도 되는 구조입니다.

이 동기화는 정해진 순서로 진행됩니다. 먼저 모든 module import가 해결되고, 그 다음 해당 module 안의 provider 의존성 순서가 분석됩니다. 순환 의존성이 감지되면(6장에서 논의한 것처럼) 시스템은 즉시 실패합니다. 그래프가 방향성 비순환 그래프(DAG)라면, runtime은 "리프(leaf)"부터 "루트(root)" 방향으로 provider를 초기화해 비동기 factory가 사용되기 전에 해결되도록 합니다.

또한 memoization pattern은 여러 module이 동일한 "설정 공유" module을 import하는 복잡한 graph에서도 비용 큰 비동기 로직이 한 번만 수행되도록 합니다. `cachedResult` promise는 동기화 지점 역할을 하며, 여러 비동기 호출을 하나의 결정론적 초기화 sequence로 모읍니다. 시작 시점의 race condition을 피해야 하는 운영 환경에서 중요한 성질입니다.

## 7.4 Global exports, named registrations, and alias-based public surfaces
Fluo의 dynamic module은 public API 디자인이 드러나는 주된 자리이기도 합니다. module helper가 어떤 provider를 internal 세부 사항으로 숨기고, 어떤 token을 지원되는 public surface로 노출할지 결정하기 때문입니다.

`RedisModule`은 좋은 사례 연구입니다. `path:packages/redis/src/module.ts:108-116`은 기본 등록을 global로 만들고 `REDIS_CLIENT`와 `RedisService` token을 export합니다. 반면 `path:packages/redis/src/module.ts:160-170`의 `forRootNamed()` helper는 사용자가 제공한 `name`에서 파생된 특화 token helper를 내보내는 non-global module을 만듭니다. 여기서 dynamic module은 provider를 만드는 데 그치지 않고, 안정적이고 주소 지정 가능한(addressable) public token surface를 설계합니다.

명명된 Redis 등록은 같은 provider factory를 쓰되, export token을 호출 인자에서 파생합니다.

`path:packages/redis/src/module.ts:160-170`
```typescript
static forRootNamed(name: string, options: RedisModuleOptions): ModuleType {
  const clientToken = getRedisClientToken(name);
  const serviceToken = getRedisServiceToken(name);
  class NamedRedisModuleDefinition {}

  return defineModule(NamedRedisModuleDefinition, {
    global: true,
    exports: [clientToken, serviceToken],
    providers: createRedisProviders(options, name),
  });
}
```

이 발췌는 dynamic module이 단순히 provider를 계산하는 데서 끝나지 않는다는 점을 보여 줍니다. 호출자가 넘긴 `name`이 raw client token과 facade service token을 바꾸고, 그 둘만 export 표면에 올라갑니다.

`SocketIoModule.forRoot()`도 유사한 패턴을 따릅니다. `path:packages/socket.io/src/module.ts:11-31`은 내부 옵션 토큰, lifecycle service, 원시 서버를 위한 팩토리 프로바이더를 정의합니다. 그 다음 **alias provider** (`useExisting`)를 사용하여 `SOCKETIO_ROOM_SERVICE` 토큰을 노출합니다. 마지막으로 `path:packages/socket.io/src/module.ts:54-61`이 내부 구현 세부 사항은 숨긴 채 public room-service와 raw-server 토큰만 export합니다.

Socket.IO 사례는 내부 lifecycle service를 public room-service token으로 노출할 때 `useExisting`을 씁니다.

`path:packages/socket.io/src/module.ts:11-31`
```typescript
function createSocketIoProviderSet(options: SocketIoModuleOptions = {}) {
  return [
    {
      provide: SOCKETIO_OPTIONS_INTERNAL,
      useValue: options,
    },
    {
      provide: SocketIoLifecycleService,
      useClass: SocketIoLifecycleService,
    },
    {
      provide: SOCKETIO_SERVER,
      useFactory: (service: unknown) => (service as SocketIoLifecycleService).getServer(),
      inject: [SocketIoLifecycleService],
    },
    {
      provide: SOCKETIO_ROOM_SERVICE,
      useExisting: SocketIoLifecycleService,
    },
  ];
}
```

`SOCKETIO_OPTIONS_INTERNAL`은 export되지 않는 내부 설정 토큰입니다. 반면 `SOCKETIO_ROOM_SERVICE`는 같은 lifecycle service 인스턴스를 public 이름으로 다시 가리키는 alias라서, 구현 객체를 하나 더 만들지 않고도 공개 API 이름을 분리합니다.

`PassportModule.forRoot()`는 `path:packages/passport/src/module.ts:29-44`에서 strategy registry를 내부로 유지하고, `path:packages/passport/src/module.ts:75-85`에서는 `AuthGuard`만 내보냅니다. 무엇을 내보내지 *않을지* 결정하는 것은 무엇을 포함할지 결정하는 것만큼이나 중요합니다.

Passport는 내부 토큰을 provider로 등록하되 export 목록에서는 제외하는 반대쪽 사례입니다.

`path:packages/passport/src/module.ts:29-44`
```typescript
function createPassportModuleProviders(
  options: PassportModuleOptions = {},
  strategies: AuthStrategyRegistration[] = [],
): Provider[] {
  return [
    {
      provide: PASSPORT_OPTIONS,
      useValue: { ...options },
    },
    {
      provide: AUTH_STRATEGY_REGISTRY,
      useValue: createStrategyRegistry(strategies),
    },
    AuthGuard,
  ];
}
```

`path:packages/passport/src/module.ts:75-85`
```typescript
static forRoot(
  options: PassportModuleOptions = {},
  strategies: AuthStrategyRegistration[] = [],
): PassportModuleType {
  class PassportRootModule extends PassportModule {}

  return defineModule(PassportRootModule, {
    exports: [AuthGuard],
    providers: createPassportModuleProviders(options, strategies),
  });
}
```

`PASSPORT_OPTIONS`와 `AUTH_STRATEGY_REGISTRY`는 module 내부에서 guard를 구성하기 위한 token입니다. export 목록에는 `AuthGuard`만 남기므로, 소비 모듈은 전략 registry 구현 세부 사항에 의존하지 않습니다.

runtime은 이러한 경계(boundary)를 엄격히 강제합니다. `path:packages/runtime/src/module-graph.ts:333-358`의 `createExportedTokenSet()`은 로컬 프로바이더도 아니고 가져온 모듈의 re-export도 아닌 토큰 export를 거부합니다. 그리고 `path:packages/runtime/src/module-graph.ts:360-415`의 `validateCompiledModules()`는 검증된 이러한 export들을 소비 모듈의 접근 가능 토큰 집합(accessible-token set)에 합칩니다.

export 검증은 module helper가 선언한 public surface를 runtime에서 다시 확인합니다.

`path:packages/runtime/src/module-graph.ts:333-358`
```typescript
function createExportedTokenSet(
  compiledModule: CompiledModule,
  importedExportedTokens: Set<Token>,
): Set<Token> {
  const exportedTokens = new Set<Token>();

  for (const token of compiledModule.definition.exports ?? []) {
    if (!compiledModule.providerTokens.has(token) && !importedExportedTokens.has(token)) {
      throw new ModuleVisibilityError(
        `Module ${compiledModule.type.name} cannot export token ${String(
          token,
        )} because it is neither local nor re-exported from an imported module.`,
        {
          module: compiledModule.type.name,
          token,
          phase: 'export validation',
          hint: `Either add a provider for ${String(token)} to ${compiledModule.type.name}'s providers array, or import a module that exports ${String(token)} so it can be re-exported.`,
        },
      );
    }

    exportedTokens.add(token);
  }

  return exportedTokens;
}
```

따라서 dynamic module의 `exports` 배열은 선언만으로 끝나지 않습니다. 그래프 컴파일 중 로컬 provider나 imported export와 맞지 않으면 즉시 실패하므로, 위 Redis, Socket.IO, Passport helper의 export 설계가 실제 visibility rule에 묶입니다.

dynamic module이 `global: true`를 선언할 때, 그것은 어떤 마법의 전역 레지스트리를 호출하는 것이 아닙니다. 정적 `@Global()` 모듈과 같은 module-graph validation 흐름에 참여하는 것입니다. 차이는 metadata가 코드로 설정되었다는 점뿐입니다. 이러한 일관성 덕분에 `useExisting` 별칭을 사용하여 내부 객체에 안정적인 공개 이름을 부여하거나, 명명된 토큰 헬퍼(named token helper)를 사용하여 동일한 컨테이너 내에서 충돌 없이 여러 모듈 인스턴스(예: 두 개의 별도 데이터베이스 연결)가 공존하도록 할 수 있습니다.

여기서 유용한 설계 휴리스틱이 나옵니다.
- 소비자가 구성 형태(shape)에 직접 의존해서는 안 될 때는 원시 옵션 토큰을 **내부(internal)**로 유지하십시오.
- 대신 파사드(facade) 서비스나 안정적인 심볼릭 토큰을 **내보내기(export)** 하십시오.
- 서로 다른 두 공개 이름이 동일한 기저의 lifecycle 객체를 가리켜야 할 때는 `useExisting`을 **사용**하십시오.
- 여러 모듈 인스턴스가 충돌 없이 공존해야 할 때는 명명된 토큰 헬퍼를 **사용**하십시오.

이 마지막 항목이 바로 `RedisModule.forRootNamed()`가 중요한 이유입니다. 새로운 컨테이너 개념을 발명하지 않고도 단지 서로 다른 토큰을 파생시킴으로써 독립적으로 주소 지정이 가능한 여러 인스턴스를 만들 수 있음을 보여주기 때문입니다.

이 named registration pattern은 primary/secondary database나 local cache/global session store처럼 동일 인프라의 여러 instance와 통신해야 하는 backend에서 중요합니다. `path:packages/redis/src/tokens.ts:5-15`를 보면 Fluo가 문자열 연결이나 symbol 파생을 통해 `REDIS_CLIENT_PRIMARY`, `REDIS_CLIENT_SECONDARY` 같은 고유 token을 만드는 방식을 볼 수 있습니다. 동적 모듈은 자신의 내부 service를 이 고유 이름에 매핑합니다.

`useExisting` alias를 사용하면 module은 resource에 대한 "기본" 이름을 제공하면서도 필요한 특정 instance에 접근할 수 있는 경로를 남길 수 있습니다. 예를 들어 `SocketIoModule`은 main server instance를 가리키는 일반적인 `SOCKET_SERVER` token을 내보내면서, 동시에 `SOCKET_SERVER_CHAT`을 구체적으로 주입받게 할 수 있습니다. "표준 이름(canonical names)" 위에 "인스턴스 이름(instance names)"을 layer하는 방식입니다.

마지막으로 `ModuleGraph`가 강제하는 visibility rule은 내부 구현 세부 사항이 실수로 유출되지 않게 합니다. provider가 등록되었지만 export되지 않았다면, 해당 동적 모듈 트리 밖의 module은 이를 주입받을 수 없습니다. 이 기본 캡슐화 덕분에 Fluo 애플리케이션이 많은 module로 커져도 전역 의존성이 무질서하게 퍼지는 것을 막을 수 있습니다. module author가 명시적으로 공개한 token만 보이기 때문입니다.

## 7.5 A practical checklist for authoring Fluo dynamic modules
이제 내부 모델이 충분히 분명해졌으니, 이를 authoring checklist로 바꿔 볼 수 있습니다. 목표는 Nest 비슷한 API 모양을 표면적으로 흉내 내는 것이 아닙니다. Fluo의 explicit DI rule 아래에서도 투명하게 읽히는 모듈을 만드는 것입니다.

첫째, 그 모듈이 정말 dynamic해야 하는지부터 판단하십시오. 등록에 런타임 옵션도 없고 계산된 provider 집합도 없다면, 평범한 `@Module(...)` metadata가 더 단순할 수 있습니다. 동적 모듈은 코드가 metadata나 provider를 실제로 계산해야 할 때 사용하십시오. 정적 모듈은 분석과 lint가 더 쉽기 때문에, 유연성이 필요한 지점에만 동적 모듈을 두는 편이 좋습니다.

둘째, provider graph를 만들기 전에 옵션을 정규화하십시오. `path:packages/prisma/src/module.ts:27-38`의 `normalizePrismaModuleOptions()`, `path:packages/queue/src/module.ts:9-25`의 `normalizeQueueModuleOptions()`, `path:packages/email/src/module.ts:48-72`의 `normalizeEmailModuleOptions()`가 모두 이 규칙을 보여 줍니다. 이 단계가 있어야 provider factory가 작게 유지되고 검증 로직이 중복되지 않습니다. 정규화 함수는 기본값(defaults)을 처리하고, provider factory가 완전한 내부 형태만 다룬다고 가정할 수 있게 해야 합니다.

이 항목은 package inventory 성격이 강하므로 세 파일을 모두 코드로 펼치지 않습니다. 앞의 Prisma와 Queue 발췌가 정규화된 값 provider 패턴을 대표하고, Email은 비동기 options provider 발췌에서 같은 `normalizeEmailModuleOptions()` 진입점을 보여 주었습니다.

셋째, 구성을 하나의 options token으로 중앙화하십시오. `EmailModule`과 `PrismaModule`은 모두 정규화된 options provider 하나를 만들고, 나머지 provider를 그 token에서 파생합니다. 이 덕분에 configuration fan-out logic이 여러 factory에 흩어지지 않습니다. 최종 구성을 로깅하거나 감사(audit)할 때도 기준점이 분명해집니다.

넷째, 비동기 옵션 팩토리는 반드시 메모이제이션하십시오. 안전한 패턴은 `path:packages/email/src/module.ts:117-136`과 `path:packages/prisma/src/module.ts:97-114`에 있습니다. 메모이제이션이 없으면 비동기 `useFactory` 작업이 예기치 않게 반복될 수 있습니다. 이는 동일한 모듈 내에 해당 옵션 토큰에 의존하는 여러 프로바이더가 있을 때 특히 중요합니다.

이 규칙은 위 Email async 발췌가 대표합니다. Prisma의 `path:packages/prisma/src/module.ts:97-114`도 같은 `cachedResult` promise와 singleton `useFactory` 구조를 쓰므로, 중복 코드 대신 citation으로 보강합니다.

다섯째, export와 global 가시성을 의식적으로 설계하십시오. `path:packages/runtime/src/module-graph.ts:333-415`의 런타임 검증은 내보낸 모든 토큰이 실제로 유효하고 가시적임을 강제한다는 점을 기억하십시오. 전역 모듈은 접근 범위를 넓히지만, 그래프 컴파일러를 우회하게 해 주지는 않습니다. 모듈의 서비스들이 시스템의 거의 모든 모듈에 의해 소비될 의도(`LoggerModule`이나 `ConfigModule` 등)인 경우에만 전역으로 표시하십시오.

여섯째, 작은 helper 계층을 선호하십시오. 하나는 옵션을 정규화하고, 다른 하나는 provider를 빌드하며, 작은 `forRoot(...)` 또는 `forRootAsync(...)`가 새 module type에 metadata를 bind하도록 하십시오. 이 패턴이 저장소 전반에서 반복되는 이유는 확장성이 좋기 때문입니다. 함수를 작게 유지하면 normalization logic, provider construction logic, module metadata binding을 분리해서 테스트할 수 있습니다.

마지막으로 동적 모듈도 나머지 DI 규칙과 완전히 연결되어 있다는 점을 잊지 마십시오. 그 모듈이 등록한 프로바이더는 여전히 컨테이너 정규화를 거칩니다. 스코프는 여전히 5장의 규칙을 따릅니다. 별칭(alias)은 여전히 6장의 순환/스코프 체크에 참여합니다. 그리고 내보내기(export)는 여전히 모듈 그래프 검증을 통과해야 합니다.

동적 모듈과 6장의 순환 의존성 처리는 서로 맞물립니다. 동적 모듈은 각 구성에 대해 고유한 module class를 만들기 때문에, 그래프에서 의도치 않은 순환으로 이어질 수 있는 단일 "전역" 식별자를 공유하지 않습니다. 각 `forRoot()` 호출은 graph에 새 node를 추가합니다. 이 덕분에 runtime은 실제 논리적 순환을 더 명확히 감지하고, 서로 다른 동적 구성도 독립적으로 다룰 수 있습니다.

마찬가지로 5장의 scope 규칙도 동적으로 등록된 provider에 동일하게 적용됩니다. service가 `TRANSIENT`, `REQUEST`, `SINGLETON` 중 무엇인지는 metadata가 decorator로 작성되었든 `defineModule()` 호출로 작성되었든 provider metadata에 의해 결정됩니다. 생성 경로와 관계없이 모든 provider를 같은 규칙으로 다루는 점이 Fluo 아키텍처의 integrity를 지탱합니다.

동적 모듈은 11장의 요청 파이프라인(request pipeline)과도 상호작용할 수 있습니다. middleware나 interceptor를 동적으로 등록하면, module은 자신의 구성에 따라 요청 처리 동작을 조정할 수 있습니다. 예를 들어 `AuthModule`은 제공된 옵션에 따라 서로 다른 인증 전략(JWT, OAuth 등)과 연결된 guard를 동적으로 등록할 수 있습니다. 이는 동적 모듈이 module graph와 DI에만 머물지 않고 request 처리 계층에도 연결될 수 있음을 보여 줍니다.

또한 8장에서 다루는 모듈 그래프(ModuleGraph)의 introspection 기능은 동적 모듈 구성을 시각화하고 디버깅하는 데 도움을 줍니다. 어떤 provider가 어떤 동적 모듈 instance에 의해 등록되었는지 확인할 수 있으면, 대규모 애플리케이션의 구성 문제를 더 빠르게 추적할 수 있습니다. 이런 관찰 가능성은 동적 모듈에 class-based identity를 부여한 설계의 직접적인 결과입니다.

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

테스트 지점을 설명하기 위해, 실제 Prisma module test는 생성된 module metadata가 bootstrap 이후 어떤 provider로 해석되는지 확인합니다.

`path:packages/prisma/src/module.test.ts:165-188`
```typescript
const prismaModule = PrismaModule.forRoot({ client });

class ManualPrismaModule {}

defineModule(ManualPrismaModule, {
  exports: [PrismaService, PrismaTransactionInterceptor],
  imports: [prismaModule],
});

class AppModule {}

defineModule(AppModule, {
  imports: [ManualPrismaModule],
});

const app = await bootstrapApplication({ rootModule: AppModule });
const prisma = await app.container.resolve(PrismaService<typeof client>);
const rawClient = await app.container.resolve(PRISMA_CLIENT);
const moduleOptions = await app.container.resolve(PRISMA_OPTIONS);

expect(prisma).toBeInstanceOf(PrismaService);
expect(rawClient).toBe(client);
expect(moduleOptions).toEqual({ strictTransactions: false });
expect(events).toEqual(['connect']);
```

이 "메타 테스트(meta-testing)" 패턴, 즉 코드 생성 결과를 테스트하는 방식은 Fluo에서 인프라 module을 검증하는 중요한 방법입니다. 동적 모듈이 단지 "동작하는" 것을 넘어, framework의 structural contracts를 지키는지 확인할 수 있습니다.

이것이 Fluo dynamic-module API의 실제 내부 그림입니다. 추가적인 컨테이너 서브시스템이 아닙니다. 모듈 메타데이터와 팩토리 프로바이더를 위한 규율 있는 코드 생성 패턴이며, 프레임워크의 다른 부분과 똑같은 명시적 토큰, 프로바이더, 모듈 그래프 메커니즘 위에 서 있습니다.

나아가 이런 테스트는 동일한 구성으로 여러 번 호출했을 때 생성된 module identity가 최적화를 위해 재사용되는지, 격리가 목표인 경우 고유하게 유지되는지를 확인해야 합니다. Fluo에서는 격리를 우선하므로, 모든 `forRoot` 호출은 새롭고 고유한 class를 생성합니다. 이는 서로 다른 pooling 설정을 가진 여러 database connection처럼, 같은 infrastructure module의 여러 instance 사이에서 상태가 새는 일을 막는 데 중요합니다.

테스트 계층은 필수 provider가 올바르게 export되었는지 확인하기에도 적합합니다. module metadata의 `exports` 배열을 확인하면, 구현 세부 사항이 외부로 유출되지 않았고 public API가 일관되게 유지되는지 검증할 수 있습니다. 이런 아키텍처 경계를 자동화하면 큰 Fluo 코드베이스도 시간이 지나며 유지보수 가능한 상태를 지키기 쉽습니다. 또한 `OnModuleInit` 또는 `OnModuleDestroy`를 구현하는 token에 대해 provider를 검사하여 lifecycle hook 등록도 확인할 수 있습니다.

기본 provider check를 넘어, 정교한 동적 모듈은 `ModuleGraph`와의 통합을 스스로 검증할 수도 있습니다. 등록된 provider의 의존성을 programmatic하게 분석하면, 필수 token이 runtime에 사용 가능한지 확인할 수 있습니다. 이는 runtime에 생성되는 구조에 대해 compile-time에 가까운 안전성을 제공하는 방식입니다. 동적 제조와 정적 graph 분석을 함께 쓰는 점이 Fluo 아키텍처의 강점입니다.

마지막으로, 동적 모듈은 특화된 telemetry provider를 등록해 observability에도 기여할 수 있습니다. 이런 provider는 고유한 module name이나 identifier를 사용하도록 구성될 수 있고, 개별 module instance 수준에서 metric과 log를 추적하게 해 줍니다. 복잡한 시스템에서 어느 구성 instance가 문제를 만들었는지 좁히는 데 유용합니다.

요약하면 Fluo에서 동적 모듈을 작성한다는 것은 framework의 핵심 primitive를 숨기지 않고 그대로 사용하는 일입니다. module을 일등 시민이자 code-generated result로 취급하면, decorator만으로는 표현하기 어려운 유연성과 투명성을 얻을 수 있습니다. 그만큼 규율은 필요하지만, 시스템이 복잡해질수록 이해하고 테스트하고 유지보수하기 쉬운 구조를 남깁니다.
