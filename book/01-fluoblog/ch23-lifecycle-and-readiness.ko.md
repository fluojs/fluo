# 시작하고 종료하는 순간까지 설계하기

<!-- book:volume=01-fluoblog;chapter=23 -->

[이전: 느린 요청과 실패를 설명할 수 있게 하기](./ch22-observability.ko.md) · [1권 목차](./toc.ko.md) · [다음: 첫 출시와 첫 운영 회고](./ch24-first-release.ko.md)

새 버전을 배포한 직후 몇 초 동안 글 저장이 실패했다. 프로세스는 실행 중이었고 포트도 열려 있었다. 잠시 뒤에는 정상으로 돌아왔다. 다음 배포에서는 반대 사건이 생겼다. 종료 신호를 받은 인스턴스가 아직 요청을 처리하는데 DB 연결 정리가 시작됐다. 정상 상태의 단위 테스트만으로는 두 사건을 설명하기 어렵다.

FluoBlog의 수명은 “서버 실행 중”이라는 한 상태로 끝나지 않는다. 모듈 그래프를 만들고, 연결을 준비하고, 트래픽을 받기 시작하며, 새 작업을 차단하고, 이미 받은 작업을 정리하고, 자원을 닫는다. 어느 단계에서 무엇을 약속하는지 정하지 않으면 운영자는 프로세스가 살아 있다는 이유로 준비되지 않은 인스턴스에 트래픽을 보낸다.

이 장에서는 Fastify가 listener를 소유하는 Node.js 24 프로세스를 기준으로 한다. 예약 발행과 DB 트랜잭션은 앞 장의 같은 애플리케이션에 남아 있다. 새로운 운영 전용 서비스로 분리하지 않는다. 외부 배포 시스템을 실제로 변경하지 않고, 애플리케이션이 제공해야 할 준비 상태와 종료 경계를 구현한다.

## 살아 있음, 진단, 준비 상태는 다른 질문이다

프로세스가 이벤트 루프를 실행할 수 있다는 사실은 게시글을 안전하게 저장할 수 있다는 뜻이 아니다. DB가 끊겼거나 필수 스키마와 코드가 맞지 않아도 HTTP 응답은 만들 수 있다. 반대로 구독 메일 공급자가 일시적으로 느려도 이미 발행된 글을 읽는 기능은 제공할 수 있다. 의존성 하나의 장애를 모든 트래픽 중단으로 연결할지 제품의 기능별로 판단해야 한다.

`@fluojs/terminus`의 `/health`는 진단 집계다. indicator나 플랫폼 진단이 나쁘면 원인을 포함한 보고서와 503을 반환한다. `/ready`는 트래픽 수용 여부다. 200이면 수용하고 503이면 rotation에서 제외한다. 본문의 상태는 `ready`, `starting`, `unavailable` 중 하나지만, 배포 계층의 수용 결정은 이진적이다. “조금 준비됐으니 조금만 트래픽을 보내라”라는 별도 severity 응답이 아니다.

Terminus는 프로세스 생존만 확인하는 `/live`를 기본으로 생성하지 않는다. DB를 포함한 `/health`를 그대로 프로세스 재시작 조건으로 쓰면 공통 DB 장애 때 모든 앱을 재시작하는 악순환이 생길 수 있다. 좁은 생존 검사가 필요한 배포 환경은 별도의 애플리케이션 또는 호스트 경계를 정의해야 한다. 이 장에서 만드는 두 endpoint를 세 종류의 probe로 오해하지 않는다.

기본적으로 indicator는 health와 readiness에 모두 참여한다. `readiness: false`는 진단은 남기되 그 indicator 하나 때문에 트래픽을 차단하지 않겠다는 뜻이다. 예를 들어 독립된 외부 검색이 없어도 기본 글 목록으로 기능을 축소할 수 있다면 검토할 수 있다. 그러나 캐시와 구독 큐가 같은 Redis를 사용하고 실제 요청이 큐 기록 성공에 의존한다면 “캐시는 선택 사항”이라는 이름만 보고 제외해서는 안 된다. 장애 시 동작이 구현돼 있을 때만 선택적 의존성으로 분류한다.

