# 4장. 부트스트랩과 플랫폼 어댑터

> **기준 소스**: [repo:docs/getting-started/quick-start.md] [repo:docs/concepts/architecture-overview.md] [pkg:runtime/README.md]
> **주요 구현 앵커**: [ex:minimal/src/main.ts] [ex:minimal/src/app.ts]

이 장에서는 Konekti 앱이 실제로 어디서 시작되는지 살펴본다. JavaScript 중급자에게 가장 먼저 보여줘야 할 것은 “프레임워크가 뭔가를 알아서 시작한다”가 아니라, **부트스트랩은 명시적으로 일어난다**는 사실이다.

## 부트스트랩을 얕게 보면 생기는 오해

`main.ts`가 짧기 때문에 초심자는 종종 부트스트랩을 단순 진입점 정도로 생각한다. 하지만 runtime 소스를 보면 부트스트랩은 생각보다 많은 책임을 가진다. module graph를 컴파일하고, runtime provider를 수집하고, container를 만들고, dispatcher와 handler mapping을 조립하고, lifecycle hook과 cleanup 경로까지 준비한다 `[pkg:runtime/src/bootstrap.ts]`.

즉, `main.ts`는 짧지만, 그 뒤에는 굉장히 두꺼운 orchestration layer가 있다.

## 시작점은 `main.ts`다

minimal 예제의 시작점은 매우 짧다 `[ex:minimal/src/main.ts]`.

```ts
// source: ex:minimal/src/main.ts
import { createFastifyAdapter } from '@konekti/platform-fastify';
import { KonektiFactory } from '@konekti/runtime';

import { AppModule } from './app';

const app = await KonektiFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});
await app.listen();
```

이 코드는 짧지만 세 가지 중요한 선언을 담고 있다.

1. 루트 모듈은 `AppModule`이다.
2. 실행 환경은 `Fastify adapter`다.
3. 둘을 조합하는 책임은 `KonektiFactory`에 있다.

## 왜 어댑터를 직접 넘기는가

Konekti는 플랫폼 의존성을 숨기지 않고 **어댑터 인수로 드러낸다** `[repo:docs/concepts/architecture-overview.md]`. 이는 “이 앱은 지금 어떤 런타임 위에 올라가는가?”를 부트스트랩 코드만 보고도 알 수 있게 한다.

이 방식의 장점은 단순하다.

- 애플리케이션 로직이 Fastify 전용 코드와 덜 섞인다.
- 나중에 Bun, Deno, Workers 같은 다른 런타임으로 옮길 때 경계가 명확하다.
- runtime layer와 platform layer의 책임 분리가 분명하다.

## `AppModule`은 실행 코드가 아니라 구조 선언이다

`examples/minimal/src/app.ts`를 보면 `AppModule`은 imports, controllers, providers를 선언한다 `[ex:minimal/src/app.ts]`.

```ts
// source: ex:minimal/src/app.ts
@Module({
  imports: [RuntimeHealthModule],
  controllers: [HelloController],
  providers: [HelloService],
})
export class AppModule {}
```

여기에는 서버를 띄우는 코드가 없다. 대신 “이 앱은 어떤 구성요소로 이루어져 있는가?”만 적혀 있다. 이 차이가 중요하다. Konekti에서 **구조 선언**과 **실행 시작**은 서로 다른 층의 책임이다.

## 부트스트랩을 읽는 올바른 순서

Konekti 앱을 처음 읽을 때는 보통 다음 순서가 가장 좋다.

1. `main.ts`에서 어떤 adapter를 쓰는지 본다 `[ex:minimal/src/main.ts]`.
2. `AppModule`에서 앱의 조립 구조를 본다 `[ex:minimal/src/app.ts]`.
3. 그 다음에 controller와 service로 내려간다.

이 순서를 따르면 “이 코드가 어느 런타임에서 어떤 구성으로 실행되는지”가 먼저 잡히고, 그 다음에 개별 기능 코드가 이해된다.

## runtime 내부에서는 실제로 무슨 일이 일어나는가

