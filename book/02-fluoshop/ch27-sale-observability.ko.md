# 판매 이벤트를 관측하고 병목 찾기

<!-- book:volume=02-fluoshop;chapter=27 -->

[이전: 리뷰·상품 문서 모델을 MongoDB로 구성해 보기](./ch26-mongoose-lab.ko.md) · [목차](./toc.ko.md) · [다음: 장애 훈련으로 FluoShop 완성하기](./ch28-failure-drills.ko.md)

## 응답은 빠른데 배송 준비가 시작되지 않는다

FluoBlog 구독자에게 두 번째 굿즈 판매를 알린 날이다. 게시글과 상품 페이지는 잘 열리고 `/orders`도 빠르게 응답한다. 그런데 운영 대시보드에는 결제가 끝난 주문이 늘어나는 반면 배송 준비는 좀처럼 시작되지 않는다. HTTP 성공률만 보던 운영자는 서버가 정상이라고 생각하지만, 고객은 “구매한 뒤 아무 일도 일어나지 않는다”고 느낀다.

이 차이는 23장에서 배송 처리를 별도 프로세스로 꺼냈기 때문에 더 잘 드러난다. 그렇다고 모든 기능을 다시 서비스로 나눌 이유는 없다. 같은 애플리케이션의 Accounts, Posts, Catalog, Inventory, Orders, Payments 경계와 PostgreSQL·Prisma 기본 경로를 유지한다. 앞의 Drizzle과 Mongoose 실습은 비교 선택지이며 이번 판매의 필수 의존성으로 동시에 추가하지 않는다.

1권에서는 느린 게시글 요청과 HTTP 오류를 보았다. 상점에서는 같은 관측 기반 위에 비즈니스 전이와 비동기 대기를 더해야 한다. `POST /payments/webhooks`의 200 응답이 열 번이라고 주문 열 개가 결제된 것은 아니다. 중복 웹훅을 안전하게 받아 준 것일 수도 있다. 큐에 작업을 넣었다는 사실도 배송 처리가 끝났다는 사실과 다르다. 한 사건의 여러 완료 지점을 구분하는 것이 이 장의 출발점이다.

아래 코드는 독자가 만든 `fluo-blog`에 추가하는 관측 계층이다. Node24와 pnpm10을 기준으로 하며 `@fluojs/metrics`, `@fluojs/terminus`를 사용한다. 이 저장소에 완성된 판매 부하 실험 환경이 있다고 전제하지 않는다. 제시한 숫자는 가설과 실험 조건이며 실제 운영 측정치가 아니다.

## 먼저 질문을 정하고 지표를 고른다

판매 당일의 질문을 세 개로 나눈다. 첫째, 고객 요청이 서비스 경계에서 성공했는가? 둘째, 주문이 의도한 상태로 바뀌었는가? 셋째, 뒤에서 해야 할 일이 쌓이거나 멈췄는가? 첫 질문에는 HTTP 요청 수와 지연이 맞고, 둘째에는 커밋 이후의 상태 변경 결과, 셋째에는 대기 건수와 가장 오래된 미처리 작업의 시각이 맞다.

이름만 다른 성공 카운터를 여러 군데에 추가하면 오히려 원인을 가린다. 같은 주문의 webhook 수신, 서명 검증, 결제 전이, Outbox 삽입, 배송 작업 enqueue는 서로 다른 사건이다. 이번에는 결제 적용 결과를 `applied`, 이미 반영된 요청을 `duplicate`, 도메인이 거절한 전이를 `rejected`, 실행 자체가 실패한 경우를 `error`로 제한한다. 실패 메시지 전문을 라벨로 쓰지 않는다.

주문 ID, 고객 ID, 이메일, 결제사 원문 ID, 개별 SKU는 이 지표의 라벨이 아니다. 주문 하나마다 새 시계열을 만들면 트래픽 증가가 곧 지표 저장 비용 증가가 된다. 단일 요청 추적은 접근을 통제한 구조화 로그에서 correlation ID로 수행하고, 메트릭은 정해진 종류의 현상을 집계한다. 개인정보와 토큰 원문을 로그로 보내지 않는 기존 원칙도 그대로 유지한다.

