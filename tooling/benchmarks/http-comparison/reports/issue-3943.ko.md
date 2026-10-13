# Issue3943 로컬 준비

상태: `LOCAL_HEADROOM_REJECTED`. 최종 로컬 완료에는 아래 검증 gate가 필요합니다.
성능, deployed CPU/tail/cold-warm 동작,
production 이득과 후보 채택은 `NOT_ESTABLISHED`입니다.
Production runtime과 package API 변경은 제안하지 않습니다.

## 최종 로컬 진단 checkpoint: 2026-10-13

Topology 수정 검증은 private harness 13/13, workerd 12/12,
전체 benchmark 453 passed, zero failed, Mac에서 기존 Linux 전용 skip 1개로
통과했습니다. Typecheck와 scoped lint도 통과했습니다. 비교 제거 5건은
assertion-level RED와 복원 GREEN을 확인했습니다. 정확한 명령과 원본 로그는
`results/issue-3943/topology-checks-20261013-1791905415999/topology-validation.json`에 있습니다.

부모가 Windows WSL2 Node 24.21.0과 독립 Mac Node 24.20.0 generator를
준비했고, 실제 LAN의 두 workload correctness probe가 통과했습니다.
3,866개 artifact를 결속한 frozen input SHA-256은
`617899c1a4dbcc07c60b334177c7eae822596be003e25939eb7d3e9c3503408b`입니다.
유한 headroom cohort는 12/12 arms, measured request 502,195건을 완료했고
traffic error는 0입니다. 평가에서 stage-minimal/one-generator throughput CV
`0.030138222108850293`이 동결 한계 `0.03`을 초과했습니다.
Manifest는 이 평가 실패를 invalid-attempt 1개로 보존합니다.
요청 실패나 미완료 cohort라는 뜻은 아닙니다.

Calibration은 `NOT_ESTABLISHED`, 성능은 `INCONCLUSIVE`입니다.
A/A, profile, 후보, BEFORE/AFTER와 Cloudflare 배포는 진행하지 않았습니다.
Threshold 완화나 추가 cohort 실행도 없습니다.
원본은 `results/issue-3943/headroom-windows-01/`, 동결 근거는
`results/issue-3943/parent-prepared-01/`에 있습니다. Worktree 밖 archive
`headroom-3943-windows-01.tar.gz`의 SHA-256은
`772764afac0bebd8bb5f4dc8f33b333f0371ce4937f3aafc799a9aa5973a9c29`입니다.
사용자는 2026-10-13 로컬 결과로 마무리하도록 선택했습니다. 검증 도구·회귀
테스트·기각 보고서를 반영하고 최적화는 보류하며 Cloudflare 실측은 제외합니다.
집중 검증·exact-head review·GitHub CI·병합을 마친 뒤 로컬 범위의 이슈 종료가
승인되었습니다. 원본의 `issueClosure: BLOCKED`는 승인 전 수집 당시 상태이며
이 최종 범위의 판정이 아닙니다.

아래 준비 절차와 과거 checkpoint는 이력입니다.
미실행·대기 문구는 당시 단계를 설명하며 위 최종 판정을 대신하지 않습니다.

## 로컬 진단 진입점

승인된 LOCAL topology는 Windows WSL2 SERVER와 독립 physical Mac generator를
기존 승인된 LAN/SSH control로 연결하는 구성입니다. LOCAL은 Cloudflare 배포가
아니라는 뜻이며 같은 host의 process라는 뜻이 아닙니다. Source 검증, host 예약과
동결된 diagnostic 실행 release 뒤 실행합니다.

```sh
cd tooling/benchmarks/http-comparison
node --import tsx src/issue-3943/experiment.ts /absolute/parent-frozen.json unique-run-id
```

이것이 유일한 issue-owned collector 경로입니다. 설치·빌드·배포·외부 Internet
load는 실행하지 않습니다. WSL2에는 기존 `dist/fluo-workers`가 필요하며 로컬
generator executable이나 `dist/load-client.mjs`는 필요하지 않습니다. 기존
shared `load()`의 SSH 지원으로 Mac의 `<remoteDirectory>/load-client.mjs`를
실행합니다.
`results/issue-3943/<run-id>`는 신규 exclusive directory이며 이미 존재하는
ID는 쓰기 전에 실패합니다.

