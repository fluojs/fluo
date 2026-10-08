# React 장시간 세션 안정성

<p><a href="./react-long-session-reliability.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Scope and prerequisites

공식 주크박스 조립은 기존 `ReactClientRouterProvider`, `ReactNavigationExperience`,
`Link`, `useRouter`, `useForm`, session 및 HTTP handler를 사용합니다. Player SDK,
private query cache, RPC transport 또는 다른 router를 추가하지 않습니다.
[제품 owner](../contracts/react-fullstack-product.ko.md),
[navigation owner](../contracts/react-navigation-payload.ko.md),
[form owner](../contracts/react-progressive-forms.ko.md)를 따릅니다.

Shipped source/harness coverage와 current-head 제품 실행은 별개입니다.
Focused 실제 journey, three-engine correctness, exact-head review와 final remote
CI는 #3879에 계속 필요합니다. 이번 lane은 실제 최소 3600000ms의 완료된
`lane-3886-one-hour` soak를 수용하며 scheduled default는 7200000ms로 유지합니다.
Historical `ca5e37bb` 완료는 원래 head/raw trace를 유지한 증거이지 current 통합
증거가 아니며 변경된 seam이 미입증이면 fresh run이 필요합니다.
[제품 수용 guide](./react-product-acceptance.ko.md)를 따릅니다.
Maintainer 결정으로 실제 physical mobile/tablet 검증은
[#3906](https://github.com/fluojs/fluo/issues/3906)으로 분리하며, PASS로 기록하지
않고 현재 lane의 차단 조건에서도 제외합니다. Clean committed checkout, Node `>=24.11.0 <27`,
pnpm `10.4.1`, build된 workspace package와 Playwright Chromium/Firefox/WebKit
binary 및 OS dependency가 필요합니다. 최초 provisioning은 준비된 환경의 run
판정과 분리합니다. Source 분류만으로 provisioning이나 아래 명령을 통과하지 않습니다.

## Deterministic workload

Maintainer가 승인한 이번 #3886 lane 수용에는
`FLUO_RELIABILITY_SOAK_PROFILE=lane-3886-one-hour`와
`FLUO_RELIABILITY_SOAK_MS=3600000`을 설정합니다. Handoff는
`soakProfile: "lane-3886-one-hour"`를 명시하고, 완료된 raw trace와
일치하는 실제 최소 1시간 duration을 요구합니다. Scheduled/manual 기본값은
2시간을 유지하며, 1시간 결과를 2시간 PASS라고 표기하지 않습니다.

레포 root에서 lead가 실행합니다.

```sh
pnpm build
pnpm --filter @fluojs/example-react-vite-ssr exec playwright install --with-deps chromium firefox webkit
REACT_VITE_FORM_TEST_SERVER=1 pnpm --filter @fluojs/example-react-vite-ssr build:reliability
pnpm --filter @fluojs/example-react-vite-ssr typecheck
FLUO_RELIABILITY_SEED=3886 pnpm --filter @fluojs/example-react-vite-ssr test:reliability
node --test examples/react-vite-ssr/tests/reliability-handoff.test.mjs
```

Chrome channel override나 retry 없이 engine마다 실행합니다. 일곱 warmup cycle
이후 최소 1,000개의 measured action을 수행합니다. 각 cycle은 같은 document에서
QR, songs, tagged back/forward, background search, 독립 shell widget, 실제 guarded
queue POST, page departure 및 복구를 포함합니다. 각 action은 실제 shell
MessageChannel의 새 sequence acknowledgement를 요구합니다. Seed, cycle fault
schedule, action index, first failure, 원시 측정과 event trace를 고유한 Playwright
output directory에 기록합니다.

Network abort/recovery, 503, event-held response, obsolete invalid payload, mapped
importer rejection, approved render throw/reset, build identity mismatch를
주입합니다. 명시적 `reliability` Vite mode만 기존 loader seam의 importer/policy
barrier를 켜며 normal asset에서는 활성화하지 않습니다. 실제 asset 누락과 독립
A/B build 배포 검증은 기존 `deployment-transition.spec.ts` companion이 담당합니다.
**현재** invalid payload는 document fallback을 유지합니다. Logout과 명시적
document reload/update는 다른 lifetime 경계이며 preservation 성공으로 세지 않습니다.

Ownership/cache companion은 late body/import/policy, 실제 saved와 failed follow-up의
GET-only 복구, 기존 역순 row/search response, page unmount, old-session rejection,
fresh 401/403, 실제 port cleanup을 검사합니다. Store source test는 provider
disconnect/rebind와 late session/deploy authority를 유지합니다. 발견한 runtime
결함은 먼저 lead가 RED를 실행해야 하며 source inspection만으로 재현을 주장하지 않습니다.

## Resource and measurement accounting

Quiescence는 page/form 정착, 추적 HTTP completion 및 실제 server request-scope
cleanup입니다. 고정 sleep이나 `networkidle`이 아닙니다. 같은 warmed page baseline과
document/port instance, mount/cleanup, persistent global listener, app socket,
enhanced interaction owner, pending work를 비교합니다. 실제 instance의 weak reference와
매 operation의 다음 ack를 확인합니다. Finished/failed 때 request reference를
제거하며 실제 scope cleanup 뒤 form-control event/body/upload/barrier retention을
비웁니다. Trace는 계속 커지는 메모리 배열 대신 disk로 stream합니다.

Browser-visible count는 public diagnostics API나 JS heap 전체 census가 아닙니다.
Internal store subscriber, React delegated element handler, native module cache,
HTTP keepalive pool과 harness observer는 owner가 다릅니다. 관측하지 않은 internal
값을 0으로 기록하지 않습니다. Public prefetch는 기존 32-entry LRU, entry당 64 KiB,
동시 요청 4개와 excess opportunity **skip**을 유지하며 queue가 아닙니다.
Cache/HTTP/store regression이 해당 기존 계약과 single-use/freshness를 별도로
검증합니다. 새 제품 resource budget을 만들지 않습니다.

Chromium CDP는 원시 JS heap을 기록하며 Firefox/WebKit에서 지원하지 않는 metric은
unsupported/null로 남기고 0이나 PASS로 채우지 않습니다. Server/harness의
`process.memoryUsage()`는 heap와 RSS를 분리합니다. Browser RSS는 `ps`의
harness-descendant process tree이며 shared page가 여러 process에서 중복 계산될
수 있습니다. 사용할 수 없는 process metric도 unsupported입니다. Warmup,
GC-not-forced와 측정 noise를 live count와 함께 보존합니다. 단일 GC나 임의
heap/RSS threshold로 correctness를 판정하지 않습니다. 재현되는 지속 증가는
owner 진단, 검증한 수정 및 같은 workload 재실행이 필요합니다.

## Separate soak and packaged starter

```sh
FLUO_RELIABILITY_SOAK=1 FLUO_RELIABILITY_SOAK_MS=7200000 FLUO_RELIABILITY_SEED=3886 \
  pnpm --filter @fluojs/example-react-vite-ssr test:reliability --project chromium
FLUO_RELIABILITY_STARTER=1 FLUO_BACKGROUND_EVIDENCE="$PWD/.omo/verification/issue-3886/packaged-<unique-run>" \
  node examples/react-vite-ssr/tests/verify-background-starter.mjs
```

고유한 packaged output directory를 먼저 만듭니다. Driver는 실제 packed starter를
설치하고 release/template byte hash를 대조한 뒤 typegen/typecheck/tests/build,
동일 long workload의 dev 및 production을 순차 실행합니다. 별도 provisioning command가
생성 앱의 정확한 Playwright 버전으로 세 engine을 설치하고 elapsed time을 기록합니다.
Test-only `FLUO_REACT_RELIABILITY=1`은 fixture importer
barrier를 켜며 framework API나 기본 production 설정이 아닙니다.

`.github/workflows/react-reliability-soak.yml`은 checkout SHA에 묶인 별도
scheduled/manual job입니다. 실제 최소 2시간 운용하며 event-settled cycle마다
측정하고 failure artifact도 남깁니다. Duration 자체가 검증 대상이며 correctness를
sleep으로 동기화하지 않습니다. Normal PR coverage는 기존 `tooling-1` task에
통합하므로 task나 18-job expanded plan을 늘리지 않습니다. Locked runner의
원시 browser receipt/trace는 `/evidence` mount에 기록합니다. 이 source pass는
elapsed-time budget을 입증하지 않습니다.

## Exact-head handoff and physical verification

`tests/reliability-handoff.mjs`는 version-1 JSON handoff와 기존 artifact root를
소비합니다. `head`, 세 `correctnessReceipts`, 하나의 `soakReceipt`,
`companionEvidence`, `physicalDevices`가 필요합니다. 승인된 #3906 보류는 빈
`physicalDevices` 배열과 `physicalDeferral: { issue:
"https://github.com/fluojs/fluo/issues/3906", status: "deferred" }`로 기록합니다.
자동 companion 및 soak 검증이 모두 통과한 뒤에만 보류 정보를 보존한
`status: "automated-evidence-complete"`를 반환하며, 전체 `evidence-complete`나
실기기 PASS를 반환하지 않습니다. Run path는 root 기준이며
각 receipt 옆 `events.jsonl`을 사용합니다. 없거나 비어 있는/escape한 file,
다른 head, 잘린 trace, 실패, 불완전한 fault/engine coverage, 짧은 soak는 거절합니다.

Companion kind는 `build`, `source-tests`, `http`, `ownership`, `cache`, `native`,
`packaged-dev`, `packaged-production`, `docs`, `ci-plan`, `contract-review`,
`code-review`, `verification-review`, `remote-ci`입니다. Lead는 실제 판정 이후에만
`{ kind, head, status: "passed", receipt }`를 제공합니다. Receipt는 원래의 비어
있지 않은 raw artifact를 가리키는 normalized `{ head, status: "passed", artifact }`
envelope입니다. Normalization은 실제 run/review/remote verdict를 대신하지 않으며
이 consumer는 workflow authority를 발급하지 않습니다.

Physical record는 `kind: "mobile"`과 `kind: "tablet"` 각각에 `physical: true`,
exact `head`, `model`, `os`, `browser`, `version`, `operator`, `artifact`,
`result: "passed"` 및 모든 scenario(`navigation`, `search`, `row`, `history`,
`fault-recovery`, `auth`, `reload`, `resource-ack`)를 요구합니다. 담당자가 실제로
수행하고 기록해야 합니다. Desktop engine, device emulation, 좁은 viewport screenshot은
대체 근거가 아니며 장치 미확보는 명시적인 external verification 요구로 남습니다.

```sh
node examples/react-vite-ssr/tests/reliability-handoff.mjs <handoff.json> <artifact-root>
```

출력은 #3879가 검토할 수집 근거의 완결성을 뜻하며 자동 제품 PASS, MusicKit 수용,
OS discard 뒤 무중단 재생이나 1.0 release가 아닙니다. 실패/미완료 run은 successful
handoff가 없으며 모든 결과는 final implementation head에 묶여야 합니다.