HTTP 라벨은 `pathLabelMode: 'template'`로 설정한다. `/orders/a`와 `/orders/b`는 `/orders/:id` 같은 제한된 경로 형태로 묶어야 한다. 내장 HTTP 지표는 `method`, `path`, `status`를 사용하며 `http_errors_total`에는 4xx와 5xx가 들어간다. 따라서 그 지표 전체를 “서버 오류”로 부르면 정상적인 409 충돌이나 잘못된 요청도 장애로 세게 된다. 서버 오류를 보려면 상태 범위를 명시한다.

## 커밋된 결과와 실행 시간을 기록하는 작은 계층

다음 완전한 파일 `src/operations/sale-metrics.ts`는 Fluo의 `MetricsService`로 collector를 한 번 만들고 재사용한다. 요청마다 `counter()`를 새로 호출하면 같은 Registry에 같은 이름을 등록하여 실패한다. 싱글턴 provider가 collector를 소유하고, 요청이나 작업은 숫자만 갱신하도록 경계를 둔다.

```ts
import { Inject } from '@fluojs/core';
import { MetricsService } from '@fluojs/metrics';

export type SaleStage = 'checkout' | 'payment' | 'fulfillment';
export type PaymentOutcome = 'applied' | 'duplicate' | 'rejected';

export type OutboxSample = {
  pending: number;
  oldestCreatedAt: Date | null;
  sampledAt: Date;
};

@Inject(MetricsService)
export class SaleMetrics {
  private readonly paymentOutcomes: ReturnType<MetricsService['counter']>;
  private readonly duration: ReturnType<MetricsService['histogram']>;
  private readonly active: ReturnType<MetricsService['gauge']>;
  private readonly pending: ReturnType<MetricsService['gauge']>;
  private readonly oldest: ReturnType<MetricsService['gauge']>;
  private readonly sampled: ReturnType<MetricsService['gauge']>;

  constructor(metrics: MetricsService) {
    this.paymentOutcomes = metrics.counter({
      name: 'shop_payment_outcomes_total',
      help: 'Payment application outcomes observed after settlement',
      labelNames: ['outcome'],
    });
    this.duration = metrics.histogram({
      name: 'shop_operation_duration_seconds',
      help: 'Duration of one application operation',
      labelNames: ['stage', 'result'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    });
    this.active = metrics.gauge({
      name: 'shop_operations_active',
      help: 'Operations currently running in this process',
      labelNames: ['stage'],
    });
    this.pending = metrics.gauge({
      name: 'shop_outbox_pending_jobs',
      help: 'Pending jobs in the last successful database sample',
    });
    this.oldest = metrics.gauge({
      name: 'shop_outbox_oldest_pending_timestamp_seconds',
      help: 'Creation time of the oldest pending job, or zero when empty',
    });
    this.sampled = metrics.gauge({
      name: 'shop_outbox_sample_timestamp_seconds',
      help: 'Time of the last successful database sample',
    });
    for (const outcome of ['applied', 'duplicate', 'rejected', 'error']) {
      this.paymentOutcomes.inc({ outcome }, 0);
    }
    for (const stage of ['checkout', 'payment', 'fulfillment']) {
      this.active.set({ stage }, 0);
    }
  }

  async measure<T>(stage: SaleStage, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    let result: 'success' | 'error' = 'error';
    this.active.inc({ stage });
    try {
      const value = await work();
      result = 'success';
      return value;
    } finally {
      this.active.dec({ stage });
      this.duration.observe({ stage, result }, (performance.now() - started) / 1_000);
    }
  }

  async payment<T extends { kind: PaymentOutcome }>(
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await this.measure('payment', work);
      this.paymentOutcomes.inc({ outcome: result.kind });
      return result;
    } catch (error) {
      this.paymentOutcomes.inc({ outcome: 'error' });
      throw error;
    }
  }

  recordOutbox(sample: OutboxSample): void {
    const sampledAt = sample.sampledAt.getTime();
    const oldestAt = sample.oldestCreatedAt?.getTime() ?? 0;
    if (
      !Number.isSafeInteger(sample.pending) || sample.pending < 0 ||
      !Number.isFinite(sampledAt) || sampledAt <= 0 ||
      !Number.isFinite(oldestAt) ||
      (sample.pending === 0 && sample.oldestCreatedAt !== null) ||
      (sample.pending > 0 && (oldestAt <= 0 || oldestAt > sampledAt))
    ) {
      throw new RangeError('Invalid outbox sample.');
    }
    this.pending.set(sample.pending);
    this.oldest.set(oldestAt / 1_000);
    this.sampled.set(sampledAt / 1_000);
  }
}
```