부모가 동결한 JSON에는 `issue:3943`, export된 `DESIGN`과 정확히 같은
`design`, `phase:"headroom"|"aa"`, 절대경로 `parentReceipt`, `artifacts`
(SERVER-local 절대 파일 경로와 SHA256), `capacity:{path,sha256}`,
`transport`, `generator`를 넣습니다. `transport`는 `kind:"ssh-lan"`,
private `serverHost`, `serverPort`, 명시적 `bindHost`,
`sshTarget:"user@private-Mac-IPv4"`, `remoteDirectory`,
`sshControl`(절대 control 경로 또는 null)을 결속합니다.
`BENCH_SERVER_HOST`, `BENCH_BIND_HOST`, `BENCH_SSH_HOST`, `BENCH_REMOTE_DIR`,
`BENCH_SSH_CONTROL`은 정확히 일치해야 하며 co-located fallback은 없습니다.
Serving-identity 검사 두 곳에 동결된 실제 server host를 명시적으로 전달합니다.
Generator 버전은
`process.version`(`v24.11.0` 등)이며 `process.versions.node`(`24.11.0`)가
아닙니다. `generator.host`는 hostname, 실제 Mac hardware UUID, darwin,
architecture, 실제 Node 버전을 결속합니다. `generator.directory`, `roles`,
`artifacts`는 관측된 remote executable, client entry, 선언·설치 lock,
autocannon entry/manifest의 경로와 hash를 결속합니다.
`generator.evidence:{path,sha256}`는 WSL2에 복사된 hash-bound parent receipt를
가리키며 WSL2에서 열 remote executable이 아닙니다. Payload는
`{issue:3943,origin:"actual-in-generator-observation",generator:{host,directory,roles,artifacts},instrumentation:{execArgv:[],nodeOptions:null}}`입니다.
Remote 경로는 remote namespace에 두고 WSL2는 자기 source/build/runtime/lock,
capacity 원본과 receipt만 hash합니다.

Hash로 동결하는 부모 receipt에는 `issue`, `phase`, `rootBuildExitCode:0`,
`design`, `transport`, `generator`, receipt 자기 자신을 제외한 SERVER frozen map과 동일한 `artifacts`가
필요합니다. 이것은 부모 소유 실행 승인과 build/source 결속이며 hash만으로
인과관계를 증명한다는 자식 주장이 아닙니다. A/A에는
`capacityReview:"accepted"`와 frozen map에 포함된 절대경로
`headroomManifest`도 필요합니다. 해당 manifest에는12 observations,
headroom verdict 한 개, 동일 design, invalidAttempts0개가 있어야 합니다.
부모는 receipt 작성 전에 원본 artifact hash, 독립 generator/network capacity와
완료된 build 증거를 검토해야 합니다.

Headroom과 A/A는 같은 CLI의 별도 승인 invocation이며 headroom에서 A/A로
자동 진행하지 않습니다. 두 workload(`stage-minimal`, `json-command-local`)는
default configuration만 사용합니다.

- Headroom: 총64 connections, generator1/4개, 교대3 pairs,
 warmup3초/capture10초,12 arms.
- A/A: connections1/64, workload·connection별 교대 A1/A2 5 pairs,
 warmup10초/ordinary capture40초,40 arms.
- Ordinary completions 최소10000, process CPU quantum fraction 최대1%.
 Throughput과 process-CPU/request arm CV 최대3%, paired mean drift 최대3%,
 p95/p99/RSS paired drift 최대5%, headroom mean gain 최대3%.
- 독립 pair ratio,95% bootstrap interval,10000 resamples, seed3943.
 Outlier 제거, 재시도, 덮어쓰기, 추가 반복은 없습니다.

Issue-owned `generator.ts`는 shared `shoot()` 주위의 얇은 identity entry이며
traffic collector를 중복하지 않습니다. 부모가 실제 선언·설치 dependency lock
곁이나 아래의 frozen remote directory에 Mac용 `load-client.mjs`로 build합니다.
내부 `--identity` control은 parent receipt를 위한 실제 process/hardware/file
관측을 출력합니다. 이 LAN control은 이미 승인됐습니다. 선언된
`BENCH_GENERATOR_*` 값으로 실제 executable·entry·lock 읽기를 대체할 수 없습니다.
Transport·identity 수정은 traffic 횟수·기간·수치 gate를 변경하지 않습니다.

Shared `load()`와 `shoot()`의 exact status/body 검사를 재사용합니다.
First-request·warmup·ordinary 응답마다 실제 generator 전후 hash,
physical host/runtime/client identity, instrumentation 없음, fresh nonce와
실제 wire request hash(one-shot token 포함)를 독립 인증합니다. One-shot PID는
달라도 되지만 동결한 physical Mac/executable/client는 같아야 합니다.
Request와 phase 원본은 identity·metric 검사 전에 따로 저장합니다. `prepareTimingIdentity`,
`authenticateTimingIdentity`, `RawCapture`, `EvidenceJournal`,
`monitorServer`를 재사용해 serving 증거·원본 바이트·실패·중단 상태·process
resources를 보존합니다. Process CPU는 로컬 host 진단뿐입니다. First-request는
분리된 관측이며 deployed cold/warm 증거가 아닙니다. 여러 로컬 generator의
interval은 겹치지만 시작 시점이 정확히 동기화됐다고 주장하지 않습니다.

## 남은 게이트

부모가 Windows 실행 전에 구체적인 topology 불일치를 발견했습니다. 이전
collector는 `LocalLoadSession`을 사용하고 SSH를 거부했으며 Mac executable을
server-local artifact로 읽었습니다. 이전 source는 superseded이며 승인된
topology 증거가 아닙니다. 이번 수정은 issue-owned source/tests/reports에만
한정했고 shared `load.ts`, `targets.ts`, `timing-identity.ts`, profile tooling은
수정하지 않았습니다. 수치 `DESIGN`은 그대로이며 timing은 아직 발생하지 않았습니다.

