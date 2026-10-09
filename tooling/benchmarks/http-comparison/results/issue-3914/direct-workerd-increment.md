# #3914 direct workerd 로컬 increment

이 결과는 canonical LOCAL Workers timing host의 전환과 그 검증만 완료한다.
Deployed Cloudflare acceptance, 전체 성능 행렬, 성능 개선 판정, remote CI 및
issue 전체 완료는 OPEN이다. 결과는 성능 baseline이 아니다.

## 실행 및 identity 경계

- `native-workers` / `fluo-workers`, 기존 workload와 default/equivalent,
  `2025-06-01` / `nodejs_compat`, HTTP response 계약을 유지한다.
- Wrangler `4.20.0`은 `deploy --dry-run` bundling에만 사용한다.
  실제 배포, 로그인, credential 변경은 수행하지 않았다.
- Private direct devDependency `workerd@1.20250604.0`의 package API로 native
  binary를 선택하고, native에 내장된 `/workerd/workerd.capnp` schema를 사용한다.
  config는 application service `benchmark` 하나와 HTTP socket 하나다.
- Ordinary timing에는 inspector/profiler가 없다. 실제 executable/version,
  PID, OS HTTP listener, control-fd 이벤트, config/bundle/metafile hash를
  연결한다. 이는 parent-side native-process 증거이지 collector의 runtime
  identity를 server identity로 대체한 것이 아니다. Opaque isolate ID는
  `not-observed`다.
- Local launch-to-ready에는 parent config/artifact hashing이 포함된다.
  `direct-workerd-single-application-v1`은 과거 Wrangler proxy/control
  process-tree 측정과 다른 resource boundary다. 이전 수치와 혼합하지 않는다.
- 요청된 CPU capture에서만 inspector를 열고 configured application
  target/context 및 실제 `Runtime.getIsolateId`를 native PID에 연결한다.

## 종료 경계와 미해결 관측

SIGTERM hang는 해결했다고 주장하지 않는다.
`direct-workerd-shutdown-probe/receipt.json`에서 native는 약 3ms에 exit 0으로
끝났지만 Fluo는 SIGTERM 후 10초에도 종료되지 않아 SIGKILL로 정리됐다.
Native stack은 `direct-workerd-shutdown-probe/fluo-workers/native-stack.log`에
있다. 앞선 실패한 CPU capture, discovery 및 종료 결과도 원본 그대로 보존했다.
이것은 미해결 native-host 관측이며 public application graceful shutdown의
구현이나 검증 결과가 아니다.

Canonical direct-host teardown은 의도적인 SIGINT process termination이다.
이를 exit 0 또는 graceful application drain으로 표시하지 않는다. Application
`close()` / `waitUntil` drain을 이 signal로 증명하지 않는다. 기존 1.5초 graceful
deadline 및 1초 forced deadline을 늘리지 않았다.

Profile validity는 workerd executable 이름만으로 SIGINT를 허용하지 않는다.
Traffic와 profile을 먼저 파일로 materialize하고 socket flush를 완료한 뒤
`profile-collector`의 PID/phase-bound intent를 저장한다. 실제 signal 전송,
request-before-exit 순서, stdout/stderr의 ended/closed 상태, forced 여부를
shutdown receipt로 기록한다. Raw intent/traffic/profile hash와 해당 run을
대조한다. Intent 없음, 전송 안 됨, intent 전 interruption, 미배출 stream,
미materialize profile, proxy/foreign PID 및 SIGKILL은 invalid다.
다른 host의 기존 abnormal-exit guard는 유지한다.

## 완료된 검증과 원본

모든 경로는 이 문서와 같은 `results/issue-3914/` 아래다. Local raw 파일은
기존 결과 디렉터리 정책대로 ignored 상태로 보존한다.

| 검증 | terminal 결과 | 원본 |
| --- | --- | --- |
| RED: ordinary launch가 Wrangler/Node였음 | assertion-level FAIL | `direct-workerd-red-20261009.log` |
| Frozen isolated install | exit 0 | `direct-workerd-install-20261009.log` |
| Benchmark typecheck | exit 0 | `direct-workerd-intent-final-typecheck.log` |
| 변경 TS/MTS 및 diagnostic Biome | exit 0, 16 files, warning 0 | `direct-workerd-intent-final-biome.log` |
| Focused positive/negative SIGINT validity | exit 0, 2/2 PASS | `direct-workerd-intent-focused.log` |
| 전체 harness tests | exit 0, 168/168 PASS, skip 0 | `direct-workerd-intent-final-tests.log` |
| Workers / Next App / Pages 실제 correctness | exit 0, 132/132 | `direct-workerd-intent-final-correctness.log`, `.json` 및 `-subjects/` |
| Ordinary Workers identity / finite cold-warm HTTP | exit 0, 2/2 authenticated, inspector absent | `direct-workerd-intent-final-timing.log`, `.json` |
| 실제 CPU capture | exit 0, 2/2 supported | `direct-workerd-profiles-intent-final.log`, `direct-workerd-profiles-intent-final/receipt.json` |

최종 CPU serving PID/isolate는 native `5227` / `f3ebb5c33ab336e6`,
Fluo `5836` / `aa94079915d2b987`다. 여섯 control/capture run의 실제 종료는
`code: null, signal: SIGINT`이며, 모두 collector intent와 drained stdout/stderr,
`signalSent: true`, `forced: false`를 기록한다.

TypeScript LSP는 source 40 files에서 error 0이었다. YAML LSP가 설치되지
않았으므로 lock importer는 frozen install 및 installed-lock 비교로 검증했다.
Full root release-readiness / canonical local CI / remote CI는 수행하지 않았다.
최종 source는 커밋 전 dirty snapshot으로 검증했으며 source/build digest를 보존했다.
이 로컬 검증을 새 performance acceptance 또는 deployed acceptance로 재표시하지 않는다.

## No-release rationale

`CONTRIBUTING.md`의 Changesets 기준에 따라 public `@fluojs/*`의 동작, API,
package contents 및 release metadata는 바뀌지 않았다. 변경은 private benchmark
harness, tests, local evidence 및 그 private dependency/importer뿐이다.
`packages/*`, root manifest/lock 및 public release artifact는 수정하지 않았으므로
Changeset을 추가하지 않는다.