소요 시간에는 단조 증가 시계인 `performance.now()`를 사용한다. 서버 시계 보정 때문에 작업 시간이 음수가 되는 일을 피하기 위해서다. 반대로 프로세스와 수집기 사이에 공유해야 하는 Outbox 시각에는 절대 시각을 쓴다. 두 시계의 용도가 다르다. 서버 간 시계 오차가 크면 가장 오래된 작업의 나이도 잘못 보이므로 운영에서는 시간 동기화와 표본 출처를 같이 관리한다.

`finally`에서 진행 중 수를 줄이는 이유는 실패한 작업이 영원히 실행 중으로 남는 관측 버그를 막기 위해서다. 처리 실패는 duration의 `result="error"`에도 남고 원래 예외는 그대로 전파된다. 여기의 `success`는 콜백이 정상적으로 반환했다는 뜻이다. `rejected`라는 도메인 결과를 정상 반환한 작업도 실행 자체는 성공이므로, 사업 결과는 별도의 outcome 카운터로 해석한다.

실제 결제 원장은 `src/payments/payment-ledger.ts`의 `PaymentLedger.prepare/record`다. 저장한 시도 ID와 금액을 이용한 외부 청구는 트랜잭션 밖에서 수행하고, 결과 기록 경계의 시간을 다음 **애플리케이션 부분 구현** `src/payments/record-observed-payment.ts`로 잰다. `Parameters`로 기존 메서드의 인수를 보존하므로 이 장에서 다른 결제 DTO나 존재하지 않는 확정 서비스를 만들지 않는다.

```ts
import type { SaleMetrics } from '../operations/sale-metrics.js';
import type { PaymentLedger } from './payment-ledger.js';

export function recordObservedPayment(
  metrics: SaleMetrics,
  ledger: PaymentLedger,
  ...args: Parameters<PaymentLedger['record']>
) {
  return metrics.measure('payment', () => ledger.record(...args));
}
```

위 연결은 원장 기록의 실행 시간만 측정하며 `record()`의 반환만 보고 새 결제라고 단정하지 않는다. 앞의 `PaymentOutcome`은 이 장이 정의한 관측용 분류이지 기존 `PaymentLedger`의 공개 반환 타입이라는 주장이 아니다. `payment()` helper는 원장과 원자적 `OrderTransition` 처리에서 새 적용·중복·거절을 실제로 구별해 반환하는 경계에만 사용한다. 기존 반환 계약에 그 정보가 없다면 duration만 계측하고 전이 수는 영속 감사 기록에서 집계하는 것이 맞다.

계측을 바깥 트랜잭션의 콜백 안에 넣으면 “커밋 이후”라는 뜻이 깨진다. 최외곽 비즈니스 작업이 끝난 자리에서 계측해야 한다. 또한 커밋 직후 프로세스가 죽으면 카운터 증가를 놓칠 수 있고, 재시작하면 프로세스 카운터도 초기화된다. 이 메트릭은 운영 추세를 설명하는 신호이지 정산 장부가 아니다. 정확한 매출과 주문 수는 영속 주문·결제 기록을 집계한다.

## 대기 건수와 표본의 신선도를 함께 남기기

처리 속도가 낮아졌을 때 대기 건수만으로는 고객 영향을 판단하기 어렵다. 갑자기 주문 1,000개가 들어와 큐가 늘어났지만 10초 안에 소진될 수도 있고, 특정 주문 하나가 하루 동안 고립될 수도 있다. 그래서 가장 오래된 미처리 시각과 마지막 성공 표본 시각을 함께 남겼다. 처리해야 할 일이 없다면 오래된 시각은 0으로 명시하고, 조회가 실패했다면 세 값을 모두 이전 상태로 유지한다.

다음 SQL은 **애플리케이션 소유 Outbox 표에 적용하는 조회 부분 구현**이다. 이 예제의 표 이름은 `shop_outbox`, 열은 `created_at timestamptz NOT NULL`, 완료 전에는 null인 `delivered_at timestamptz`다. 기존 모델 이름이 다르면 이 매핑만 맞춘다. 새 프레임워크 내장 표가 있는 것이 아니다. 실제 등록된 Prisma 클라이언트의 읽기 경계에서 실행하고 결과를 `OutboxSample`로 변환한다.

