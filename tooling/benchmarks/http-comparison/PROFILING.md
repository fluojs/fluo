# HTTP runtime profiling

## #3910 측정 결과

수집 범위, 원본 검증, 동일-runtime 비교, hotspot 재확인과 headroom 한계는
[`results/profiling/REPORT.md`](results/profiling/REPORT.md)에 정리했다.
[`manifest.json`](results/profiling/manifest.json)은 원본 해시와 분석 산출물을 연결한다.
원본 archive는 로컬에 별도 보존하며 Git 요약만으로 raw 검증을 재현할 수는 없다.
서버 최대 capacity와 성능 예산 PASS를 주장하지 않는다.

## 실행과 API

이 엔진은 기존 `load`, `monitorServer`, `EvidenceJournal`과 canonical target launch를 사용한다. `src/run.ts`의 uninstrumented timing과 별도로 실행한다. 공개 package API는 추가하지 않는다.

```sh
cd tooling/benchmarks/http-comparison
BENCH_TARGETS=native-nodejs \
BENCH_SUITE=business BENCH_SCENARIOS=read-search-local \
BENCH_PROFILE_MODES=cpu BENCH_CONFIGURATION=equivalent \
BENCH_CONNECTIONS=4 BENCH_WARMUP_SEC=1 \
BENCH_MEASURE_SEC=2 BENCH_CONTROL_SEC=1 \
pnpm exec tsx src/profile.ts
```

위 명령은 development-only smoke이다. 성능 측정, headroom 또는 profiler overhead budget 통과를 뜻하지 않는다.

- `runProfiles(plan: CapturePlan)`: 선택한 target/scenario/mode/repeat를 순차 capture한다. 모든 16개 `TARGETS`를 선택할 수 있다. target name을 생략하면 16개 전체이며, unknown/duplicate name은 실패한다.
- `captureCondition(...)`: lead가 소유하는 orchestration에서 단일 조건을 실행한다. 기존 `EnvironmentSummary`, provenance SHA-256과 `EvidenceJournal`을 전달한다.
- `validateCapture(capture, rawBytes)`: raw bytes의 hash/size, serving subject, profile schema, request frames, 3개 phase의 성공 traffic과 clock anchors를 검증한다.
- `profileCompleteness(captures, requiredConditions, rawBytes)`: 선언한 조건의 missing/duplicate/failed/partial capture를 거부한다. **subset coverage complete와 issue acceptance complete는 다르다.**
- `timingCompleteness(samples, provenanceSha256)`: fresh issue3910의 16 targets × (3 business + 8 stage scenarios) × 2 configurations × concurrency 1/64 × 3 repeats, **2112개** 고유 uninstrumented 조건만 complete로 판정한다. historical 576 archive, instrumented samples, 잘못된 provenance, empty/error traffic과 partial matrix는 거부한다. lead가 timing 결과를 `StageTimingSample`로 투영한다.

### Lead의 raw timing 변환 계약

`timingCompleteness`는 pure descriptor validator이며 raw timing parser/aggregation은 lead 소유다. `source:'issue3910'` label 또는 descriptor의 hash 문자열만으로 raw provenance가 입증되는 것은 아니다. lead는 **descriptor 구성 전에** 원본 journal/measurement를 parse하고 다음을 검증해야 한다.

1. completed request count가 양수이고 errors, timeouts, non2xx, body mismatches(`result.mismatches`), statusMismatches가 모두 정확히 0이다. field가 없거나 partial/interrupted/invalidAttempts가 있는 record를 정상 sample로 보완하지 않는다.
2. actual configuration/scenario/concurrency/repeat/mode가 조건과 일치하며 warmup 5초, measurement 15초의 완료된 interval이다. historical archive에서 이 값을 재표시하지 않는다.
3. raw bytes의 SHA-256을 실제로 재계산한다. source snapshot digest와 그 source로 수행된 build receipt의 source digest가 같고, provenance digest가 해당 source/build/runtime/lockfile에 연결돼 있다. reused artifact를 fresh build로 표시하지 않는다.
4. `StageTimingSample`의 required counters/intervals/sourceSha256/buildSourceSha256/rawSha256을 검증한 원본 값으로 채운다. pure validator는 누락된 counters, 잘못된 interval, source/build digest 불일치와 2112 coverage를 거부하지만 caller가 제공한 hash의 원본 bytes를 직접 읽지는 않는다.

