# 느린 요청과 실패를 설명할 수 있게 하기

<!-- book:volume=01-fluoblog;chapter=22 -->

[이전: 예약 발행과 정기 작업 만들기](./ch21-scheduled-publishing.ko.md) · [1권 목차](./toc.ko.md) · [다음: 시작하고 종료하는 순간까지 설계하기](./ch23-lifecycle-and-readiness.ko.md)

예약한 글이 공개된 아침, 독자 한 명이 “목록은 빨리 열리는데 글을 누르면 가끔 오래 걸린다”고 알려 왔다. 운영자의 컴퓨터에서는 재현되지 않는다. 서버는 살아 있고 오류 로그도 많지 않다. 그날 예약 작업은 성공했다고 기록했지만, 성공한 작업 하나가 모든 독자의 경험을 설명하지는 못한다.

관측 가능성은 로그를 많이 남기는 일이 아니다. 사용자의 증상을 어떤 요청과 작업으로 좁히고, 그때 시스템이 내린 판단을 설명할 수 있는 상태를 만드는 일이다. FluoBlog에는 서로 다른 세 질문이 있다. 어느 경로가 얼마나 느려졌는가, 특정 요청은 어디서 실패했는가, 예약 발행처럼 HTTP 밖에서 실행되는 작업은 실제로 진행되고 있는가. 첫 질문에는 집계 지표가, 두 번째에는 구조화된 요청 기록이, 세 번째에는 작업 지표와 영속 발행 기록이 필요하다.

이 장의 코드는 Node.js 24와 pnpm 10을 기준으로 한다. Prometheus 서버 설치나 외부 로그 전송은 하지 않는다. 애플리케이션이 제공하는 scrape 응답과 요청 관측 경계를 만들고, 그 경계가 어떤 사실을 나타내는지 검증한다. 저장소의 작은 HTTP 예제에 모든 관측 설정이 이미 들어 있다고 가정하지 않는다.

## 평균 응답 시간이 사건을 감추는 방식

100개 요청 중 99개가 20밀리초, 하나가 2초라면 평균은 약 40밀리초다. 평균만 보면 대부분의 독자에게 괜찮아 보이지만, 한 독자는 매번 같은 큰 글을 읽을 때 2초를 기다릴 수 있다. 경로별 지연 분포와 요청 수를 함께 봐야 한다. 표본이 두 개뿐인 경로의 p95와 요청이 수만 개인 경로의 p95도 같은 확신으로 해석할 수 없다.

Fluo의 `MetricsModule.forRoot`는 HTTP 계측을 명시적으로 켤 때 `http_requests_total`, `http_errors_total`, `http_request_duration_seconds`를 기록한다. `http: true` 또는 HTTP 옵션 객체가 필요하다. 단지 `/metrics`가 열린다고 HTTP 요청 수가 자동으로 쌓인다고 생각하지 않는다. 기본 프로세스 지표와 HTTP 지표는 별개의 설정이다.

또한 `http_errors_total`은 서버 오류만 세는 이름이 아니다. 4xx와 5xx 응답, 계측 경계를 통과한 오류가 포함된다. 글이 없어서 반환한 404, 작성자가 아닌 계정의 403, DB 실패의 500을 하나의 장애율로 합치면 제품 동작과 서버 고장을 혼동한다. 출시 판단에는 `http_requests_total`에서 `status=~"5.."`를 고르는 식으로 질문에 맞는 분자를 정한다. 보안 경계의 401·403 증가는 별도의 신호로 본다.

수집 범위도 정확히 말해야 한다. 내장 HTTP histogram은 미들웨어가 `next()`를 기다리는 구간을 단조 시계로 측정한다. 독자 브라우저의 렌더링, DNS와 TLS 연결 시간, 모든 응답 바이트가 클라이언트에 도착한 순간까지를 합친 측정이 아니다. Fastify가 Fluo dispatch에 넘기기 전에 거절한 요청이나 프로세스까지 도달하지 못한 연결도 애플리케이션 지표만으로 셀 수 없다. 독자의 경험과 서버 처리를 연결하되 둘을 같은 값으로 부르지 않는다.

## 게시글 ID를 지표 라벨로 만들지 않기

처음에는 요청 경로를 그대로 라벨로 넣고 싶어진다. `/posts/1`, `/posts/2`가 따로 보이면 편리해 보이기 때문이다. 하지만 게시글이 늘 때마다 시계열도 늘고, 존재하지 않는 임의 경로를 요청하는 것만으로 라벨 공간이 커질 수 있다. 요청 ID나 사용자 ID를 라벨로 추가하면 증가 폭은 훨씬 크다. 지표는 검색 가능한 상세 기록이 아니라 제한된 차원의 집계다.