```sql
SELECT
  count(*) AS pending,
  min(created_at) AS oldest_created_at,
  statement_timestamp() AS sampled_at
FROM shop_outbox
WHERE delivered_at IS NULL;
```

한 문장에서 세 값을 읽어야 건수와 가장 오래된 시각이 다른 순간의 값을 섞지 않는다. `count(*)`의 드라이버 반환이 문자열이나 bigint라면 `Number` 변환 전에 안전한 정수 범위를 확인한다. DB 조회가 성공한 뒤에만 `recordOutbox()`를 호출한다. 이미 있는 정기 작업이나 운영 집계 경로에서 호출할 수 있으며, `/metrics` 요청마다 무거운 전체 표 집계를 실행하도록 만들지 않는다.

여러 웹 인스턴스가 같은 전역 Outbox를 각각 관찰하면 같은 건수가 여러 번 노출된다. 이 값을 인스턴스별로 합산하면 주문이 부풀려진다. 하나의 표본 생산자를 정하거나, 같은 원본을 보는 표본에는 `max` 같은 중복 제거 집계 정책을 사용한다. 서로 다른 분할을 각각 관찰하는 구조라면 합산이 맞을 수도 있으므로 대시보드 제목에 전역 값인지 분할 값인지 명시한다.

마지막 성공 시각이 오래되면 대기 건수가 0이어도 “문제가 없다”고 말할 수 없다. 표본 수집기 자체가 멈췄을 수 있기 때문이다. 미수집 상태를 건강한 0과 구분하는 것은 캐시, 재고 투영, 배송 대사에서도 반복해서 쓰는 원칙이다. `recordOutbox()`는 스케줄러를 만들지 않으며, 어느 프로세스가 어떤 주기로 호출하는지는 애플리케이션의 운영 설정에 남는다.

## 진단과 트래픽 수용을 같은 질문으로 만들지 않기

배송 지연을 발견했다고 모든 웹 인스턴스의 readiness를 실패시키면 게시글도 상품 조회도 멈출 수 있다. 반대로 주문을 영속화할 DB 연결이 끊겼는데 readiness가 성공하면 새로운 구매 요청을 계속 받는다. `/health`는 원인을 모으는 진단이고 `/ready`는 이 인스턴스를 트래픽 수용 대상으로 둘지 정하는 이진 판단이다.

다음 완전한 파일 `src/operations/operations.module.ts`는 기존 `BlogDatabaseModule`을 재사용한다. 이 모듈의 async global Prisma 등록을 새 `forRoot`로 대체하지 않는다. 현재 전역 export는 Terminus에서도 보이지만 소유 모듈을 `imports`에 명시해 의존 관계를 드러낸다. 나중에 scoped 등록으로 바꾸는 경우에는 이 명시적 가시성 연결이 필수다. `MetricsService`도 non-global이므로 이를 사용하는 `SaleMetrics`와 같은 모듈에서 import하고 필요한 서비스만 export한다.

```ts
import { Module } from '@fluojs/core';
import { ForbiddenException, type MiddlewareContext, type Next } from '@fluojs/http';
import { MetricsModule, MetricsService } from '@fluojs/metrics';
import { createPrismaHealthIndicatorProvider, TerminusModule } from '@fluojs/terminus';
import { MemoryHealthIndicator } from '@fluojs/terminus/node';
import { BlogDatabaseModule } from '../database/blog-database.module.js';
import { SaleMetrics } from './sale-metrics.js';

export function createOperationsModule(probeToken: string) {
  if (probeToken.trim().length === 0) {
    throw new Error('An operations probe token is required.');
  }
  class ProbeBoundary {
    async handle(context: MiddlewareContext, next: Next): Promise<void> {
      if (context.request.headers['x-ops-token'] !== probeToken) {
        throw new ForbiddenException('Operations probe authentication failed.');
      }
      await next();
    }
  }
  @Module({
    imports: [
      MetricsModule.forRoot({
        path: '/internal/metrics',
        http: {
          pathLabelMode: 'template',
          durationHistogramBuckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
        },
        endpointMiddleware: [ProbeBoundary],
      }),
      TerminusModule.forRoot({
        path: '/internal',
        imports: [BlogDatabaseModule],
        endpointMiddleware: [ProbeBoundary],
        execution: { indicatorTimeoutMs: 1_000 },
        indicatorProviders: [
          createPrismaHealthIndicatorProvider({
            key: 'shop-database',
            timeoutMs: 800,
          }),
        ],
        indicators: [
          MemoryHealthIndicator.create({
            key: 'heap',
            heapUsedThresholdRatio: 0.9,
            readiness: false,
          }),
        ],
      }),
    ],
    providers: [SaleMetrics],
    exports: [SaleMetrics, MetricsService],
  })
  class OperationsModule {}
  return OperationsModule;
}
```