## 모듈을 import한 위치가 준비 상태를 바꾼다

Terminus가 DB 연결을 찾지 못하면 올바른 SQL probe도 실행할 수 없다. 일반적인 비전역 형제 모듈은 서로의 provider를 볼 수 없어 Terminus의 `imports`에 의존성을 명시해야 한다. 하지만 이 책의 10장 등록은 의도적으로 전역이다. 루트가 `src/database/blog-database.module.ts`의 `BlogDatabaseModule`을 한 번 import하고, 그 모듈의 `PrismaModule.forRootAsync`가 `global: true`, `inject: [AppSettings]`로 컨테이너별 클라이언트를 소유한다. Terminus도 이 전역 `PrismaService`를 주입받는다.

다음은 `src/operations/operations.module.ts`의 **완전한 파일**이다. `serviceToken: PrismaService`로 기존 lifecycle-aware 서비스만 해석한다. 새 DB 모듈이나 module-scope `client`를 만들지 않는다. `TrafficModule`은 비전역이므로 Terminus의 imports에도 명시한다. 22장의 `operationsConfig`는 운영 토큰의 검증된 스냅샷이다.

```typescript
import { Module } from '@fluojs/core';
import {
  ForbiddenException, type MiddlewareContext, type Next,
} from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import {
  createPrismaHealthIndicatorProvider,
  TerminusModule,
} from '@fluojs/terminus';
import { operationsConfig } from '../config/operations-config.js';
import { TrafficModule, TrafficIndicator } from './traffic.js';

export function createOperationsModule(healthToken: string | false) {
  if (healthToken !== false && healthToken.trim().length === 0) {
    throw new Error('A non-empty health token is required.');
  }
  class OperationsAccessMiddleware {
    async handle(context: MiddlewareContext, next: Next): Promise<void> {
      if (context.request.headers['x-health-token'] !== healthToken) {
        throw new ForbiddenException('Operations access denied.');
      }
      await next();
    }
  }

  @Module({
    imports: [
      TrafficModule,
      TerminusModule.forRoot({
        path: '/internal',
        imports: [TrafficModule],
        endpointMiddleware: healthToken === false ? [] : [OperationsAccessMiddleware],
        indicatorProviders: [
          createPrismaHealthIndicatorProvider({
            key: 'posts-database',
            serviceToken: PrismaService,
          }),
          TrafficIndicator,
        ],
        execution: { indicatorTimeoutMs: 1_500 },
      }),
    ],
  })
  class OperationsRegistration {}

  return OperationsRegistration;
}

export const OperationsModule = createOperationsModule(
  operationsConfig.HEALTH_TOKEN ?? false,
);
```

이 예제의 `TrafficIndicator`는 뒤에서 구현한다. 기존 `src/app.ts`는 AccountsModule과 PostsModule을 유지하고 OperationsModule을 import한다. 시작 코드에서 TrafficGate를 해석할 수 있도록 루트 앱은 TrafficModule도 직접 import한다. 같은 모듈 클래스를 재사용하는 것이며 서로 다른 gate를 두 개 생성하지 않는다.

`PrismaService` 기반 indicator는 실제 probe 전에 연결의 수명주기 상태를 확인하고 `current()`를 통해 활성 클라이언트를 사용한다. 종료 중인데 raw client가 아직 SQL을 받을 수 있다는 이유로 ready가 되지 않는다. 토큰이 그래프 전체에 없어서 부팅 후 down으로 보고되는 경우와, 다른 모듈에 있지만 가시성이 없어 bootstrap에서 `MODULE_VISIBILITY_ERROR`가 나는 경우도 다르다. 후자는 DB 장애가 아니라 조합 오류이므로 배포 전에 수정해야 한다.