현재 수정의 테스트는 source-ready지만 미실행입니다. Server에 없는 remote
executable, receipt byte 변조, LAN transport drift, 서로 다른 one-shot PID,
runtime/client/lock/request drift, instrumentation 거부와 선언 env 대신 실제
hash 관측을 검증합니다. 아래 기존 checkpoint 파일은 변경 없이 보존하며 이전
source hash의 결과만 설명합니다. 현재 harness/typecheck/lint는 부모의 다음
host/check release 뒤 실행하고 package suite는 반복할 필요가 없습니다.

2026-10-13에 package 검증을 완료했습니다. Workers42/42와 runtime Web32/32가
통과했고 Workers/runtime package typecheck는 exit0입니다. 최초 focused run의
새 lifecycle 테스트2개 timeout은 원본 그대로 보존했습니다. 일반 `send()`로는
조기 응답이 노출되지 않아 실제 SSE EOF가 handler 완료보다 먼저 발생하도록
테스트를 수정했으며 handler 실패도 검증합니다. Production runtime 수정은
필요하지 않았습니다.

증거는 `results/issue-3943/package-checks-20261013-1791891602920/`에 있습니다.
최초 `focused.log`, 두 typecheck 로그와 통과한 `retry-sse-eof/` 로그를 보존했고
`package-checkpoint.json`에 unchanged HEAD, accepted preflight와 테스트 대상
source4개 hash를 결속했습니다. 최초 root Vitest 명령의 기존 globalSetup이
dependency build closure를 실행했으며 재검증은 기존 package config를 사용해
해당 빌드 반복을 피했습니다.

Topology 수정 전에 private issue3943 harness9/9가 통과했습니다. Byte fixture와 invalid CLI
freeze 테스트는 수동 준비한 private `dist`에 의존하지 않습니다. Artifact와
generator 비교문 제거는 각각 assertion-level RED(exit1), 복원은 각각
GREEN(exit0)이었습니다. `identity.ts`는 mutation 전 SHA256
`b57d1626a171f6535643d9523c9be207795058fc3264cff2dc30967b669f1bbd`로
바이트 단위 복원됐습니다. Isolated benchmark typecheck와 scoped lint
(TS8개/MTS2개)도 exit0입니다.

최초 scoped lint 오류3건은 규칙을 끄지 않고 수정했습니다. `forEach` callback을
statement-only로 고쳤고 issue-owned condition cleanup에서 원래 오류가 덮이지
않도록 했습니다. 실제 filesystem 회귀는 operation 실패, cleanup 실패와
동시 실패 모두를 `EvidenceJournal`에 보존합니다. 최초 lint 실패와 의도적인
mutation 실패 원본은
`results/issue-3943/harness-checks-20261013-1791892537593/`에 남겨뒀습니다.

부모가 공유 native-workers port를 해제한 뒤 `workerd.test.mts`를 포함하는 full
isolated benchmark suite가94.497초에 exit0으로 완료됐습니다. 총450개 중449개
통과, 실패0개이며 Linux-only CPU-counter 테스트1개는 macOS에서 skip됐습니다
(`tests/resources.test.mts:109`). Workerd bind, 같은 길이 bundle-byte 변조를
포함한 실제 HTTP identity와 중단된 process 회귀가 통과했습니다.
해당 과거 run은 종료됐습니다. 이번 수정의 test/build는 실행 중이지 않습니다.
이미 통과한 package suite는 반복하지 않았으며
그 이후 package 테스트 수정은 동등한 statement-only cleanup callback뿐입니다.
Root provisioning은 완료됐으므로 누락
prerequisite가 없으면 root 설치·빌드를 반복하지 않습니다. 이번 준비에서 성능
측정은 하지 않았습니다.

최종 검사 명령, 최초 실패, 복원된 source hash와 원본 로그 경로는
`results/issue-3943/harness-checks-20261013-1791892537593/harness-checkpoint.json`에
결속했습니다.

동결된 향후 profile matrix는 blocked입니다. 두 workload, CPU/allocation,
각2회, 총8 captures, warmup10초, control10초/capture20초/control10초입니다.
기존 shared profile collector는 모든 warmup 원본과 전체 frozen
source/generator 경계 인증을 보존하지 않으므로 accepted issue3943 capture로
호출하지 않습니다. Collector를 중복 구현하거나 지원되지 않는 profile fallback을
추가하지 않았습니다. 부모가 shared 소유 범위의 누락을 해소하고 유효한 로컬
prerequisite 이후 profiles를 승인해야 합니다. request_factory profile은
사용하지 않습니다.

Deployment blocker는 CPU/allocation capture의 본질적인 플랫폼 한계가 아니라
authorization·target·telemetry 증거 부족입니다. Deployment에는 승인된
account/project, endpoint, deployment·source identity,
external-load 범위·host 예약, 비용 한도, CPU/tail/cold-warm telemetry 접근과
별도로 동결한 deployed 수치 설계가 필요합니다. Local workerd는 이를 대체할 수
없습니다.

Test-only coverage와 private benchmark tooling은 published behavior나 package
contents를 변경하지 않으므로 이 준비에는 Changeset이 필요하지 않습니다.