기존 `src/app.ts`의 조합 경계에서 `createOperationsModule(validatedProbeToken)`을 한 번 호출하고 반환된 모듈 객체를 공유한다. 기능마다 팩터리를 다시 호출해 관측 경로와 collector를 중복 등록하지 않는다. `PaymentsModule` 등 계측하는 기능은 그 모듈을 import한 뒤 `@Inject(SaleMetrics)`로 주입한다. 토큰은 기존 설정 경계에서 읽고 코드나 로그에 원문을 남기지 않는다. 실습 토큰 비교는 경로별 보호의 예이며, 운영의 사설 네트워크와 TLS 또는 프록시 인증 정책을 대체한다고 보지 않는다. 배포 probe와 수집기에도 같은 접근 조건을 설정해야 한다.

`endpointMiddleware`는 class 기반이며 지정한 관측 엔드포인트에만 적용된다. 전체 애플리케이션 `middleware`에 같은 정책을 걸면 블로그 독자도 probe 토큰을 요구받는다. `path: false`는 Metrics의 scrape 경로를 끄는 옵션이지만 HTTP 계측 활성화와는 별개다. 관측 경로가 인터넷에 노출되지 않는 배포 경계를 먼저 정한 다음 활성화한다.

Prisma indicator는 단순한 `SELECT 1` 이전에 래퍼의 수명주기 상태를 확인한다. 원시 클라이언트가 아직 질의할 수 있어도 종료가 시작된 통합은 새 작업을 받을 준비가 된 것이 아니다. Heap indicator는 이 예제에서 진단에만 참여한다. 이것은 메모리 압박을 무시한다는 뜻이 아니라 하나의 비율로 인스턴스를 퇴출하면 부하가 남은 인스턴스로 이동하여 상황을 악화시킬 수 있다는 선택이다. 장기 상승, GC 비용과 요청 지연을 함께 보고 경보와 용량 계획으로 대응한다.

Terminus의 indicator는 기본적으로 readiness에 참여한다. `readiness: false`인 indicator만 그 참여에서 빠지며, 추가 `readinessChecks`를 넣어도 기존 indicator 검사가 사라지지 않는다. `/ready`의 본문은 `{ status: 'ready' }`, `{ status: 'starting' }`, `{ status: 'unavailable' }` 범위이고 HTTP 상태는 200 또는 503이다. `/health`의 상세 contributors를 readiness 본문에서도 받을 것으로 가정하지 않는다. 별도 process-only liveness 경로는 기본 생성되지 않는다.

## 가설을 좁히는 쿼리

다음은 Prometheus에 수집한 뒤 사용할 **조회 표현식**이다. 첫 식은 최근 5분간 주문 생성의 5xx 비율이고, 둘째는 모든 인스턴스의 checkout 작업을 합쳐 계산한 95백분위 지연이다. 인스턴스별 백분위 값을 평균 내지 않고 histogram bucket을 먼저 합친다. 요청이 거의 없는 구간에서는 비율과 백분위가 불안정하므로 절대 요청 수도 같이 본다.

```promql
sum(rate(http_requests_total{method="POST",path="/orders",status=~"5.."}[5m]))
/
clamp_min(sum(rate(http_requests_total{method="POST",path="/orders"}[5m])), 0.001)

histogram_quantile(
  0.95,
  sum by (le) (
    rate(shop_operation_duration_seconds_bucket{stage="checkout"}[5m])
  )
)
```

