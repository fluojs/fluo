# React 애플리케이션 성능 비교

<p><a href="./react-performance-benchmarks.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 [#3883](https://github.com/fluojs/fluo/issues/3883)의 격리된
[React 애플리케이션 비교](../../tooling/benchmarks/react-app-comparison/README.md)를 설명합니다.
[풀스택 제품 계약](../contracts/react-fullstack-product.ko.md)은 목표 사용자 여정을 정의하며,
측정 완료나 모든 여정의 출시를 선언하지 않습니다.

## 공통 작업과 선행 정확성

독립적인 네 production 앱은 같은 seeded public 상품 목록/상세, 인증된 CRUD,
공통 리소스를 유지하며 이동하는 jukebox를 구현합니다. 레코드 수, 최초/변경 값,
validation 범위, 인증 판단, status와 응답 의미, 정적 asset, 사용자 interaction
검증을 맞춥니다. 경쟁 제품의 수치에 맞추려고 private 응답을 public cache에
저장하지 않습니다. 각 프레임워크의 native/default cache 결과와 cache 정책을
맞춘 결과를 별도로 기록합니다. Next.js App Router의 RSC 전송 모델과 hydrated
모델의 client code/work를 구분합니다. 전송된 JavaScript 양만으로 전체 페이지를
동등하게 취급하지 않습니다.

측정 전에 실제 production HTTP 및 browser에서 correctness를 통과해야 합니다.
실패, sign-out, navigation도 같은 앱에서 관찰합니다. 아직 구현하지 않은 제품
여정이나 측정할 수 없는 metric은 통과한 측정이 아닙니다. 기존
[Vite SSR 예제](../../examples/react-vite-ssr/README.ko.md)는 더 작은
baseline이며 완전한 CRUD나 장시간 jukebox 동작의 독립적인 증거가 아닙니다.

## 측정과 판정

### FA-V3 동일 실행 production 수용

새 production 수용에는 `methodVersion: "FA-V3"`,
`measurementPurpose: "integrated"`, `measurementKind: "production"`을
명시합니다. 기존 CLI와 준비된 native observer의 명시적 opt-in을 사용하며
별도 native counterpart는 허용하지 않습니다. `evaluateAcceptedEvidence`는 같은 run의 method/config, product,
environment, pair/phase, warmup/measured 순서, raw CPU, request cutoff와
canonical native raw/schema/host receipt를 먼저 인증한 뒤 평가합니다. Metric 없는 quality 실패도 유지합니다.
FA-V2의 기존 관측 min/max 수식과 정확한 decimal equality를 상속하며 새
MAD/spread veto, tolerance, budget이나 sample 선택 규칙을 추가하지 않습니다.
FA-V2/unversioned capture는 historical 의미를 유지하고 재사용하지 않습니다.

Fresh before/final cohort마다 변경하지 않은 representative config를 파생하고
같은 비어 있지 않은 `pairId` 및 `pairPhase: "before"` / `"after"`를
명시하며 full config/source/build/environment identity는 각각 동결합니다.
Suite README의 명시적 isolated Linux 대표 invocation으로 재현합니다. Full-suite의
`run-gate.mjs`는 `measurementKind: "development"`, `measurementPurpose: "timing"`과
`nativeLifetime: { enabled: false }`인 fresh development timing도 수집합니다.
Kind/purpose/phase와 공유 tool/source identity를 인증한 뒤 합치며 production
terminal/metric을 dev 증거로 옮기지 않습니다. Client 소유 RE-A01 source-edit
인증은 그대로 필수이며 우회하지 않습니다.

Canonical agent는 seven hooks 모두에 CModule request callback, 독립
Resource/Loader birth, 안정적인 invocation frame과 per-thread parent chain을
사용합니다. 124-byte payload/128-byte stride/512-byte header/500000-event
journal의 native release/acquire publication과 drop/failure/ownership 검증을
유지합니다. 실제 canonical agent/host/collector hash를 인증하며 private
candidate나 변환 decoder의 identity를 사용하지 않습니다. Signal entry는
대상 exit/reap보다 먼저여야 하지만 성공한 정상 sender return은 그 뒤에
관측될 수 있습니다. Raw NULL, missing status와 SIGTERM 15는 그대로입니다.
Partial hooks/coverage, missing return, cutoff 변경, foreign evidence나 cleanup
실패는 unavailable/INCONCLUSIVE이며 성공이 아닙니다. Observer/setup/drain
비용을 차감하지 않습니다. 기본 disabled 수집에는 Python/Frida가 필요 없고
macOS native 지원은 unsupported입니다. Development/HMR과 원래 browser/
readiness/throughput/CPU 경계, 모든 budget, 네 framework/profile, 2 warmup/
5 independent alternating sample과 workload 200/8을 유지합니다.

준비된 SDK 검증은 `tests/native-sdk/`에 있습니다. Linux ARM64에서
`fixture.c`를 `headless_shell`로 컴파일하고 pinned Python으로
`run-fixture.py <fresh-output-root>`, 이어서
`node verify-fixture.mjs <fresh-output-root>`를 실행합니다. Canonical
agent/decoder로 65-level nesting, 실제 pthread interleaving, publication/
accounting, pointer reuse, failure와 retirement를 검사합니다. 원래 private
65-level bridge의 exit-1 finding은 보존하며 green으로 바꾸지 않습니다.
`qualify-browser.mjs <prepared-root>`와 독립 `--verify`는 준비된 guest에서
새 canonical source closure와 원래 Next 2 warmup/1 measured prefix를 묶으며
모든 raw artifact와 원래 exit를 보존합니다. 이 유한 검증은 mechanism
qualification이며 before/final 성능 PASS,
issue 종료나 final-head review가 아닙니다. Fresh paired fixed-cycle gate,
독립 exact-head review와 GitHub CI는 다음 단계로 남습니다.

