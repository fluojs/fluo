# #3939 측정·기각 보고서

2026-10-13 판정은 headroom `NOT_ESTABLISHED`, performance `INCONCLUSIVE`입니다.
Lead는 고정된 calibration 정책에 따라 #3939 후보 선택을 중단했습니다.
A/A, CPU/allocation profile, runtime 후보, BEFORE/AFTER 실행·성능 이득 근거는
없습니다. 이 보고서는 issue 종료·lane 완료·PR 준비 완료를 선언하지 않으며,
과거 report-only 종료 권한을 다시 해석하지 않습니다.
시작 HEAD는 `ce70426f3bf29430c4eb941f8e94baaf8f78d364`, 승인 preflight
digest는 `59bd0578c5701d29210ee000812732034981284b578d0b4abee296d89c9ad6ba`입니다.
측정 source는 이 HEAD 위의 dirty prepared checkout이며 HEAD만으로는 재현되지
않습니다. `frozen-windows-02.json`의 source/build/lockfile hash가 실행을 묶습니다.
모든 성능 실행은 다른 build가 끝난 후 lead가 독점적으로 예약합니다.
측정 대상 Fluo server는 Windows desktop WSL2이며 Mac은 독립 HTTP load
generator만 담당합니다. `current-policy-collector-integrity.json`과
`collector-integrity-preparation.json`의 `AWAITING_LEAD_MEASUREMENT`는 이전 준비
시점 상태입니다. 그대로 보존하며 현재 판정은 아래 lead verdict를 참조합니다.

## 수정된 collector의 완료 결과

`results/issue-3939/headroom-windows-02/`에는 132/132 원본 records가 있습니다.
11 fixtures × 2 configurations × 3 pairs × 2 arms이며 모든 조건의 total
connections는 64, 설정된 warmup은 3초, 설정된 measured duration은 10초입니다.
관찰된 autocannon wall duration은 11초일 수 있으며 설정이나 보존된 측정값은
변경하지 않았습니다.
Pair별 arm 순서는 `1/4`, `4/1`, `1/4`입니다.
완료된 measured requests는 10,390,826개이며 traffic failures와 invalid attempts는
각각 0입니다. Lead verdict는 모든 shard hash와 server/generator identity 인증을
확인했습니다. 이번 문서 작업은 traffic을 실행하거나 해당 인증을 새로 수행하지
않았습니다.

각 pair에서 `sum(4-worker requests.average) / 1-worker requests.average - 1`을
계산하고 세 pair의 산술평균을 사용합니다. 22개 조건 중 다음 4개가 고정된
평균 gain 3% 한계를 초과했습니다. 표는 반올림 표시이며 원본 수치를 보존합니다.

| Condition | Mean gain |
| --- | ---: |
| `json-large/equivalent` | 4.6180% |
| `ascii-large/default` | 3.3485% |
| `utf8-large/default` | 4.0261% |
| `buffer/equivalent` | 11.6246% |

수정된 collector의 기능적 성공은 해당 실행의 응답 검증·수집 성공입니다.
Generator/network headroom, A/A 안정성 또는 production runtime의 성능 개선을
증명하지 않습니다. 나머지 18개 조건의 작은 평균 gain도 capacity 증명이 아닙니다.
이는 같은 server source에서 generator 수를 바꾼 진단이며 BEFORE/AFTER가 아닙니다.
Threshold 완화·outlier 제거·unchanged retry·통과할 때까지 반복하지 않습니다.

## 보존된 과거 실패

Lead는 이전 Mac-server headroom 시도를 12/132 records 보존 후 중단했습니다.
Generator를 1개에서 4개로 늘리자 첫 조건 throughput이 57%-128% 증가했습니다.
이는 기각된 환경 진단이며 Windows server 성능·성공한 calibration·최적화
근거가 아닙니다.

Windows headroom 시도의 완료 records 60/132를 보존합니다. UTF-8 warmup의
HTTP 200 4,414회 중 body mismatch 318회는 pinned autocannon의 fragment
디코딩 결함이며 Windows 응답 bytes 오류가 아닙니다. 완료된 scaling 실패
`json-small/equivalent` 평균 +13.2%, `utf8-small/default` 평균 +9.84%는
독립적인 실패로 남습니다. 보존된 scaling 판정에는 `json-large/default` +3.6185%,
`json-large/equivalent` +3.9555%도 포함됩니다. Collector 수정과 새 실행 완료가
이 네 scaling 실패나 UTF-8 실패를 지우거나 이전 실행을 PASS로 바꾸지 않습니다.
원본·manifest는 수정하지 않으며 재실행 권한도 이 보고서에서 부여하지 않습니다.

