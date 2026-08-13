<!-- packages: @fluojs/runtime, @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: T16 Part 3 source-analysis draft for application context shells, adapter contracts, and runtime lifecycle coordination -->

# Chapter 9. Application Context and Platform Adapter Contracts

이 장은 Fluo가 하나의 부트스트랩 spine 위에서 application context, full application, microservice shell을 어떻게 조립하는지 설명합니다. Chapter 8이 모듈 그래프와 초기화 순서를 확정했다면, 이 장은 그 결과물이 어떤 런타임 셸 계약으로 노출되는지 이어서 보여 줍니다.

## Learning Objectives
- `ApplicationContext`, `Application`, `MicroserviceApplication`이 공유하는 공통 부트스트랩 기반을 이해합니다.
- adapterless context와 full application의 차이를 런타임 토큰 관점에서 설명합니다.
- readiness, listen, shutdown contract가 어느 계층에서 책임지는지 분석합니다.
- cleanup과 재시도 가능한 close 동작이 런타임 무결성에 왜 중요한지 정리합니다.
- platform shell과 HTTP adapter가 서로 다른 호스트 가정을 어떻게 분리하는지 살펴봅니다.
- 고급 툴링이나 워커 프로세스에서 application context를 언제 선택할지 판단합니다.

## Prerequisites
- Chapter 8 완료.
- Fluo 라이프사이클 훅과 런타임 토큰 기본 이해.
- HTTP 어댑터와 DI 컨테이너 역할에 대한 기초 지식.

## 9.1 Fluo builds three runtime shells from one bootstrap spine
Fluo runtime internals를 오해하는 가장 쉬운 방법은 `Application`, `ApplicationContext`, `MicroserviceApplication`이 서로 전혀 다른 bootstrap path에서 나온다고 생각하는 것입니다. 실제 구현은 그렇지 않습니다.

세 shell 모두 `path:packages/runtime/src/bootstrap.ts` 안에서 조립됩니다. 그리고 더 아래쪽 bootstrap spine을 공유합니다. module graph compilation, container registration, runtime token registration, lifecycle singleton resolution, hook execution, platform-shell startup이 공통입니다.

`path:packages/runtime/src/types.ts:163-199`의 public type을 보면 닮은 점이 분명합니다. `ApplicationContext`는 `container`, `modules`, `rootModule`, `get()`, `close()`를 노출합니다. `Application`은 여기에 `state`, `dispatcher`, `listen()`, `ready()`, `connectMicroservice()`, `startAllMicroservices()`를 추가합니다. `MicroserviceApplication`은 context surface를 재사용하면서 `listen()`, `send()`, `emit()` 같은 transport method를 더합니다.

이것은 우연한 API 대칭이 아닙니다. 구현 순서의 반영입니다. Fluo는 먼저 transport-neutral한 DI/lifecycle baseline을 만든 뒤, 각 shell type이 약속한 capability만 래핑해 노출합니다.

source에서도 분기 지점이 직접 보입니다. `path:packages/runtime/src/bootstrap.ts:920-1029`의 `bootstrapApplication()`은 `new FluoApplication(...)`을 반환합니다. `path:packages/runtime/src/bootstrap.ts:1059-1153`의 `FluoFactory.createApplicationContext()`는 `new FluoApplicationContext(...)`를 반환합니다. `path:packages/runtime/src/bootstrap.ts:1164-1189`의 `FluoFactory.createMicroservice()`는 먼저 application context를 만든 다음, resolve된 runtime token을 `FluoMicroserviceApplication`으로 감쌉니다.

full application branch의 대표 지점은 반환부입니다. 앞선 module bootstrap과 lifecycle 실행은 공유하지만, 이 branch만 dispatcher, adapter, adapter 보유 여부, platform shell reference를 함께 넣어 `FluoApplication`을 만듭니다.

`path:packages/runtime/src/bootstrap.ts:1000-1012`
```typescript
    return new FluoApplication(
      bootstrapped.container,
      bootstrapped.modules,
      options.rootModule,
      dispatcher,
      bootstrapTiming,
      adapter,
      hasHttpAdapter,
      platformShell,
      lifecycleInstances,
      logger,
      runtimeCleanup,
    );
```

여기서 `dispatcher`와 `adapter`가 함께 들어간다는 점이 application shell의 표식입니다. 같은 container baseline을 쓰더라도, 이 shell은 request dispatch와 adapter listen 정책까지 책임집니다.

context branch는 같은 spine을 지나지만 반환 객체가 다릅니다. dispatcher와 HTTP adapter를 만들지 않고, DI와 lifecycle 제어에 필요한 값만 `FluoApplicationContext`로 감쌉니다.

`path:packages/runtime/src/bootstrap.ts:1128-1135`
```typescript
      return new FluoApplicationContext(
        bootstrapped.container,
        bootstrapped.modules,
        rootModule,
        bootstrapTiming,
        lifecycleInstances,
        runtimeCleanup,
      );
```

microservice branch는 또 다른 독립 bootstrap이 아닙니다. 먼저 context를 만든 뒤, 그 context에서 transport runtime token을 resolve하고 wrapper를 얹습니다.

`path:packages/runtime/src/bootstrap.ts:1168-1180`
```typescript
    const logger = options.logger ?? createConsoleApplicationLogger();
    const microserviceToken = options.microserviceToken ?? DEFAULT_MICROSERVICE_TOKEN;
    const context = await FluoFactory.createApplicationContext(rootModule, options);

    try {
      const runtime = await context.get<unknown>(microserviceToken);

      if (!isMicroserviceRuntime(runtime)) {
        throw new InvariantError('Resolved microservice token does not implement listen().');
      }

      return new FluoMicroserviceApplication(context, logger, runtime);
```

이 세 발췌를 함께 보면 layered composition이 더 선명합니다. application은 dispatcher와 HTTP adapter를 가진 shell이고, context는 adapterless DI/lifecycle shell이며, microservice는 context 위에 transport runtime을 붙인 shell입니다.