CLI는 `BENCH_SUITE=business|stages|all`, `BENCH_TARGETS`, `BENCH_SCENARIOS`를 사용한다. `BENCH_PROFILE_MODES=cpu,allocation,gc-eventloop`로 mode를 선택한다. `BENCH_PROFILE_RUNS` 기본값은 1, `BENCH_CONFIGURATION` 기본값은 equivalent, concurrency 기본값은 64, warmup은 5초, capture/control은 각각 15초다. HTTP 포트 기본 base는 `35111`, inspector base는 `35211`이며 `BENCH_PROFILE_PORT_BASE`와 `BENCH_INSPECTOR_PORT_BASE`로 별도 배정한다.

기본 실행은 준비된 build를 사용한다. `BENCH_PROFILE_BUILD=1`은 선택한 target만 `buildTarget`으로 빌드하며 root build를 하지 않는다. build 중인 다른 writer와 실행을 겹치지 않는다. reuse는 fresh root build claim이 아니다. canonical Next `.next/trace`의 `next-build`/`bundler=turbopack`와 `BUILD_ID`를 보존하며 webpack probe fixture를 acceptance로 대체하지 않는다.

## Mode와 serving subject

각 조건은 새 서버의 `control-before`, 별도 새 서버의 `capture`, 별도 새 서버의 `control-after`로 구성된다. control은 inspector, GC flags, runtime diagnostic injection을 사용하지 않는다. 각 phase는 실제 cold HTTP correctness request, warmup, `monitorServer`가 감싼 load와 process teardown을 수행한다.

| Mode | Node / production Next / Deno / application workerd | Bun JSC |
| --- | --- | --- |
| `cpu` | `Profiler.enable`, `Profiler.setSamplingInterval({interval:1000})`, `Profiler.start` → `Profiler.stop` | `ScriptProfiler.startTracking({includeSamples:true})` → `ScriptProfiler.stopTracking` 및 `ScriptProfiler.trackingComplete` |
| `allocation` | `HeapProfiler.enable`, `HeapProfiler.startSampling({samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true})` → `HeapProfiler.getSamplingProfile` → `HeapProfiler.stopSampling` | `Heap.enable`, `Heap.startTracking` → `Heap.stopTracking` 및 `Heap.trackingComplete.snapshotData` |
| `gc-eventloop` | Node/Next `--trace-gc`와 serving `perf_hooks`; Deno `--v8-flags=--trace-gc`와 serving wall-delay sampler. workerd `Tracing.start` 지원을 직접 probe | `Heap.enable`의 `Heap.garbageCollected`와 serving wall-delay sampler |

CPU-only mode는 heap/GC profiler를 시작하지 않는다. allocation/heap-only mode는 CPU profiler를 시작하지 않는다. GC/event-loop mode는 CPU 또는 allocation profiler를 시작하지 않는다. Bun heap은 **retained snapshot**이며 allocation sample/rate가 아니다. V8 allocation은 collected objects를 sampling에 포함하도록 명시한다. sampled bytes를 정확한 allocation count/rate로 표시하지 않는다. 초기 live-only Deno capture가 0 samples였던 실패도 보존한다.

Node/Next/Deno inspector `/json/list`의 websocket을 선택한다. Bun은 JSC websocket이다. `Runtime.evaluate`의 실제 PID/runtime과 process tree를 대조한다. Workers는 priming HTTP 완료 후 `/json/list`에서 direct `workerd:` 또는 Wrangler proxy의 `Cloudflare Worker`/`description=workers` application target 하나를 선택한다. proxy websocket에는 `Origin: http://localhost`를 보낸다. `WebSocketPair`와 `caches`가 있는 Worker realm, actual workerd descendant PID, `Runtime.getIsolateId`의 실제 application isolate id를 확인한다. proxy discovery id는 inspector session id이며 둘을 혼동하지 않는다. process/isolate identity 원본과 `Runtime.enable` context notification을 protocol에 보존한다. Wrangler Node launcher를 application CPU subject로 인정하지 않는다.

## Evidence와 실패