**Historical 방법.** 아래 FA-V2 purpose 분리와 명령은 historical 기록입니다.
FA-V3는 별도 production timing/native-conformance 수용만 교체합니다.

### FA-V2 관측 범위 수용

FA-V2는 수용 의미를 변경하며 numeric budget이나 public 동작을 완화하지 않습니다.
`baseline.json`의 기존 median/spread/MAD veto는 historical replay 전용입니다.
`evaluatePerformance(..., "historical-v1")`, `evaluateEvidence`,
CLI `--historical-replay`는 과거 판정을 보존합니다.
과거 FAIL/INCONCLUSIVE나 unversioned receipt를 FA-V2로 재분류할 수 없습니다.

5개 independent sample을 제거 없이 모두 사용합니다. L/U는 관측 min/max,
B는 기존 budget, b는 기존 band이며 세 peer를 각각 비교합니다:

| 비교 | PASS | FAIL |
| --- | --- | --- |
| Upper absolute | U_F <= B | L_F > B |
| Throughput absolute | L_F >= B | U_F < B |
| Upper peer | U_F <= b * L_peer | L_F > b * U_peer |
| Throughput peer | b * L_F >= U_peer | b * U_F < L_peer |

경계 교차는 INCONCLUSIVE이고 equality는 PASS입니다. Decimal 및 zero 비교에
tolerance를 넓히지 않습니다. Spread/MAD는 diagnostic이며 독립 veto가 아니므로
진짜 budget 실패를 noise로 숨기지 않습니다. 기존의 별도 repeatability veto는
사라집니다. 5회 관측 extrema는 confidence interval, 미래 모집단 상한이나
통계적 보장이 아닙니다. Missing/invalid/duplicate/quality/correctness/authentication
실패는 통과할 수 없습니다. 200 requests/concurrency 8, 5회 measured/2회 warmup,
순서 교대, 네 framework/네 profile, 22개 client/6개 server metric 및 모든
budget/band와 peer cache/prefetch 기본값은 그대로입니다.

동결된 순서 교대 측정 plan에 대한 membership과 순서를 인증하며 raw `warmup`,
`cycle`, `slot`, framework, profile, run ID를 함께 검증합니다. 개수와 unique ID만으로
warmup과 measured sample을 구분하지 않습니다. 승인된 representative production
descriptor는 200/8뿐 아니라 throughput path, journey/action과 interaction도
결합합니다. 모든 phase/purpose에서 동일하게 변경하고 hash를 다시 계산해도
이 descriptor 변경은 거부합니다.

파생 config의 `measurement.methodVersion: "FA-V2"`와
`measurement.measurementPurpose: "timing"` 또는 `"native-conformance"`를
명시합니다. 같은 `measurement.pairId`와 `measurement.pairPhase: "before"` 또는
`"after"`로 묶되 별도 config/execution identity를 인증합니다. Timing은
`nativeLifetime: { enabled: false }`, native conformance는
`{ enabled: true, python: "/absolute/provisioned/python" }`을 요구합니다.
Purpose는 cache `native`/`matched-cache` 및 execution `discovery`/`regression`과
다릅니다. Timing은 Frida 없이 CDP/React readiness, passive NetLog 인증,
원래 cutoff와 throughput/server snapshot까지 browser lifetime을 유지합니다.
Native conformance는 같은 product/build/stimuli/repetitions에서 기존 ownership,
coverage, journal, retirement, raw exit와 cleanup을 모두 요구합니다.
그 performance 값은 timing verdict에 넣지 않고 terminal을 다른 execution에
빌려주지 않습니다. Native conformance 단독 통과는 성능 PASS가 아닙니다.

`evaluateAcceptedEvidence(baseline, timingReceipts, commonOutputRoot,
nativeReceipts)`는 두 purpose를 함께 인증합니다. `evaluateAcceptedPair`는 fresh
before/after의 phase/pair, frozen method/stimuli/environment까지 묶습니다.
Raw/config/environment 증거 전체를 common root에 보존하고 runner의
`--native-receipts <JSON>`에 matching receipt path 배열을 전달합니다.
Sibling purpose root는 `--trace-root <common-root>`로 인증합니다. Full-suite
`<profile>.json`은 production/development를 합친 receipt입니다. Counterpart가
없으면 timing collection은 INCONCLUSIVE이며 정상 gate CLI는 unversioned를
거부합니다. Method 테스트는 실제 pair PASS나 issue 종료가 아닙니다. Fresh
frozen pair, 독립 review와 full GitHub CI는 여전히 필요합니다.