즉 bootstrap 구조는 완전히 별개인 세 경로가 아니라, 한 baseline 위에 올라가는 layered composition입니다. runtime은 context 전용 DI system이나 microservice 전용 lifecycle engine을 따로 유지하지 않습니다. 같은 core baseline 위에 다른 wrapper를 얹습니다.

구현 관점의 diagram은 다음과 같습니다.

```text
bootstrap graph + container + lifecycle baseline
  -> FluoApplicationContext  (DI-only shell)
  -> FluoApplication         (context + dispatcher + adapter state)
  -> FluoMicroserviceApplication (context + resolved transport runtime)
```

테스트도 이 공통 조상을 강화합니다. `path:packages/runtime/src/bootstrap.test.ts:522-629`는 context bootstrap을 검증하고, `path:packages/runtime/src/application.test.ts:175-235`는 full application lifecycle을 검증하며, `path:packages/runtime/src/bootstrap.test.ts:764-859`는 microservice wrapper path를 검증합니다.

이 공유 bootstrap spine이 이 장의 기반입니다. runtime contract의 나머지 부분을 이해하려면, 먼저 context, application, microservice shell이 하나의 compiled module/container baseline 위에서 만들어지는 형제라는 사실을 봐야 합니다.

## 9.2 Application context is the adapterless baseline and still runs full lifecycle bootstrap
`FluoApplicationContext`는 `path:packages/runtime/src/bootstrap.ts:856-928`에 정의되어 있습니다. 표면은 의도적으로 작습니다. `container`, `modules`, `rootModule`, optional bootstrap timing diagnostics, lifecycle instance, cleanup callback, 그리고 `get()`이 사용하는 좁은 context-resolution cache를 저장합니다.

context shell 자체도 그 의도를 그대로 드러냅니다. 저장하는 값은 compiled module baseline과 lifecycle cleanup에 필요한 값이고, public 동작은 DI lookup과 close입니다.

`path:packages/runtime/src/bootstrap.ts:856-896`
```typescript
class FluoApplicationContext implements ApplicationContext {
  private closed = false;
  private closeStarted = false;
  private closingPromise: Promise<void> | undefined;
  private readonly contextResolutionCache: ContextResolutionCache = new Map();

  constructor(
    readonly container: Container,
    readonly modules: CompiledModule[],
    readonly rootModule: ModuleType,
    readonly bootstrapTiming: ApplicationContext['bootstrapTiming'],
    private readonly lifecycleInstances: unknown[],
    private readonly runtimeCleanup: Array<() => void>,
    private readonly contextCacheableTokens: ContextCacheableTokens,
  ) {
    installContextCacheInvalidation(this.container, this.contextResolutionCache, this.contextCacheableTokens);
  }

  async get<T>(token: Token<T>): Promise<T> {
    if (this.closed) {
      return this.container.resolve(token);
    }

    this.assertProviderResolutionAllowed();
    const resolved = await resolveContextToken(
      this.container,
      token,
      this.contextCacheableTokens,
      this.contextResolutionCache,
    );
    this.assertProviderResolutionAllowed();

    return resolved;
  }

  private assertProviderResolutionAllowed(): void {
    if (this.closeStarted) {
      throw new InvariantError('Application context cannot resolve providers after shutdown has started.');
    }
  }
```

이 발췌에도 dispatcher, adapter, listen state는 없습니다. 그래서 context는 덜 bootstrap된 application이 아니라 DI와 lifecycle만 약속하는 별도 shell입니다. 추가된 cache는 두 번째 DI system이 아니라 동일한 container 앞에 놓인 guarded fast path입니다.

public method도 `get()`과 `close()`뿐입니다. 이 미니멀한 표면이 핵심입니다. application context는 CLI task, worker, migration, 혹은 HTTP listener가 필요 없는 모든 DI-driven process를 위한 runtime baseline입니다.

애플리케이션이 작성한 provider의 cache eligibility는 effective runtime provider와 root module에 직접 선언된 provider로 제한됩니다. Bare class와 class/factory provider도 singleton이어야 하며, alias, value, `multi: true` provider는 제외됩니다. Internal runtime token은 명시적으로 seed됩니다. Imported module provider는 여전히 container 자체의 singleton cache를 사용하지만 `ApplicationContext.get()`은 별도 context-cache entry를 추가하지 않습니다.

`path:packages/runtime/src/bootstrap.ts:1074-1113`
```typescript
function createContextCacheableTokenSet(
  effectiveProviders: BootstrapEffectiveProviders,
  runtimeTokens: readonly Token[],
): Set<Token> {
  const cacheableTokens = new Set<Token>(runtimeTokens);

  for (const provider of effectiveProviders.runtimeProviders) {
    if (isDirectSingletonContextProvider(provider)) {
      cacheableTokens.add(providerToken(provider));
    }
  }

  for (const provider of effectiveProviders.rootModuleProviders) {
    if (isDirectSingletonContextProvider(provider)) {
      cacheableTokens.add(providerToken(provider));
    }
  }

  return cacheableTokens;
}

function isDirectSingletonContextProvider(provider: Provider): boolean {
  if (isMultiProvider(provider)) {
    return false;
  }

  if (typeof provider === 'function') {
    return providerScope(provider) === 'singleton';
  }

  if ('useExisting' in provider || 'useValue' in provider) {
    return false;
  }

  return providerScope(provider) === 'singleton';
}
```

Resolution helper는 적격 token에 대해서만 in-flight promise를 memoize하고 실패한 resolution은 제거합니다. 그 밖의 lookup은 모두 DI에 직접 위임되므로 alias target scope, request-scope error, transient 재생성, 새로운 multi-provider contribution array가 유지됩니다. `container.override()`는 기존 entry를 지우고 override된 각 token의 eligibility를 다시 계산합니다. `close()` 이후에는 `get()`이 context cache를 의도적으로 우회해 disposed container에 도달하므로, 이전에 cache된 singleton이 필수 post-close failure를 숨기지 않습니다.