위 경로는 우선 로컬 loopback listener에서 검증한다. `HEALTH_TOKEN`이 없으면 두 endpoint는 토큰 없이 열리므로 외부 배포에서는 내부 네트워크 정책이 필요하다. 토큰을 설정하면 class 기반 `endpointMiddleware`가 health와 readiness 모두에 적용되고, 요청에는 `x-health-token`이 필요하다. `METRICS_TOKEN`과 별개의 값이며 17장의 사용자 로그인 쿠키를 대신 쓰지 않는다. runtime 소유 route에 일반 컨트롤러의 `@UseGuards`를 붙여 보호한다고 가정해서도 안 된다.

## 시작 hook과 listener가 열리는 순서

Runtime은 모듈 그래프와 DI 컨테이너를 구성한 뒤 lifecycle 대상 인스턴스를 해석한다. 그다음 대상들의 `onModuleInit()`을 실행하고, 이어 `onApplicationBootstrap()`을 실행한다. 플랫폼 시작이 성공해야 readiness marker가 ready로 바뀐다. HTTP dispatcher와 listener는 이 준비 과정과 구분되는 경계다.

`bootstrapFastifyApplication`은 앱을 구성하지만 자동 signal 등록을 소유하지 않는다. `runFastifyApplication`은 listen을 완료하고 shutdown 등록을 설치한 뒤 실행 중인 앱을 반환한다. 따라서 후자를 사용한 뒤 다시 `app.listen()`을 호출할 필요는 없다. 반대로 저수준 factory를 썼다고 Node signal 처리가 자동으로 생긴다고 생각하지 않는다.

시작 실패도 부분적으로 성공한 실행이다. DB 연결은 열렸는데 나중의 초기화가 실패할 수 있다. Runtime은 이때 `bootstrap-failed`라는 signal 값으로 정리 hook을 실행하고 컨테이너 정리를 시도한다. 애플리케이션의 정리 코드는 “정상 시작을 끝낸 경우에만 호출된다”는 가정 없이 자신이 실제로 얻은 자원만 해제해야 한다. 초기화 실패를 catch해 빈 저장소로 서비스를 열어 버리는 것은 복구가 아니라 데이터 계약의 변경이다.

시작 hook에 대규모 데이터 마이그레이션을 넣는 것도 피한다. 인스턴스 두 대가 함께 시작하면 같은 변경을 경쟁할 수 있고, 수 분 걸리는 작업이 listener 준비 시간을 지배한다. 스키마 변경과 데이터 변환은 배포 절차의 별도 단계로 소유하고, 앱의 시작은 필요한 의존성을 사용할 수 있는지 확인하는 정도로 제한한다. 예약 발행의 밀린 작업은 시작 hook에서 무한히 모두 처리하지 않고 정상적인 작은 배치로 따라잡는다.

## readiness만 내려서는 진행 중 요청이 끝나지 않는다

readiness가 503으로 바뀌어도 로드밸런서가 즉시 모든 요청을 멈추지는 않는다. 이미 연결된 클라이언트와 전달 중인 요청이 남는다. 더욱 중요한 점은 Fluo의 종료 hook이 adapter close보다 먼저 실행된다는 사실이다. `onModuleDestroy`를 “HTTP 연결이 전부 닫힌 뒤 호출되는 곳”으로 사용하면 잘못된 순서를 만든다.

Runtime의 `Application.close()`는 시작 즉시 새 직접 dispatch와 해석 작업의 진입을 닫고 readiness를 낮춘다. 하지만 이미 수용한 dispatch를 그 gate가 취소하는 것은 아니다. listener를 통한 모든 요청이 저절로 원하는 업무 단위까지 drain된다는 보장으로 확대하지 않는다. 이 장에서는 앱 소유의 작은 트래픽 gate를 만들어 `app.close()` 전에 보통 HTTP 요청을 먼저 기다린다.

`src/operations/traffic.ts`는 **완전한 파일**이다. Gate는 DB나 외부 연결을 소유하지 않는다. 새 요청을 받을지와 몇 개가 middleware 경계를 실행 중인지 기록한다. 내부 진단 요청은 drain 대상에서 제외해 종료 대기 중에도 이유를 조회할 수 있게 한다.