대기 나이는 다음처럼 건수가 양수인 표본만 대상으로 한다. 마지막 식은 표본 갱신이 60초 넘게 멈춘 상황을 찾는다. 60초는 샘플 설정값이지 제품에 보편적으로 맞는 경계가 아니다. 실제 표본 주기와 허용 지연을 기준으로 정해야 한다. Prometheus 자체가 대상을 수집하지 못하는 상황에는 scrape의 `up`과 시계열 부재도 별도로 관찰한다.

```promql
(time() - shop_outbox_oldest_pending_timestamp_seconds)
and (shop_outbox_pending_jobs > 0)

time() - shop_outbox_sample_timestamp_seconds > 60
```

이제 가설을 세울 수 있다. checkout 시간이 늘고 DB 연결 대기도 늘면 SQL 경계나 풀 포화를 조사한다. HTTP는 빠른데 `applied` 비율만 낮고 `duplicate`가 높으면 결제사의 재전송과 멱등성 결과를 확인한다. 결제 적용은 안정적이지만 Outbox 나이가 계속 증가하면 publisher와 배송 소비자 경계를 따라간다. 큐 대기 건수는 안정적인데 fulfillment 실행 시간만 길어지면 배송 단계의 외부 의존성과 잠금 시간을 의심한다.

한 번에 워커 수, 풀 크기, 재시도 횟수를 모두 올리지 않는다. 워커를 늘려 DB 대기가 더 길어졌다면 병목을 옮겼거나 키웠을 수 있다. 일정한 SKU 분포와 주문 입력으로 변경 전후의 처리량, 오류 비율, 지연 분포, 대기 나이를 비교한다. 이 장의 실험은 실제 결제나 외부 배송 발주를 하지 않는 어댑터에서 수행한다. 컴퓨터 한 대의 결과를 운영 용량 보장으로 옮기지 않는다.

## 관측 코드도 실패를 시험한다

다음 완전한 파일 `src/operations/sale-metrics.test.ts`는 실제 Registry 출력의 기계 값을 검사한다. 지표 설명 문구를 고정하지 않는다. 기다리는 시간 없이 성공·중복·예외를 직접 발생시키고, 실패한 경계가 진행 중 수를 남기지 않는지 본다. `MetricsService`와 `Registry`를 직접 구성하는 것은 collector 동작에 초점을 맞춘 단위 실험이며 모듈 가시성 시험은 아니다.

```ts
import { MetricsService, Registry } from '@fluojs/metrics';
import { expect, it } from 'vitest';
import { SaleMetrics } from './sale-metrics.js';

it('separates duplicate payments and clears failed activity', async () => {
  const registry = new Registry();
  const metrics = new SaleMetrics(new MetricsService(registry));
  await metrics.payment(async () => ({ kind: 'applied' as const }));
  await metrics.payment(async () => ({ kind: 'duplicate' as const }));
  const failure = new Error('Database unavailable.');
  await expect(metrics.payment(async () => { throw failure; })).rejects.toBe(failure);
  metrics.recordOutbox({
    pending: 2,
    oldestCreatedAt: new Date('2026-01-01T00:00:00Z'),
    sampledAt: new Date('2026-01-01T00:01:00Z'),
  });
  const text = await registry.metrics();
  expect(text).toContain('shop_payment_outcomes_total{outcome="applied"} 1');
  expect(text).toContain('shop_payment_outcomes_total{outcome="duplicate"} 1');
  expect(text).toContain('shop_payment_outcomes_total{outcome="error"} 1');
  expect(text).toContain('shop_operations_active{stage="payment"} 0');
  expect(text).toContain(
    'shop_operation_duration_seconds_count{stage="payment",result="error"} 1',
  );
  expect(text).toContain('shop_outbox_pending_jobs 2');
});
```

통합 실험에서는 `createOperationsModule`을 등록한 앱에 `@fluojs/testing`의 `createTestApp`으로 요청한다. 토큰 없는 `/internal/metrics`는 403, 올바른 토큰을 준 경로는 Prometheus content type과 지표 문자열을 반환해야 한다. `/products` 같은 기존 공개 경로에는 probe 토큰이 필요 없어야 한다. 단위 실험에서 collector가 맞아도 경로별 보호가 전역에 잘못 걸릴 수 있으므로 실제 요청 경계를 한 번 더 본다.