`path:packages/runtime/src/bootstrap.ts:1129-1178`
```typescript
function installContextCacheInvalidation(
  container: Container,
  cache: ContextResolutionCache,
  cacheableTokens: ContextCacheableTokens,
): void {
  const cacheInvalidatingContainer = container as CacheInvalidatingContainer;
  const override = cacheInvalidatingContainer.override.bind(container);

  cacheInvalidatingContainer.override = (...providers: Provider[]): Container => {
    const result = override(...providers);
    cache.clear();

    for (const provider of providers) {
      const token = providerToken(provider);

      if (isDirectSingletonContextProvider(provider)) {
        cacheableTokens.add(token);
      } else {
        cacheableTokens.delete(token);
      }
    }

    return result;
  };
}

async function resolveContextToken<T>(
  container: Container,
  token: Token<T>,
  cacheableTokens: ReadonlySet<Token>,
  cache: ContextResolutionCache,
): Promise<T> {
  if (!cacheableTokens.has(token)) {
    return container.resolve(token);
  }

  const cached = cache.get(token);

  if (cached) {
    return cached as Promise<T>;
  }

  const resolution = container.resolve(token).catch((error: unknown) => {
    cache.delete(token);
    throw error;
  });
  cache.set(token, resolution);

  return resolution;
}
```

Regression coverage가 이 경계를 실행 가능한 형태로 고정합니다. `path:packages/runtime/src/bootstrap.test.ts:687-885`는 direct singleton memoization, duplicate winner eligibility, transient override, multi-provider 위임을 다룹니다. `path:packages/runtime/src/application.test.ts:2783-2886`은 transient/request-scoped alias, singleton override invalidation, 그리고 `ApplicationContext.get()`과 `Application.get()` 양쪽의 post-close failure를 다룹니다.

실제 bootstrap path는 `path:packages/runtime/src/bootstrap.ts:1619-1740`의 `FluoFactory.createApplicationContext()`입니다. 이 함수를 `bootstrapApplication()`과 비교하면, 대부분의 순서가 동일합니다. 여전히 logger, platform shell, runtime provider list, compiled module, runtime context token, lifecycle instance, timing diagnostics를 만듭니다.

핵심 차이는 token registration입니다. Full application에서는 `registerRuntimeBootstrapTokens()`가 `HTTP_APPLICATION_ADAPTER`와 `PLATFORM_SHELL`을 모두 추가합니다. Context는 같은 platform, cleanup-registration, bootstrap-ready, container, compiled-module baseline을 등록하지만 `HTTP_APPLICATION_ADAPTER`는 생략합니다.

토큰 등록 함수는 이 차이를 가장 작게 보여 줍니다. Application branch는 공유 lifecycle token과 함께 HTTP adapter token을 추가합니다. Context branch는 lifecycle token을 유지하되 adapter를 생략하고, 두 branch 모두 공통 context token 등록 helper로 내려갑니다.

`path:packages/runtime/src/bootstrap.ts:1280-1300`
```typescript
function registerRuntimeBootstrapTokens(
  bootstrapped: BootstrapResult,
  adapter: HttpApplicationAdapter,
  platformShell: RuntimePlatformShell,
  runtimeCleanup: Array<() => void>,
  bootstrapReadySignal: BootstrapReadySignal,
): void {
  registerRuntimeContextTokens(bootstrapped, {
    provide: HTTP_APPLICATION_ADAPTER,
    useValue: adapter,
  }, {
    provide: PLATFORM_SHELL,
    useValue: platformShell,
  }, {
    provide: RUNTIME_CLEANUP_REGISTRATION,
    useValue: createRuntimeCleanupRegistration(runtimeCleanup),
  }, {
    provide: BOOTSTRAP_READY_SIGNAL,
    useValue: bootstrapReadySignal,
  });
}
```

이 첫 발췌는 full application branch가 HTTP adapter token을 추가한다는 점만 좁혀 보여 줍니다. 이어지는 공통 helper를 보면 context branch가 같은 baseline token을 공유하면서 adapter token만 제외한다는 차이가 닫힙니다.

`path:packages/runtime/src/bootstrap.ts:1302-1332`
```typescript
function registerRuntimeContextTokens(bootstrapped: BootstrapResult, ...providers: Provider[]): void {
  bootstrapped.container.register(
    ...providers,
    {
      provide: RUNTIME_CONTAINER,
      useValue: bootstrapped.container,
    },
    {
      provide: COMPILED_MODULES,
      useValue: bootstrapped.modules,
    },
  );
}

function registerRuntimeApplicationContextTokens(
  bootstrapped: BootstrapResult,
  platformShell: RuntimePlatformShell,
  runtimeCleanup: Array<() => void>,
  bootstrapReadySignal: BootstrapReadySignal,
): void {
  registerRuntimeContextTokens(bootstrapped, {
    provide: PLATFORM_SHELL,
    useValue: platformShell,
  }, {
    provide: RUNTIME_CLEANUP_REGISTRATION,
    useValue: createRuntimeCleanupRegistration(runtimeCleanup),
  }, {
    provide: BOOTSTRAP_READY_SIGNAL,
    useValue: bootstrapReadySignal,
  });
}
```

두 번째 발췌는 공통 helper와 context 전용 wrapper를 이어서 보여 줍니다. 그래서 `RUNTIME_CONTAINER`와 `COMPILED_MODULES`는 둘 다 갖지만, `HTTP_APPLICATION_ADAPTER`는 full application만 갖는다는 설명이 코드와 맞습니다.

이 차이는 테스트로 명시적으로 고정됩니다. `path:packages/runtime/src/bootstrap.test.ts:667-685`는 application service resolve는 성공하고, `context.get(HTTP_APPLICATION_ADAPTER)`는 `No provider registered`로 실패하며, `context.get(PLATFORM_SHELL)`은 성공해야 한다고 검증합니다.

여기서 중요한 점은 미묘합니다. application context는 "절반만 bootstrap된 상태"가 아닙니다. 자신이 약속한 capability에 대해서는 완전히 bootstrap된 상태입니다. 다만 adapter access를 약속하지 않을 뿐입니다.