V8 allocation 종료 전 `getSamplingProfile`을 한 번 호출해 snapshot 변환을 priming한다.
V8는 트리 변환 중에도 sampling 가능한 문자열을 할당할 수 있다. priming은 snapshot
일관성의 보장이 아니며, 최종 `stopSampling` 응답의 모든 sample-node 연결을 검증한다.
중간 snapshot으로 최종 응답을 대체하거나 누락된 node/sample을 보정·삭제하지 않는다.
priming은 측정 traffic 종료 뒤에 수행하며, 원본에는 종료 처리의 profiler 자체 비용도
포함될 수 있다. CPU 및 Bun retained-heap 경로에는 이 호출을 추가하지 않는다.

각 invocation은 `results/profiling/<timestamp>-<uuid>/`에 `provenance.json`, `manifest.json`, `report.json`과 조건별 고유 디렉터리를 만든다.

- `protocol.jsonl`: 전송한 method/id/params와 수신한 raw protocol bytes, collector monotonic timestamp.
- `allocation-prime-protocol.jsonl`: V8 allocation priming 요청과 전체 raw 응답. 최종 응답과 파일을 분리해 각 파일의 64 MiB 한도를 유지한다.
- `subject.json`, `discovery.json`: runtime identity, serving/launcher PID, isolate id, inspector URL과 process tree.
- `profile.json`: native V8 CPU/allocation profile, JSC CPU stack samples, JSC heap snapshot 또는 diagnostic output. 원본 stack을 요약으로 대체하지 않는다.
- phase별 stdout/stderr, `entry.json`의 built entry hash, Next build trace/BUILD_ID, 조건별 provenance bytes/hash.
- 각 `ProfileCapture.artifacts`의 상대 경로, byte size, SHA-256과 `manifest.json`의 `invalidAttempts`. interrupted/failed attempts는 complete coverage에 포함하지 않는다.

파일별 raw limit는 64 MiB다. 초과하면 failed로 처리하고 남은 부분을 성공 artifact로 인정하지 않는다. raw response를 거대한 console output으로 내보내지 않는다.

상태는 `supported`, `unsupported`, `blocked`, `failed`다. 현재 workerd GC `Tracing.start`의 실제 `-32601`만 optional unsupported로 분류한다. CPU/heap capture 실패, inspector 접근 실패, empty/startup-only profile, 잘못된 subject, 불완전한 flush는 unsupported fallback이 아니다.

workerd의 Tracing.start rejection은 이 protocol에만 적용된다. 전체 GC capability가 unsupported라는 증거가 아니며 passive application-isolate GC capture는 blocked/unproven으로 남는다. stage request attribution은 native anonymous stage handler, Fluo의 zero-argument `read`, stage request helpers 및 bundled `nativeFetch` ancestor를 포함한다. module/factory startup frame만으로 request profile을 통과시키지 않는다.

## Clock, flush와 해석

runtime `performance.now()`를 읽기 전후의 collector clock으로 bracket해 시작/종료 anchor 두 개를 보존한다. Node uptime도 함께 기록한다. collector, CPU profile, JSC event 및 V8 GC log의 원점이 같다고 가정하지 않는다. Workers의 request-local frozen clock을 Node ELU 또는 유효 wall-delay로 집계하지 않는다.

Node/Next의 inspector evaluation에서는 dynamic import callback이 없을 수 있어 `process.getBuiltinModule('node:perf_hooks')`를 사용한다. 초기 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` 실패도 raw evidence로 보존한다.

JSC notification은 stop 호출 전에 구독한다. V8 stop response와 JSC completion event를 확보한 뒤 websocket을 닫고 기존 `stopTargets`로 process group을 종료한다. SIGKILL teardown은 invalid다. readiness/protocol/exit는 이벤트 기반 bounded timeout이며 fixed sleep을 사용하지 않는다. wall-delay diagnostic의 10ms interval과 existing resource monitor interval은 시간 자체를 측정하는 instrumentation이다.

`report.json`은 phase별 throughput/latency/process-tree CPU와 raw linkage를 보존한다. fresh-process before/after control의 drift, profiler overhead, client contention과 짧은 capture 한계를 검토해야 한다. RSS는 allocation/GC metric이 아니며 process-tree CPU는 isolate/request CPU가 아니다. generated frames는 실제 source map을 검증하기 전까지 unresolved다.

이 CLI는 subset capture가 모두 성공해도 issue acceptance를 `incomplete`로 남긴다. 전체 2112 timings, primary equivalent/concurrency64의 target/scenario profiles, generator control, overhead 분석과 bottleneck map의 final aggregation은 lead가 수행한다.
