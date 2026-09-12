# 성능 주장을 실험으로 검증하기

<!-- book:volume=03-internals;chapter=19 -->

[이전: CLI와 Studio가 애플리케이션을 보는 방법](./ch18-cli-and-studio.ko.md) · [3권 목차](./toc.ko.md) · [다음: 프레임워크 변경 하나를 끝까지 제출하기](./ch20-contributing-a-change.ko.md)

## 빠르다는 문장에 빠진 목적어

FluoBlog의 티셔츠 판매 이벤트를 앞두고 한 개발자가 “모듈 그래프 캐시를 켜면 더 빠르다”는 결과를 가져왔다. 같은 프로세스에서 작은 앱을 반복 생성한 실험이었다. 운영자는 이 수치를 보고 주문 API의 지연도 줄어들 것이라 기대했다. 그러나 운영 환경은 앱을 한 번 시작해 오래 실행하고, 주문 요청의 상당한 시간은 PostgreSQL 거래와 재고 경합에 쓰인다. 시작 작업의 일부를 줄인 결과를 정상 상태의 주문 처리 성능으로 옮겨 읽은 것이다.

앞 장에서 snapshot과 live 자료의 출처를 나눴다면 이번에는 숫자의 출처를 나눈다. 프로세스 시작, 모듈 그래프 컴파일, provider 생성, lifecycle 실행, 요청 처리, 종료는 서로 다른 비용이다. 같은 밀리초 단위를 사용한다고 같은 측정량이 되지 않는다. 먼저 바꾸려는 비용과 제품의 실패를 연결해야 한다.

이번 실험의 질문은 좁다. **같은 모듈 identity로 application context를 반복 구성할 때, 모듈 그래프 캐시가 부트스트랩 비용을 얼마나 바꾸는가?** 개발 도구가 같은 앱 구조를 여러 번 검사하거나 테스트가 같은 slice를 반복 조립할 때에 관련된 질문이다. 실제 주문 HTTP 처리량, 데이터베이스 쿼리, 결제 성공률을 측정하는 실험은 아니다.

이 질문을 고른 이유는 공개 API로 대조군과 실험군을 만들 수 있고, 최적화가 보존해야 하는 정합성을 함께 검사할 수 있기 때문이다. 캐시가 service 인스턴스까지 잘못 재사용하면 숫자는 매우 좋아질 수 있다. 하지만 이전 앱에서 닫은 자원이나 고객 상태가 다음 앱으로 새면 최적화가 아니라 결함이다. 시간보다 먼저 결과와 수명주기 격리를 검증한다.

## 측정 전에 구현 경계를 읽는다

`@fluojs/runtime`의 `moduleGraphCache`는 기본적으로 꺼져 있다. `true`로 process-local cache를 선택하거나 `ModuleGraphCompileCache` 인스턴스를 넘겨 보관량과 종료를 호출자가 소유할 수 있다. 여기서는 후자를 쓴다. 실험 하나가 끝났는데 전역 캐시가 다음 실험의 초기 상태를 바꾸지 않도록 하기 위해서다.

캐시 키에는 root module identity, 런타임 provider 입력, validation token, 모듈 replacement 쌍, core의 module/class-DI metadata write version, 컴파일 알고리즘 버전이 반영된다. 이름이 같은 클래스라고 같은 identity가 아니며, 설정이 바뀌어도 항상 재사용되는 무조건적인 메모이제이션도 아니다. 실패한 그래프 컴파일은 캐시하지 않는다. 반환하는 compiled graph는 보관된 snapshot과 분리되어야 한다.

이 계약은 캐시의 비용도 설명한다. hit여도 키를 계산하고 반환할 자료를 복제하는 비용이 있다. 작은 그래프에서는 절약한 순회 비용보다 관리 비용이 더 크게 보일 수 있다. 그래프가 크다는 말만으로 효과가 정해지는 것도 아니다. 옵션과 동적 모듈 identity가 계속 달라지면 reuse가 줄어든다. “캐시 사용”이라는 설정값과 “유의미한 재사용”이라는 관측 결과를 구별한다.