readiness 실험은 실제 DB를 끊는 대신 먼저 제어 가능한 indicator로 결과를 바꾸어 검증할 수 있다. 선택적 indicator만 `down`이면 `/health`는 503이지만 다른 필수 조건이 정상인 `/ready`는 200이어야 한다. 필수 DB indicator가 `down`이면 두 경로 모두 503이어야 한다. 실제 연결 단절은 별도 실습 DB에서 검증하고, 시뮬레이션 결과를 네트워크 장애 검증으로 부르지 않는다.

timeout은 원시 작업의 취소와 다르다. `indicatorTimeoutMs`는 진단 응답을 무기한 붙잡지 않도록 하지만 모든 드라이버의 진행 중 질의를 강제로 중단하지 않는다. 같은 indicator의 이전 probe가 아직 실행 중이면 새 요청에서 중첩 probe를 시작하지 않는 계약도 있다. 느린 DB에서 probe까지 쌓여 장애를 증폭시키지 않는지 패키지의 요청 회귀 테스트와 함께 확인한다.

공유 Registry 실험도 별개다. 기본 등록은 앱 bootstrap마다 Registry가 격리된다. 여러 앱이 하나를 공유해야 한다면 bootstrap provider인 `METRICS_REGISTRY`를 사용한다. 관련 없는 모듈 provider에 같은 토큰을 적는 것으로 소유권이 설정되지 않는다. 공유 모드도 애플리케이션의 중복 metric 이름을 덮어쓰지 않으며, 내장 HTTP collector는 라벨과 계측 설정까지 일치해야 재사용된다.

이 원고에서는 새 판매 부하, 실제 PostgreSQL 단절, Prometheus scrape를 실행하지 않았다. 위 단위 코드와 통합 절차는 검증 방법과 예상 결과를 제시한다. 저장소의 패키지 테스트는 공개 API와 수명주기 계약의 근거이며 FluoShop 배포가 검증되었다는 증거는 아니다.

## 판매를 멈출 조건과 계속할 조건

운영자는 이제 “전체 서버가 느리다” 대신 어느 단계가 늦고 어느 결과가 늘었는지 말할 수 있다. 그렇다고 모든 지표 상승이 자동으로 판매 중단을 뜻하지는 않는다. 배송 지연은 추가 주문을 언제까지 받을 수 있는지, 취소·문의가 얼마나 늘었는지와 함께 판단한다. 주문을 안전하게 저장할 수 없거나 금액 정합성을 확인할 수 없으면 해당 구매 경로는 멈추는 것이 맞다. 읽기 기능까지 같은 기준으로 꺼야 하는지는 별도 결정이다.

관측 계층은 정합성을 대신하지 않는다. 성공 카운터가 정상이어도 영속 기록이 잘못되면 주문은 잘못된 것이다. 반대로 진단 수집이 잠시 끊겨도 영속 기록과 대사 경로가 살아 있다면 상태를 복구할 수 있다. 그래서 다음 장에서는 장애를 일부러 주입하고 지표와 DB 결과를 나란히 확인한다. 두 번째 권의 마지막 검증은 화려한 대시보드가 아니라, 실패한 주문을 설명하고 안전하게 다시 처리할 수 있다는 증거다.

## 근거와 더 읽을 소스

- [Metrics 등록·Registry·라벨 계약](../../packages/metrics/README.ko.md), [공개 export](../../packages/metrics/src/index.ts), [collector 생성 서비스](../../packages/metrics/src/metrics-service.ts), [HTTP 라벨과 계측](../../packages/metrics/src/http-metrics-middleware.ts)
- [scrape 경로 요청 테스트](../../packages/metrics/src/metrics-module.request.test.ts), [Registry와 플랫폼 계측 구현](../../packages/metrics/src/metrics-module.ts)
- [Terminus readiness와 진단 계약](../../packages/terminus/README.ko.md), [공개 export](../../packages/terminus/src/index.ts), [옵션과 indicator 타입](../../packages/terminus/src/types.ts), [Prisma 수명주기 인디케이터](../../packages/terminus/src/indicators/prisma.ts)
- [의존성 모듈 가시성 테스트](../../packages/terminus/src/module-sibling-composition.test.ts), [요청·timeout 회귀 테스트](../../packages/terminus/src/request-regressions.test.ts), [공개 서브패스 테스트](../../packages/terminus/src/public-subpaths.test.ts)

[이전](./ch26-mongoose-lab.ko.md) · [목차](./toc.ko.md) · [다음](./ch28-failure-drills.ko.md)