`traffic.ts`는 기존 pinned autocannon `setupClient`에서 queued response마다
실제로 수신한 fragment를 디코딩합니다. 요청별 body/status 검사·parser event·
timing을 유지하며 installed module은 수정하지 않습니다. 새 collector는 불변
`record-N.json`, `failure-N.json` 원본과 작은 hash/byte-length `raw.json` index를
기존 EvidenceJournal로 기록합니다. `evaluate-aa`는 원본을 하나씩 인증·평가하고
metrics/nonces만 유지하며 보고서를 `rawIndexSha256`에 묶습니다. 누락·변조·미등록·
순서 변경·root 밖 원본은 보고서를 보존하며 실패합니다. 과거 monolithic raw는
읽을 수 있지만 현재 calibration으로 승격하지 않습니다. `evaluate-aa`의
non-CALIBRATED 판정은 nonzero로 종료합니다. 과거 raw를 덮어쓰거나 migrate하지 않습니다.

## 불변 설계와 선행 조건

이 절은 동결된 사전 계약과 과거 준비 절차의 참고입니다. 새 freeze나 측정은
남은 작업이 아니며 아래 절차를 이번 기각 판정 이후 실행하지 않습니다.

`src/issue-3939/plan.ts`가 machine 설계와 SHA-256을,
`src/issue-3939/fixtures.ts`가 정확한 응답 bytes·길이·hash를 소유합니다.
Primary는 `json-large/default/64`입니다. 다섯 paired relative change에
자유도 4의 Student t를 적용해 95% interval을 계산합니다.
Ordinary sample마다 검증된 완료 요청 20,000개 이상, 측정 CPU 대비
counter quantization 1% 이하를 요구합니다. 과거 증거가 아닌 사전 gate입니다.
A/A 전체는 fresh server arm 440개입니다(11 fixtures × 2 configurations ×
2 connections × 5 pairs × 2 arms). Warmup·traffic만 22,000초이며
startup/teardown은 별도입니다. 통과한 일부 조건으로 대체하지 않습니다.

양쪽 frozen dependency graph를 설치하고 Node dependency closure를 build합니다.
Benchmark 전체 typecheck에는 다른 linked platform 선언도 필요합니다.
아래는 과거 준비 절차의 재현 참고이며 현재 실행 지시가 아닙니다.
이번 문서 작업 단위에서는 install·build·test·측정을 실행하지 않았습니다.
Lead가 지정한 작업 제한이며 새로운 사용자 권한 부여가 아닙니다.

```sh
cd "$WINDOWS_MEASUREMENT_WORKTREE"
pnpm install --frozen-lockfile
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace install --frozen-lockfile
pnpm --filter '@fluojs/platform-nodejs...' build
cd tooling/benchmarks/http-comparison
pnpm exec esbuild src/issue-3939/server.ts --bundle --platform=node --format=esm --target=node24 --packages=external --tsconfig-raw={} --outfile=dist/issue-3939/server.mjs
pnpm exec esbuild src/issue-3939/load-client.ts --bundle --platform=node --format=esm --target=node24 --packages=external --tsconfig-raw={} --outfile=dist/issue-3939/load-client.mjs
```

Lead가 최종 준비 source를 Windows measurement worktree로 복사하고 이슈 소유
`load-client.mjs`를 Mac generator install 옆의 `load-client.mjs`로 배치합니다.
구현자가 원격 배치하지 않습니다.
기존 `shoot`와 `load.ts` SSH transport를 재사용하고 매 measurement에 실제
executable·generator lockfile hash를 추가합니다. 기존 generator 의존성이
external import를 resolve해야 합니다. 원격 설치와 새 SSH transport는 없습니다.
Windows WSL2 안에서는 유효한 Windows 측 socket을 의도적으로 설정한 경우가
아니면 `BENCH_SSH_CONTROL`을 unset해야 합니다. 기존 Mac master socket은
Windows에서 유효하지 않습니다. 기존 공유 generator entry는
필수 executable/lockfile attestation을 반환하지 않아 의도적으로 거부됩니다.