런타임의 `diagnostics: { timing: true }`는 bootstrap phase를 제공한다. `bootstrap_module`은 이 실험에서 관심 있는 근접 지표지만 순수 캐시 lookup 시간 하나는 아니다. 공개 bootstrap 경계 안의 작업을 포함한다. `totalMs`와 외부에서 잰 경과 시간도 같다고 가정하지 않는다. 외부 측정에는 wrapper 진입, 로깅, 결과 반환 등의 비용이 포함될 수 있다. application context에는 HTTP dispatcher를 만들 이유가 없으므로 `create_dispatcher` phase가 없는 것도 정상이다.

## 도메인 계산을 고정한 작은 fixture

측정할 때마다 주문을 임의 생성하면 입력 분포까지 바뀐다. 이 장에서는 서버가 보유한 읽기 모델의 고정 snapshot을 사용한다. 기본 통화는 KRW이고 금액은 최소 화폐 단위 정수다. 기존 계정 식별자 `reader-7`을 유지한다. 실제 결제를 만들거나 과거 주문 가격을 새 상품 가격으로 다시 계산하지 않는다.

다음은 **완전한 `fluo-blog/src/experiments/order-bootstrap.fixture.ts` 파일**이다. 독립 실험용 `OrdersModule`이지 기존 제품의 OrdersModule 파일을 교체하는 코드가 아니다. 데이터베이스와 인증 모듈을 새로 만들지도 않는다. 1,000건 중 짝수 인덱스의 500건만 `paid`이며 각 주문의 snapshot 금액은 25,000이다. 따라서 합계의 oracle은 12,500,000으로 고정된다.

주문은 version 0으로 생성되므로 `pending_payment` 행은 0, 첫 결제 완료 전이를 나타내는 `paid` 행은 1로 둔다. 게시글의 초기 version 1과 혼동하지 않는다. 실제 상품 가격은 `ProductVariant`에서 주문 시 확정해 snapshot으로 남기는 경계를 유지한다. 이 고정 입력은 그 이후의 읽기 모델만 흉내 내며 별도 SKU 원장이나 재고 회계 모델을 도입하지 않는다.

```ts
import { Inject, Module } from '@fluojs/core';

interface OrderSnapshot {
  readonly id: string;
  readonly customerId: string;
  readonly status: 'pending_payment' | 'paid';
  readonly currency: 'KRW';
  readonly totalMinor: number;
  readonly version: number;
}

const ORDER_SNAPSHOTS = Symbol('ORDER_SNAPSHOTS');
const snapshots: readonly OrderSnapshot[] = Object.freeze(
  Array.from({ length: 1_000 }, (_, index): OrderSnapshot => Object.freeze({
    id: `order-${index + 1}`,
    customerId: 'reader-7',
    status: index % 2 === 0 ? 'paid' : 'pending_payment',
    currency: 'KRW',
    totalMinor: 25_000,
    version: index % 2 === 0 ? 1 : 0,
  })),
);

@Inject(ORDER_SNAPSHOTS)
export class OrderSummary {
  private active = false;

  constructor(private readonly orders: readonly OrderSnapshot[]) {}

  onModuleInit(): void {
    this.active = true;
  }

  totals(): { paidCount: number; paidTotalMinor: number } {
    if (!this.active) {
      throw new Error('OrderSummary is not active.');
    }
    let paidCount = 0;
    let paidTotalMinor = 0;
    for (const order of this.orders) {
      if (order.status === 'paid') {
        paidCount += 1;
        paidTotalMinor += order.totalMinor;
      }
    }
    return { paidCount, paidTotalMinor };
  }

  onDestroy(): void {
    this.active = false;
  }
}

@Module({
  providers: [
    { provide: ORDER_SNAPSHOTS, useValue: snapshots },
    OrderSummary,
  ],
  exports: [OrderSummary],
})
class OrdersModule {}

@Module({ imports: [OrdersModule] })
export class ExperimentAppModule {}
```