`packages/runtime/src/bootstrap.ts`를 보면 bootstrap은 단순한 `create()` 함수 한 번으로 끝나지 않는다 `[pkg:runtime/src/bootstrap.ts]`. 이 파일에는 provider scope 판별, duplicate provider 처리, lifecycle hook 실행, cleanup 경로, exception filter 실행, request dispatcher 조립 등 애플리케이션 전체 생명주기를 묶는 로직이 들어 있다.

```ts
// source: pkg:runtime/src/bootstrap.ts
function providerScope(provider: Provider): 'singleton' | 'request' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useValue' in provider) {
    return 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  if ('useFactory' in provider) {
    return provider.scope ?? (provider.resolverClass ? getClassDiMetadata(provider.resolverClass)?.scope : undefined) ?? 'singleton';
  }

  return 'singleton';
}
```

이 함수 하나만 봐도 bootstrap이 단순 진입점이 아니라는 사실이 드러난다. runtime은 provider를 단순 등록하는 것이 아니라, **각 provider가 어떤 수명 규칙을 가져야 하는지**까지 bootstrap 단계에서 이해한다 `[pkg:runtime/src/bootstrap.ts#L65-L83]`.

특히 초반부만 봐도 다음 구조가 드러난다.

- `providerScope(...)`는 provider가 singleton/request/transient 중 무엇인지 판별한다 `[pkg:runtime/src/bootstrap.ts#L65-L83]`
- `closeRuntimeResources(...)`는 adapter shutdown과 container dispose를 한 경로로 정리한다 `[pkg:runtime/src/bootstrap.ts#L119-L153]`
- `collectProvidersForContainer(...)`는 runtime provider와 module provider를 하나의 등록 집합으로 다룬다 `[pkg:runtime/src/bootstrap.ts#L262-L280]`

즉, bootstrap은 단순 생성이 아니라 **애플리케이션 운영 규칙의 총괄자**다.

## module graph는 왜 bootstrap의 일부인가

runtime은 `compileModuleGraph(...)`를 호출해 root module에서 시작한 구조를 실제 실행 가능한 graph로 바꾼다 `[pkg:runtime/src/bootstrap.ts]` `[pkg:runtime/src/module-graph.ts]`. 이 점이 중요하다. module graph는 문서적 개념이 아니라, bootstrap 시점에 실제로 검증되고 컴파일되는 입력 데이터다.

```ts
// source: pkg:runtime/src/bootstrap.ts
function collectProvidersForContainer(
  modules: CompiledModule[],
  runtimeProviders: Provider[] | undefined,
  policy: DuplicateProviderPolicy,
  logger?: ApplicationLogger,
): Provider[] {
  const selectedProviders = new Map<Token, SelectedProviderEntry>();

  for (const runtimeProvider of runtimeProviders ?? []) {
    const token = providerToken(runtimeProvider);
    selectedProviders.set(token, {
      moduleName: '<runtime>',
      provider: runtimeProvider,
      source: 'runtime',
      token,
    });
  }
```

이 코드는 runtime bootstrap이 module-defined provider와 runtime-defined provider를 하나의 등록 표면으로 모은다는 사실을 보여 준다 `[pkg:runtime/src/bootstrap.ts#L262-L279]`. 즉, bootstrap은 단순 module traversal이 아니라 **실행에 필요한 모든 provider surface를 통합하는 조립 과정**이다.

그래서 부트스트랩 장은 결코 “hello world를 띄우는 법”에서 멈추면 안 된다. 이 장은 독자에게 다음 사실을 심어줘야 한다.

> 부트스트랩은 앱을 실행하는 순간이 아니라, 앱의 구조가 **실행 가능한 계약**으로 검증되는 순간이다.

## adapter 계약을 보는 눈

platform adapter는 그저 “Fastify를 감싸는 객체”가 아니다. adapter는 runtime이 기대하는 HTTP application contract를 구현하는 쪽이다 `[pkg:runtime/src/bootstrap.ts]`. 이 구조 덕분에 Node/Fastify 위에서 잘 돌아가는 앱이, 어댑터만 바꾸면 다른 환경에서도 같은 application logic을 유지할 수 있다 `[repo:README.md]`.

책에서는 여기서 단순히 “런타임 포팅이 가능하다”로 끝내면 안 된다. 오히려 다음과 같이 설명해야 한다.