lifecycle 동작도 완전합니다. 같은 테스트 파일의 `path:packages/runtime/src/bootstrap.test.ts:1090-1129`는 context bootstrap이 `onModuleInit()`와 `onApplicationBootstrap()`을 실행하고, 이후 `close()`가 `onModuleDestroy()`와 `onApplicationShutdown()`을 실행함을 보여 줍니다.

context와 application이 lifecycle을 공유한다는 점은 공통 helper에서 확인할 수 있습니다. bootstrap은 singleton lifecycle instance를 resolve하고, hook을 실행한 뒤 platform shell을 시작하고 readiness state를 표시합니다.

`path:packages/runtime/src/bootstrap.ts:1334-1358`
```typescript
async function resolveBootstrapLifecycleInstances(
  bootstrapped: BootstrapResult,
  resolvedInstances?: unknown[],
): Promise<unknown[]> {
  const lifecycleProviders = [
    ...bootstrapped.effectiveProviders.runtimeProviders,
    ...bootstrapped.effectiveProviders.moduleProviders,
  ];

  return resolveLifecycleInstances(bootstrapped.container, lifecycleProviders, resolvedInstances);
}

async function runBootstrapLifecycle(
  modules: CompiledModule[],
  lifecycleInstances: unknown[],
  logger: ApplicationLogger,
  platformShell: RuntimePlatformShell,
  bootstrapReadySignal: MutableBootstrapReadySignal,
): Promise<void> {
```

이 발췌는 lifecycle 대상 목록을 runtime provider와 compiled module provider에서 함께 만든다는 점을 보여 줍니다. 다음 발췌는 그 목록을 실제 bootstrap phase에서 어떻게 실행하는지로 초점을 좁힙니다.

`path:packages/runtime/src/bootstrap.ts:1346-1358`
```typescript
async function runBootstrapLifecycle(
  modules: CompiledModule[],
  lifecycleInstances: unknown[],
  logger: ApplicationLogger,
  platformShell: RuntimePlatformShell,
  bootstrapReadySignal: MutableBootstrapReadySignal,
): Promise<void> {
  resetReadinessState(modules);
  await runBootstrapHooks(lifecycleInstances);
  await platformShell.start();
  markReadinessState(modules);
  bootstrapReadySignal.markReady();
  logCompiledModules(logger, modules);
}
```

따라서 context bootstrap도 platform shell startup과 application bootstrap hook을 실제로 실행합니다. 차이는 HTTP adapter surface가 없다는 점이지, lifecycle phase가 생략된다는 뜻이 아닙니다.

즉 context bootstrap은 dry-run mode가 아닙니다. Direct singleton lifecycle candidate를 eager하게 resolve하고, full application shell과 같은 runtime hook을 실제로 수행합니다.

timing diagnostics도 같은 패턴을 따릅니다. `path:packages/runtime/src/bootstrap.test.ts:1387-1411`은 기본적으로 `bootstrapTiming`이 없지만, `diagnostics.timing`을 켜면 사용할 수 있음을 보여 줍니다. runtime은 timing instrumentation을 HTTP app에만 제한하지 않습니다.

context bootstrap 흐름을 요약하면 다음과 같습니다.

```text
createApplicationContext(rootModule)
  -> bootstrapModule()
  -> register context/lifecycle runtime tokens without HTTP_APPLICATION_ADAPTER
  -> resolve singleton lifecycle instances
  -> run bootstrap hooks
  -> return DI-only shell with get() and close()
```

그래서 context API는 고급 툴링에서 특히 유용합니다. 같은 validated module graph, 같은 singleton state, 같은 shutdown semantics를 얻으면서도, DI에 접근하려고 HTTP adapter를 억지로 만들 필요가 없습니다.

## 9.3 Full applications add dispatcher state, readiness checks, and adapter-driven listen semantics
`FluoApplication`은 `path:packages/runtime/src/bootstrap.ts:403-529`에 정의되어 있습니다. context가 가지는 모든 것을 저장하면서, 추가로 `dispatcher`, adapter 존재 여부 상태, platform shell reference, connected microservice list, `ApplicationState`를 보관합니다.

application shell의 constructor는 context baseline 위에 무엇이 추가되는지 직접 보여 줍니다. 같은 `container`, `modules`, `rootModule`을 받지만, dispatcher와 adapter 상태가 함께 들어옵니다.

`path:packages/runtime/src/bootstrap.ts:403-424`
```typescript
class FluoApplication implements Application {
  private applicationState: ApplicationState = 'bootstrapped';
  private closed = false;
  private closeStarted = false;
  private closingPromise: Promise<void> | undefined;
  private readonly lifecycleInstances: unknown[];
  private readonly connectedMicroservices: MicroserviceApplication[] = [];

  constructor(
    readonly container: Container,
    readonly modules: CompiledModule[],
    readonly rootModule: ModuleType,
    readonly dispatcher: Dispatcher,
    readonly bootstrapTiming: Application['bootstrapTiming'],
    private readonly adapter: HttpApplicationAdapter,
    private readonly hasHttpAdapter: boolean,
    private readonly platformShell: RuntimePlatformShell,
    lifecycleInstances: unknown[],
    private readonly logger: ApplicationLogger,
    private readonly runtimeCleanup: Array<() => void>,
  ) {
    this.lifecycleInstances = lifecycleInstances;
  }
```

이 구조 때문에 application shell은 context 기능을 포함하면서도 HTTP adapter와 dispatcher state를 관리합니다. context와 같은 baseline을 쓰지만, 같은 contract는 아닙니다.

`ApplicationState`는 `path:packages/runtime/src/types.ts`에 선언되어 있습니다. 허용 값은 계속 `'bootstrapped'`, `'ready'`, `'closed'`입니다. `closeStarted`는 새 public state가 아니라 private admission gate입니다. Pending 또는 failed teardown은 이전 public state를 유지하지만 일반 application operation은 shutdown 시작부터 reject됩니다. Public state는 teardown이 성공적으로 완료된 뒤에만 `closed`가 됩니다.