`active`는 성능을 흉내 내기 위한 가짜 작업이 아니다. service가 초기화 전에 사용되거나 종료 뒤 다시 사용되는 것을 관찰 가능하게 만드는 probe다. 캐시가 라이프사이클을 생략하거나 이전 service를 돌려주면 합계만 같다는 테스트로는 놓칠 수 있지만 이 상태를 함께 보면 드러난다. 실제 자원을 열지 않으면서도 자원 소유권 회귀를 설명할 수 있다.

snapshot 배열과 각 행은 동결한다. `useValue`로 전달한 객체 identity는 공급자와 소비자가 공유할 수 있기 때문에, 실험 코드의 의도치 않은 수정이 다음 시행의 입력을 바꾸지 않게 한다. 이것을 Fluo가 모든 application data를 깊게 복제해 준다는 보장으로 해석하지 않는다. 모듈 metadata의 보호와 provider value의 객체 소유권은 다른 층이다.

## 먼저 같은 결과와 다른 인스턴스를 증명한다

다음은 **완전한 `fluo-blog/src/experiments/order-bootstrap.test.ts` 파일**이다. `@fluojs/testing`으로 정상 모듈 조립을 확인하고, runtime context 두 개로 캐시를 켠 경우의 격리를 확인한다. 전자는 빠른 slice 검증이고 후자는 측정할 진짜 진입점의 계약 검증이다. 테스트 성공 여부에 밀리초 임계값은 없다.

```ts
import { FluoFactory, ModuleGraphCompileCache } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { ExperimentAppModule, OrderSummary } from './order-bootstrap.fixture.js';

const expected = { paidCount: 500, paidTotalMinor: 12_500_000 };

it('computes the fixed order summary through the module graph', async () => {
  const module = await Test.createTestingModule({
    rootModule: ExperimentAppModule,
  }).compile();
  try {
    expect((await module.resolve(OrderSummary)).totals()).toEqual(expected);
  } finally {
    await module.container.dispose();
  }
});

it('reuses compilation without reusing live service instances', async () => {
  const cache = new ModuleGraphCompileCache(8);
  try {
    const first = await FluoFactory.createApplicationContext(ExperimentAppModule, {
      moduleGraphCache: cache,
    });
    let firstService: OrderSummary;
    try {
      firstService = await first.get(OrderSummary);
      expect(firstService.totals()).toEqual(expected);
    } finally {
      await first.close();
    }
    expect(() => firstService.totals()).toThrow();

    const second = await FluoFactory.createApplicationContext(ExperimentAppModule, {
      moduleGraphCache: cache,
    });
    try {
      const secondService = await second.get(OrderSummary);
      expect(secondService).not.toBe(firstService);
      expect(secondService.totals()).toEqual(expected);
    } finally {
      await second.close();
    }
  } finally {
    cache.dispose();
  }
  expect(cache.size).toBe(0);
});
```

테스트 helper의 `.compile()`은 lifecycle과 effective provider를 다룬다. 성공한 reference를 받은 뒤에는 호출자가 container를 정리해야 한다. 그래서 assertion이 실패해도 `finally`가 실행된다. 이를 빼면 성공한 시행만 메모리와 자원을 정리하는 편향이 생기고, 반복 측정에서 이전 시행이 다음 시행을 오염시킨다.

두 context를 동시에 만드는 경합 실험도 유용하지만 이번 시간 비교에는 섞지 않는다. 여기서는 하나를 닫고 다음을 만들기 때문에 프로세스 내부의 관측 대상이 분명하다. 병렬 context 생성 성능을 주장하려면 동시성 수준을 독립 변수로 정한 별도 실험과, 여러 context의 provider 및 종료 격리 테스트가 필요하다.

고장 주입은 구체적으로 한다. fixture의 `onModuleInit`가 정해진 오류를 던지게 바꾸면 context 생성이 reject되어야 하고 성공 표본에 포함되면 안 된다. provider token을 누락한 모듈로 바꾸면 그래프 실패가 발생하며 실패를 성공 캐시 entry로 저장하면 안 된다. 이 두 실패는 느린 성공이 아니다. 실행 시간 배열에 넣고 평균을 낮추는 순간 측정값의 뜻이 깨진다.

