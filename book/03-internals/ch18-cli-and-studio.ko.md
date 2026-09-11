# CLI와 Studio가 애플리케이션을 보는 방법

<!-- book:volume=03-internals;chapter=18 -->

[이전: 재사용 가능한 Fluo 확장 패키지 만들기](./ch17-extension-package.ko.md) · [3권 목차](./toc.ko.md) · [다음: 성능 주장을 실험으로 검증하기](./ch19-performance-experiments.ko.md)

## 주문이 사라진 것이 아니라 관측 대상이 달랐다

상점을 연 FluoBlog의 운영 화면에서 주문 조회가 실패했다. 개발자는 앞 장의 기록 확장을 의심했다. `OrdersModule`에 새 모듈을 import한 뒤 문제가 보였기 때문이다. 다른 개발자는 Studio에 표시된 그림을 보고 “주문 서비스가 등록되지 않았다”고 판단했다. 하지만 그 화면은 어젯밤에 만든 정적 snapshot이었다. 지금 실행 중인 애플리케이션의 DI 그래프가 아니었다.

이 상황에서는 더 많은 로그보다 먼저 관측의 출처를 정해야 한다. 어느 실행에서 만든 자료인지, 부트스트랩이 성공했는지, 파일을 읽은 것인지 살아 있는 프로세스에 연결한 것인지가 필요하다. 같은 Studio 화면 안에 보여도 데이터 생산 경로가 다르면 대답할 수 있는 질문도 다르다. 도구가 보여주지 않는 정보를 “없다”로 해석하면 정상 코드를 고치고 실제 오류는 남겨둔다.

이 장은 같은 제품의 `src/app.ts`와 `src/main.ts` 경계를 유지한다. 전자는 `AppModule`을 export하는 조립부이고 후자는 서버를 시작하는 실행 경계다. CLI 검사에는 `src/app.ts`를 넘긴다. 검사하려고 `src/main.ts`를 import하여 실제 listener나 소비자를 중복 시작하는 방식은 쓰지 않는다. 기존 `examples/fluo-blog`에 전체 주문 모델이 구현되어 있다고 가정하지도 않는다.

질문을 세 가지로 나누면 도구 선택이 쉬워진다. “어떤 라우트와 플랫폼 상태를 내보냈는가”에는 정적 inspect artifact가 적합하다. “지금 어떤 모듈이 무엇을 주입받고 어느 요청이 처리됐는가”에는 Node live Studio가 적합하다. “모듈이 왜 부트스트랩조차 하지 못했는가”에는 컴파일 실패와 stderr, 작은 모듈 테스트가 먼저다. 마지막 질문을 성공한 부트스트랩 이후의 snapshot으로만 풀려고 하지 않는다.

## 세 패키지가 나눠 가진 관측 책임

`@fluojs/cli`의 공개 `runInspectCommand`는 명령 실행을 조율한다. 인수를 해석하고 모듈 경로와 export를 고르고, 런타임을 로드하고, 결과를 JSON이나 report로 감싸며, 파일을 기록한다. 공개 루트는 실제 inspect 구현을 지연 import한다. 단순히 CLI를 import했다고 검사할 애플리케이션이 시작되는 것은 아니다.

실제 구조와 라우트의 권위는 런타임에 있다. inspect 구현은 adapterless application을 만들고 `PLATFORM_SHELL`로 shell을 얻는다. 이어 `snapshot()`과 dispatcher의 route descriptor를 읽어 inspection snapshot을 만든다. TypeScript 파일에서 클래스 이름을 정규식으로 찾아 라우트 목록을 상상하는 도구가 아니다. 따라서 동적 모듈 조립과 실제 dispatcher가 이해하는 effective path를 반영할 수 있지만, 모듈 평가와 부트스트랩의 부수 효과도 실제로 일어날 수 있다.

`@fluojs/studio`는 그 자료의 소비자다. 공개 `parseStudioPayload`가 파일 형식을 확인하고, `applyFilters`가 표시 범위를 바꾸며, `renderMermaid`가 플랫폼 의존 관계를 그린다. 브라우저 viewer는 이 계약 위에서 동작한다. Studio를 `AppModule.imports`에 넣을 `StudioModule` 같은 API는 없다. 설치와 실행은 CLI sidecar와 viewer의 경계이며 애플리케이션의 기능 모듈이 아니다.

정적 inspect는 `PlatformShellSnapshot`과 선택적인 compiled `routes`를 제공한다. 보고된 플랫폼 component와 dependency는 있지만, live 모드의 compiled module/provider graph나 provider scope metadata는 없다. 반대로 Node live 모드는 module, provider, controller, route 노드와 import, export, ownership, dependency 관계를 제공한다. 둘의 차이는 렌더링 옵션 하나가 아니라 생산하는 데이터의 차이다.

