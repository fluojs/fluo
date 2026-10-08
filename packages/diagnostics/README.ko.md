# @fluojs/diagnostics

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Runtime 구현이나 Studio UI를 설치하지 않고 공유 진단 데이터를 읽는 portable 계약 패키지입니다. Public root와 모든 public subpath는 host builtin, environment 조회, metadata 설치, I/O, timer 또는 resource 생성을 import 시 수행하지 않으며 package-wide `engines.node`를 선언하지 않습니다.

## 설치

```bash
pnpm add @fluojs/diagnostics
```

타입만 사용하는 애플리케이션은 개발 dependency로 설치할 수 있습니다. JSON reader를 실행하는 배포 코드는 일반 dependency로 선언하세요. 모듈 등록이나 서비스 설정은 필요하지 않습니다.

## 공개 API와 소유권

| Import | 책임 |
| --- | --- |
| `@fluojs/diagnostics` | 아래 데이터 타입 전체와 `parseStudioPayload`, `parseStudioLiveEvent`, `validateStudioLiveEvent`, `isStudioLiveEvent` |
| `@fluojs/diagnostics/platform-contract` | State, check, health/readiness report, resource ownership, snapshot, diagnostic issue, validation result 및 `PlatformStatusSnapshot<TDetails>` |
| `@fluojs/diagnostics/studio-contracts` | Static/report/live wire 및 parsed 타입, graph, route, request trace, timing과 reader; platform 타입도 재노출 |

`RuntimeDiagnosticsGraph`와 관련 module/provider/relationship 타입은 root에서 제공합니다. 이는 serialized DI graph이며 DI 실행부가 아닙니다. `RuntimeDiagnosticsScope`는 `singleton | request | transient`입니다.

공유 선언과 wire 판별·검증은 diagnostics가 소유합니다. Runtime은 실제 snapshot/timing 생산, bootstrap, PlatformShell start/stop, probe 및 resource 관리를 소유합니다. Studio는 공개 reader facade, 필터, Mermaid와 viewer를 소유합니다. CLI는 inspect bootstrap/close, artifact 쓰기, sidecar transport를 소유합니다. Prometheus, counter/histogram backend 및 일반 logging 실행부는 포함하지 않습니다.

각 기능은 lifecycle union, health/readiness 판정, critical/reason/code, dependency metadata와 details를 계속 소유합니다. `PlatformStatusSnapshot<TDetails>`는 좁은 details 타입을 유지하며, Notifications의 구체적 member와 readonly dependencies를 지우지 않습니다. Resource ownership flag는 실제 connect/disconnect 책임을 설명하고 진단 severity는 health/readiness나 traffic admission과 동일하지 않습니다. [Health and Readiness Contract](../../docs/contracts/health-and-readiness.ko.md)를 따르세요.

## 사용 예

```ts
import { parseStudioPayload, type StudioInspectionSnapshot } from '@fluojs/diagnostics';

const snapshot: StudioInspectionSnapshot = {
  generatedAt: '2026-10-08T00:00:00.000Z',
  readiness: { status: 'ready', critical: false },
  health: { status: 'healthy' },
  components: [],
  diagnostics: [],
  routes: [{ id: 'GET /posts', controller: 'Posts', handler: 'list', method: 'GET', path: '/posts' }],
};
const { payload } = parseStudioPayload(JSON.stringify(snapshot));
const route = payload.snapshot?.routes?.[0];
// route: graphNodeId = 'route:GET__posts', kind = 'http', params = []
```

## Wire와 parsed 계약

- Raw platform snapshot, standalone timing, snapshot-plus-timing envelope와 version-1 report를 읽습니다. `parseStudioPayload(rawJson)`는 typed `payload`와 원본 `rawJson`을 반환하고 잘못된 JSON/지원하지 않는 형식은 throw합니다. Static inspect는 successful bootstrap의 platform/route artifact이며 compiled DI graph를 포함하지 않습니다.
- Persisted `StudioRouteDescriptor`의 `graphNodeId`, `kind`, `params`는 optional입니다. Parsed route에서는 required이며 생략 시 `route:<sanitized-id>`(빈 sanitized id는 `anonymous`), `http`, `[]`가 적용됩니다. 명시적인 graphNodeId와 임의 string kind는 보존하고 잘못된 제공 값은 거부합니다. Runtime의 producer route는 계속 세 필드를 요구합니다.
- Timing/report/live version은 `1`입니다. Timing은 `bootstrap_module`, `register_runtime_tokens`, `resolve_lifecycle_instances`, `run_bootstrap_lifecycle`, `create_dispatcher` 다섯 phase와 finite number만 수용합니다. Timing 생략과 명시적인 malformed timing은 다릅니다. 소수점 세 자리 rounding은 runtime 생산자의 책임입니다.
- Report의 componentCount, diagnosticCount, errorCount, healthStatus, readinessStatus, timingTotalMs, warningCount는 snapshot/timing과 일치해야 합니다.
- Live event는 snapshot/request/timing/diagnostic/restart/disconnect/heartbeat variant와 emittedAt, epoch, eventId, sequence, source를 유지합니다. Source runtime은 node/bun/deno/worker/unknown입니다. `validateStudioLiveEvent(unknown)`와 `parseStudioLiveEvent(string)`은 완전한 wire payload를 검증·정규화해 반환하고 오류는 throw합니다. `isStudioLiveEvent`는 같은 판정의 boolean facade이며 입력을 바꾸지 않습니다.
- Request trace의 body, headers, payload, rawBody, requestBody, responseBody 필드는 거부합니다. Runtime은 body/cookie/header/query/fragment 및 raw error를 공개하지 않습니다. CLI sidecar는 부분 ingress를 수용하고 payload를 unknown으로 보관하며 자체 epoch/sequence를 생성합니다. Sidecar의 recursive body-like-field 거부는 완전한 wire reader와 별도 transport 경계입니다.

기존 reader의 느슨한 static acceptance를 새로운 strict schema로 바꾸지 않습니다. 이 패키지는 transport나 보안 redaction 실행부를 대체하지 않습니다.

## 호환성과 검증

기존 runtime root/devtools, core/internal, Studio root 및 기능별 status import는 동일한 공유 선언을 참조하며 유지됩니다. 제거된 `@fluojs/studio/contracts`는 복원하지 않습니다. [선택적 import 마이그레이션](../../docs/getting-started/migrate-diagnostics.ko.md)을 참조하세요. Studio의 Node `>=24.0.0 <27`, CLI의 Node `>=24.11.0 <27` 정책은 그대로입니다.

실행 근거: `src/contracts.test.ts`, `src/portable-boundary.test.ts`, `../runtime/src/diagnostics-conformance.test.ts`, `../studio/src/contracts.test.ts`, `../cli/src/cli.test.ts` 및 기능별 `src/status.test.ts`. Built dist를 설치한 isolated consumer 테스트는 diagnostics만으로 public import와 declaration을 확인합니다.

```bash
pnpm --filter @fluojs/diagnostics build
pnpm exec vitest run packages/diagnostics/src packages/runtime/src/diagnostics-conformance.test.ts packages/studio/src/contracts.test.ts --maxWorkers=1
```