Fluo의 기본 template 모드는 요청 params를 이용해 경로를 정규화한다. 이 장에서는 더 엄격한 제품 소유 경로 분류를 선택한다. 아직 매칭되지 않은 임의 경로까지 원문으로 남기지 않고 `UNKNOWN`으로 모은다. 아래의 분류는 읽기 경로만 자세히 나누고, 인증과 구독의 세부 경로는 기능 단위로 합친다. 나중에 새 경로를 추가할 때 분류를 함께 검토해야 한다는 비용을 지불하는 대신, 시계열 수의 상한을 명확하게 얻는다.

다음은 `src/observability/observability.module.ts`의 **완전한 파일**이다. 같은 조합에서 한 번 호출해 반환된 모듈 identity를 재사용한다. `scrapeToken`은 설정 경계가 전달하는 운영용 값이며 사용자 JWT가 아니다. `false`를 주면 scrape route만 사라지고 HTTP·작업 계측은 유지된다. 네트워크 경계가 없는 공개 서비스에 보호되지 않은 지표를 내보내지 않도록 두 경우를 코드에서 구분한다.

```typescript
import { Module } from '@fluojs/core';
import {
  ForbiddenException,
  type MiddlewareContext,
  type Next,
} from '@fluojs/http';
import { MetricsModule } from '@fluojs/metrics';
import { PublishingMetrics } from './publishing-metrics.js';

export function createObservabilityModule(scrapeToken: string | false) {
  if (scrapeToken !== false && scrapeToken.trim().length === 0) {
    throw new Error('A non-empty metrics token is required.');
  }

  class MetricsAccessMiddleware {
    async handle(context: MiddlewareContext, next: Next): Promise<void> {
      if (context.request.headers['x-metrics-token'] !== scrapeToken) {
        throw new ForbiddenException('Metrics access denied.');
      }
      await next();
    }
  }

  @Module({
    imports: [
      MetricsModule.forRoot({
        path: scrapeToken === false ? false : '/internal/metrics',
        endpointMiddleware: [MetricsAccessMiddleware],
        http: {
          durationHistogramBuckets: [0.01, 0.05, 0.1, 0.3, 1, 3, 10],
          pathLabelNormalizer: ({ path }) => {
            if (/^\/posts\/?$/.test(path)) return '/posts';
            if (/^\/posts\/[^/]+\/read\/?$/.test(path)) return '/posts/:id/read';
            if (/^\/posts\/[^/]+\/?$/.test(path)) return '/posts/:id';
            if (path.startsWith('/auth/')) return '/auth/*';
            if (path.startsWith('/subscriptions')) return '/subscriptions/*';
            if (path === '/internal/metrics') return '/internal/metrics';
            if (path === '/internal/health') return '/internal/health';
            if (path === '/internal/ready') return '/internal/ready';
            return 'UNKNOWN';
          },
        },
      }),
    ],
    providers: [PublishingMetrics],
    exports: [PublishingMetrics],
  })
  class ObservabilityModule {}

  return ObservabilityModule;
}
```

`endpointMiddleware`가 중요한 이유는 지표 보호를 모든 게시글 요청의 인증으로 확대하지 않기 위해서다. 이 클래스는 scrape route에만 붙는다. `middleware`라는 별도 옵션은 모듈 수준 경계이므로 두 옵션을 혼동하지 않는다. 지표 접근을 거절한 403도 HTTP 계측에 포함된다. 따라서 지표 수집기의 토큰 설정이 틀리면 지표 수집 실패와 해당 route의 403 증가를 함께 조사할 수 있다.

버킷 단위는 초다. 여기서는 공개 조회의 후보 목표인 300밀리초를 경계 하나로 둔다. 버킷은 유한하고 엄격히 증가해야 하며, 잘못된 설정은 시작 때 거부된다. 버킷을 촘촘히 늘리면 추정의 해상도는 좋아지지만 각 라벨 조합에 대응하는 시계열도 늘어난다. 아직 사용하지 않는 장기 작업의 10분 단위 버킷을 HTTP 지표에 미리 넣을 이유는 없다.

토큰 비교는 작은 애플리케이션 수준 접근 경계다. 실제 배포에서는 TLS와 내부 scrape 경로의 네트워크 정책을 함께 둔다. 토큰을 URL query에 넣지 않고 header로 전달하며, 접근 로그 allowlist에도 넣지 않는다. 보호 경계가 준비되지 않았다면 이 함수를 `false`로 호출한다. 빈 문자열이나 빈 path를 비활성화 신호로 사용하지 않는다. Fluo에서 route 비활성화는 `path: false`다.

## 같은 관측 모듈을 한 번만 등록하기