- adapter는 transport/runtime 세부사항을 흡수한다.
- runtime은 module graph와 dispatcher를 조립한다.
- app code는 provider와 controller 수준에 머문다.

이 삼각형이 유지될 때만 portability가 현실이 된다.

## `HelloController`와 `HelloService`가 보여 주는 최소 실행 단위

minimal 예제는 작은 만큼 중요하다. `hello.controller.ts`와 `hello.service.ts`를 함께 보면, Konekti가 요구하는 최소 feature shape가 보인다 `[ex:minimal/src/hello.controller.ts]` `[ex:minimal/src/hello.service.ts]`.

```ts
// source: ex:minimal/src/hello.controller.ts
@Inject(HelloService)
@Controller('/hello')
export class HelloController {
  constructor(private readonly helloService: HelloService) {}

  @Get('/')
  greet(): { message: string } {
    return this.helloService.greet('World');
  }
}
```

```ts
// source: ex:minimal/src/hello.service.ts
export class HelloService {
  greet(name: string): { message: string } {
    return { message: `Hello, ${name}!` };
  }
}
```

이 두 파일이 중요한 이유는, Konekti의 많은 고급 논의가 결국 이 정도 단순한 구조에서 시작되기 때문이다. controller는 service를 주입받고, service는 plain class로 동작한다. 즉, 복잡한 runtime/DI/HTTP 논의도 결국은 **이 최소 조립 단위가 커져 가는 과정**으로 이해할 수 있다.

## platform shell은 bootstrap 뒤편의 운영 엔진이다

`packages/runtime/src/platform-shell.ts`를 보면 runtime이 단순히 adapter를 받아 서버를 띄우는 데서 멈추지 않는다는 점이 드러난다 `[pkg:runtime/src/platform-shell.ts]`. platform shell은 component readiness, health aggregation, start/stop ordering, rollback, diagnostic issue 누적을 담당한다.

```ts
// source: pkg:runtime/src/platform-shell.ts
function aggregateReadiness(reports: PlatformReadinessReport[]): PlatformReadinessReport {
  const hasCriticalNotReady = reports.some((report) => report.critical && report.status === 'not-ready');
  const hasNotReady = reports.some((report) => report.status === 'not-ready');
  const hasDegraded = reports.some((report) => report.status === 'degraded');
  const hasCritical = reports.some((report) => report.critical);

  if (hasCriticalNotReady) {
    const reason = reports.find((report) => report.critical && report.status === 'not-ready')?.reason;
    return {
      critical: hasCritical,
      reason: reason ?? 'One or more critical platform components are not ready.',
      status: 'not-ready',
    };
  }
```

이 코드는 readiness를 단순 boolean으로 다루지 않는다는 점을 보여 준다 `[pkg:runtime/src/platform-shell.ts#L54-L82]`. Konekti는 component별 report를 모아 `ready`, `degraded`, `not-ready` 같은 더 풍부한 상태를 계산한다. 즉, bootstrap 뒤편의 운영 엔진도 꽤 정교하다.

## start/stop도 bootstrap contract의 일부다

`RuntimePlatformShell.start()`를 보면 platform component lifecycle이 얼마나 조심스럽게 다뤄지는지 알 수 있다 `[pkg:runtime/src/platform-shell.ts#L150-L197]`. started component 목록을 별도로 추적하고, 중간 실패가 나면 rollback 경로까지 준비한다.

이 구조가 중요한 이유는, bootstrap이 단순 “시작 성공/실패”가 아니라는 점을 보여 주기 때문이다.

- 일부 component가 시작된 상태에서 다음 component가 실패할 수 있다.
- readiness와 health는 component 집계 결과일 수 있다.
- shutdown 역시 reverse ordering과 rollback을 고려해야 할 수 있다.

즉, Konekti runtime은 작은 hello-world 예제 뒤에서 이미 **운영 가능한 수명주기 엔진**을 갖고 있다.

## Application 타입을 읽으면 bootstrap의 범위가 더 넓어 보인다

`packages/runtime/src/types.ts`의 `Application` 인터페이스도 이 장에서 꼭 봐야 한다 `[pkg:runtime/src/types.ts#L167-L183]`.