```typescript
import { Inject, Module } from '@fluojs/core';
import {
  HttpException,
  type MiddlewareContext,
  type Next,
} from '@fluojs/http';
import type { HealthIndicator, HealthIndicatorResult } from '@fluojs/terminus';

export class TrafficGate {
  private accepting = true;
  private active = 0;
  private idle = Promise.withResolvers<void>();

  constructor() {
    this.idle.resolve();
  }

  isAccepting(): boolean {
    return this.accepting;
  }

  enter(): boolean {
    if (!this.accepting) return false;
    if (this.active === 0) this.idle = Promise.withResolvers<void>();
    this.active += 1;
    return true;
  }

  leave(): void {
    this.active -= 1;
    if (this.active === 0) this.idle.resolve();
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  waitForIdle(): Promise<void> {
    return this.idle.promise;
  }
}

@Inject(TrafficGate)
export class TrafficMiddleware {
  constructor(private readonly gate: TrafficGate) {}

  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    const path = context.request.path;
    if (
      path === '/internal/health'
      || path === '/internal/ready'
      || path === '/internal/metrics'
    ) {
      await next();
      return;
    }
    if (!this.gate.enter()) {
      throw new HttpException(503, 'The instance is draining.', {
        code: 'SERVICE_UNAVAILABLE',
      });
    }
    try {
      await next();
    } finally {
      this.gate.leave();
    }
  }
}

@Inject(TrafficGate)
export class TrafficIndicator implements HealthIndicator {
  readonly key = 'traffic-admission';

  constructor(private readonly gate: TrafficGate) {}

  async check(key: string): Promise<HealthIndicatorResult> {
    return {
      [key]: {
        status: this.gate.isAccepting() ? 'up' : 'down',
      },
    };
  }
}

@Module({
  providers: [TrafficGate, TrafficMiddleware],
  exports: [TrafficGate, TrafficMiddleware],
})
export class TrafficModule {}
```

`TrafficIndicator`는 TrafficModule의 일반 provider 목록에 중복 등록하지 않는다. Terminus의 `indicatorProviders`가 소유하고, 필요한 gate만 TrafficModule의 export에서 가져온다. interface 이름만으로 주입하는 것이 아니라 `@Inject(TrafficGate)`가 실제 class token을 지정한다.

Gate의 종료 결정은 되돌리지 않는다. drain 중 요청 하나가 실패했다고 다시 accepting으로 바꾸면 이미 시작한 자원 정리와 새 작업이 충돌할 수 있다. `leave`는 middleware의 `finally`에서 진입 성공마다 정확히 한 번 호출한다. 앱 개발자가 임의로 여러 번 호출하는 공개 카운터처럼 쓰지 않는다. 요청 수가 0이 되는 사건을 Promise로 전달하므로 일정 시간마다 숫자를 읽는 polling도 필요 없다.

이 gate가 기다리는 대상은 `next()`의 완료다. 응답 바이트가 독자에게 모두 전달된 시점은 아니며, handler가 분리해서 실행한 작업도 포함하지 않는다. 큐와 Cron, 스트리밍 세션의 수명은 각 소유 모듈의 계약으로 정리해야 한다. 게시글 저장이 끝나기 전에 응답하고 DB 작업을 분리해 버리면 이 gate만으로 안전해지지 않는다. 핵심 변경은 응답 전에 끝내고 장기 작업은 영속 입력을 가진 작업 경계로 넘긴다는 이전 장의 원칙을 유지한다.

## 종료를 소유하는 진입점

먼저 **`src/app.ts`의 추가 조각**을 적용한다. 기존 imports와 OpenAPI sources는 유지하며 다음 두 항목만 추가한다. root의 BlogDatabaseModule은 그대로 한 번 등록되어 있고, 22장의 ObservabilityModule·SubscriptionsModule도 같은 identity를 재사용한다.

```diff
+import { OperationsModule } from './operations/operations.module.js';
+import { TrafficModule } from './operations/traffic.js';
@@ imports
+    OperationsModule, TrafficModule,
```