## 대조군과 실험군을 한 쌍씩 실행한다

다음은 **완전한 `fluo-blog/src/experiments/order-bootstrap.measure.test.ts` 파일**이다. 앞 fixture와 표준 데코레이터가 설정된 기존 Vitest 환경을 사용한다. 계측은 결과를 출력하는 실험이며 성능 우열을 자동으로 통과시키는 회귀 테스트가 아니다. 타입과 정합성 assertion이 실패하면 측정도 중단한다.

```ts
import { performance } from 'node:perf_hooks';
import {
  FluoFactory,
  ModuleGraphCompileCache,
  type BootstrapTimingDiagnostics,
} from '@fluojs/runtime';
import { expect, it } from 'vitest';
import { ExperimentAppModule, OrderSummary } from './order-bootstrap.fixture.js';

type Mode = 'uncached' | 'cached';
interface Sample {
  pair: number;
  mode: Mode;
  wallMs: number;
  bootstrapMs: number;
  moduleMs: number;
  closeMs: number;
  retainedEntries: number;
}

function moduleDuration(timing: BootstrapTimingDiagnostics): number {
  const phase = timing.phases.find((item) => item.name === 'bootstrap_module');
  if (!phase) {
    throw new Error('Missing bootstrap_module timing.');
  }
  return phase.durationMs;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    throw new Error('At least one sample is required.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const value = sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  if (value === undefined) {
    throw new Error('Percentile index is out of bounds.');
  }
  return value;
}

it('records paired bootstrap samples without a speed threshold', async () => {
  const cache = new ModuleGraphCompileCache(8);
  const samples: Sample[] = [];

  async function run(pair: number, mode: Mode): Promise<Sample> {
    const start = performance.now();
    const context = await FluoFactory.createApplicationContext(ExperimentAppModule, {
      moduleGraphCache: mode === 'cached' ? cache : false,
      diagnostics: { timing: true },
    });
    const wallMs = performance.now() - start;
    let closeMs = 0;
    let measured: Omit<Sample, 'closeMs'>;
    try {
      const service = await context.get(OrderSummary);
      expect(service.totals()).toEqual({
        paidCount: 500,
        paidTotalMinor: 12_500_000,
      });
      const timing = context.bootstrapTiming;
      if (!timing) {
        throw new Error('Bootstrap timing was not collected.');
      }
      measured = {
        pair,
        mode,
        wallMs,
        bootstrapMs: timing.totalMs,
        moduleMs: moduleDuration(timing),
        retainedEntries: cache.size,
      };
    } finally {
      const closeStart = performance.now();
      await context.close();
      closeMs = performance.now() - closeStart;
    }
    return { ...measured, closeMs };
  }

  try {
    for (let pair = 0; pair < 5; pair += 1) {
      await run(pair, 'uncached');
      await run(pair, 'cached');
    }
    for (let pair = 0; pair < 30; pair += 1) {
      const order: Mode[] = pair % 2 === 0
        ? ['uncached', 'cached']
        : ['cached', 'uncached'];
      for (const mode of order) {
        samples.push(await run(pair, mode));
      }
    }
    const summary = (['uncached', 'cached'] as const).map((mode) => {
      const selected = samples.filter((sample) => sample.mode === mode);
      return {
        mode,
        count: selected.length,
        wallP50: percentile(selected.map((sample) => sample.wallMs), 0.5),
        wallP95: percentile(selected.map((sample) => sample.wallMs), 0.95),
        moduleP50: percentile(selected.map((sample) => sample.moduleMs), 0.5),
        closeP50: percentile(selected.map((sample) => sample.closeMs), 0.5),
      };
    });
    console.log(JSON.stringify({ node: process.version, samples, summary }, null, 2));
  } finally {
    cache.dispose();
  }
}, 60_000);
```

