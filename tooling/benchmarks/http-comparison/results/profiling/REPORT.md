# #3910 HTTP stage and runtime profiling

## 결과와 범위

2026-10-03~2026-10-08의 동일 Mac 측정이다. 수집과 원본 검증은 완료했지만,
**독립적인 서버 최대 처리량 또는 성능 예산 PASS를 입증한 결과는 아니다.**
실제 runtime 최적화는 후속 #3911~#3914, 성능 게이트는 #3915의 범위다.

| 증거 | 결과 | 원본 연결 |
| --- | --- | --- |
| 비계측 timing | 16 targets × 11 scenarios × 2 configurations × 2 concurrency × 3 repeats = 2,112 samples | `timing-collection-audit-20261008.json` |
| primary profiling | 528개 고유 조건: supported 506, unsupported 22 | `primary-raw-audit-20261008.log` |
| 원본 검증 | 5,360개 파일, 8,314,371,516 bytes; SHA-256, subject, traffic, coverage 통과 | `audit-primary-20261008.mjs` |
| hotspot 재확인 | 7개 Fluo 플랫폼 + native Deno/Next 대조, CPU 9개 capture | `hotspot-confirmations.json` |
| generator 진단 | 14개 조건, 1-vs-4 generators, 3회 교차 비교, 84개 관측 | `headroom-summary.json` |
| 최종 focused checks | 초기 107 tests·fresh build 통과; GC 표기 수정 후 110 tests, review fix-back 후 123 tests·typecheck·lint 통과 | `final-focused-checks-20261008.log`, `gc-metadata-focused-20261008.log`, `review-boundary-focused-20261009.log` |
| 실제 host smoke | 16 targets × 11 scenarios = 176 receipts; 각 25개 요청의 body/status/counters 통과 | `final-correctness-smoke-20261008.json` |

Primary condition은 `equivalent`, concurrency 64, warmup 5초, capture 15초다.
각 mode는 새 서버의 비계측 before/after control을 각각 갖는다.
CPU, sampled allocation/retained heap, GC/event-loop mode를 합치지 않았다.
중단·실패 원본은 보존하고, 해당 실패 capture만 정상 matrix에서 제외했다.

## 동일 조건 비교

아래 값은 `equivalent`, concurrency 64에서 3회 비계측 처리량의 중앙값 비율
`Fluo / 같은 runtime의 native`다. 1보다 작으면 이 관측에서 Fluo 처리량이 낮았다.
이는 최대 서버 capacity 또는 독점 framework CPU 비용 비율이 아니다.

| 플랫폼 | 최소 응답 | 업무 조회 |
| --- | ---: | ---: |
| Fastify | 0.645 | 0.739 |
| Express | 0.682 | 0.699 |
| Node.js | 0.602 | 0.677 |
| Bun | 0.721 | 0.689 |
| Deno | 0.402 | 0.577 |
| local Workers | 0.977 | 0.986 |
| production Next | 0.894 | 0.906 |

같은 조건의 Nest 대비 비율은 Fastify 최소 응답 0.689 / 업무 조회 0.770,
Express 최소 응답 0.701 / 업무 조회 0.742였다. 전체 704개 조건 통계와
396개 native/Nest 비교는 `timing-comparisons.json`에 있다.
각 반복의 p50/p95/p99와 변동을 보존하며, 반복 percentile을 pooled percentile로 부르지 않는다.

## 반복 관측된 비용과 후속 조사

아래 비율은 전체 CPU profile sample 중 self share다. idle/GC/program sample도
분모에 포함하며, absolute CPU time이나 exclusive stage time이 아니다.

| 관측 | Primary → 재확인 | 대응 위치 / 후속 |
| --- | --- | --- |
| Fastify request shell | 3.10% → 2.76% | `platform-nodejs`의 `createDeferredFrameworkRequestShell`, #3912 |
| Express response wrapper | 6.01% → 5.11% | `platform-express`의 `createFrameworkResponse`, #3912 |
| Bun header lookup | `findHeaderName` 5.53% → 4.84%; 인접 anonymous scan도 반복 관측 | `runtime/src/web.ts`, #3911/#3913 |
| Deno request 종료 | `DOMException` 18.77% → 19.79% | raw parent chain은 Deno `abortRequest`/`close`; #3913 조사 |
| Workers response headers | 8.54% → 6.71% | `toResponseHeaders`, #3914 |
| Workers request headers | 3.89% → 5.05% | `cloneWebHeaders`, #3914 |

Node의 `writev`와 Next의 metadata/render/manifest frame은 host/runtime 비용이다.
특히 native Next 대조에서도 유사한 frame이 관측돼 독점 Fluo 병목으로 판정하지 않았다.
`loadManifest`의 실제 구현에는 cache hit 경로가 있어 함수 출현만으로 요청마다 파일을
읽는다고 단정하지 않는다.

Deno native 재확인에는 `DOMException` leaf sample이 없었다. 그러나 이것만으로
Fluo의 특정 signal 접근이 원인이라고 확정할 수는 없다. 정상 완료, peer disconnect,
이미 abort된 signal과 body read의 계약을 보존하는 통제 실험이 후속 작업에 필요하다.