운영 토큰도 시작 때 입력을 해석한다. 다음 **`src/config/operations-config.ts` 전체**는 9장의 DB·포트·JWT 설정을 대체하지 않고 운영 endpoint의 두 선택적 키만 추가한다. 미지정 metrics는 route를 만들지 않고, 미지정 health 토큰은 23장의 loopback·내부 네트워크 경로를 선택한다. 빈 문자열은 미지정과 달리 설정 오류다. 토큰 원문은 로그에 내보내지 않는다.

```typescript
import { z } from 'zod';

const TokenSchema = z.string().refine((value) => value.trim().length > 0);
const OperationsConfigSchema = z.object({
  METRICS_TOKEN: TokenSchema.optional(),
  HEALTH_TOKEN: TokenSchema.optional(),
});

export const operationsConfig = Object.freeze(OperationsConfigSchema.parse({
  METRICS_TOKEN: process.env.METRICS_TOKEN,
  HEALTH_TOKEN: process.env.HEALTH_TOKEN,
}));
```

**`src/observability/blog-observability.module.ts` 전체**에서 factory는 한 번만 호출한다. 뒤의 PostsModule과 루트 AppModule이 같은 identity를 import한다. 매 import 위치마다 factory를 새로 호출하면 서로 다른 Registry와 중복 scrape 경로를 만들 수 있다.

```typescript
import { operationsConfig } from '../config/operations-config.js';
import { createObservabilityModule } from './observability.module.js';

export const ObservabilityModule = createObservabilityModule(
  operationsConfig.METRICS_TOKEN ?? false,
);
```

로컬 검증은 환경 변수 `METRICS_TOKEN`, `HEALTH_TOKEN`을 실행 전에 설정한다. 이 파일은 운영 자격 증명을 프로세스 입력에서만 읽고, 9장의 .env 파일 병합 정책을 자동 상속한다고 주장하지 않는다. 앞 장에서 검증한 `blogConfig`와 `AppSettings`를 새 설정 객체로 덮어쓰지 않는다.

## 예약 작업의 성공과 실패를 별도로 관측하기

예약 작업은 HTTP 요청이 아니므로 HTTP 오류율이 낮아도 완전히 멈춰 있을 수 있다. `src/observability/publishing-metrics.ts`는 이 차이를 드러내는 **완전한 파일**이다. 지표 이름을 만드는 일과 값을 갱신하는 일을 분리한다. 발행 스캔과 pending 메일의 큐 전달은 다른 실패 경계이므로 `stage`는 `publication_scan`, `email_dispatch` 두 값으로 제한한다. 글·전달·계정 ID는 라벨이 아니다.

```typescript
import { Inject } from '@fluojs/core';
import { MetricsService } from '@fluojs/metrics';

@Inject(MetricsService)
export class PublishingMetrics {
  private readonly runs: ReturnType<MetricsService['counter']>;
  private readonly active: ReturnType<MetricsService['gauge']>;
  private readonly duration: ReturnType<MetricsService['histogram']>;

  constructor(metrics: MetricsService) {
    this.runs = metrics.counter({
      name: 'blog_background_runs_total',
      help: 'Completed background stages by outcome',
      labelNames: ['stage', 'outcome'],
    });
    this.active = metrics.gauge({
      name: 'blog_background_active',
      help: 'Background stages active in this process',
      labelNames: ['stage'],
    });
    this.duration = metrics.histogram({
      name: 'blog_background_duration_seconds',
      help: 'Background stage duration in seconds',
      labelNames: ['stage'],
      buckets: [0.01, 0.1, 0.5, 1, 5, 15, 30],
    });
  }

  async observe<T>(
    stage: 'publication_scan' | 'email_dispatch',
    work: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    this.active.inc({ stage });
    try {
      const result = await work();
      this.runs.inc({ stage, outcome: 'success' });
      return result;
    } catch (error: unknown) {
      this.runs.inc({ stage, outcome: 'failure' });
      throw error;
    } finally {
      this.duration.observe({ stage }, (performance.now() - startedAt) / 1000);
      this.active.dec({ stage });
    }
  }
}
```

`MetricsService`는 전역 서비스가 아니다. 위 조합은 `PublishingMetrics`가 속한 모듈에서 `MetricsModule.forRoot`를 직접 import하므로 해석할 수 있다. 반대로 루트 앱에 MetricsModule을 import하고 형제인 PostsModule에서 바로 MetricsService를 주입하면 가시성이 생기지 않는다. 관측 모듈이 `PublishingMetrics`를 export하고 PostsModule이 그 관측 모듈을 import하도록 연결한다.