먼저 각 모드에 다섯 번의 예열을 준다. 이 수가 모든 환경에서 충분한 예열을 증명하지는 않는다. 최초 실행을 정상 상태 표본과 분리하는 시작 규칙이다. 두 번째 실험에서 예열 횟수를 바꾸려면 근거와 함께 보고한다. 결과를 본 뒤 자신에게 유리한 표본만 예열이었다고 재분류하지 않는다.

측정 구간은 30쌍이고 실행 순서를 번갈아 바꾼다. uncached를 전부 실행한 뒤 cached를 전부 실행하면 JIT, 열 상태, 시스템 부하 변화가 모드 차이처럼 보이기 쉽다. 교대 실행도 이런 영향을 완전히 제거하지는 못하지만 순서 편향을 줄이고 쌍별 원자료를 남긴다. 재현 가능한 순서를 택했으므로 무작위성에 의해 테스트가 통과하거나 실패하지 않는다.

`wallMs`는 context가 반환될 때 멈춘다. 합계 계산과 assertion은 그 뒤라 측정 대상이 아니며, 종료는 `closeMs`로 따로 기록한다. `bootstrapMs`와 `moduleMs`는 런타임의 timing이다. 작은 값은 런타임 반올림 때문에 0으로 보일 수 있다. 그래서 출력된 0을 실제 비용이 없다는 결론으로 바꾸지 않는다.

`retainedEntries`는 소유한 캐시의 보관 상태를 관찰하는 보조 지표이지 hit count가 아니다. 값이 안정적이라고 모든 호출이 hit였다는 뜻은 아니다. 정확한 hit 경로를 연구하려면 해당 소스의 키 계산과 snapshot 재사용 테스트를 따로 읽는다. 공개 API에 없는 hit counter를 원고에서 만들어 사용하지 않는다.

## 숫자를 얻은 뒤에도 아직 결론은 아니다

독자의 프로젝트에서 두 파일을 실행하는 명령은 다음과 같다. 기존 Vitest 설정이 표준 데코레이터를 처리해야 한다. Node 지원 범위는 `>=24.0.0 <27`이며 본문 기준은 Node24와 pnpm10이다. 이 장에서는 명령을 실행한 것처럼 시간 표를 채우지 않는다.

```bash
pnpm exec vitest run src/experiments/order-bootstrap.test.ts src/experiments/order-bootstrap.measure.test.ts --maxWorkers=1
```

먼저 올바른 결과, 종료 후 사용 거부, 새 context의 별도 인스턴스가 통과했는지 확인한다. 다음으로 각 모드에 30개 표본이 있는지, pair와 실행 조건이 맞는지 본다. 중간 예외가 났다면 일부 숫자만 골라 비교하지 말고 실패한 실험으로 기록한다. 실패율을 따로 분석하는 부하 실험과 정상 부트스트랩 시간 비교를 혼합하지 않는다.

보고서에는 소스 revision, Node/pnpm 버전, 운영체제와 CPU, 전원 상태, worker 수, 계측 여부, fixture 크기, 예열과 표본 수를 적는다. 여기서 “캐시가 빠르다”는 결론이 나더라도 범위는 같은 프로세스의 같은 module identity를 반복 조립한 조건이다. 매번 새 프로세스를 띄우는 cold start에는 이 cache가 이어지지 않는다. 첫 번째 uncached 생성과 이미 예열된 cached 생성만 비교해 cold start 개선이라고 제목을 붙이지 않는다.

30개 표본의 p95는 꼬리 지연을 안정적으로 추정하기에는 거칠다. 이 코드의 nearest-rank 방식에서는 상위 몇 표본에 크게 좌우된다. p50은 대표적인 시행을, p95는 큰 지연을 관찰하는 단서로 보되 모집단의 정밀한 한계값처럼 제시하지 않는다. 원자료를 버리지 않는 이유도 분포와 외부 부하를 나중에 다시 확인하기 위해서다.