```ts
// source: pkg:runtime/src/types.ts
export interface Application {
  readonly bootstrapTiming?: BootstrapTimingDiagnostics;
  readonly container: Container;
  readonly modules: CompiledModule[];
  readonly rootModule: ModuleType;
  readonly state: ApplicationState;
  readonly dispatcher: Dispatcher;

  close(signal?: string): Promise<void>;
  connectMicroservice(options?: CreateMicroserviceOptions): Promise<MicroserviceApplication>;
  dispatch: Dispatcher['dispatch'];
  get<T>(token: Token<T>): Promise<T>;
  startAllMicroservices(): Promise<void>;
  listen(): Promise<void>;
  ready(): Promise<void>;
}
```

이 인터페이스를 보면 bootstrap 결과가 단순 서버 인스턴스가 아니라는 점이 분명해진다. container, compiled modules, dispatcher, lifecycle control, microservice 연결까지 모두 application shell 안에 들어 있다 `[pkg:runtime/src/types.ts#L167-L183]`. 즉, bootstrap은 “서버 열기”가 아니라 **애플리케이션 능력 집합을 구성하는 과정**이다.

## 부트스트랩 장을 더 두껍게 써야 하는 이유

독자는 종종 core/DI/HTTP 장이 중요하고 bootstrap 장은 비교적 얇아도 된다고 생각한다. 하지만 실제로는 반대다. bootstrap 장이 약하면, 뒤의 모든 장이 서로 어떻게 붙는지 설명하기 어려워진다. root module, adapter, dispatcher, container, lifecycle shell이 어디서 만나느냐를 이 장이 잡아줘야 하기 때문이다.

즉, 4장은 책의 입구이면서 동시에, **나중 장들의 접합부를 미리 보여 주는 허브 장**이어야 한다.

## lifecycle 타입이 왜 중요한가

`packages/runtime/src/types.ts`를 보면 runtime은 단순 실행 함수 몇 개가 아니라, lifecycle hook과 application shell 타입을 명시적으로 가진다 `[pkg:runtime/src/types.ts]`.

- `OnModuleInit` / `OnApplicationBootstrap`
- `OnModuleDestroy` / `OnApplicationShutdown`
- `ApplicationContext` / `Application`

이 타입들이 중요한 이유는, 부트스트랩을 단순 “서버 시작”이 아니라 **수명주기를 가진 애플리케이션 계약**으로 격상시키기 때문이다. 책에서 bootstrap 장이 두꺼워져야 하는 이유도 여기에 있다. 이 장은 단순 진입점 소개가 아니라, 앱이 살아나고 준비되고 종료되는 전체 생애의 입구이기 때문이다.

## 이 장을 다 읽고 나면 보여야 하는 것

독자가 이 장을 다 읽고 나면 최소한 다음 그림이 머릿속에 있어야 한다.

- `main.ts`는 root module과 adapter를 넘긴다.
- runtime bootstrap은 module graph를 컴파일하고 provider를 모은다.
- platform shell은 lifecycle과 readiness/health 상태를 관리한다.
- 실제 feature는 그 위에 controller/service/module 형태로 올라간다.

즉, bootstrap은 “앱 시작 코드”가 아니라 **앱 전체 계약이 처음 현실이 되는 순간**이다. 이 인식이 있으면, 뒤의 config/observability/testing 장도 모두 bootstrap의 자연스러운 연장선으로 읽힌다.

## 메인테이너 시각

메인테이너는 부트스트랩을 “처음 실행하는 코드”가 아니라 **시스템의 중심 접합부**로 본다. bootstrap에서 어설픈 변경이 생기면, lifecycle, DI, HTTP dispatch, health/readiness, cleanup가 한꺼번에 흔들릴 수 있기 때문이다 `[pkg:runtime/src/bootstrap.ts]`.

## 이 장의 핵심

Konekti 부트스트랩은 짧지만 숨겨져 있지 않다. 어댑터를 직접 넘기고, 루트 모듈을 직접 지정하고, factory를 통해 앱을 만든다. 이 구조가 이후 core, di, runtime, http를 모두 연결하는 첫 번째 관문이다.

한 문장으로 요약하면, **부트스트랩은 진입점이 아니라 구조·실행·운영을 묶는 관문**이다.