각 collector를 생성자에서 한 번 만드는 것도 기능의 일부다. 요청이나 tick마다 `metrics.counter`를 다시 호출하면 같은 Registry에 같은 이름을 재등록하여 실패한다. 반환된 collector를 저장하고 `inc`, `observe`, `dec`만 반복한다. `finally`에서 active 값을 낮춰 실패한 실행이 영원히 진행 중으로 표시되지 않게 한다. 실패를 다시 던지는 이유는 계측 때문에 원래 작업의 오류 의미가 바뀌지 않게 하려는 것이다.

앞 장 `PublishingSchedule`은 다음 **완전한 교체 파일**로 바꾼다. `src/posts/publishing-schedule.ts`라는 경로와 `posts.publish-due` 작업 이름을 유지한다. 기존 CronModule, ScheduledPublishingService, SubscriptionsModule 등록도 유지한다. 스캔에서 실패해도 앞선 발행의 pending 메일은 전달할 수 있어야 하므로 두 단계를 모두 시도한 뒤 실패를 Cron에 돌려준다.

```typescript
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { PublishingMetrics } from '../observability/publishing-metrics.js';
import { PendingEmailDispatcher } from '../subscriptions/email-jobs.js';
import { ScheduledPublishingService } from './scheduled-publishing.service.js';

@Inject(ScheduledPublishingService, PendingEmailDispatcher, PublishingMetrics)
export class PublishingSchedule {
  constructor(
    private readonly publishing: ScheduledPublishingService,
    private readonly emails: PendingEmailDispatcher,
    private readonly metrics: PublishingMetrics,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'posts.publish-due' })
  async tick(): Promise<void> {
    const failures: unknown[] = [];
    try {
      const published = await this.metrics.observe(
        'publication_scan', () => this.publishing.publishDue(new Date()),
      );
      console.info(JSON.stringify({ event: 'posts.publish_due', published }));
    } catch (error: unknown) {
      failures.push(error);
    }
    try {
      const dispatched = await this.metrics.observe(
        'email_dispatch', () => this.emails.dispatchPending(),
      );
      console.info(JSON.stringify({ event: 'posts.email_dispatch', dispatched }));
    } catch (error: unknown) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more background stages failed.');
    }
  }
}
```

성공한 실행 수와 발행한 글 수는 다르다. 기한이 지난 글이 없어도 정상적인 조회는 성공이다. 따라서 `blog_background_runs_total{stage="publication_scan",outcome="success"}`가 증가한다고 적체가 없다고 결론 내릴 수 없다. 21장의 스캐너가 확인한 정상 버전 경합은 건너뜀이고, DB·예기치 않은 발행 실패처럼 전파된 오류는 해당 단계의 failure다. 이미 커밋한 글을 뒤의 실패 때문에 취소하지 않는다.

`email_dispatch`의 성공은 pending 전달 행을 큐에 넣는 호출이 완료됐다는 뜻이다. SMTP 수락이나 수신함 도착의 성공 횟수가 아니다. 큐 전달이 실패해도 publication 스캔은 success로 남을 수 있으며, worker의 `rejected`·`uncertain`은 19장의 `PostDelivery` 원장에서 별도로 조사한다. 발행 기록과 가장 오래된 미처리 예약 시각도 함께 확인한다. 프로세스가 강제 종료되면 `finally`와 마지막 scrape가 실행되지 않을 수 있으므로 메모리 counter를 정합성의 원장으로 삼지 않는다.

## 호출자와 모듈 가시성을 함께 바꾸기

19~21장은 `EmailDispatchSchedule`과 `PublishingSchedule`을 별도로 등록했다. 이 장에서는 위의 한 tick이 스캔 뒤 pending dispatch를 시도하도록 묶는다. 따라서 **`src/subscriptions/subscriptions.module.ts`에서 스케줄 provider 하나만 제거**하고 dispatcher·worker·구독 컨트롤러·FormsAuthModule·Redis·Queue·Email 등록은 그대로 둔다. 두 caller를 함께 남겨 동일 dispatcher가 겹쳐 실행되는 구성을 만들지 않는다.

```diff
-import { EmailDispatchSchedule } from './email-dispatch-schedule.js';
@@
-      Subscriptions, PendingEmailDispatcher, PostEmailWorker, EmailDispatchSchedule,
+      Subscriptions, PendingEmailDispatcher, PostEmailWorker,
```

같은 파일의 factory와 RecordingEmailTransport 선언 뒤에 다음 **singleton 등록**을 추가한다. 이것은 기존 루트의 inline factory 호출을 옮긴 것이지 두 번째 구독 시스템이 아니다. 로컬 Redis 주소와 기록 transport를 보존하며, 실제 SMTP를 설정하지 않는다.

```typescript
export const SubscriptionsModule = createSubscriptionsModule(
  { host: '127.0.0.1', port: 6379 }, new RecordingEmailTransport(),
);
```