`moduleMs`는 줄었는데 `wallMs`가 비슷하다면 캐시가 무의미하다고 즉시 단정할 필요는 없다. 그래프 컴파일이 전체 비용에서 작은 몫일 수 있다. 반대로 작은 fixture에서 `wallMs`가 크게 줄었다면 로그 출력과 JIT, provider 구성이 달라지지 않았는지 확인한다. 결과를 설명할 때는 개선 비율뿐 아니라 절대 시간과 적용 빈도를 같이 계산한다. 하루 한 번 시작하는 서비스에서 수 밀리초를 줄이는 것과 매 요청의 거래 대기를 줄이는 것은 제품 가치가 다르다.

## 제품의 성능 문제로 돌아오기

판매 이벤트의 주문 지연을 검증하려면 다음 실험은 실제 HTTP 경계를 통과해야 한다. 먼저 `Test.createApp` 기반으로 인증, 입력 검증, 상태 전이, 응답 정합성이 동일함을 검증한다. 하지만 virtual request helper의 처리량을 실제 Fastify listener의 네트워크 처리량으로 보고하지 않는다. listener 비용을 포함하려면 실제 호스트에서 같은 요청·동시성·데이터 조건을 가진 별도 부하 실험이 필요하다.

부하 발생기가 응답을 기다린 뒤 다음 요청을 보내면 서버가 느려질수록 스스로 유입량을 줄인다. 그 결과만 보면 대기열이 폭증하는 상황을 놓칠 수 있다. 일정 유입률 실험에서는 예정된 요청과 실제 시작 지연도 기록해야 한다. 성공 응답만의 지연과 timeout·오류 비율을 함께 남기고, 결제나 외부 알림은 테스트 포트로 대체한다. 실제 돈이나 외부 전송을 성능 실험의 부작용으로 만들지 않는다.

캐시의 메모리 비용도 시간과 함께 검토한다. 동적 모듈을 계속 만들면 constructor와 snapshot 보관이 늘어날 수 있으므로 이 예제는 크기를 8로 제한하고 끝에 dispose한다. capacity를 키워 hit를 늘린 결과라면 메모리와 수명주기 비용도 보고한다. retained size가 제한된 것과 전체 heap이 누수 없이 일정하다는 것은 다른 주장이다.

성능 실험이 끝났을 때 남아야 하는 것은 승리한 숫자 하나가 아니다. 질문, 고정한 입력, 대조 조건, correctness oracle, 원자료, 측정에서 제외한 비용, 실패 조건을 가진 설명이다. 그 설명이 있으면 동료가 결론에 동의하지 않아도 같은 실험을 재현할 수 있다. 다음 장에서는 이런 증거를 작은 프레임워크 변경과 함께 제출한다. 더 빠르게 만든 줄뿐 아니라 그대로 지켜야 하는 계약까지 리뷰 가능한 형태로 남기는 과정이다.

## 소스 근거와 검증 범위

- [runtime README](../../packages/runtime/README.ko.md), [공개 export](../../packages/runtime/src/index.ts), [부트스트랩 타입](../../packages/runtime/src/types.ts): application context, cache 옵션과 diagnostics.
- [모듈 그래프 구현](../../packages/runtime/src/module-graph.ts), [캐시 테스트](../../packages/runtime/src/module-graph.test.ts): key, 실패 비보관, 반환 snapshot 격리, capacity와 dispose.
- [부트스트랩 구현](../../packages/runtime/src/bootstrap.ts), [부트스트랩 테스트](../../packages/runtime/src/bootstrap.test.ts), [timing 구현](../../packages/runtime/src/health/diagnostics.ts): phase 경계와 lifecycle.
- [testing README](../../packages/testing/README.ko.md), [공개 타입](../../packages/testing/src/types.ts), [테스트 계약](../../docs/contracts/testing-guide.ko.md): slice와 실제 runtime/HTTP 검증의 역할 구분.

새 fixture와 계측 파일은 독자가 재현할 완전한 예제이며 이 원고에서 실행한 benchmark 결과가 아니다. 따라서 속도 향상 수치, 통과 로그, 데이터베이스·실제 HTTP 처리량은 제시하지 않는다. 확인한 근거는 현재 공개 API와 구현·테스트의 계약이다.