Client 채택은 승인된 RE-A01 source-bound React-edit 관계를 보존합니다.
before의 `src/document.ts`/`reload:true`와 after의
`src/catalog-destination.tsx`/`reload:false`만 같은
from/to/path/selector/expectedText를 유지한 채 허용합니다. 그 외 field 변경은
거부하고 full config/source/build/edit-source hash는 원본별로 인증·보존합니다.
`pairStimuliComparison`은 development 관계를 식별할 뿐 수용하지 않습니다.
Aggregate가 기존 client `authenticateReactEditPair`로 양쪽 원본 environment
binding과 source proof를 인증하고 그 evidence를 보존해야 합니다. Verifier/proof
부재는 fail-closed입니다. Server-only production에는 이 예외를 적용하지 않습니다.
같은 product 안의 timing/native counterpart는 실제 edit descriptor까지 동일해야
하며 cross-product 예외를 purpose pairing에 빌려 쓸 수 없습니다.
Client verifier는 같은 FA-V2 method, pair ID, purpose와 before-to-after phase
전환만 인증하며 원본 source proof와 relation replay를 유지합니다. Production은
그 phase 전환만 허용하고 dev edit 예외를 허용하지 않습니다. 각 full config/hash에 `pairPhase`를 남기고
before/after config ID를 따로 동결합니다.

CPU는 configured SERVER PID의 post-workload lifetime average/single logical CPU로
`100 * (utime + stime) / CLK_TCK / (uptimeSeconds - starttime / CLK_TCK)`를
계산합니다. 원본 `/proc/<pid>/stat`, 재확인 birth/counter, `/proc/uptime`,
`getconf CLK_TCK`와 raw `ps`를 인증·재계산합니다. RSS는 기존 `ps` snapshot
byte입니다. Display rounding, client/window CPU 또는 core 수로 나누는 대체는
없고 85% budget을 유지합니다. Tick/birth quantization과 uptime 0.01초 resolution을
보존하므로 unrounded 계산이 연속 시간 정밀도를 보장하지 않습니다.

Passive NetLog는 missing CDP terminal을 항상 해결하지 않습니다. 실제 Next RSC의
ExtraInfo 부재, renderer/native millisecond 불일치 및 complete trace에서
`ResourceFinish` 부재가 관측됐지만 같은 URL의 native chain 소유권은 입증되지
않았습니다. 기존 exact classifier는 그대로이며 clock window/nearest URL,
추정 cancellation, peer prefetch 변경 또는 native counterpart terminal 차용은
금지합니다. Pending timing은 quality blocker로 남습니다.
Blink InspectorId/CDP ID와 renderer가 생성한 network request ID는 별도 identity
공간입니다. 검토한 Chromium `ResourceLoader::Dispose` GC prefinalizer는
`HandleError`/`DidFailLoading`을 건너뛰고 URLLoader client를 detach할 수 있습니다.
이는 source coverage 반례이지 실제 pending 요청의 원인 진단이 아닙니다.
Complete tracing만으로 모든 terminal callback의 관측 coverage를 입증하지 않습니다.

기계가 읽는 suite의 `baseline.json`은 절대 budget, 상대 비교 band, profile,
반복/warmup 횟수와 historical 집계/noise/outlier 규칙을 소유합니다.
새 production 수용은 위 FA-V3 방법을 적용합니다. 예산을
완화하려면 검토 가능한 명시적 변경이 필요합니다.
첫 측정 시작점을 `--mode discovery`로 기록했습니다. 실제 budget 부족을 준비
오류로 취급하지 않으며, 실행 명령이 성공했어도 결과 파일의 성능 판정은
`fail`입니다. 별도의 회귀 실행에서는 이 옵션을 생략하며 `fail`과 `inconclusive`
모두 종료 상태가 0이 아닙니다. 고정된 budget에 맞추는 최적화는 이 이슈의
예산 변경이 아니라 #3884/#3885에서 다룹니다.
Cold/warm TTFB, shell
arrival/LCP, hydration과 main-thread work, interaction-to-pending 및
interaction-to-approved-view p50/p95, 전송/압축 JS/CSS, request 수,
throughput, error rate, server CPU/RSS를 기록합니다. 개발 cold ready와 React,
CSS, server edit-to-visible은 production navigation과 구분해서 측정합니다.
TanStack fixture는 격리된 manifest와 lockfile 모두에서 `react`와
`react-dom`을 `19.2.8`로 고정하며 production 및 개발 결과는 동일한
의존성 그래프를 사용해야 합니다.
과거 Fluo discovery는 canonical generated starter 개발 경로가 아닌
build/restart harness를 사용했으며 해당 receipt는 현재 Fluo 개발 지연의
증거가 아닙니다. 현재 fixture는 Vite middleware와 gateway를 통한
canonical `fluo dev --runner fluo`를 실행합니다. CSS는 visible HMR,
server 편집은 generation readiness 이후 새 document를 관측하며 React는
아래 source-bound before reload/final HMR 관계를 사용합니다.
TanStack의 route loader 편집은 개발 서버를 다시 시작한 뒤 변경된 페이지를
열고 실제 restart 시간을 포함합니다. Next.js CSS 편집도 태블릿급 browser에서 CSS HMR
표시가 안정적으로 관찰되지 않아 개발 서버를 재시작하고 문서를 다시
엽니다. Next.js server 편집도 소스 변경이 browser에 반영되지 않아
재시작 후 문서를 다시 엽니다. 두 값 모두 native HMR 시간은 아닙니다.
Shell arrival는 first-contentful-paint를, 초기 main-thread work는 hydration 외
작업도 포함하는 CDP `Performance.TaskDuration`을 사용합니다. 원시 trace에는
이 측정 방식과 unavailable 값을 기록하며 RSC 전송 byte를 hydrated client
work와 동일시하지 않습니다.
공통 `react-initial-completion-v1` 경계는 load-only cold 수집을 대체합니다.
entry navigation 전에 기존 hook을 전달 호출하는 React DevTools observer와
CDP request observer를 설치합니다. Document load 외에도 실제 root의
`isDehydrated=false`, element 존재, pending root lane 없음, committed Fiber
tree의 fallback/dehydrated Suspense 없음이 필요합니다. 동결된 passive mask
`10256`가 있는 commit은 `onPostCommitFiberRoot`까지 기다리며, passive 작업이
없는 후속 commit은 직접 완료될 수 있습니다. 최초 root commit만이 아니라
동기 passive effect와 그 effect가 예약한 React update를 관찰합니다. 기존
`data-benchmark-hydrated` leaf-effect 표식도 true여야 합니다. Cold 소유
document/script/stylesheet request가 실제 identity로 성공 종료된 뒤 cold CPU,
asset/request inventory를 수집하고 warm navigation을 시작합니다.
DOM 존재, 임의 sleep, network-idle을 완료 신호로 쓰지 않습니다.