**`src/posts/posts.module.ts`**에는 아래 두 import와 imports 항목만 추가한다. `BlogJobsModule`, 페이지에 export한 `PostEditingService`, 예약 API와 기존 게시글 등록은 그대로다. `PendingEmailDispatcher`는 SubscriptionsModule의 export에서, `PublishingMetrics`는 ObservabilityModule의 export에서 해석된다. 새 클래스 목록으로 PostsModule 전체를 교체하지 않는다.

```diff
+import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
+import { ObservabilityModule } from '../observability/blog-observability.module.js';
@@ imports
+    SubscriptionsModule, ObservabilityModule,
```

**`src/app.ts`**에서는 19장의 inline 구독 등록을 같은 identity로 바꾸고 관측 모듈을 추가한다. 다른 모든 imports와 OpenAPI sources는 그대로 남긴다. `FormsPagesModule`, 20장의 캐시를 적용한 `createPostsPagesModule`, 18장의 업로드 모듈, 21장의 `PostSchedulePagesModule`도 제거하지 않는다.

```diff
-import { createSubscriptionsModule, RecordingEmailTransport } from './subscriptions/subscriptions.module.js';
+import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
+import { ObservabilityModule } from './observability/blog-observability.module.js';
@@ imports
-    createSubscriptionsModule({ host: '127.0.0.1', port: 6379 }, new RecordingEmailTransport()),
+    SubscriptionsModule, ObservabilityModule,
```

`BlogJobsModule`은 계속 유일한 Cron 등록이다. 이 변경 뒤 등록된 작업 이름은 `posts.publish-due`이며, 이전 `subscriptions.dispatch-pending` 작업은 더 이상 provider에서 발견되지 않는다. 전달 기록과 `blog-post-email-v1` 큐 job identity는 바뀌지 않는다. 알려진 영구 도메인 거절은 21장의 `scheduleFailure`로 격리되므로 스캔 success에도 이런 후보가 있을 수 있다. 경쟁 패배·영구 거절·인프라 실패를 모두 같은 failure counter로 해석하지 않는다.

## 실제 Cron callback에서 두 단계를 검증하기

다음 **`src/observability/background-stages.spec.ts` 전체**는 실제 PublishingSchedule·PublishingMetrics와 Cron 등록을 사용한다. DB와 Queue만 호출 seam의 대역이며, 이는 발행 원자성이나 실제 Redis 전달을 증명하는 시험이 아니다. 수동 scheduler가 callback을 잡아 두므로 30초를 기다리지 않고 실제 등록된 작업을 실행한다.

```typescript
import { Module } from '@fluojs/core';
import { CronModule, type CronScheduler } from '@fluojs/cron';
import { createTestApp } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { PublishingSchedule } from '../posts/publishing-schedule.js';
import { ScheduledPublishingService } from '../posts/scheduled-publishing.service.js';
import { PendingEmailDispatcher } from '../subscriptions/email-jobs.js';
import { createObservabilityModule } from './observability.module.js';

for (const failure of ['none', 'publication_scan', 'email_dispatch'] as const) {
  it(`runs both scheduled stages when failure is ${failure}`, async () => {
    const callbacks: Array<() => Promise<void>> = [];
    const calls: string[] = [];
    const scheduler: CronScheduler = (_expression, _options, callback) => {
      callbacks.push(callback);
      return { stop() {} };
    };
    @Module({
      imports: [
        CronModule.forRoot({ scheduler }),
        createObservabilityModule('stage-test-token'),
      ],
      providers: [
        PublishingSchedule,
        {
          provide: ScheduledPublishingService,
          useValue: {
            async publishDue() {
              calls.push('publication_scan');
              if (failure === 'publication_scan') throw new Error('Database unavailable.');
              return 1;
            },
          },
        },
        {
          provide: PendingEmailDispatcher,
          useValue: {
            async dispatchPending() {
              calls.push('email_dispatch');
              if (failure === 'email_dispatch') throw new Error('Queue unavailable.');
              return 2;
            },
          },
        },
      ],
    })
    class StageProbeModule {}

    const app = await createTestApp({ rootModule: StageProbeModule });
    try {
      expect(callbacks).toHaveLength(1);
      const tick = callbacks[0];
      if (!tick) throw new Error('Publishing callback was not registered.');
      await tick();
      expect(calls).toEqual(['publication_scan', 'email_dispatch']);
      const scrape = await app.request('GET', '/internal/metrics')
        .header('x-metrics-token', 'stage-test-token').send();
      expect(scrape.status).toBe(200);
      for (const stage of ['publication_scan', 'email_dispatch'] as const) {
        const outcome = failure === stage ? 'failure' : 'success';
        expect(scrape.body).toEqual(expect.stringContaining(
          `blog_background_runs_total{stage="${stage}",outcome="${outcome}"} 1`,
        ));
        expect(scrape.body).toEqual(expect.stringContaining(
          `blog_background_active{stage="${stage}"} 0`,
        ));
      }
    } finally {
      await app.close();
    }
  }, 5_000);
}
```