Lead가 실제 관찰한 identity JSON을 제공합니다. Unknown/default는 허용하지 않습니다.
`server`와 `generator`에 `hostname`, `os`, `arch`, `nodeExecutable`,
`nodeVersion`, `nodeExecutableSha256`, `power`, `network`, `resourceLimits`,
`backgroundWorkload`의 비어 있지 않은 값을 넣습니다. Generator는
`lockfileSha256`과 이슈 소유 compiled client에 일치하는 `clientEntrySha256`도
필요합니다. 양쪽 Node 24와 서로 다른 hostname을 요구합니다.
최상위에는 `bindHost`, `serverHost`, `sshHost`, `remoteDirectory`를 넣습니다.
Server executable은 real path여야 합니다. `bindHost`와 `serverHost`는 Windows
WSL2 server를, `sshHost`, `remoteDirectory`, 필요한 `BENCH_SSH_CONTROL`은
Mac generator 연결을 가리키지만 socket 자체는 명령을 실행하는 Windows host에
존재해야 합니다. Lead가 역할에 맞는 실제 값을 새로 관찰해야 하며
이전 transport 방향을 재사용하지 않습니다. 이전 실제 HTTP 10회 setup 검사는
과거 연결·정확성 확인일 뿐입니다.

모든 준비가 끝난 후 freeze합니다. 새 파일만 허용하며 덮어쓰기를 거부합니다.
Source, linked package source/build, 양쪽 lockfile, runtime·host를 묶습니다.
Dirty prepared checkout을 명시적으로 기록하므로 freeze 후 commit·edit·rebuild·
transport 변경을 하지 않습니다. 과거 calibration receipt를 재사용하지 않습니다.
최종 source 복사 후 Windows measurement worktree에서 실제 server/generator
identity를 새로 freeze합니다.

## Lead 전용 명령

아래는 수집된 `headroom-windows-02`의 실행 형태를 기록한 재현 참고입니다.
이번 판정 후 재실행하지 않으며 기존 output은 덮어쓰지 않습니다.
Frozen manifest는 Mac checkout용으로 다시 쓰지 않습니다. 실행 당시 Windows
경로는 `/home/wpfek/fluo-http-performance-3939-3943-20261013/.worktrees/issue-3939`입니다.

```sh
cd /home/wpfek/fluo-http-performance-3939-3943-20261013/.worktrees/issue-3939/tooling/benchmarks/http-comparison
unset BENCH_SSH_CONTROL # No deliberately configured Windows-side socket.
pnpm exec tsx src/issue-3939/experiment.ts headroom \
  results/issue-3939/frozen-windows-02.json results/issue-3939/headroom-windows-02
```

Collector log의 `RAW_NOT_EVALUATED`와 원본 index의 `NOT_EVALUATED`는 수집 상태이며
수정하지 않습니다. 별도 lead verdict의 `NOT_ESTABLISHED` / `INCONCLUSIVE`가
평가 결과입니다. A/A·profile·후보·BEFORE/AFTER 명령은 실행하지 않습니다.
Allocation sampling이 native/external Buffer의 정확한 할당량이나 전체 Node
encoding 비용을 증명하지 않는 한계도 유지합니다.

## 불변 artifact와 역할

다음 경로는 `tooling/benchmarks/http-comparison/` 기준입니다.

| Artifact | SHA-256 |
| --- | --- |
| `results/issue-3939/frozen-windows-02.json` | `f73658945e12343d762c6b5ee26d7d9eeeaee1930eb714679e9314c41878bc12` |
| `results/issue-3939/headroom-windows-02/raw.json` | `8fff8d6733f2b1f9fca512d067a50afe57cf180093893c5b65d527bc5b1d9346` |

원본 `record-0.json`부터 `record-131.json`의 SHA-256·byte length는 index가
소유합니다. Design digest는
`1277f395bf77dc44822086cd4da5981b794343e404d02cdd49e908bbd59bbf36`,
prepared build artifacts digest는
`8e2a2621a017b0180be2fddf5d3d8405cc30f013954d2b7e33cab167a4c00fa2`입니다.

Worktree 밖 lane 근거 root는
`/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/`입니다.
그 아래 `headroom-windows-02-verdict.json`의 SHA-256은
`824f5fbce13e9e473bc769c739d7e321e776b97bb76eab03b964318edb72cf20`,
`headroom-windows-02.tar.gz`는
`c586b566d86ac0c258c8fa5c164e11e5c3a55f3fbdbb9654d47a90dc227aae62`입니다.
이 archive는 worktree 밖에 있으며 문서 수정 대상이 아닙니다.
이 경로들은 로컬 보존 artifact 참조이며 공개 다운로드 링크가 아닙니다.
과거 Windows 근거는 같은 root의 `headroom-windows-01-raw.json`
(`616c7586c050a1df5d5e4957ac6a3eaa4dcfaf37f674fa4a4e2c9492c660b801`),
`headroom-windows-01-scaling.json`, `windows-headroom-utf8-incident.json`입니다.
Wrong-role 근거는 `results/issue-3939/headroom-01/raw.json`, `frozen-01.json`입니다.