다음은 기존 `src/app.ts`, 22장의 `blogAccessObserver`, 위 TrafficModule을 사용하는 **`src/main.ts` 교체 파일**이다. AppModule에는 아래 조립 변경을 적용하며 계정·인증·네이티브 폼·업로드·구독·캐시·예약 모듈을 모두 남긴다. 포트는 9장의 `AppSettings.port`와 같은 `blogConfig.PORT`를 사용하고 loopback host를 유지한다. `PUBLIC_ORIGIN`, DB와 인증 설정도 기존 AppSettingsModule의 검증 경로에 남는다. 18장의 6 MiB 본문·총 multipart, 5 MiB 파일 한도와 파일 1개 제한을 명시적으로 보존한다.

```typescript
import { ensureMetadataSymbol } from '@fluojs/core';
import { createCorrelationMiddleware } from '@fluojs/http';
import { runFastifyApplication } from '@fluojs/platform-fastify';

ensureMetadataSymbol();
const { AppModule } = await import('./app.js');
const { blogConfig } = await import('./config/app-settings.module.js');
const { blogAccessObserver } = await import('./observability/access-log.js');
const { TrafficGate, TrafficMiddleware } = await import('./operations/traffic.js');

const app = await runFastifyApplication(AppModule, {
  host: '127.0.0.1',
  port: blogConfig.PORT,
  maxBodySize: 6 * 1024 * 1024,
  multipart: {
    maxFileSize: 5 * 1024 * 1024,
    maxFiles: 1,
    maxTotalSize: 6 * 1024 * 1024,
  },
  shutdownSignals: false,
  shutdownTimeoutMs: 5_000,
  middleware: [createCorrelationMiddleware(), TrafficMiddleware],
  observers: [blogAccessObserver],
});
const gate = await app.get(TrafficGate);
let closing: Promise<void> | undefined;

function close(signal: string): Promise<void> {
  if (closing) return closing;
  gate.stopAccepting();
  closing = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        gate.waitForIdle(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('HTTP work drain exceeded 10000ms.')),
            10_000,
          );
        }),
      ]);
    } catch (error: unknown) {
      process.exitCode = 1;
      console.error('HTTP drain failed.', error);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    await app.close(signal);
  })();
  return closing;
}

function onSignal(signal: string): void {
  void close(signal).catch((error: unknown) => {
    process.exitCode = 1;
    console.error('Application shutdown failed.', error);
  });
}

process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));
```

`shutdownSignals: false`가 없으면 helper의 기본 종료 경로와 이 파일의 사전 drain 경로가 함께 작동할 수 있다. 종료 소유자를 하나로 정하기 위해 기본 signal 등록을 끈다. 이 예제는 준비가 끝난 뒤 signal handler를 등록하므로 시작 도중의 프로세스 종료까지 하나의 완성된 배포 supervisor로 관리하지는 않는다. 시작 실패는 runtime cleanup이, 프로세스 전체의 강제 종료 상한은 배포 호스트가 소유한다.

`closing`은 두 signal이 연달아 와도 같은 작업을 관찰하게 한다. gate를 닫는 동작은 첫 await보다 먼저 일어나므로 다음 요청이 작업 수를 늘릴 수 없다. 10초를 넘기면 실패를 기록하고 자원 정리로 진행한다. 이때 진행 중 SQL·업로드·메일 작업을 취소하거나 롤백했다는 보장은 없다. 이미 커밋됐지만 응답이 유실된 변경도 있을 수 있고, 정리와 남은 작업이 겹쳐 실패할 수도 있다. 예산을 넘긴 종료를 정상 drain이나 안전한 강제 정리로 기록하지 않기 위해 exit code도 실패로 남긴다.