## 첫 자료는 안전한 검사 전용 모듈로 만든다

실제 `src/app.ts`를 검사하기 전에 부트스트랩이 실행된다는 사실부터 확인하자. 다음은 **완전한 `fluo-blog/src/diagnostics/inspect-app.ts` 파일**이다. 상점 모듈을 대체하지 않는 독립 실험이며 메모리 값만 사용한다. 검사 전용 모듈에 명시적인 token, provider, export, 클래스 주입을 넣어 CLI가 어디까지 실행하는지 관찰한다.

```ts
import { Inject, Module } from '@fluojs/core';

const ORDER_INSPECTION_STATE = Symbol('ORDER_INSPECTION_STATE');

interface OrderInspectionState {
  readonly orderId: string;
  readonly status: 'paid';
}

@Module({
  providers: [{
    provide: ORDER_INSPECTION_STATE,
    useValue: { orderId: 'order-42', status: 'paid' } satisfies OrderInspectionState,
  }],
  exports: [ORDER_INSPECTION_STATE],
})
class InspectOrdersModule {}

@Inject(ORDER_INSPECTION_STATE)
class LifecycleProbe {
  constructor(private readonly state: OrderInspectionState) {}

  onModuleInit(): void {
    if (this.state.status !== 'paid') {
      throw new Error('Unexpected inspection fixture state.');
    }
    console.error('INSPECT_PROBE_START');
  }

  onDestroy(): void {
    console.error('INSPECT_PROBE_STOP');
  }
}

@Module({
  imports: [InspectOrdersModule],
  providers: [LifecycleProbe],
})
export class InspectAppModule {}
```

여기서 stderr는 고의적인 관찰 통로다. 프로그램이 소비할 JSON을 stdout에 쓰는 실험에서 provider가 `console.log`로 진단을 섞으면 파서가 깨질 수 있다. CLI는 자신의 런타임 진단을 stderr로 분리하지만 애플리케이션이 직접 쓰는 임의 stdout까지 자동으로 정화하는 격리 장치는 아니다. 실무 조립부에서도 import 시점의 출력과 부수 효과를 줄이는 편이 좋다.

Node24와 pnpm10을 사용하는 `fluo-blog` 프로젝트에서 실행할 명령은 다음과 같다. `@fluojs/cli`, `@fluojs/runtime`은 프로젝트에 설치되어 있어야 한다. Studio는 개발 의존성으로 설치한다. 아래 명령은 재현 절차이며 이 원고의 실행 성공 로그가 아니다.

```bash
pnpm add -D @fluojs/studio
pnpm exec fluo inspect ./src/diagnostics/inspect-app.ts --export InspectAppModule --report --output artifacts/inspect-probe-report.json
pnpm exec fluo-studio-viewer
```

첫 명령의 검사는 `INSPECT_PROBE_START`와 `INSPECT_PROBE_STOP`을 stderr에 남겨야 한다. report에는 timing과 snapshot이 생기되 이 fixture에는 controller가 없으므로 routes는 빈 배열이다. 플랫폼 component를 등록하지 않았으므로 비어 있는 플랫폼 그림도 정상이다. `LifecycleProbe`가 그림에 없다고 해서 provider가 실행되지 않았다는 결론은 틀리다. 시작·종료 신호와 정적 snapshot의 생산 범위가 그 반례다.

viewer는 출력한 HTTP URL로 연다. 패키지의 `dist/index.html`을 파일로 직접 열라는 뜻이 아니다. `@fluojs/studio/viewer`는 HTML 진입 파일을 해석하기 위한 asset-resolution subpath이며 실행할 JavaScript 모듈이 아니다. 공개 명령 `fluo-studio-viewer`가 로컬 HTTP 서버를 제공하고, 그 페이지에 report 파일을 넣는다.

같은 실험에서 `InspectAppModule`의 `imports`를 제거하면 `LifecycleProbe`가 요구하는 토큰을 해석하지 못해야 한다. 이때 성공한 report를 기대하지 않는다. 기존 report 파일이 남아 있을 수도 있으므로 “파일이 존재한다”만으로 최신 검사의 성공을 판정해서도 안 된다. 새 실행의 종료 코드와 출력 경로, 생성 시점을 함께 다룬다.

## CLI를 자동화할 때 종료 코드도 자료다

