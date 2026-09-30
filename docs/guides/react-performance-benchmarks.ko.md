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

기계가 읽는 suite의 `baseline.json`은 절대 budget, 상대 비교 band, profile,
반복/warmup 횟수, 집계법, noise 처리와 outlier 규칙을 소유합니다. 예산을
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
동결된 네 profile의 반복 및 noise 규칙을 유지하되 production server의 TTFB,
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