지원 범위는 hook/Fiber 필드를 확인한 동결 production renderer `19.2.8`과
Next 내장 `19.3.0-canary-cbb046ab-20260731`입니다. Timeout, observer 부재,
미지원 renderer, 초기 resource 실패는 load로 대체하지 않고 nonzero/inconclusive로
처리합니다. 임의의 비동기 effect 작업, 이후 생성되는 root, background prefetch의
완료 보장은 아닙니다. Next의 native RSC prefetch는 변경하지 않으며 pending/abort를
별도로 남겨 inconclusive나 error budget 실패를 유지합니다. 원시
`timings.initialBoundary`에는 renderer, commit/post-passive 상태, load/완료/수집/warm
시점, CDP metric/paint 원시값, 초기 request와 warm 직전 pending identity를 보존합니다.
Request에는 loader/request ID, initiator, 종료 phase/시점, cancellation을 남기며
기존 raw-trace authentication을 그대로 요구합니다.

과거 production `nativeLifetime` 모드는 선택적이며 기본 비활성이었습니다.
FA-V3 production은 같은 실행의 integrated native 관측을 요구합니다.
FA-V2 timing/native-conformance 분리는 historical 기록이며 아래 observer 요구 사항은
FA-V3 production integrated에도 적용합니다.
`run-gate.mjs` config의 `measurement`에
`{ "nativeLifetime": { "enabled": true, "python": "/opt/fluo-native-debug/bin/python" } }`
를 추가해야 하며, 기본 경로는 Frida/Python을 import·실행·설치하거나 요구하지
않습니다. `chromium-native-lifetime-v1`의 최초 지원 경계는 Linux/AArch64,
ELF64 little-endian, canonical Playwright revision `1228` headless_shell,
Chromium `149.0.7827.0`입니다. 실제 실행 executable 및 renderer의 로드된
mapping이 SHA-256
`b6f53f7e40c3ad6727cb3a12536026dcd93281e5965923752c8130ed53e5e8c4`,
GNU build ID `afcd146a627911fb30269f995d093903636ed886`, 보존된 versioned
symbol/argument/clock schema와 agent/host source identity에 일치해야 합니다.
Version 문자열이나 ELF offset만으로 macOS, 다른 binary 또는 full Chromium을
지원한다고 선언하지 않습니다. 외부 runtime은 별도로 격리 provision한 Python
`3.11.2`와 Frida `17.21.0`이며 executable 및 의존 파일 hash를 검증합니다.
정확한 executable hash, runtime 확인 및 opt-in 재현 명령은
[suite의 관측 재현 경계](../../tooling/benchmarks/react-app-comparison/README.md#opt-in-exact-native-lifetime-observation)에 있습니다.

Entry navigation 전에 hook을 준비하고 소유한 browser process tree의 새 child는
resume 전에 독립 hook을 설치한 뒤 CDP로 renderer role을 확인합니다.
`IdentifiersFactory::RequestId`의 실제 호출, PID/process birth, Resource와 독립
native Loader birth, CDP target/session/request occurrence가 유일하게 연결되어야
합니다. Native loader pointer는 CDP `loaderId`가 아닙니다. 아직 pending인
record에만 같은 loader의 `Cancel` 진입, 그 안의 `HandleError` 진입 및 두 정상
반환이 원래 cutoff보다 엄격히 이전인 경우 취소를 부여합니다. 검증된 monotonic
clock/단위가 필요하며 URL·가까운 시각·GC·teardown으로 추론하지 않습니다.
실제 CDP terminal을 유지하고 원본 observation을 보존합니다. 취소는
`request-failed`, `canceled:true`로 기존 errorRate의 실패에 포함하며 status,
body byte, CDP error code 또는 settledTimestamp를 만들지 않습니다.

Native event는 host가 보유한 shared memory에 buffer하여 event마다 IPC하지 않습니다. Hook 비용을
측정에서 차감하지 않으며 setup/drain과 별도 observer process 비용은 provenance에
남기지만 따로 측정하지 않습니다. 기존 throughput 및 `ps` snapshot 뒤,
BrowserServer close 전에 drain하고 원래 request cutoff를 유지합니다.
각 소유 session은 자연스러운 process 종료까지 Frida agent와 child gating을 유지합니다.
원래 observer hook은 drain에서 stop하지만 재개 중인 exec child의 gate는 변경하지
않습니다. 최종 close가 남은 session을 정리하며 session detach/unload는
BrowserServer close 전이 아니라 process 종료 뒤입니다. Resident memory/runtime 비용도
차감 없이 포함합니다.
실패·abort된 preparation이 observer child의 bounded 종료를 강제할 때도
eternalize된 inert script가 살아 있는 process의 agent unload를 방지합니다.
Transport schema v2는 PID/starttime/exec epoch별 append-only memfd journal을
보존하고 hook readiness 또는 gated resume 전에 host가 소유권을 획득·검증합니다.
500000개 fixed-width record는 wrap하지 않습니다. Native writer는 AArch64
release publication을, host는 acquire read를 사용합니다. 원본 binary
header/record, ownership, attempted/committed count, sequence marker, drop,
native callback/invocation 상태를 인증하고 replay합니다. 소유권 누락,
publication/callback 중단, overflow와 불완전한 call은 hash를 다시 계산해도
inconclusive입니다.

Live interval은 원래 cutoff를 포함해야 합니다. 그보다 이른 retirement는
인증된 detach와 birth-bound 정상 status로 입증하며 destroyed script RPC 또는
인위적인 cutoff padding을 사용하지 않습니다. 조기 browser lifecycle observer의
별도 zombie-status witness는 누락된 pidfd status를 대체하거나 zombie에 보낸
signal을 종료 원인으로 지정하지 않습니다.
이 status witness가 없으면 인증된 소유 browser/zygote parent의 실제
`waitpid`/`wait4` 정상 반환에서 genuine raw reap status만 확보합니다. 호출 전
kernel PID/starttime/parent, 원본 stat, 반환 PID와 observer sequence를 보존합니다.
NULL wait status destination은 NULL로 유지합니다. 실제 reap 전에 확보한 별도의
birth-bound zombie `stat` exit-code field로 status를 입증할 수 있지만 wait 반환과
pidfd status를 다시 쓰지 않습니다.
이른 retirement의 raw SIGTERM 15는 별도로 완전한 pre-cutoff Chromium 정상
termination caller/return chain과 live target에 대한 성공한 send를 요구합니다.
15를 0으로 바꾸거나 missing pidfd status를 채우지 않습니다. 이 retirement 증명은
`graceful-close`를 빌리거나 소급하지 않으며 기존 post-close shutdown 인증과
분리합니다. 성공한 gated exec는 독립된 이전·이후
history를 보존하고 resume 전에 successor readiness를 검증합니다. 실패한 exec는
epoch를 닫지 않습니다. 알 수 없는 role/status, crash와 미지원 transition은
거부합니다. Production COOP navigation과 capture boundary는 유지합니다.
별도의 두 문서 nonempty-retirement correctness fixture를 측정 cohort의 사전
navigation으로 사용하지 않습니다. Journal, writer/callback과 lifecycle overhead는
차감하지 않으며 이 correctness 검증은 performance PASS가 아닙니다.

Python host는 BrowserServer 종료까지 pidfd exit 구독을 유지한 다음 원래 cutoff의
증거를 마무리합니다. Main exit/error/disconnect와 관측 가능한 descendant wait
status를 보존하며 알려진 비정상 종료는 NetLog parse 전에 거부합니다. Python exit 0이나
detach 성공은 browser 정상 종료의 증거가 아닙니다. 이미 reap된 descendant status는
0이 아니라 missing으로 남기며 main exit 0만으로 모든 descendant의 정상 종료를
입증하지 않습니다. Drain 이후 별도 shutdown 관측은 인증된 Chromium main의
정상 종료 caller, 살아 있는 소유 target의 PID/start identity, 성공한 SIGTERM 전송,
명시적 close 이후의 순서와 정상 main 종료가 모두 일치할 때만 raw status 15를
의도적인 shutdown으로 구분합니다. 이 관측의 IPC/setup 비용도 보정하지 않습니다.
Zombie target, 실패한 전송, 누락된 caller, 원인 불명 및 다른 비정상 종료는
허용하지 않으며 status 15나 missing을 0으로 바꾸지 않습니다. Native/CDP,
coverage/process, schema/source hash, host log와 cleanup raw artifact를 fresh output
root에 보존하고 `verifyTraceFiles`에서 hash·realpath containment·run identity와
reconciliation replay를 확인합니다. Warmup 및 combined trace에도 적용합니다.
미지원 환경, late attach, partial hook, event drop, 불완전 반환, script/transport
오류, 증명되지 않은 renderer retirement, identity ambiguity, 확인되지 않은 child role,
worker/service-worker coverage는 unavailable/inconclusive입니다. 정상·실패·timeout·
abort에서 observer session/child/listener를 bounded event wait로 정리하며 실패를
숨기지 않습니다. 두 기존 headless 진단에는 pending이 없었으므로 36개의 이미
취소된 native binding은 backend 가능성만 입증합니다. 새 focused runtime도
missing-terminal 재현이나 최종 성능 PASS가 아닙니다. 개정된 로컬 대표 pair는 기존
Apple M4 Pro host의 명시적 opt-in OrbStack Linux ARM64를 사용하며 macOS native
관측은 여전히 미지원입니다. 동일 최종 collector의 네 framework/profile before/after 재수집,
기존 반복·warmup·budget·통계와 historical fail/inconclusive 보존 요구는 유지됩니다.

[격리 Linux 실행 경계](../../tooling/benchmarks/react-app-comparison/README.md#explicit-isolated-linux-representative-pair)가
명령과 고정 allocation을 소유합니다: kernel
`7.0.14-orbstack-00380-ga7e0a2dc9535`, 논리 CPU 12개/8392974336 bytes,
추가 container quota 0, 실제 Node `v24.21.0` 및 기록된 immutable image ID입니다.
이는 공유 VM 용량이지 전용 예약이 아닙니다. `--isolated-container`는 선택한 실행 중
container를 host Docker에서 실제 관측하고 매 invocation의 guest executable,
SDK/browser/Python/Frida/schema/source를 인증합니다. 준비 JSON이나 image identity만으로
live evidence를 대신하지 않습니다. 출력 root 안의 environment record digest,
immutable identity/config hash와 별도 invocation evidence를 모든
production/dev/warmup/combined trace, receipt 및 aggregate에 결합하며
binding 누락·불일치·변조는 실패합니다. After에는 `--environment-identity`와
`--environment-config-identity`로 before hash 두 개를 함께 요구하고 실제 도구/resource 및
아래 인증된 React-edit 두 필드 대안 외의 모든 고정 설정을 동일하게 유지하며
배타적 timing window를 예약합니다. Passive generator CPU 및 ambient contention
snapshot은 기존 timing window를 사용하고 CPU/RSS, capture, throughput 경계나
budget을 변경하지 않습니다. 과거 macOS Node `24.20.0`을 포함한 `baseline.json`은
그대로 유지하며 옛 macOS와 새 Linux 관측을 비교해 성능 향상을 주장하지 않습니다.
Tracked 대표 기본값은 Frida를 활성화하지 않습니다. 일반 default/CI/macOS 경로는
Docker/Python/Frida가 필요 없고 이 로컬 모드는 cross-platform 성능 수용을 주장하지 않습니다.
Comparable identity에서는 invocation locator와 product commit/build 차이를 제외합니다.
실제 절대 경로/config는 evidence와 provenance에 보존하고, before/after worktree/build
root가 달라도 도구/collector content hash와 allocation은 같아야 합니다.
매 invocation의 full exact configuration과 hash를 그대로 보존합니다.

서로 다른 dev config의 유일한 대안은 before product
`8a09eb8d216e555b97760a86539dea31e79c86a8`의 Fluo `src/document.ts` /
`reload:true`와 reviewed final `f9f5ac6722957cbe2752b9959e657a46594c0a1b`
또는 source가 검증된 후속 구현 head의 `src/catalog-destination.tsx` /
`reload:false`입니다. 인증된 versioned before-to-after phase 전환 외에는
이 두 필드만 해당 방향으로 달라질 수 있고 다른 설정,
편집, peer, budget은 모두 같아야 합니다. 양쪽 모두 `/login`에서 `Editor login`을
단 한 번 `Editor login changed`로 바꾸고 동일한 visible `h1`을 관측한 뒤
원본 source bytes를 정확히 복구합니다. 원래 representative full hash는 before
`b7e8cfc2c53a57006197357542b6831b9ccb58835297ee01e22a7a1afc5a5b5d`,
final `a48953e1f5825e26afc5865a5177af988619bdceebec801cf8b4025b1a2fad73`으로
서로 다르게 유지합니다. 두 원래 identity flag와 함께 `--environment-before-record`,
`--environment-before-root`를 사용합니다. 원본 bytes/digest, containment,
invocation, source/head/blob, build/dependency와 collector 증거로 capture와 replay의
관계를 인증합니다. Production-only pair는 인증된 versioned phase 전환만 허용하며
나머지 config는 동일해야 하고,
profile, dev와 warmup hash를 aggregate hash와 별도로 보존합니다.
Before record는 `--react-edit-pair-source`로 준비합니다. Aggregate와 development
capture에 이 증거를 보존하지만 production-only child에는 flag를 전달하지 않습니다.
인증된 edit descriptor가 다르면 after의 source proof는 필수입니다. 이 opt-in 없는
일반 isolated capture와 same-config pair는 기존 경로를 유지하며 pinned
ancestry/blob 또는 dev-only 실행의 production build를 요구하지 않습니다.

Stimulus 전에 구독한 observer는 before의 새 main-frame document
`reload-to-visible`와 final의 관련 component update 및 동일 document
`hmr-to-visible`를 구분합니다. Fallback/restart/relaunch는 관측된 경로로 남기며
선택된 HMR 증거를 대신하지 못합니다. 초기/최종 visible marker와 원본/편집/복구
bytes/hash를 raw evidence에 보존합니다. 질문이 답변 없이 만료된 뒤 lead가
best judgment로 product-native 경로를 선택한 것이며 affirmative user choice나
waiver가 아닙니다. Merge base `942f673d34d58a9093d7012253913aec9143ff45`와
final upstream `f3e699047bfa51bbb69d9abeb2717eeb9e1871b0`에는 CLI/HTTP/React
typegen, background form, navigation, store, provider 변경이 포함되어 제품 차이를
#3884만의 인과 효과나 same-upstream 단일 최적화 control로 주장하지 않습니다.
좁은 pair 검증은 성능 PASS가 아닙니다. 네 framework/profile의 fresh 전체 재수집,
2 warmup/5 measured 순서 교대, 원래 budget과 versioned FA-V3 판정, exact-head review와
final GitHub CI는 계속 필수입니다.

과거 load-only 데이터는 다른 초기 작업 구간을 수집했고 cold module이 끝나기 전에
warm을 시작할 수 있었습니다. 보존된 Linux 증거에는 cold script 취소가 있습니다.
과거 fail/inconclusive는 모두 유지하며, 변경하지 않은 runtime의 before와 최종
runtime의 after에 **동일하게 교정된 collector**를 적용해 다시 수집해야 비교할 수
있습니다. 22개 metric 이름/범위, budget, 5회 반복, 2회 warmup, 순서 교대,
불확실성 규칙과 peer 기본값은 그대로입니다. 네 앱 readiness smoke는 정확성
증거이며 성능 PASS가 아닙니다.
별도 `text/x-component` 응답의 인코딩된 wire byte를 따로 기록하고,
처음 HTML에 inline된 RSC 데이터는 HTML 응답에 남깁니다. 이 값들은
hydrated JavaScript byte나 초기 main-thread work와 동등하지 않습니다.

모든 관측값에는 정확한 commit, lockfile, production build 명령, browser/runtime
버전, dataset, desktop 또는 지정한 저사양/태블릿급 CPU/network profile,
cache mode, framework version 및 실행별 원시 trace가 있어야 합니다. 매 대상에
warmup을 수행하고 독립 반복 실행 간 대상 순서를 교대합니다. Percentile 집계법을
적고 noise와 예산 초과 sample을 포함해 원시값을 보존합니다. Throughput을
해석하기 전에 generator CPU 여유를 확인합니다. 같은 머신의 generator 경합을
프레임워크 수용량으로 오해하면 안 됩니다. 판정 불명은 통과가 아닙니다. Emulated
profile로 측정하지 않은 기기까지 결과를 일반화하지 않습니다.
Desktop viewport는 1440 × 900, 태블릿급 viewport는 820 × 1180이며
태블릿급 CPU는 4배 감속, downlink는 1.6 Mbps로 에뮬레이션합니다.
물리적 태블릿 측정 결과는 아닙니다.
Native profile은 각 host의 기본 cache 동작을 유지하고, matched-cache
profile은 네 앱 모두에서 browser cache 재사용을 비활성화합니다. Fluo가
압축 없이 보낸 asset을 경쟁 앱의 gzip 응답과 동등한 압축 전송량으로
비교하지 않습니다. Asset 목록에 `contentEncoding`, `cacheControl`을
기록하고 두 방식 모두 인증 응답은 private으로 유지합니다.
Matched 방식은 응답 cache header나 gzip/Brotli/identity 코덱을
고쳐서 같게 만들지 않습니다. 상대 압축 byte band는 같은 코덱의
압축률이 아니라 각 host에서 실제 전달된 wire byte를 비교합니다.

Pull request smoke는 정확성과 결정적인 asset 크기/request 수를 검증합니다.
Shared runner에서 단 한 번 측정한 timing으로 merge를 거절하지 않습니다. 분리된
대표 환경 performance workflow는 확인된 회귀를 실패로 남기고 원시 trace를
보존하며 불확실성을 통과로 숨기지 않습니다. 어느 workflow도 기존 HTTP/DI
suite의 local-only 정책이나 #3879 최종 제품 여정 검증을 대체하지 않습니다.
Smoke는 기존 `static` 검증 task에서 React 전용 selector로 조건부 실행하며
HTTP comparison의 별도 조건부 coverage를 유지합니다. 측정 승인 marker는
목적지 view가 렌더링할 때 표시합니다. 문서 교체나 응답 본문 수집 실패는
실행을 inconclusive로 분류하고, 실제 request 실패는 throughput 오류와
함께 errorRate에 포함합니다. 디코딩 및 인코딩된 asset byte는 browser CDP
network data event에서 수집합니다. 수집 경계에서 아직 완료되지 않은
speculative prefetch는 pending으로 기록하고, byte 값이나 request 실패를
만들어 내지 않은 채 실행을 inconclusive로 분류합니다.

## Client delivery diagnostics

Issue #3884는 `tooling/benchmarks/react-app-comparison/src/client-delivery.mjs`에
별도의 production 관측 경로를 추가합니다. Repository root에서 실행합니다.

```sh
node tooling/benchmarks/react-app-comparison/src/client-delivery.mjs \
  --build-root tooling/benchmarks/react-app-comparison/apps/fluo \
  --output-dir tooling/benchmarks/react-app-comparison/results/issue-3884/<fresh-invocation>/fluo
node tooling/benchmarks/react-app-comparison/src/client-delivery.mjs \
  --build-root examples/react-vite-ssr --lockfile pnpm-lock.yaml \
  --output-dir tooling/benchmarks/react-app-comparison/results/issue-3884/<fresh-invocation>/example
```

설치된 generated starter는 절대 경로를 `--build-root`로, source repository를
`--source-root`로 전달합니다. Starter의 frozen lockfile이 설치된 package graph를
식별합니다. Observer는 앱의 production config를 사용하며 chunk 추가나 manifest 변경
없이 emitted module membership, static/dynamic import edge, rendered code byte,
content hash 및 중복 module owner를 기록합니다. `graph.json`, `manifest.json`,
`source.patch`, `untracked-inputs.json`은 source/build/package/lock/runtime/host identity를
보존합니다. 매번 새 output directory를 사용합니다.

먼저 이 observer로 설치 starter를 build한 뒤, 그 정확한 build를 일반 `pnpm start`로
시작합니다. 실행 중인 server 아래에서 다시 build하지 않고 cold/warm private-ordinary
여정을 수집합니다.

```sh
node tooling/benchmarks/react-app-comparison/src/client-delivery.mjs \
  --observe-output tooling/benchmarks/react-app-comparison/results/issue-3884/<fresh-invocation>/starter \
  --capture-url 'http://127.0.0.1:<port>/products/sku-42?preview=true'
```

보존한 manifest와 serving 중인 manifest가 같아야 합니다. 생성 correctness test는
shell resource를 먼저 warm하고 실제 search approval을 defer한 동안 resource operation과
native form input acknowledgment를 확인합니다. Background form/search API를 추가하지 않습니다.

Example의 `tests/client-delivery.spec.ts`는 각 action 전에 CDP와 정확한 DOM observer를
등록합니다. Cold/warm과 public-prefetch/private-ordinary trace를 나누어 HTML,
bootstrap, HTTP-selected initial module, 실제 hydration control acknowledgment,
negotiated payload, built destination module, destination DOM/frame 관측을 보존합니다.
CDP monotonic seconds와 document performance milliseconds는 별도 clock domain입니다.
`decodedBytes`는 수집한 decoded body이고 `encodedTransportBytes`는 protocol overhead를
포함하므로 canonical compressed-body budget metric이 **아닙니다**. Cache hit, content
encoding, 반복 network transfer를 명시합니다. Body 수집 실패, 누락 stage나 provenance를
완전한 trace로 바꾸지 않습니다.

이 unthrottled correctness trace는 관측 overhead를 포함하며 5회 profile 영수증이 아닙니다.
전체 directory를 `results/issue-3884/`에 보관하고 `verifyDeliveryTraceFiles(...)`로
artifact를 검증한 뒤, 변경하지 않은 representative regression gate를 별도로 실행합니다.
Canonical metric, 경쟁 앱 실측, profile setting이나 threshold를 diagnostic으로 대체하지
않습니다. Client subset 통과로 실패한 server/dev/full verdict를 통과로 바꾸지 않습니다.
Public prefetch는 HTTP-approved single-use를 유지하며 ordinary private activation,
refresh, retry, history는 여전히 fresh approval을 얻습니다.

## 증거 재현

정확한 frozen-lockfile 설치, build, browser, 측정 및 판정 명령은
[suite README](../../tooling/benchmarks/react-app-comparison/README.md)에 기록합니다.
설치와 build를 마친 뒤, 시간 측정과 분리된 정확성 및 asset/request
smoke를 실행합니다.

```sh
pnpm --dir tooling/benchmarks/react-app-comparison --ignore-workspace test:smoke
```

반복 측정은 대표 host에서 README의 `run-gate.mjs` 명령으로 실행합니다.
`results/<head-sha>/`에는 각각 독립적인 `discovery/`, `regression/` 실행과
별도의 production/development profile 영수증,
실행별 `traces/`, `dev-traces/`, `combined-traces/`, `verdict.json`이 남습니다.
이 디렉터리 전체를 commit된 소스 트리 밖에 보존합니다. 최초 baseline은
Node.js 24.20.0, pnpm 10.4.1, Playwright 1.61.1, seeded dataset,
macOS arm64 Apple M4 Pro host를 지정합니다. 실제 trace에는 Chromium
버전, source hash, lockfile hash, 앱 버전, CPU/network 에뮬레이션,
cache 정책, dirty-worktree 여부도 기록합니다. 일부 profile trace가
있어도 `verdict.json` 없이 중단된 실행은 불완전한 증거입니다. 다른
source hash나 정확성 실패 실행의 영수증을 섞어 누락된 profile을
채우지 않습니다.
각 보고서에 전체 원시 trace를 보관합니다. 실행별 값 없는 집계 비율은 독립
검증이 불가능합니다. Commit된 수치 목표는 장래의 budget이지 경쟁 제품의
측정값이 아닙니다. 완료되고 반복 가능한 측정만 경쟁 제품 관측값에 넣고
추정값이나 한 번의 smoke 값으로 대체하지 않습니다.

첫 네 profile 실행은 dirty worktree의
`f71be378fc824d6b093a25881ea1f994826c6910`에서 source SHA-256
`ba68a55a6c04d0d75b640c13373a39b33318d0a892be69437ea935ce1e3e8312`를
기록했습니다.
그 뒤 lint 전용 소스 교정은 build/browser 재검증을 통과했고 후보 소스 hash가
`2d52ddcbdfe8699308ea0f1b20f15112b95e2b7e5e0cc09f4658bdc10c391884`로
달라졌습니다. 이 discovery는 이후 commit head의 성능 영수증이 아닙니다.
[Commit된 manifest](../../tooling/benchmarks/react-app-comparison/evidence/3883-baseline.json)는
gitignore된 로컬 `results/local-3883-auth-recheck/`와 production 원시 trace
112개, development 원시 trace 112개, 결합 trace 80개 및 모든 영수증의
무결성 hash를 가리킵니다. 개별 sample을 확인하려면 무시된 전체 실행
디렉터리가 필요하며 manifest에 원시 본문이 포함된 것은 아닙니다.
성능 판정은 **fail**입니다. Fluo tablet-native CSS edit 중앙값 `1504.67 ms`가
고정된 `1500 ms` budget을 넘고 상대 비교 band 22건도 실패했습니다.
Fluo desktop-native compressed JS는 `66,373 / 170,000` byte로 해당
metric만 통과했습니다. 동일한 verdict의 noise 42건, outlier 64건,
missing-metric 157건은 판정 불명입니다. `baseline.json`에는 Fluo와
경쟁 앱의 모든 metric 중앙값을 기술적으로 기록하고 값이 없으면 `null`로
표시합니다. Noise나 outlier가 있는 숫자 중앙값도 해당 판정 불명을
통과로 바꾸지 않습니다. Discovery의 종료 코드나 판정 불명 metric의 숫자만으로 성능
통과를 주장할 수 없습니다.