다음은 **완전한 `fluo-blog/tools/inspect-report.mjs` 파일**이다. 검사 전용 모듈을 실행한 다음 같은 산출물을 Studio의 공개 소비자 API로 읽는다. `.mjs` 파일 자체에는 데코레이터가 없다. 검사 대상 `.ts` 파일은 CLI의 명시적 TypeScript loader 경계로 로드한다.

```js
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInspectCommand } from '@fluojs/cli';
import { applyFilters, parseStudioPayload, renderMermaid } from '@fluojs/studio';

const artifactPath = 'artifacts/inspect-probe-report.json';
const exitCode = await runInspectCommand([
  './src/diagnostics/inspect-app.ts',
  '--export',
  'InspectAppModule',
  '--report',
  '--output',
  artifactPath,
], {
  cwd: process.cwd(),
  ci: true,
  interactive: false,
});

if (exitCode !== 0) {
  process.exitCode = exitCode;
} else {
  const raw = await readFile(resolve(artifactPath), 'utf8');
  const { payload } = parseStudioPayload(raw);
  if (!payload.report) {
    throw new Error('Expected an inspect report artifact.');
  }
  const report = payload.report;
  const filtered = applyFilters(report.snapshot, {
    query: '',
    readinessStatuses: ['degraded', 'not-ready'],
    severities: ['warning', 'error'],
  });
  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    summary: report.summary,
    visibleComponentCount: filtered.components.length,
    visibleDiagnosticCount: filtered.diagnostics.length,
    routeCount: report.snapshot.routes?.length ?? 0,
    mermaid: renderMermaid(filtered),
  }, null, 2));
}
```

실행은 프로젝트 루트에서 `node tools/inspect-report.mjs`다. 성공했을 때만 파일을 읽는 분기가 핵심이다. inspect 구현은 산출물을 쓴 뒤 `finally`에서 application을 닫는다. 종료 훅이 실패하면 파일이 이미 있어도 명령은 실패할 수 있다. 그 파일은 부트스트랩 당시의 자료로는 쓸 수 있지만 전체 검사 수명주기가 성공했다는 증거로 쓰면 안 된다.

report의 `summary`에는 component 수, diagnostic 수, error 수, warning 수, health 상태, readiness 상태, 총 timing이라는 일곱 필드가 있다. 소비자 파서는 요약과 snapshot/timing의 일치도 확인한다. 화면에서 보이는 숫자를 얻기 위해 report를 단순히 `JSON.parse`한 뒤 임의 타입으로 단언하지 않는 이유다. 잘못 조립한 보고서를 정상 구조처럼 취급하면 경고가 사라진 것처럼 보일 수 있다.

필터 뒤의 개수는 별도 이름으로 출력한다. `applyFilters`는 원본을 수정하지 않고 component와 diagnostic 표시 범위를 고른다. 필터로 경고 component를 숨겨도 원래 aggregate readiness가 `ready`로 바뀌는 것은 아니다. 필터링된 snapshot을 원래 report의 `snapshot` 자리에 덮어쓴 뒤 기존 summary와 함께 내보내면 일관성 검증에 실패할 수 있다. 표시 자료와 원본 증거를 따로 보관한다.

`--json`과 `--format json`은 같은 출력 모드다. `--timing`은 snapshot 옆에 timing을 넣고 `--report`는 지원 요청에 적합한 요약 envelope를 만든다. `--mermaid`는 Studio 렌더러를 필요로 한다. JSON 검사 자체를 위해 애플리케이션에 Studio 런타임 모듈을 넣을 이유는 없다. 자동화에서는 필요한 선택 패키지가 없을 때 설치 안내와 함께 실패하도록 하고, 도구가 몰래 package manager를 실행해 환경을 바꾸리라 기대하지 않는다.

## 실제 제품으로 옮길 때 바뀌는 질문

검사 전용 실험을 이해했다면 명령 대상을 `./src/app.ts`로 바꿀 수 있다. 다만 그 조립부가 데이터베이스와 작업 소비자를 초기화한다면 inspect도 그 경계를 만날 수 있다. 외부 연결 없는 진단 구성이 필요하면 애플리케이션이 명시적인 모듈 조립으로 제공해야 한다. inspect에 임의의 `--no-side-effects` 옵션이 있다고 가정하지 않는다.

제품의 DB 등록은 기존 `src/database/blog-database.module.ts`의 `BlogDatabaseModule` 하나다. `AppSettings`를 주입받는 비동기 전역 등록을 그대로 유지하며, 진단용이라는 이유로 다른 DB wrapper를 병렬로 추가하지 않는다. 위 fixture는 아예 DB provider가 없는 별도 그래프이므로 그 계약과 충돌하지 않는다. 실제 제품을 검사할 때도 `PaymentLedger.prepare/record`를 호출해 청구를 만들어 상태를 확인하는 방식은 쓰지 않는다. 검사와 거래 실행은 다른 작업이다.