가장 먼저 볼 계약은 `path:packages/runtime/src/bootstrap.ts:437-443`의 `ready()`입니다. 이 메서드는 `adapter.listen()`을 호출하지 않습니다. application이 이미 닫혀 있지 않은지만 확인한 뒤, `platformShell.assertCriticalReadiness()`에 위임합니다.

`ready()`는 transport bind가 아니라 platform readiness gate입니다. adapter로 요청을 받기 전에 critical component 상태를 확인하는 단계로 분리되어 있습니다.

`path:packages/runtime/src/bootstrap.ts:437-443`
```typescript
  async ready(): Promise<void> {
    if (this.applicationState === 'closed') {
      throw new InvariantError('Application cannot become ready after it has been closed.');
    }

    await this.platformShell.assertCriticalReadiness();
  }
```

즉 Fluo에서 readiness는 "server socket이 bind되었다"의 동의어가 아닙니다. platform shell에 기반한 pre-listen gate입니다. critical platform component가 ready라고 보고해야만 transport startup이 허용됩니다.

`path:packages/runtime/src/bootstrap.ts:738-786`의 `listen()`은 그 readiness gate 위에 adapter behavior를 얹습니다. private shutdown-start gate가 닫혔으면 reject하고, 이미 ready면 바로 return하며, adapter가 없으면 `options.adapter`를 제공하거나 `createApplicationContext()`를 쓰라는 invariant error를 던집니다.

그 다음 `listen()`이 adapter 정책을 적용합니다. adapter 없는 application bootstrap은 허용되지만, adapter 없이 listen하는 것은 이 guard에서 막힙니다.

`path:packages/runtime/src/bootstrap.ts:738-786`
```typescript
  async listen(): Promise<void> {
    if (this.closeStarted) {
      throw new InvariantError('Application cannot listen after it has been closed.');
    }

    if (this.applicationState === 'ready') {
      return;
    }

    if (this.listenPromise) {
      await this.listenPromise;
      return;
    }

    this.listenPromise = this.startListening();

    try {
      await this.listenPromise;
    } finally {
      this.listenPromise = undefined;
    }
  }

  private async startListening(): Promise<void> {
    if (this.closeStarted) {
      throw new InvariantError('Application cannot listen after it has been closed.');
    }

    if (!this.hasHttpAdapter) {
      throw new InvariantError(
        'Application cannot listen without an HTTP adapter. Provide options.adapter for HTTP startup, or use createApplicationContext() for adapterless DI-only bootstrap.',
      );
    }

    await this.ready();
    try {
      await this.adapter.listen(this.dispatcher);
    } catch (error: unknown) {
      this.logger.error('Failed to start the HTTP adapter.', error, 'FluoApplication');
      throw error;
    }

    if (this.closeStarted) {
      throw new InvariantError('Application startup was interrupted by shutdown.');
    }

    this.applicationState = 'ready';
    this.logger.log('fluo application successfully started.', 'FluoApplication');
  }
```

이 발췌는 application과 context 선택지가 왜 나뉘는지도 보여 줍니다. HTTP startup이 목적이면 adapter를 제공하고, DI-only bootstrap이 목적이면 `createApplicationContext()`로 가야 합니다.

이 정확한 에러 문자열은 `path:packages/runtime/src/application.test.ts:407-420`에서 검증됩니다. 이 테스트가 중요한 이유는, runtime이 adapterless application bootstrap 자체는 의도적으로 허용하면서도, adapter 없이 `listen()`하는 행위는 금지한다는 사실을 고정하기 때문입니다.

이 guard를 통과한 뒤에야 `listen()`은 `await this.ready()`를 호출하고, 그 다음 `await this.adapter.listen(this.dispatcher)`를 실행합니다. 성공하면 state를 `'ready'`로 바꾸고 startup log를 남깁니다. 즉 transport adapter가 application state transition을 단독으로 소유하지 않습니다. 더 큰 runtime shell policy의 일부로 참여합니다.

dispatcher 조립은 그보다 앞서 `path:packages/runtime/src/bootstrap.ts:890-910`의 `createRuntimeDispatcher()`에서 일어납니다. runtime은 compiled module controller로부터 handler mapping을 만들고, route mapping을 로그로 남기며, middleware, converters, interceptors, observers, optional exception filter로 dispatcher를 생성합니다.

dispatcher 생성은 full application branch에만 필요한 request-facing 단계입니다. compiled module baseline에서 handler source를 만들고, HTTP pipeline 옵션을 묶은 뒤 dispatcher를 반환합니다.

`path:packages/runtime/src/bootstrap.ts:890-910`
```typescript
function createRuntimeDispatcher(
  bootstrapped: BootstrapResult,
  options: BootstrapApplicationOptions,
  logger: ApplicationLogger,
): Dispatcher {
  const handlerMapping = createHandlerMapping(createHandlerSources(bootstrapped.modules), {
    versioning: options.versioning,
  });
  logRouteMappings(logger, handlerMapping.descriptors);

  const errorHandler = createFilterErrorHandler(options.filters);
  const dispatcherOptions = createRuntimeDispatcherOptions(
    bootstrapped,
    options,
    handlerMapping,
    errorHandler,
    logger,
  );

  return createDispatcher(dispatcherOptions);
}
```

context branch에는 이 dispatcher 조립이 없습니다. 그래서 module bootstrap 공유와 HTTP request pipeline 생성은 서로 다른 단계로 읽어야 합니다.

이 사실이 application context와 full application의 진짜 분기점을 보여 줍니다. module bootstrap 자체가 아니라, request dispatch machinery를 만들 것인지, `listen()`을 노출할 것인지에서 갈라집니다.

