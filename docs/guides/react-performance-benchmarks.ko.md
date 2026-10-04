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

### FA-V2 관측 범위 수용

FA-V2는 수용 의미를 변경하며 numeric budget이나 public 동작을 완화하지 않습니다.
`baseline.json`의 기존 median/spread/MAD veto는 historical replay 전용입니다.
`evaluatePerformance(..., "historical-v1")`, `evaluateEvidence`,
`evaluateServerEvidence`, CLI `--historical-replay`는 과거 판정을 보존합니다.
과거 FAIL/INCONCLUSIVE나 unversioned receipt를 FA-V2로 재분류할 수 없습니다.

수용은 개수뿐 아니라 정확한 rotating plan을 인증합니다. Cycle 1-2는 warmup,
3-7은 measured이고 각 cycle의 네 framework slot 순서를 유지합니다.
Receipt와 raw/combined trace의 `warmup`/`cycle`/`slot`, run/profile/cache/framework,
raw device/URL을 결합하므로 두 purpose에서 같이 바꾸고 원본 raw/config hash를
보존해도 warmup을 measured로 옮길 수 없습니다. Production journeys의
action/status/selector, interactions 및 `/products/sku-42`의 200 requests/
concurrency 8은 승인된 `config/representative.json.measurement`와 일치해야
합니다. Production-only SHA-256
`b8d8a51b4b40660c796d952a5af3a066dc2c5837a33841e5556c5d050cedc119`를
method receipt에 결합하며, 모든 phase/purpose를 같은 잘못된 endpoint/route/action으로
바꾸고 self-hash를 다시 계산해도 승인된 workload가 아닙니다. 선언된
purpose/phase/root 및 별도 인증된 development source-edit 차이는 production
descriptor를 바꾸지 않습니다. 이 guard는 missing timing/native pair나
알려진 Next terminal coverage gap을 해결한 것이 아닙니다.

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
nativeReceipts)`와 server subset의 `evaluateAcceptedServerEvidence`는 두 purpose를
함께 인증합니다. `evaluateAcceptedPair`/`evaluateAcceptedServerPair`는 fresh
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
현재 client helper는 FA-V2 이전 구현이라 새 phase 차이를 거부합니다.
Client owner가 인증된 method/phase 관계만 좁게 적응해야 하며 이번 server 방법이
그 통합 통과를 주장하지 않습니다. 각 full config/hash에 `pairPhase`를 남기고
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
새 수용은 위 FA-V2 방법을 적용합니다. 예산을
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
현재 Fluo fixture는 Fast Refresh가 아니라 다시 build/restart한 후
browser를 reload합니다. TanStack의 route loader 편집은 개발 서버를
다시 시작한 뒤 변경된 페이지를 엽니다. 두 편집 시간은 실제 restart
경로를 포함합니다. Next.js CSS 편집도 태블릿급 browser에서 CSS HMR
표시가 안정적으로 관찰되지 않아 개발 서버를 재시작하고 문서를 다시
엽니다. Next.js server 편집도 소스 변경이 browser에 반영되지 않아
재시작 후 문서를 다시 엽니다. 두 값 모두 native HMR 시간은 아닙니다.
Fluo fixture의 build/restart harness는 generated
starter의 `fluo dev` Vite middleware 경로가 아닙니다. 이 값으로
canonical Fluo 개발 지연이나 경쟁 앱과의 개발 성능 동등성을 주장할 수
없습니다.
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

#3885의 [suite server-only runner](../../tooling/benchmarks/react-app-comparison/README.md)는
동결된 네 profile의 반복과 budget을 유지하고 FA-V2 관측 범위로 production server의 TTFB,
throughput/error rate, CPU, RSS만 평가합니다. 개발 편집을 실행하거나 22개
metric 전체의 verdict를 주장하지 않습니다. Browser의 first-contentful-paint인
`shellArrivalMs`는 실제 socket에서 처음 받은 shell byte가 **아닙니다**.
별도 gate가 있는 Fastify 실제 socket에서 shell 전달과 request-abort 정리를
검증하고, 읽기를 멈춘 client에서 `write(false)`/drain 또는 close 및 request-scope
폐기를 검증합니다. 점진적으로 flush하는 gzip proxy는 descendant 해제 전
압축 해제된 shell을 전달할 수 있지만 전체 body를 모은 뒤 gzip하는 proxy는
이를 버퍼링합니다. Buffered host는 선언한 body 크기와 concurrency에서
따로 측정합니다. Node writable high-water mark는 전체 RSS 상한이 아닙니다.
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

## 증거 재현

### 명시적인 Linux server-only 환경

아래 observer runtime/journal/lifecycle 요구는 native-conformance에 적용합니다.
FA-V2 timing은 Python/Frida observer identity 없이 같은 Linux/browser/collector
환경을 인증합니다. Timing purpose와 `nativeLifetime.enabled: false`로 파생하고
after의 `pairPhase`를 변경합니다. 각 purpose는 자기 before의 environment/config
ID와 비교해야 합니다.

과거 macOS ARM64 Apple M4 Pro/Node 24.20.0 baseline은 변경하지 않습니다.
현재 대표 GitHub workflow는 여전히
`self-hosted, macOS, ARM64, react-app-performance-m4-pro` label을 요구하며
새 Linux 경로를 dispatch하지 않습니다. 일반 CI/macOS의 기본 native lifetime
observer는 disabled이며 Docker, Python, Frida를 요구하지 않습니다.

#3885의 새 대표 경로는 같은 Apple M4 Pro host의 실제 실행 중인 Linux ARM64
container를 명시적으로 선택합니다. 동결 환경은 OrbStack kernel
`7.0.14-orbstack-00380-ga7e0a2dc9535`, image reference
`fluo-verification:sha256-81a185cd17d652f2d9fe7dbbaad1647262d17094e49eac533e7de30d2b37293e`,
actual image ID
`sha256:f240abbe0c9fadb08df3b4f8b409111f5fd87733dfade0c69d6dfd839682d56b`,
Node `v24.21.0`/V8 `13.6.233.17-node.53`, logical CPU 12개,
shared VM memory 8,392,974,336 byte입니다. 추가 per-container CPU quota,
cpuset, memory limit은 없습니다. 공유 capacity 관측이며 전용 reservation이
아닙니다. 사용자 질문이 응답 없이 만료된 뒤 lead가 best judgment로 선택한
환경으로, affirmative user selection이나 budget 면제가 아닙니다.

독점 측정 창을 조정하고 해당 환경에서 dependency와 production build를 먼저
준비합니다. Container는 같은 절대 경로의 checkout과 실제 provisioned SDK,
browser를 사용할 수 있어야 합니다. [suite README의 실제 명령](../../tooling/benchmarks/react-app-comparison/README.md#explicit-linux-server-only-invocation)은
변경하지 않은 `config/representative.json`에서 로컬 config를 파생하고
FA-V2 method/pair/phase와 native-conformance
`measurement.nativeLifetime = { enabled: true, python: "/absolute/provisioned/python" }`을
명시한 뒤 다음 runner를 사용합니다.

```sh
node src/run-server-only.mjs \
  --config ../../../.omo/verification/issue-3885/server-environment-config.json \
  --output-dir "$(pwd)/results/$(git rev-parse HEAD)/before" \
  --isolated-container <running-container>