Cron의 callback은 작업 예외를 로그와 오류 hook에 전달한 뒤 정리한다. 그래서 실패 사례에서도 callback Promise의 reject를 성공 조건으로 삼지 않고 각 단계의 failure 시계열과 다른 단계의 실행을 확인한다. 마지막의 5초는 잘못된 구현이 테스트를 붙잡지 못하게 하는 상한이다. 배치의 실제 DB 실패·영구 거절 분류는 21장의 PostgreSQL 시험으로 별도 검증한다.

## 한 요청의 시작과 끝을 연결하기

지표에서 HTML 읽기 `/posts/:id/read` 또는 JSON 조회 `/posts/:id`의 지연이 증가했다는 사실을 찾았으면 다음 질문은 “어떤 요청이었나?”다. `@fluojs/http`의 `createAccessLogObserver`는 시작 기록, dispatch 오류 기록, 마지막 종료 기록을 만든다. 종료 기록에는 `durationMs`, 최종 상태와 `outcome`이 있다. `success`, `handled_error`, `unhandled_error`, `not_found`, `aborted`는 관측된 dispatch 결과의 분류이며 상품 차원의 성공 여부를 자동 판정하는 값은 아니다.

다음은 `src/observability/access-log.ts`의 **완전한 파일**이다. 예제 sink는 로컬 stdout만 사용한다. 원문 경로의 slug나 우연히 들어온 민감한 경로를 로그에 그대로 저장하지 않도록 매칭된 route가 없는 경우 고정 문자열로 바꾼다. 원문 경로가 필요한 사고 조사에는 별도의 제한된 보존 정책이 필요하며, 기본 로그에 모든 요청 정보를 쌓는 것으로 대체하지 않는다.

```typescript
import { createAccessLogObserver } from '@fluojs/http';

export const blogAccessObserver = createAccessLogObserver({
  headers: {
    allow: ['x-request-id'],
    redact: ['x-metrics-token', 'x-health-token'],
  },
  sink: {
    emit(event) {
      console.info(JSON.stringify({
        ...event,
        path: event.matchedRoute ?? '/unmatched',
      }));
    },
  },
});
```

요청 ID 생성은 observer와 별개의 책임이다. `src/main.ts`의 기존 Fastify 실행 옵션에 다음 **옵션 부분 구현**을 합친다. `AppModule`은 기존 계정·게시글·관측 모듈을 조합한 `src/app.ts`의 앱이다. 이 블록은 그 앱의 나머지 설정이나 등록을 대체하지 않는다.

```typescript
import { ensureMetadataSymbol } from '@fluojs/core';
import { createCorrelationMiddleware } from '@fluojs/http';
import { runFastifyApplication } from '@fluojs/platform-fastify';

ensureMetadataSymbol();
const { AppModule } = await import('./app.js');
const { blogConfig } = await import('./config/app-settings.module.js');
const { blogAccessObserver } = await import('./observability/access-log.js');

await runFastifyApplication(AppModule, {
  host: '127.0.0.1',
  port: blogConfig.PORT,
  maxBodySize: 6 * 1024 * 1024,
  multipart: {
    maxFileSize: 5 * 1024 * 1024,
    maxFiles: 1,
    maxTotalSize: 6 * 1024 * 1024,
  },
  middleware: [createCorrelationMiddleware()],
  observers: [blogAccessObserver],
});
```

Correlation middleware는 들어온 `x-request-id` 또는 이전 형식의 `x-correlation-id`를 채택하고, 없으면 시작 기록 전에 ID를 생성한다. 같은 ID는 응답 header에도 이어진다. 이 ID는 상관관계를 찾기 위한 값이지 인증된 사용자 식별자나 전역 고유성을 증명하는 값이 아니다. 고객이 보낸 ID를 권한이나 멱등성 키로 대신 사용하지 않는다.

기본 header allowlist는 비어 있다. 허용 목록에 넣더라도 `authorization`, `cookie`, `set-cookie` 같은 민감 header는 계속 가려진다. 이 예제는 요청 body나 비밀번호·JWT 원문을 기록하지 않는다. 클라이언트 IP도 필요하지 않아 `clientIdentity`를 생략했다. 프록시가 보내는 header를 무조건 믿고 IP를 넣으면 공격자가 운영 기록의 주소를 바꿀 수 있다. 주소가 실제로 필요한 시점에만 정확한 trusted proxy 범위를 설정한다.