`path:packages/runtime/src/application.test.ts:355-395`의 runtime token 테스트도 이를 구체화합니다. `RUNTIME_CONTAINER`, `COMPILED_MODULES`, `HTTP_APPLICATION_ADAPTER`를 주입받은 probe provider는, lifecycle hook 동안 live application container, compiled modules list, configured adapter를 실제로 관찰합니다.

따라서 application shell contract는 이렇게 요약할 수 있습니다.

```text
Application = ApplicationContext
  + dispatcher
  + HTTP adapter token registration
  + readiness gate
  + listen() state transition
  + microservice attachment helpers
```

source가 구현하는 모델도 정확히 이것입니다. application shell은 totally different bootstrap universe가 아니라, context baseline에 transport-facing capability를 더한 형태입니다.

## 9.4 Shutdown and failure cleanup are first-class runtime contracts, not afterthoughts
Application context와 application shell은 public lifecycle state와 private terminal operation gate라는 두 shutdown 개념을 사용합니다. 둘을 분리하면 문서화된 `bootstrapped | ready | closed` state 계약을 보존하면서 teardown에 새 작업이 진입하지 못하게 할 수 있습니다.

`Application.close()`는 teardown promise를 만들기 전에 `closeStarted`를 동기적으로 설정합니다. 그 시점부터 `Application.listen()`, `Application.get()`, `connectMicroservice()`, `startAllMicroservices()`는 reject됩니다. `ApplicationContext.close()`도 `ApplicationContext.get()`에 같은 규칙을 적용합니다. 이 gate는 teardown이 pending인 동안은 물론 close 시도가 실패한 뒤에도 닫힌 상태를 유지합니다. 성공한 teardown만 public application state를 `closed`로 바꾸며, pending 또는 failed 시도는 이전 public state를 그대로 노출합니다. 두 `get()` 구현은 awaited provider resolution 뒤 gate를 다시 검사하므로 close 직전에 admission된 lookup도 shutdown 시작 뒤 provider를 반환할 수 없습니다.

Connect 경로는 asynchronous runtime resolution 전후에 gate를 검사합니다. Start-all 경로는 iteration 전과 각 child listen 직전에 다시 검사합니다. 이 재검사는 shutdown 직전에 admission된 작업이 shutdown 시작 뒤 child를 attach하거나 start하지 못하게 합니다.

공유 `closeRuntimeResources()` helper는 readiness reset, runtime cleanup callback, lifecycle hook, optional adapter close, container disposal을 순서대로 실행합니다. 각 phase는 `RetryableShutdownState`에 completion bit를 가집니다. 현재 close 시도는 에러가 있어도 뒤 phase를 계속 시도하고 실패를 aggregate합니다. 이후 `close()`는 완료된 phase를 건너뛰고 각 incomplete phase를 하나의 단위로 재시도합니다. Lifecycle hook은 하나의 phase이므로 일부 hook이 실패하면 개별 hook이 transaction처럼 완료되었다고 가정하지 않고 hook phase 전체를 재시도합니다.

`path:packages/runtime/src/retryable-shutdown.ts`
```typescript
export type RetryableShutdownState<TPhase> = {
  complete(phase: TPhase): void;
  isComplete(phase: TPhase): boolean;
};

export function createRetryableShutdownState<TPhase>(): RetryableShutdownState<TPhase> {
  const completedPhases = new Set<TPhase>();

  return {
    complete(phase) {
      completedPhases.add(phase);
    },
    isComplete(phase) {
      return completedPhases.has(phase);
    },
  };
}
```

Concurrent close caller는 `closingPromise`를 공유합니다. 성공한 close 이후 호출은 멱등입니다. 실패한 close는 in-flight promise만 지우고 terminal gate나 completed-phase ledger는 지우지 않으므로, 다음 explicit close는 application operation을 다시 열지 않고 cleanup을 이어갈 수 있습니다.

Executable evidence는 shell과 race별로 의도적으로 분리되어 있습니다.

| Contract | Regression evidence |
| --- | --- |
| 실패한 application close는 operation-terminal 상태를 유지하고 incomplete teardown phase만 재시도합니다. | `path:packages/runtime/src/application.test.ts` — `keeps failed shutdown terminal while retrying only incomplete cleanup` |
| `Application.get()`은 teardown이 pending이어도 shutdown 시작부터 reject됩니다. | `path:packages/runtime/src/application.test.ts` — `rejects Application.get() as soon as shutdown starts while teardown is pending` |
| Application shutdown 전에 admission된 provider lookup은 async resolution 뒤 값을 반환할 수 없습니다. | `path:packages/runtime/src/application.test.ts` — `rejects Application.get() when shutdown starts during provider resolution` |
| `ApplicationContext.get()`은 teardown이 pending이어도 shutdown 시작부터 reject됩니다. | `path:packages/runtime/src/bootstrap.test.ts` — `rejects ApplicationContext.get() as soon as shutdown starts while teardown is pending` |
| Context shutdown 전에 admission된 provider lookup은 async resolution 뒤 값을 반환할 수 없습니다. | `path:packages/runtime/src/bootstrap.test.ts` — `rejects ApplicationContext.get() when shutdown starts during provider resolution` |
| Parent connect/start operation은 child close가 pending인 동안 reject됩니다. | `path:packages/runtime/src/bootstrap.test.ts` — `rejects connect and start operations while application close is pending` |
| Shutdown 전에 admission된 connect도 async runtime resolution 뒤 child를 attach할 수 없습니다. | `path:packages/runtime/src/bootstrap.test.ts` — `rejects connectMicroservice() when shutdown starts during runtime resolution` |
| Context retry는 완료된 phase를 건너뛰고 incomplete hook phase를 재시도합니다. | `path:packages/runtime/src/bootstrap.test.ts` — `retries only incomplete application context shutdown phases` |

Failure-path cleanup은 `runBootstrapFailureCleanup()`이 소유합니다. Bootstrap이 lifecycle instance나 runtime resource를 만든 뒤 실패하더라도, runtime은 readiness를 reset하고 모든 cleanup phase를 시도하면서 원래 bootstrap error를 보존합니다.