```

Host Docker info/inspect에서 선택한 running container로 fresh invocation을 전달하고
guest가 OS/kernel, image/allocation, 실제 Node/pnpm executable,
Playwright/TypeScript SDK 구현, 실행한 browser, Python/Frida executable/dependency
hash, collector/observer/schema와 cgroup allocation을 인증합니다. Image 생성 후
provisioned SDK는 image ID와 별도로 검증합니다. 준비 JSON은 실제 invocation의
대체물이 아닙니다. Missing/mismatch/tamper/unsupported binding은 수집과
server 평가를 통과할 수 없습니다.

`chromium-native-lifetime-v1`은 opt-in입니다. 지원 경계는 Linux ARM64
revision 1228 `headless_shell` `149.0.7827.0`, binary SHA-256
`b6f53f7e40c3ad6727cb3a12536026dcd93281e5965923752c8130ed53e5e8c4`,
build ID `afcd146a627911fb30269f995d093903636ed886`, ELF64-LE-AArch64,
Python `3.11.2`/Frida `17.21.0`의 동결 hash와 versioned hook/agent/host schema입니다.
macOS를 포함한 미지원 host에서 요청하면 native PASS로 대체하지 않고
unavailable/nonzero/inconclusive로 남깁니다.

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

공통 production observer는 원래 cutoff에서 request hook을 drain/stop하지만
child gating, Frida session/agent와 pidfd 종료 구독은 소유 process의 자연
종료까지 유지합니다. Release는 재개 중인 exec child의 gate를 변경하지 않으며
최종 close가 남은 session을 정리합니다. BrowserServer 종료 전에 살아 있는 agent를
detach/unload하지 않습니다. 실패·abort된 preparation에서 observer child를
bounded 종료해도 eternalize된 inert script는 live-agent unload를 방지합니다.
Resident memory/runtime 비용과 drain 이후 shutdown IPC 비용을 차감하지 않습니다.
Main exit/error/disconnect와 관측 가능한 descendant wait status를 원시 증거에
보존하고 알려진 비정상 종료는 NetLog parse 전에 거부합니다. 이미 reap된
status는 0이 아니라 missing이며 Python exit 0이나 main exit 0만으로 모든
descendant의 정상 종료를 입증하지 않습니다. 명시적 close 이후 shutdown의 raw status 15는 인증된 Chromium
정상 종료 caller, 살아 있는 소유 target의 PID/start identity, 성공한 SIGTERM
전송, 명시적 close 이후 순서와 정상 main 종료가 모두 일치할 때만 의도적인
shutdown으로 구분합니다. Zombie target, 실패한 전송, 누락된 caller와 원인 불명
종료는 허용하지 않으며 status 15나 missing을 0으로 바꾸지 않습니다.

Runner provenance, profile receipt, production/warmup raw trace와 별도 socket
관측에 동일한 실제 environment binding을 보존합니다. 평가 경계의
Historical `evaluateServerEvidence`는 replay 전용입니다.
FA-V2 `evaluateAcceptedServerEvidence`는 공통 environment/raw/native 인증과
matching native counterpart를 요구한 뒤 관측 범위 판정을 6개 server metric으로
필터링합니다. Passive headroom은
generator/ambient CPU 관측을 추가할 뿐 기존 sampling, browser cutoff,
throughput 및 그 이후 `ps` CPU/RSS와 lifecycle을 변경하지 않습니다. Socket은
native loopback이며 browser profile emulation을 상속하지 않습니다.
Buffered 크기/concurrency 증거도 독립 실험으로 남깁니다.

FA-V2 after에는 before의 `--environment-identity <identitySha256>`를 유지하되
after의 `--environment-config-identity <configSha256>`를 따로 동결해 전달합니다.
`pairPhase`가 full hash를 바꾸므로 before hash를 after alias로 쓰지 않습니다.
Historical same-config replay는 기존 두 before ID 검사를 유지합니다.
비교 identity는 run ID/PID, 절대 product/tool locator와 product HEAD 변경을
제외하지만 provenance에는 보존하며, 실제 tool/collector 내용, allocation,
동결 config는 제외하지 않습니다. 전체 environment record, profile config,
receipt, raw/native trace, socket 파일과 verdict를 함께 보관해야 replay할 수
있습니다. 과거 macOS와 새 Linux를 paired gain으로 묶거나 과거 Linux
FAIL/inconclusive를 재분류하지 않습니다. 같은 최종 collector의 새 before/after
재수집은 여전히 필요하며 환경 probe는 성능 수용이 아닙니다.
Stable product/source/build provenance는 인증된 top-level invocation binding과
분리합니다. Runner와 measurement child 모두 공통 capture의
`entrypoints: ["run-server-only.mjs"]`를 선택하며 공통 12개 소스와 runner,
server measurement, socket-shell을 같은 경계로 인증합니다. Child는 선택과
`fa-v2.mjs`, `server-cpu.mjs`도 포함합니다. Parent binding을 invocation transport로 전달받고 실제 환경을 driver 실행 전에
인증·비교합니다. FA-V2 gate는 historical strict replay에 method/purpose/config/
CPU/counterpart 인증을 추가합니다. 명시적인 isolated
모드만 invocation 소유 Linux Python subreaper를 통해 host SIGINT/SIGTERM을
전달하고 descendant reap을 요구하며 `finally`에서 allocation을 재확인합니다.
일반 disabled CI/macOS에는 Python 요구 사항이 추가되지 않습니다.

이전 공통 환경의 four-warmup probe에서 truncated NetLog와 browser 종료 후
incomplete coverage가 남았고 원인은 미해결입니다. 이후 DEBUG/zero-warmup
small-fixture 통과는 warmup 안정성 증거가 아닙니다. JSON repair, sleep/poll
flush 또는 동결 acceptance warmup 축소 없이 실패를 nonzero/inconclusive로
보존합니다.

소스를 고정한 독립 재현에서는 Frida detach 후 `server.close` 전에 main browser가
SIGSEGV로 종료했고 실제 network-service writer도 JSON footer 없이 닫혔습니다.
그 재현은 flush 대기로 설명할 수 없습니다. Resident-agent 개입의 제한된 행
완료는 production 수정이나 안정성 증명이 아닙니다. JSON이 완전하고 main exit가
0인 별도 행에서도 zygote crash가 있었으므로 두 조건만으로 descendant teardown
안전을 증명하지 않습니다. 원래 과거 capture에는 browser exit 증거가 없었으므로
이번 원인을 소급해 단정하거나 diagnostic 결과를 성능 수용 증거로 재사용하지 않습니다.
이후 공통 production 수정은 위 resident 종료 경계와 인증된 shutdown 관측을
함께 채택합니다. 새 source의 제한된 fixture/replay 통과도 과거 실패를 지우거나
전체 before/after 성능 수용·장기 안정성·독립 reviewer PASS를 대신하지 않습니다.

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