Observer의 sink는 비동기 완료를 기다릴 수 있다. 매 요청마다 외부 로그 서버 전송을 await하면 로그 시스템의 지연이 요청 수명에 들어온다. 이 예제의 stdout도 무한한 저장소는 아니다. 운영 호스트는 수집·보존·용량 정책을 소유해야 하며, 외부 sink를 도입한다면 제한된 버퍼와 실패 정책을 별도로 검증한다. 구조화된 로그를 쓴다는 이유로 비즈니스 응답이 로그 전송 성공에 의존하도록 만들지 않는다.

## 실제 요청 경계에서 지표를 읽는 실험

다음 `src/observability/observability.spec.ts`는 **완전한 로컬 요청 실험 파일**이다. 두 게시글 경로와 접근 거절이 실제 가상 HTTP dispatch를 통과하도록 한다. 단순히 collector를 직접 증가시키고 그 값을 읽는 테스트가 아니므로, HTTP 계측 등록을 빠뜨리거나 endpoint middleware를 전체 앱에 잘못 적용하면 실패한다.

```typescript
import { Module } from '@fluojs/core';
import { Controller, Get, NotFoundException } from '@fluojs/http';
import { createTestApp } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { createObservabilityModule } from './observability.module.js';

it('groups post paths and keeps scrape access separate', async () => {
  @Controller('/posts')
  class ReadProbeController {
    @Get('/:id')
    read() {
      return { title: 'Hello, Fluo!' };
    }

    @Get('/:id/read')
    readPage() {
      return '<article>Hello, Fluo!</article>';
    }
  }

  @Controller('/failure')
  class FailureProbeController {
    @Get('/')
    fail() {
      throw new NotFoundException('Post not found.');
    }
  }

  @Module({
    imports: [createObservabilityModule('local-probe-token')],
    controllers: [ReadProbeController, FailureProbeController],
  })
  class ProbeModule {}

  const app = await createTestApp({ rootModule: ProbeModule });
  try {
    expect((await app.request('GET', '/posts/1').send()).status).toBe(200);
    expect((await app.request('GET', '/posts/2').send()).status).toBe(200);
    expect((await app.request('GET', '/posts/1/read').send()).status).toBe(200);
    expect((await app.request('GET', '/posts/2/read').send()).status).toBe(200);
    expect((await app.request('GET', '/not-a-route').send()).status).toBe(404);
    expect((await app.request('GET', '/failure').send()).status).toBe(404);
    expect((await app.request('GET', '/internal/metrics').send()).status).toBe(403);

    const scrape = await app.request('GET', '/internal/metrics')
      .header('x-metrics-token', 'local-probe-token')
      .send();
    expect(scrape.status).toBe(200);
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="/posts/:id",status="200"} 2',
    ));
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="/posts/:id/read",status="200"} 2',
    ));
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="UNKNOWN",status="404"} 1',
    ));
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_errors_total{method="GET",path="/internal/metrics",status="403"} 1',
    ));
    expect(scrape.body).not.toEqual(expect.stringContaining('path="/posts/1"'));
    expect(scrape.body).not.toEqual(expect.stringContaining('path="/posts/2"'));
    expect(scrape.body).not.toEqual(expect.stringContaining('path="/posts/1/read"'));
    expect(scrape.body).not.toEqual(expect.stringContaining('path="/posts/2/read"'));
    expect(scrape.body).not.toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="UNKNOWN",status="200"}',
    ));
  } finally {
    await app.close();
  }
});
```

현재 scrape 요청 자체는 collector가 결과를 직렬화한 뒤 완료된다. 그래서 “이번 scrape까지 요청 수에 포함되어야 한다”는 assertion을 만들지 않는다. 여기서는 이미 완료된 요청만 비교한다. 테스트마다 새 앱이 기본 isolated Registry를 소유하므로 앞 테스트의 counter가 섞이지 않는다. 특별한 이유로 `METRICS_REGISTRY`를 bootstrap provider로 공유한다면 그 격리도 테스트 작성자가 책임져야 한다. `/failure`는 매칭된 handler에서 404를 던져 `UNKNOWN` 시계열 한 건을 만든다. 반면 `/not-a-route`의 미매칭 404는 이 계측 미들웨어에 진입하지 않아 counter에 더하지 않는다. 모든 404가 지표에 포함된다고 확대하지 않는다. 두 HTML 경로는 실제 React 렌더러 대신 작은 응답을 쓰는 라벨 시험이며, 24장에서는 실제 조립한 SSR 경로를 확인한다.

요청 ID 실험에서는 `createAccessLogObserver`의 sink를 배열 수집으로 바꾸고 `clock`에 수동 숫자를 반환하는 함수를 전달할 수 있다. 시작 시각을 100으로 두고 handler가 끝나기 전에 350으로 바꾸면 종료 기록의 기대 `durationMs`는 250이다. 오류 route에도 같은 middleware와 observer를 붙여 시작·오류·종료의 ID가 같은지, 종료가 하나뿐인지 확인한다. 실제로 250밀리초를 기다릴 필요가 없다. 이 방식은 클록 계산의 계약을 검증하며 네트워크 성능 시험을 대신하지 않는다.