전체 raw stack 참조, source 대응 방법, 우선순위와 회귀 조건은 `bottleneck-map.json`에 있다.
함수명/본문 대응과 검증된 source-map mapping은 구분한다. Workers 임시 source map의
직접 조회가 profile 좌표와 맞지 않은 항목은 exact mapping 미확정으로 남겼다.

## headroom과 진단의 한계

플랫폼별 최고 처리량 조건과 최고 generator CPU 조건을 선정했다.
같은 총 concurrency 64에서 generator 4개/1개 처리량 중앙값 비율은
0.842~1.060이었다. 여러 조건의 단일 generator CPU가 약 한 코어에 도달했고,
4개 generator는 같은 host에서 오히려 처리량이 낮아지기도 했다.
따라서 **독립적인 서버 capacity/headroom 판정은 inconclusive**다.
별도 머신 또는 동기화된 부하 제어 없이 모든 scenario나 concurrency 1로 일반화하지 않는다.

Workers의 22개 `gc-eventloop` 조건은 application-isolate `Tracing.start`의 실제
미지원 응답을 보존한 것이다. CPU와 allocation은 application isolate에서 수집했다.
이 protocol 미지원은 모든 GC 관측 수단이 미지원이라는 뜻이 아니다.
Wrangler를 포함한 process-tree CPU는 isolate/request CPU와 다르다.
cross-request promise 경고도 `workerd-runtime-warning.md`에 남아 있다.

Bun heap은 retained snapshot이지 allocation rate가 아니다. V8 sampling size 합계,
RSS, GC, event-loop wall delay, Node ELU를 서로 대체하지 않는다.
GC stdout/stderr의 집계는 해당 phase의 warmup도 포함하며 steady-state 전용 횟수가 아니다.
`profile-metrics.json`은 before/capture/after의 throughput, latency, CPU/request,
memory와 profiler overhead/drift를 각 mode별로 연결한다.

기존 Bun GC 원본의 `gcTraceSource: "--trace-gc"`는 collector의 잘못된 표기였다.
실제 launch에는 그 Node flag가 없고, protocol에는 JSC `Heap.garbageCollected`
이벤트가 보존돼 있다. 기존 원본은 해시 보존을 위해 수정하지 않았다.
`profile-metrics.json`은 실제 이벤트 수집원을 구분하며, collector의 후속 수정은
새 Bun 결과에 `Heap.garbageCollected`를 기록한다.

## 재현과 원본 보존

`primary-inputs-20261008.json`이 primary 디렉터리를 고정하므로 후속 hotspot capture를
primary matrix에 중복 포함하지 않는다.

```sh
cd tooling/benchmarks/http-comparison
node --max-old-space-size=4096 --import tsx results/profiling/audit-primary-20261008.mjs
node --max-old-space-size=4096 results/profiling/summarize-primary-20261008.mjs
```

위 명령은 보존된 raw 디렉터리가 필요하다. 요약 파일만으로 원본 검증을 통과하지 않는다.
Timing은 원래 `b02cde867` source에 연결돼 있고, 이후 Nest/Deno/Workers classifier 수정은
기존 자료를 새 head에서 측정한 것처럼 바꾸지 않았다. Headroom의 준비 순서 수정 역시
기존 timing이나 serving runtime을 변경한 최적화가 아니다.

원본과 실패 증거를 담은 로컬 archive는
`.omo/3910-raw-evidence-20261008.tar.gz`이며 크기는 1,130,338,756 bytes다.
SHA-256은 `f7c5e6158192a6f68588e6df29040012983e4e66a47e355e701a824ad51a5b1e`다.
Archive 전체 읽기가 exit 0으로 완료됐다. 보관 방식 질문의 timeout 후 lead 판단으로 Git에는 분석·manifest·재현 도구를,
로컬에는 원본 archive를 보존한다. 사용자의 명시적 선택으로 기록하지 않는다.
원격 원본 배포는 하지 않았으며, 이 경로를 외부에서 다운로드 가능한 증거로 표시하지 않는다.
원본 archive를 가진 환경에서 `tar -xzf <archive> -C results/profiling`으로 복원한 뒤
위 검증 명령을 실행한다. 요약만 받은 외부 독자는 raw evidence를 독립 검증할 수 없다.

## 리뷰 fix-back 검증

Next bundle 경로만으로 startup 프레임을 요청으로 인정하던 결함과 V8 CPU
`startTime`/`endTime`/`timeDeltas` 검증 누락을 exact reviewed head에서 재현했다.
검증된 Next host 요청 ancestry, shared source의 알려진 요청 함수, native stage
handler 위치로 인식을 제한하고, 유한한 양의 CPU interval과 sample/delta 대응을 검사한다.
0인 delta는 실제 V8 기록에도 존재하므로 허용한다. 인접 startup 반례까지 포함한
123개 테스트와 전체 528개 primary 조건의 강화된 raw 감사가 통과했다.
원본을 재측정하거나 기존 실패 판정을 덮어쓰지 않았다.