`path:packages/runtime/src/bootstrap.ts:223-243`
```typescript
async function runBootstrapFailureCleanup(options: {
  container?: Container;
  lifecycleInstances: readonly unknown[];
  logger: ApplicationLogger;
  modules: CompiledModule[];
  runtimeCleanup: readonly (() => void)[];
  scope: 'application' | 'application context';
}): Promise<void> {
  const errors: unknown[] = [];

  resetReadinessState(options.modules);

  errors.push(...(await runCleanupCallbacks(options.runtimeCleanup)));

  if (options.lifecycleInstances.length > 0) {
    try {
      await runShutdownHooks(options.lifecycleInstances, 'bootstrap-failed');
    } catch (error) {
      errors.push(error);
    }
  }
```

이 첫 failure-cleanup 발췌는 bootstrap 실패 후에도 lifecycle shutdown hook을 호출하려고 시도한다는 점을 보여 줍니다. 이어지는 발췌는 container disposal과 cleanup failure logging을 분리해서 보여 줍니다.

`path:packages/runtime/src/bootstrap.ts:245-260`
```typescript
  if (options.container) {
    try {
      await disposeContainer(options.container);
    } catch (error) {
      errors.push(error);
    }
  }

  for (const error of errors) {
    options.logger.error(
      `Failed to clean up after ${options.scope} bootstrap failure.`,
      error,
      'FluoFactory',
    );
  }
}
```

이 발췌는 cleanup이 best effort가 아니라 runtime contract임을 보여 줍니다. 이미 만든 lifecycle instance가 있다면 실패 경로에서도 shutdown hook을 실행하려고 시도합니다.

이것은 단순한 방어 코딩이 아닙니다. bootstrap이 multi-phase이기 때문에 반드시 필요한 rollback path입니다. provider resolution 이후, platform start 이후, 혹은 dispatcher creation 직전에도 실패가 가능하기 때문입니다.

테스트가 이 보장을 구체화합니다. `path:packages/runtime/src/application.test.ts:237-270`은 adapter shutdown failure 후에도 `close()`를 재시도할 수 있음을 증명합니다. `path:packages/runtime/src/application.test.ts:272-290`은 shutdown hook failure가 조용히 묻히지 않고 surface된다는 것을 보여 줍니다. `path:packages/runtime/src/application.test.ts:292-320`은 cleanup도 실패하더라도 original startup failure를 보존한다는 점을 검증합니다.

close idempotency도 의도적인 설계입니다. `FluoApplication.close()`와 `FluoApplicationContext.close()`는 모두 `closingPromise`를 memoize합니다. close가 이미 진행 중이면, 뒤늦은 호출자는 같은 promise를 기다립니다. close가 성공하면 이후 호출은 즉시 return합니다. close가 실패하면 promise를 비워 재시도를 허용합니다.

lifecycle hook ordering은 `path:packages/runtime/src/bootstrap.ts:1267-1279`의 `runShutdownHooks()`가 담당합니다. instance를 역순으로 순회하고, 먼저 `onModuleDestroy()`를 모두 실행한 뒤, 그 다음 `onApplicationShutdown(signal)`을 실행합니다. 가능한 한 startup dependency 방향을 거꾸로 되돌리는 ordering이라고 볼 수 있습니다.

NestJS `beforeApplicationShutdown`은 지원하지 않으며 이 flow에 중간 phase를 만들지 않습니다. Application-wide signal cleanup보다 먼저 수행해야 하는 준비 작업은 `onModuleDestroy()`로 옮기고, signal에 의존하는 cleanup에는 `onApplicationShutdown(signal?)`을 사용합니다. Application context는 compatibility shim, alias, fallback 또는 추가 runtime hook을 설치하지 않습니다.

shutdown hook ordering은 별도 helper로 고정되어 있습니다. 두 hook family 모두 reverse order로 처리되므로, startup 때 만들어진 singleton lifecycle instance를 반대 방향으로 정리합니다.

`path:packages/runtime/src/bootstrap.ts:1267-1279`
```typescript
async function runShutdownHooks(instances: readonly unknown[], signal?: string): Promise<void> {
  for (const instance of [...instances].reverse()) {
    if (isOnModuleDestroy(instance)) {
      await instance.onModuleDestroy();
    }
  }

  for (const instance of [...instances].reverse()) {
    if (isOnApplicationShutdown(instance)) {
      await instance.onApplicationShutdown(signal);
    }
  }
}
```

context-only shell에도 같은 보장이 적용됩니다. `path:packages/runtime/src/bootstrap.test.ts:612-628`은 context shutdown failure가 `context.close()`를 통해 그대로 surface됨을 보여 줍니다.

결과 cleanup flow는 다음과 같습니다.

```text
close()
  -> if successfully closed, return
  -> if close is in progress, await the existing promise
  -> synchronously close the terminal operation gate
  -> close connected microservices
  -> run every incomplete teardown phase in order
  -> record each successful phase
  -> set public state to closed only after complete success
  -> on failure, keep the gate closed and allow an explicit cleanup retry
```

Bootstrap-failure cleanup은 별도의 rollback path로 유지됩니다. 가능한 cleanup callback과 lifecycle hook을 실행하고 container disposal을 시도하며, cleanup error를 로그로 남긴 뒤 원래 bootstrap error를 보존합니다. Bootstrap을 완료하지 못한 shell에는 normal close retry state를 재사용하지 않습니다.

## 9.5 The platform shell and adapter seams define what the runtime may assume about the host
이제 runtime bootstrap 안의 두 가지 다른 contract를 분리해서 볼 수 있습니다. 하나는 platform shell이고, 다른 하나는 HTTP adapter입니다. 둘은 상호작용하지만, 답하는 질문이 다릅니다.

platform-shell contract는 `path:packages/runtime/src/platform-contract.ts:151-160`에 정의되어 있습니다. `PlatformShell`은 `start()`, `stop()`, `ready()`, `health()`, `snapshot()`을 구현해야 합니다. 역할은 request adapter보다 더 넓은 인프라 component를 하나의 단위로 조율하는 것입니다.