원고 통합 검토에서는 위 코드 블록을 메모리에서 TypeScript로 변환해 기존 패키지 산출물과 연결했다. JSON·HTML 라벨 요청 시험과 실제 Cron callback의 정상·DB 호출 실패·Queue 호출 실패 세 사례가 통과했다. DB와 Queue 호출은 대역이며 실제 발행·Redis·SMTP 검증이 아니다. 독자 앱의 Node24/Vitest 명령은 실행하지 않았으므로 파일을 조립한 뒤 `pnpm exec vitest run src/observability/observability.spec.ts src/observability/background-stages.spec.ts`로 다시 검증한다. 실제 listener의 content type·접근 정책·전송 시간은 별도 확인 대상이다.

## 사고를 설명하는 질문의 순서

운영에서 사용할 다음 PromQL은 **질의 예시**이며 Prometheus가 이 endpoint를 수집하도록 별도로 설정돼 있어야 한다. 첫 질의는 JSON 상세와 HTML 읽기의 경로별 p95, 두 번째는 같은 두 경로 각각의 서버 오류 비율이다. 정규식은 고정된 두 라벨만 선택하고 `path`를 집계 키에 남겨 SSR과 JSON을 섞지 않는다.

```promql
histogram_quantile(
  0.95,
  sum by (path, le) (
    rate(http_request_duration_seconds_bucket{method="GET",path=~"/posts/:id(/read)?"}[5m])
  )
)
```

```promql
sum by (path) (rate(http_requests_total{method="GET",path=~"/posts/:id(/read)?",status=~"5.."}[5m]))
/
sum by (path) (rate(http_requests_total{method="GET",path=~"/posts/:id(/read)?"}[5m]))
```

분모가 없는 구간은 오류율 0의 증거가 아니다. 요청이 없거나 수집이 끊겼을 수 있다. p95는 histogram 버킷을 바탕으로 추정하며 각 인스턴스의 p95를 단순 평균하지 않는다. 배포 전후를 비교할 때도 요청량과 캐시가 차 있는 정도, 콘텐츠 크기가 비슷한지 확인한다. 숫자가 내려갔다고 변경이 원인이라고 단정하지 않는다.

처음의 사건으로 돌아가 보자. 상세 조회의 지연만 증가했고 5xx는 늘지 않았다면 무조건 서버를 재시작하기보다 느린 요청의 종료 기록을 찾는다. 같은 시각 예약 작업의 실행 시간이 길어졌다면 DB 경쟁이라는 가설이 생기지만 아직 결론은 아니다. 쿼리 범위와 연결 풀 상태를 확인하고, 같은 콘텐츠와 캐시 조건에서 작업 실행 전후를 비교한다. 반대로 발행 기록은 정상인데 목록만 오래된 경우는 캐시 가시성 문제로 분리한다.

관측 코드가 제품의 모든 세부사항을 알 필요는 없다. 게시글마다 라벨을 만들거나 모든 서비스를 tracing 체계로 한꺼번에 바꾸면 비용부터 늘어난다. 지금 필요한 것은 제한된 경로 집계, 한 요청의 상관관계, 예약 작업의 실행 신호다. 이 세 가지로 설명되지 않는 구체적인 사건이 생겼을 때 다음 계측을 추가한다.

이제 FluoBlog는 느리거나 실패한 뒤의 상태를 설명할 준비가 됐다. 하지만 배포 중에 들어온 요청은 어떨까. 프로세스가 살아 있어도 아직 DB 연결을 준비하지 못했거나 이미 정리를 시작했을 수 있다. 다음 장에서는 관측된 상태를 트래픽 수용 결정과 연결하고, 시작과 종료를 서비스 동작의 일부로 설계한다.

## 구현 근거

- [Metrics 등록·Registry 소유권·endpoint 보호 계약](../../packages/metrics/README.ko.md)
- [HTTP collector의 라벨·오류·측정 구간 구현](../../packages/metrics/src/http-metrics-middleware.ts)
- [사용자 정의 collector 생성 API](../../packages/metrics/src/metrics-service.ts)
- [실제 요청을 통한 scrape와 접근 실패 테스트](../../packages/metrics/src/metrics-module.request.test.ts)
- [HTTP 관측과 correlation 계약](../../packages/http/README.ko.md)
- [AccessLogEvent와 observer 구현](../../packages/http/src/access-log-observer.ts)
- [상관관계·종료 결과·sink 대기 테스트](../../packages/http/src/access-log-observer.test.ts)