Fastify의 `shutdownTimeoutMs`는 adapter close를 기다리는 상한이다. 0을 설정하면 close 자체는 즉시 시작하지만, 기저 cleanup을 취소하거나 즉시 프로세스를 죽이는 값은 아니다. 마찬가지로 기본 Node signal helper의 `forceExitTimeoutMs`도 이름만 보고 `process.exit()`를 강제 실행한다고 추측해서는 안 된다. timeout 시 실패를 기록하고 exit code를 설정하는 경계다. 위 코드는 custom signal 경로이므로 그 helper timeout에 기대지 않는다.

전체 종료 예산은 단순히 가장 큰 timeout 하나가 아니다. 이 예제에서는 HTTP 작업 대기, Cron·Queue·Email drain, DB와 기타 hook, Fastify close가 순서와 일부 중첩에 따라 시간을 사용한다. 배포 호스트의 유예 시간을 정할 때 관찰한 전체 시간을 기준으로 여유를 둔다. 특히 멈춘 custom hook이 있는 경우 앱 수준 코드만으로 강제 종료를 보장하지 않는다. 외부 강제 종료 후에도 예약 데이터와 트랜잭션으로 복구할 수 있어야 한다.

## 수명주기 순서를 소스 경계에서 실험하기

종료 hook의 이름을 외우기보다 호출 순서를 직접 확인해 보자. 다음 `src/operations/lifecycle-order.spec.ts`는 **독립 실험 파일**이다. 실제 `bootstrapApplication`을 사용하고, adapter만 사건 기록용 대역으로 바꾼다. HTTP 전송 적합성 시험이 아니라 runtime이 adapter close보다 hook을 먼저 실행한다는 계약의 시험이다.

```typescript
import { Module } from '@fluojs/core';
import type { HttpApplicationAdapter } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { expect, it } from 'vitest';

it('runs resource hooks before adapter close', async () => {
  const events: string[] = [];

  class ResourceProbe {
    onModuleInit(): void {
      events.push('init');
    }
    onApplicationBootstrap(): void {
      events.push('bootstrap');
    }
    onModuleDestroy(): void {
      events.push('destroy');
    }
    onApplicationShutdown(signal?: string): void {
      events.push(`shutdown:${signal}`);
    }
  }

  @Module({ providers: [ResourceProbe] })
  class ProbeModule {}

  const adapter: HttpApplicationAdapter = {
    async listen() {
      events.push('listen');
    },
    async close() {
      events.push('adapter-close');
    },
  };
  const app = await bootstrapApplication({ rootModule: ProbeModule, adapter });
  try {
    expect(events).toEqual(['init', 'bootstrap']);
    await app.listen();
    await app.close('SIGTERM');
    expect(events).toEqual([
      'init',
      'bootstrap',
      'listen',
      'destroy',
      'shutdown:SIGTERM',
      'adapter-close',
    ]);
  } finally {
    await app.close();
  }
});
```

여러 lifecycle 인스턴스가 있다면 시작은 등록된 순서로, 종료는 인스턴스 역순으로 각 phase를 실행한다. `onModuleDestroy` 전체 뒤에 `onApplicationShutdown` 전체가 온다. 지원하는 공개 hook은 이 둘과 시작의 두 hook이며 `beforeApplicationShutdown`을 추가해도 Fluo가 호출하지 않는다. 원시 PlatformShell의 중첩 `start`·`stop`은 conflict로 거부되는 반면 Application의 동시 `close`는 진행 중 Promise를 공유하므로, 이름이 비슷한 계층의 동작을 섞지 않는다.

TrafficGate의 실험은 진행 중 요청이 handler 안에 도달했다는 Promise 신호를 만든 다음 시작한다. 신호를 받은 뒤 `stopAccepting`을 호출하고 두 번째 `/posts` 요청이 503인지 확인한다. 첫 요청을 붙잡고 있던 Promise를 풀기 전에는 idle 신호가 끝나지 않아야 하며, 풀면 첫 요청은 정상 완료되고 `waitForIdle()`이 끝나야 한다. readiness 요청은 그동안 gate에서 막히지 않고 Terminus로 가서 503을 반환해야 한다. 다음 장의 요청 테스트가 이 시나리오를 실제 코드로 고정한다.

