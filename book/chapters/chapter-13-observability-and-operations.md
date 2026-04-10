# 13장. 관측 가능성과 운영

> **기준 소스**: [repo:docs/concepts/observability.md] [ex:ops-metrics-terminus/README.md]
> **주요 구현 앵커**: [ex:ops-metrics-terminus/src/app.ts] [ex:ops-metrics-terminus/src/ops/ops.controller.ts]

이 장은 Konekti에서 운영이 부가 기능이 아니라는 점을 설명한다. metrics, health, ready, request correlation은 “나중에 붙이는 것”이 아니라 앱이 스스로를 설명하는 기본 수단이다 `[repo:docs/concepts/observability.md]`.

## 왜 observability를 책 후반이 아니라 중반에 다뤄야 하는가

관측 가능성은 종종 운영팀의 영역처럼 취급되지만, Konekti 문맥에서는 그렇지 않다. readiness와 health, metrics endpoint, request correlation은 모두 런타임과 request pipeline이 이미 어떤 구조를 갖고 있는지 위에서만 의미를 가진다 `[repo:docs/concepts/observability.md]`. 즉, observability는 운영의 부록이 아니라 **애플리케이션이 자기 상태를 외부에 드러내는 계약**이다.

특히 observability 문서는 `/health`와 `/ready`를 명확히 구분한다. 이는 단순 엔드포인트 개수가 아니라, **프로세스가 살아 있는가**와 **트래픽을 받을 준비가 되었는가**를 나누는 운영 사고방식이다 `[repo:docs/concepts/observability.md]`.

`ops-metrics-terminus` 예제의 `app.ts`는 metrics와 terminus 모듈이 실제로 어떻게 등록되는지 보여준다 `[ex:ops-metrics-terminus/src/app.ts]`. 이 장에서는 그 코드를 중심으로 “운영 가능성도 결국 module composition의 한 형태”라는 점을 설명할 수 있다.

## `/health`와 `/ready`를 왜 나눠야 하나

이 구분은 운영 경험이 적은 독자에게는 사소해 보일 수 있다. 하지만 실제 시스템에서는 큰 차이를 만든다.

- `/health`는 프로세스가 살아 있는가를 묻는다.
- `/ready`는 지금 트래픽을 받아도 되는가를 묻는다.

Konekti가 이 둘을 분리해서 설명하는 이유는, 앱의 생존과 준비 상태를 같은 것으로 취급하지 않기 때문이다 `[repo:docs/concepts/observability.md]`.

## module composition으로서의 운영

`ops-metrics-terminus` 예제의 `AppModule`은 metrics와 terminus를 다른 feature module처럼 imports에 올려 조합한다 `[ex:ops-metrics-terminus/src/app.ts]`. 이것이 의미하는 바는 분명하다. 운영 기능도 예외적인 부착물이 아니라, **정상적인 module composition의 일부**다.

```ts
// source: ex:ops-metrics-terminus/src/app.ts
@Module({
  imports: [
    MetricsModule.forRoot({ registry: sharedRegistry }),
    TerminusModule.forRoot({
      indicators: [new MemoryHealthIndicator({ key: 'memory', rssThresholdBytes: Number.MAX_SAFE_INTEGER })],
    }),
    OpsModule,
  ],
})
export class AppModule {}
```

이 코드가 보여 주는 것은 운영 기능이 앱 바깥에서 덕지덕지 붙는 것이 아니라, 앱 구조 안에서 **정상적인 module import**로 취급된다는 사실이다 `[ex:ops-metrics-terminus/src/app.ts]`. Konekti의 운영 철학은 여기서도 일관된다. 운영도 구조와 계약 안에 들어와야 한다.

이 관점은 Konekti의 장점이기도 하다. observability가 “프레임워크 밖의 툴링”처럼 달리는 것이 아니라, 앱 구조 안에서 일관되게 다뤄지기 때문이다.

## custom metric은 어디서 만들어지는가

운영 장에서는 framework-provided metric만큼이나 app-provided metric도 중요하다. `metrics-registry.ts`는 이 점을 아주 깔끔하게 보여 준다 `[ex:ops-metrics-terminus/src/ops/metrics-registry.ts]`.

```ts
// source: ex:ops-metrics-terminus/src/ops/metrics-registry.ts
export const sharedRegistry = new Registry();
const meter = new PrometheusMeterProvider(sharedRegistry);

export const exampleJobsTriggeredCounter = meter.createCounter(
  'example_ops_jobs_triggered_total',
  'Total number of example ops job trigger requests.',
);
```

이 코드가 보여 주는 것은 단순한 counter 생성법이 아니다. framework metric과 application metric이 **같은 registry 위에 공존할 수 있는 구조**가 먼저 준비된다는 점이다. 즉, 운영 데이터는 바깥 도구에 던져 놓는 것이 아니라 앱과 같은 구조 안에서 관리된다.

## metrics endpoint는 framework가 어떻게 만든다

`packages/metrics/src/metrics-module.ts`를 보면 metrics endpoint조차 controller로 생성된다 `[pkg:metrics/src/metrics-module.ts]`.