contract 자체는 HTTP request 처리를 말하지 않습니다. start, stop, readiness, health, snapshot이라는 host component coordination surface만 정의합니다.

`path:packages/runtime/src/platform-contract.ts:151-160`
```typescript
/**
 * High-level runtime facade that coordinates platform components as one unit.
 */
export interface PlatformShell {
  start(): Promise<void>;
  stop(): Promise<void>;
  ready(): Promise<PlatformReadinessReport>;
  health(): Promise<PlatformHealthReport>;
  snapshot(): Promise<PlatformShellSnapshot>;
}
```

구현체는 `path:packages/runtime/src/platform-shell.ts:137-465`의 `RuntimePlatformShell`입니다. 이 클래스는 component registration을 정규화하고, dependency identity를 검증하고, dependency order로 정렬하고, 그 순서대로 시작하고, 역순으로 정지하며, readiness와 health report를 집계합니다.

startup branch는 dependency validation과 ordering을 먼저 고정한 뒤 component를 순서대로 시작합니다. start 실패 시에는 이미 시작한 component를 rollback하려고 시도합니다.

`path:packages/runtime/src/platform-shell.ts:160-207`
```typescript
  async start(): Promise<void> {
    if (!this.hasRegisteredComponents() || this.started) {
      return;
    }

    if (this.rollbackPendingComponents.length > 0) {
      await this.stop();
    }

    this.validateIdentityAndDependencies();

    const validationFailures = await this.validateComponents();
    if (validationFailures.length > 0) {
      throw new InvariantError(
        `Platform shell validation failed: ${validationFailures.map((issue) => `${issue.componentId}:${issue.code}`).join(', ')}`,
      );
    }
```

이 발췌는 platform shell start가 validation과 dependency ordering을 통과한 뒤에만 진행된다는 점을 보여 줍니다. 이어지는 branch는 실제 ordered start loop와 rollback 처리를 좁혀 보여 줍니다.

`path:packages/runtime/src/platform-shell.ts:178-207`
```typescript
    this.orderedComponents = this.orderByDependency();
    const startedComponents: RegisteredPlatformComponent[] = [];

    for (const component of this.orderedComponents) {
      try {
        await component.component.start();
        startedComponents.push(component);
      } catch (error) {
        this.diagnostics.push(createUnknownFailureIssue(component.component.id, 'start', error));
        const startFailure = new InvariantError(
          `Platform component "${component.component.id}" failed to start: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );

        try {
          await this.stopStartedComponents(startedComponents);
          this.rollbackPendingComponents = [];
        } catch (rollbackError) {
          this.rollbackPendingComponents = [...startedComponents];
          this.diagnostics.push(createUnknownFailureIssue(component.component.id, 'start-rollback', rollbackError));
        }

        throw startFailure;
      }
    }

    this.started = true;
    this.stopped = false;
    this.rollbackPendingComponents = [];
  }
```

stop branch는 시작 순서의 반대로 component를 정리합니다. 이 부분이 HTTP adapter close와 다른 이유는 platform shell이 request adapter 하나가 아니라 여러 host component의 dependency order를 관리하기 때문입니다.

`path:packages/runtime/src/platform-shell.ts:209-226`
```typescript
  async stop(): Promise<void> {
    const hasRollbackPending = this.rollbackPendingComponents.length > 0;

    if ((!this.started && !hasRollbackPending) || this.stopped) {
      return;
    }

    const toStop = hasRollbackPending
      ? [...this.rollbackPendingComponents]
      : this.orderedComponents.length > 0
      ? [...this.orderedComponents]
      : [...this.registeredComponents];

    await this.stopStartedComponents(toStop);
    this.rollbackPendingComponents = [];
    this.started = false;
    this.stopped = true;
  }
```

readiness branch는 application `ready()`가 호출하는 대상입니다. component report를 모아 aggregate readiness로 반환하고, critical not-ready 상태는 `assertCriticalReadiness()`에서 invariant error가 됩니다.

`path:packages/runtime/src/platform-shell.ts:228-253`
```typescript
  async ready(): Promise<PlatformReadinessReport> {
    if (!this.hasRegisteredComponents()) {
      return {
        critical: false,
        status: 'ready',
      };
    }

    const reports: PlatformReadinessReport[] = [];

    for (const component of this.registeredComponents) {
      try {
        reports.push(await component.component.ready());
      } catch (error) {
        const issue = createUnknownFailureIssue(component.component.id, 'ready', error);
        this.diagnostics.push(issue);
        reports.push({
          critical: true,
          reason: issue.cause,
          status: 'not-ready',
        });
      }
    }

    return aggregateReadiness(reports);
  }
```

`path:packages/runtime/src/platform-shell.ts:331-339`
```typescript
  async assertCriticalReadiness(): Promise<void> {
    const readiness = await this.ready();

    if (readiness.status === 'not-ready') {
      throw new InvariantError(
        `Runtime platform shell is not ready: ${readiness.reason ?? 'critical platform component is unavailable.'}`,
      );
    }
  }
```

`path:packages/runtime/src/platform-shell.test.ts:94-219`의 테스트가 핵심 동작을 보여 줍니다. dependency order가 start에 반영되고, reverse order가 stop에 반영되며, unknown dependency id는 거부되고, aggregate snapshot은 readiness, health, component dependency, diagnostics를 함께 묶습니다.

이 platform shell은 `runBootstrapLifecycle()` 동안 시작되고, `FluoApplication.ready()`가 `listen()` 전에 다시 검사합니다. 즉 platform shell은 runtime의 host-readiness governor입니다.

adapter contract는 더 좁습니다. HTTP adapter는 request/response dispatch와 listen/close semantics에 집중하고, platform shell은 host component의 readiness와 health를 집계합니다. 이 분리 덕분에 runtime은 호스트별 세부 사항을 한 계층에 밀어 넣지 않고, application shell이 무엇을 가정해도 되는지 명확히 제한합니다.