Probe가 멈추는 실패도 구분한다. Terminus의 `indicatorTimeoutMs`는 기다림을 제한하고 해당 indicator를 down으로 보고한다. 동일 컨테이너에서 이전 probe가 아직 실행 중이면 같은 indicator에 새 probe를 중첩하지 않는다. 다만 timeout이 임의 DB 드라이버의 진행 중 SQL을 취소한다는 뜻은 아니다. 지연을 시험할 때는 probe의 시작·해제 신호를 사용하고, 시간 초과 자체를 시험하는 경우에만 제어된 fake timer를 사용한다.

원고 통합 검토에서는 lifecycle 순서 시험을 메모리에서 변환해 실제 runtime과 adapter 대역으로 실행했다. 9장의 AppSettings와 10장의 전역 async BlogDatabaseModule 등록을 사용한 별도 DI 실험에서도, Prisma 드라이버만 대역으로 두고 health·ready의 토큰 없는 403과 인증된 200, 연결·해제 각 1회를 확인했다. 실제 PostgreSQL 연결이나 signal을 받는 별도 Fastify 프로세스를 시험한 것은 아니다. 독자 앱에서는 `pnpm exec vitest run src/operations/lifecycle-order.spec.ts`를 실행하고, 로컬 listener에 짧은 요청과 제어된 진행 중 요청을 보내 첫 SIGTERM부터 준비 상태 변경·요청 완료·프로세스 종료까지 기록한다. DB·Cron·Queue·Email이 포함된 전체 종료 시간은 작은 adapter 대역 실험으로 증명할 수 없다.

## 첫 출시에서 지킬 경계

정상 트래픽이 드물고 단일 인스턴스를 수동 운영한다면 사전 drain gate 없이 기본 helper의 signal 처리를 사용하는 선택도 가능하다. 그 경우 배포 때 진행 중 요청의 일부가 실패할 수 있음을 제품과 테스트에서 받아들여야 한다. 반대로 이 장의 gate를 복사했다고 장기 스트림이나 외부 작업까지 무중단이 되는 것은 아니다. 기다릴 업무 단위와 재시도 가능한 데이터 경계를 아는 것이 구현보다 먼저다.

FluoBlog는 이제 시작 성공과 listener 개방을 구분하고, DB와 앱의 수용 상태를 readiness에 반영하며, 종료 전에 보통 HTTP 작업을 제한된 시간 동안 기다린다. 발행된 본문은 여전히 불변이고 예약 초안은 영속 시각에서 복구한다. 운영 처리가 도메인 규칙을 느슨하게 만드는 예외가 되지 않는다.

다음 장에서는 이 기능들을 첫 출시의 증거로 묶는다. “서버가 켜졌다”보다 강한 기준이 필요하지만, 모든 가능한 미래 기능을 구현할 필요는 없다. 독자가 글을 읽고 작성자가 초안을 안전하게 발행하며, 장애가 생겼을 때 원인을 설명하고 제한된 절차로 복구할 수 있는지 확인한다.

## 구현 근거

- [Terminus readiness·DI 조합·probe timeout 계약](../../packages/terminus/README.ko.md)
- [Terminus 모듈 조합과 readiness 등록](../../packages/terminus/src/module.ts)
- [Prisma 서비스 token을 이용하는 indicator](../../packages/terminus/src/indicators/prisma.ts)
- [형제 모듈 가시성 성공·실패 테스트](../../packages/terminus/src/module-sibling-composition.test.ts)
- [Runtime lifecycle와 signal 소유권](../../packages/runtime/README.ko.md)
- [시작·종료 순서의 아키텍처 계약](../../docs/architecture/lifecycle-and-shutdown.md)
- [Runtime bootstrap과 종료 phase 구현](../../packages/runtime/src/bootstrap.ts)
- [Fastify helper와 제한된 close 계약](../../packages/platform-fastify/README.ko.md)
- [Fastify 실행 옵션과 adapter close 구현](../../packages/platform-fastify/src/adapter.ts)