```ts
// source: pkg:metrics/src/metrics-module.ts
@Controller('')
class MetricsController {
  @Get(metricsPath)
  async getMetrics(_input: undefined, ctx: RequestContext): Promise<string> {
    await platformTelemetry.refresh(ctx);
    ctx.response.setHeader('content-type', registry.contentType);
    return registry.metrics();
  }
}
```

이 발췌가 중요한 이유는 observability가 framework 바깥의 어색한 플러그인처럼 붙지 않는다는 점을 보여 주기 때문이다. metrics 노출도 결국 Konekti의 정상적인 controller/route 모델 안에서 이루어진다 `[pkg:metrics/src/metrics-module.ts#L95-L103]`.

즉, 운영 기능도 다른 모든 기능처럼 **module, controller, provider 계약** 위에서 구성된다.

## 작은 운영 endpoint가 왜 교육적으로 좋은가

`ops.controller.ts`와 `ops-metrics.service.ts`는 이 장에서 매우 좋은 예시다 `[ex:ops-metrics-terminus/src/ops/ops.controller.ts]` `[ex:ops-metrics-terminus/src/ops/ops-metrics.service.ts]`.

```ts
// source: ex:ops-metrics-terminus/src/ops/ops.controller.ts
@Inject(OpsMetricsService)
@Controller('/ops')
export class OpsController {
  constructor(private readonly service: OpsMetricsService) {}

  @Get('/jobs/trigger')
  triggerJob() {
    return this.service.triggerJob();
  }
}
```

```ts
// source: ex:ops-metrics-terminus/src/ops/ops-metrics.service.ts
export class OpsMetricsService {
  triggerJob() {
    exampleJobsTriggeredCounter.inc();
    return { accepted: true, metric: 'example_ops_jobs_triggered_total' };
  }
}
```

이 조합이 교육적으로 좋은 이유는, business action 하나가 metrics와 직접 연결되는 모습을 아주 작게 보여 주기 때문이다. “운영”이 별도 팀의 영역이 아니라, **도메인 action이 남기는 관측 가능한 흔적**이라는 감각을 독자에게 줄 수 있다.

## 운영도 결국 테스트되어야 한다

observability는 “엔드포인트가 있으니 됐다”로 끝나면 안 된다. 실제로 metrics와 health가 기대대로 노출되는지 테스트하는 흐름이 중요하다. 이 점에서 `ops-metrics-terminus` 예제의 테스트는 운영 기능이 실제 contract라는 사실을 뒷받침한다 `[ex:ops-metrics-terminus/README.md]`.

```ts
// source: ex:ops-metrics-terminus/src/app.test.ts
await expect(app.dispatch({ method: 'GET', path: '/health' })).resolves.toMatchObject({
  status: 200,
});

const triggerResult = await app.dispatch({ method: 'GET', path: '/ops/jobs/trigger' });
expect(triggerResult.status).toBe(200);

const metricsResult = await app.dispatch({ method: 'GET', path: '/metrics' });
expect(metricsResult.status).toBe(200);
expect(metricsResult.body).toContain('example_ops_jobs_triggered_total');
expect(metricsResult.body).toContain('konekti_component_ready');
```

이 테스트가 좋은 이유는 운영 기능의 핵심을 아주 짧게 증명하기 때문이다. health endpoint가 살아 있고, business action이 counter를 증가시키며, 그 결과가 `/metrics` scrape에 실제로 드러난다 `[ex:ops-metrics-terminus/src/app.test.ts#L87-L109]`. 즉, observability는 장식이 아니라 **검증 가능한 계약**이다.

## 운영 장에서 독자가 가져가야 하는 감각

이 장을 제대로 읽은 독자는 observability를 “모니터링 붙이기”로 이해하면 안 된다. 오히려 다음처럼 이해해야 한다.

- module composition이 운영 기능까지 포괄한다.
- request lifecycle은 metrics와 health semantics와 연결된다.
- 운영 기능도 테스트와 함께 유지되어야 한다.

이 감각이 생기면 observability는 부록 주제가 아니라, runtime contract의 확장선으로 보이기 시작한다.

## readiness와 component 상태의 연결

observability를 더 깊게 이해하려면, health/ready가 단순 endpoint가 아니라 component 상태 집계의 결과라는 점을 기억해야 한다. 이때는 4장의 platform shell과 다시 연결해서 읽는 것이 좋다 `[pkg:runtime/src/platform-shell.ts]`. 즉, 운영 장은 독립된 부록이 아니라 bootstrap/lifecycle 장의 후속편이다.

이런 교차 참조가 책에서 중요하다. 그래야 독자가 운영 기능을 “나중에 붙이는 모듈”이 아니라, **초기 설계에서 이미 예견된 runtime contract의 일부**로 이해하게 된다.

## 메인테이너 시각

메인테이너는 운영 기능을 “있으면 좋은 것”으로 보지 않는다. request tracing, metrics, readiness는 behavior contract를 실제 운영 환경에서 관찰할 수 있게 해 주는 도구이기 때문이다. 즉, observability는 기능이 아니라 **신뢰를 유지하는 수단**이다.