```bash
pnpm exec fluo inspect ./src/app.ts --json --output artifacts/product-snapshot.json
pnpm exec fluo inspect ./src/app.ts --report --output artifacts/product-report.json
```

제품 snapshot의 `routes`에서 `/orders/:id`가 어떤 controller와 handler에 연결됐는지 확인한다. descriptor의 `params`는 `id` 같은 매개변수 **이름**이지 주문 번호가 아니다. `kind`는 일반 HTTP이면 `http`, React 페이지라면 `react-page`일 수 있고 임의의 문자열 kind도 계약상 보존된다. 이 목록은 authoritative dispatcher에서 얻은 투영이지만 투영 자체가 route matching이나 충돌 판정을 다시 수행하지는 않는다.

이름이 같은 controller나 handler가 존재할 때 display label만으로 노드를 연결하지 않는다. 정규화된 route의 `graphNodeId`가 live graph node와의 명시적 연결 키다. 도구 내부의 노드 ID 문자열 규칙을 소비자가 다시 구현하면 규칙이 바뀌거나 이름이 충돌할 때 엉뚱한 서비스가 선택된다. 구형 artifact에서 일부 필드가 생략된 경우의 기본값도 Studio 파서에 맡긴다.

정적 report만으로 “이 고객의 요청이 주문 서비스를 호출했다”는 주장은 할 수 없다. 정적 라우트의 존재는 특정 HTTP 요청의 성공과 다르다. 주문 상태가 `paid`인지, 고객에게 조회 권한이 있는지, 응답이 403인지 200인지는 요청 계층의 검증 대상이다. 계정과 JWT subject는 1권부터 이어진 같은 값을 사용하고, 진단을 위해 인증을 우회하거나 고객 ID를 새로 만드는 일은 하지 않는다.

## 살아 있는 애플리케이션과의 연결

Node 개발 환경에서는 `pnpm exec fluo dev --studio`를 사용한다. CLI는 로컬 sidecar를 시작하고 token이 포함된 URL을 출력한다. 앱이 runtime을 import하기 전에 명시적인 Studio 설정을 child process에 전달한다. runtime 소스가 환경 변수를 직접 읽고 자의적으로 관측을 켜는 구조가 아니다. 이 조기 주입 경계 때문에 임의 native watcher와 조합할 수 없다.

live Studio는 Fluo가 소유한 Node restart runner를 요구한다. `--raw-watch`, `--runner native`, `FLUO_DEV_RUNNER=native`와 섞으면 거부되는 것이 계약이다. Bun, Deno, Workers에도 동일한 live bridge가 이미 있다고 설명하지 않는다. 이들의 대체 경로는 지원되는 설정에서 만든 static/report artifact다. 본문의 실행 기준을 Node24로 고정한 이유가 여기서도 드러난다.

재현은 시간 지연을 추측하지 말고 상태를 기준으로 진행한다. token URL을 열고 연결 상태가 `connected`가 된 뒤, 기존 테스트 계정으로 `/orders/order-42`에 요청한다. 그 요청의 method/path와 request ID를 찾아 route와 handler, status code를 연결한다. 코드를 수정해 재시작하면 `restarting`과 새 실행의 snapshot을 구분한다. 과거 요청 목록을 새 프로세스가 처리한 요청으로 읽지 않는다.

그림의 `depends_on` 선은 DI 의존성이지 함수 호출 추적 결과가 아니다. 최근 request flow도 요청과 route/handler의 상관관계를 제공하는 범위다. `OrdersService`에서 재고 저장소를 몇 번 호출했는지, 내부 SQL 어느 줄에서 시간을 썼는지는 이 MVP가 제공하는 전체 메서드 호출 추적이 아니다. 그 질문에는 서비스 계측이나 데이터베이스 증거가 따로 필요하다.

로컬 경계도 정확히 이해한다. sidecar는 `127.0.0.1`에 bind하고 ingestion과 browser state/SSE API는 token을 요구하며 CORS는 기본 비활성이다. request body와 headers 같은 민감 필드는 live event 검증에서 거부된다. 그렇다고 URL과 오류 메시지까지 자동으로 모든 비밀에서 자유로운 것은 아니다. 제품은 자격 증명을 query string이나 오류 메시지에 넣지 않아야 한다. 이 도구를 production의 공개 운영 대시보드로 바꿔 설명하지 않는다.