Windows server는 `DESKTOP-VLEUB8O`, WSL2 Linux x64, Node `v24.21.0`,
`/opt/fluo-tools/node-v24.21.0-linux-x64/bin/node`입니다.
Mac generator는 `mac-mini.local`, Darwin 27.2.0 arm64, Node `v24.20.0`,
`/Users/ayden/.nvm/versions/node/v24.20.0/bin/node`입니다.
Server는 `0.0.0.0`에 bind하고 `192.168.0.10:35711`에서 HTTP를 제공합니다.
Mac `192.168.0.129`에서 direct LAN HTTP를 보내며 SSH
`ayden@192.168.0.129`는 control만 담당합니다. SSH data tunnel은 아닙니다.
실행 당시 resource limits·power·background workload·executable/client/lockfile
hash의 원본 소유자는 frozen manifest입니다.

측정 없이 artifact 확인과 lead가 보존한 pair 수치의 산술평균 재현만 수행하는
정확한 명령은 [evidence-receipt.md](./evidence-receipt.md)에 기록합니다.

## 집중 검증과 보존 근거

아래 명령은 기존 검증 경로 참고이며 이번 문서 작업에서 실행하지 않았습니다.

```sh
pnpm vitest run packages/platform-nodejs/src/node/node-response.test.ts \
  packages/platform-nodejs/src/node/node-response.compression.test.ts \
  packages/platform-nodejs/src/node/node-response.compression-recovery.test.ts \
  packages/platform-nodejs/src/node/node-response.wire.test.ts \
  packages/platform-nodejs/src/index.test.ts \
  packages/testing/src/portability/http-adapter-portability.test.ts --maxWorkers=1
pnpm --filter @fluojs/platform-nodejs typecheck
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace test
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace typecheck
pnpm exec biome check packages/platform-nodejs/src/node/node-response.wire.test.ts \
  tooling/benchmarks/http-comparison/src/issue-3939/
```

Factory fixture test는 fixture별 한 번의 bounded correctness 요청만 수행합니다.
Wire regression은 HEAD/204/205/304/206의 관찰된 동작을 보존하고 status 정책을
바꾸지 않습니다. 기존 compression/recovery test는 decline/handled,
pre/post-commit 실패와 disconnect coverage를 유지합니다.
검사 raw log는 `results/issue-3939/`에 보존합니다. Profile용 지정 output 경로는
`results/profiling/issue-3939/`이며 이번 성능 조사에서는 profile을 수집하지
않았습니다. 과거 근거는 변경하지 않습니다.
Public package runtime 최적화는 출하하지 않습니다. 이번 문서 작업은 source·
test·manifest·raw record를 수정하지 않으며 새 Changeset을 만들지 않습니다.
로컬 구현 커밋은 이전 private benchmark harness·collector 수정·test·작성된
policy JSON companion을 포함합니다. `CONTRIBUTING.md`에 따라 private benchmark/
report 변경과 package의 test-only coverage는 공개 package의 behavior·API·contents·
release metadata를 바꾸지 않으므로 Changeset이 필요하지 않습니다.
별도 check/source receipt는 과거 기능 검사와 변경 없는 source를 묶으며 새 성능
실행의 근거가 아닙니다.
Book·package README 수정은 필요 없습니다. 측정 진단과 기각만 기록하며 framework
계약이나 consumer usage를 변경하지 않기 때문입니다.

남은 절차는 lead가 최종 diff와 companion artifact를 승인 preflight에 대조하고,
최종 exact head의 contract/code/verification 세 review를 완료하는 것입니다.
Publication 전에는 해당 head에 묶인 완료된 검증 receipt와 필요한 EN/KO 의미·문서
검증이 필요합니다. 이후 승인된 PR publication과 exact PR-head canonical selected
GitHub CI가 필요하며, 변경된 head는 영향받은 review/check를 다시 받아야 합니다.
이번에는 docs CI·full local CI·review·publication을 수행하지 않았습니다.
이 보고서만으로 merge·issue 종료·lane 완료 권한이 생기지 않습니다.