## 잘못된 자료를 일부러 넣어 보는 계약 실험

그림이 그려진다는 것만 확인하면 소비자 검증의 의미를 놓친다. 다음은 **완전한 `fluo-blog/tools/check-report.mjs` 파일**이다. 앞서 만든 artifact를 읽고 공개 파서와 필터가 지켜야 하는 기계적 성질을 확인한다. 원본 파일을 수정하지 않으며 실행 시 외부 전송도 없다.

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyFilters, parseStudioPayload, renderMermaid } from '@fluojs/studio';

const raw = await readFile('artifacts/inspect-probe-report.json', 'utf8');
const { payload } = parseStudioPayload(raw);
assert.ok(payload.report);
const report = payload.report;
const before = JSON.stringify(report.snapshot);
const filtered = applyFilters(report.snapshot, {
  query: 'missing-component',
  readinessStatuses: [],
  severities: [],
});
assert.equal(JSON.stringify(report.snapshot), before);
assert.equal(
  renderMermaid(filtered),
  renderMermaid(JSON.parse(JSON.stringify(filtered))),
);

const inconsistent = JSON.parse(raw);
inconsistent.summary.componentCount += 1;
assert.throws(() => parseStudioPayload(JSON.stringify(inconsistent)));

const invalidPhase = JSON.parse(raw);
invalidPhase.timing.phases.push({ name: 'read_orders', durationMs: 1 });
assert.throws(() => parseStudioPayload(JSON.stringify(invalidPhase)));
console.log('REPORT_CONTRACT_OK');
```

예상 결과는 정상 report의 파싱 성공, 필터 적용 뒤 원본 유지, 직렬화 왕복 뒤 같은 Mermaid, 두 변형 입력의 거부다. `read_orders`는 합리적으로 들려도 공개 bootstrap timing phase가 아니다. 허용 이름은 `bootstrap_module`, `register_runtime_tokens`, `resolve_lifecycle_instances`, `run_bootstrap_lifecycle`, `create_dispatcher`다. 애플리케이션 작업 시간을 프레임워크 timing 필드에 몰래 섞으면 자료의 뜻이 바뀐다.

추가로 입력 모듈과 같은 경로를 `--output`으로 지정하는 경우는 CLI가 거부해야 한다. 직접 같은 파일인 경우와 symlink로 같은 파일을 가리키는 경우의 보호가 소스에 있다. 이것을 임의의 모든 파일 alias나 외부 변경 경합까지 막는 일반 파일시스템 트랜잭션이라고 확대하지 않는다. 중요한 운영 습관은 소스와 artifacts 디렉터리를 분리하고 검사 종료 코드도 함께 남기는 것이다.

시작 실패, 종료 실패, 잘못된 요약, 낡은 snapshot은 서로 다른 사건이다. 각각의 증거를 구별하면 주문 장애를 보며 확장 패키지부터 의심하는 대신 올바른 층으로 이동할 수 있다. 다음 장에서는 timing 숫자에 같은 원칙을 적용한다. 캐시를 켜서 빨라졌다는 문장이 무엇을 측정했고 무엇을 제외했는지 설명할 수 있어야 한다.

## 소스 근거와 검증 범위

- [CLI README](../../packages/cli/README.ko.md), [공개 inspect 진입점](../../packages/cli/src/public-inspect.ts), [검사 구현](../../packages/cli/src/commands/inspect.ts): loader, adapterless bootstrap, 출력, close, 종료 코드.
- [출력 경로 보호](../../packages/cli/src/commands/output-path-safety.ts), [CLI 테스트](../../packages/cli/src/cli.test.ts): 검사 인수와 artifact 경계.
- [Studio README](../../packages/studio/README.ko.md), [공개 export](../../packages/studio/src/index.ts), [소비자 계약](../../packages/studio/src/contracts.ts): 정적·실시간 자료의 구분, 파싱, 정규화, 필터와 렌더링.
- [Studio 계약 테스트](../../packages/studio/src/contracts.test.ts), [live 계약 테스트](../../packages/studio/src/live-contracts.test.ts): 보고서 일관성 및 이벤트 검증.
- [CLI sidecar 종료 테스트](../../packages/cli/src/studio/sidecar-shutdown.test.ts): 로컬 ingestion과 종료 경계.

이 장은 현재 공개 API와 소스를 대조한 실행 실험을 제공한다. 여기서 새 검사 fixture, viewer, live 세션을 실제로 실행해 통과했다고 주장하지 않는다. 특히 실제 주문 데이터나 외부 인프라에 연결한 검사는 수행하지 않았다.
