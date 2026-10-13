# #3939 documentation evidence receipt / 문서 근거 receipt

## 한국어

2026-10-13, checkout은 `/Users/ayden/Documents/fluo/.worktrees/issue-3939`,
HEAD는 `ce70426f3bf29430c4eb941f8e94baaf8f78d364`입니다. Dirty 준비 변경을
보존했습니다. 이 receipt는 문서 확정 범위만 다루며 최종 구현 exact-head 검증
receipt나 issue 종료·lane 완료·PR 준비 완료 판정이 아닙니다.

승인 계약은 worktree 밖
`/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/preflight-3939-collector-integrity.json`,
digest는 `59bd0578c5701d29210ee000812732034981284b578d0b4abee296d89c9ad6ba`입니다.
Lead의 같은 root 내 `headroom-windows-02-verdict.json`을 판정 원본으로 사용합니다.
원본 SHA-256은 `824f5fbce13e9e473bc769c739d7e321e776b97bb76eab03b964318edb72cf20`입니다.

관찰 결과는 132/132 records, 22 conditions, 완료 measured requests 10,390,826개,
traffic failures 0, invalid attempts 0입니다. 네 조건의 평균 gain이 3%를 초과하여
headroom은 `NOT_ESTABLISHED`, performance는 `INCONCLUSIVE`입니다.
Collector 기능적 성공을 production runtime 성능 수용으로 해석하지 않습니다.
A/A·profile·후보·BEFORE/AFTER나 benefit claim은 없습니다.

문서 작업 중 아래 read-only hash 명령으로 manifest·index·lead verdict·archive를
확인했고, shard 검사에서 `record-0.json`부터 `record-131.json`까지 132개 모두
`OK`였습니다. 보존된 pair 평균을 재현해 4/22 breaches를 확인했습니다.
이는 lead가 이미 인증한 실제 server/generator identity를 새로 인증하거나 원본
traffic 전체를 다시 분석한 결과가 아닙니다.
Index의 `NOT_EVALUATED`와 과거 정책·준비 receipt는 그대로 보존합니다.
EN/KO 수치·기각 사유·역할·명령·제한·후속 절차를 대조했습니다.
`git diff --check`는 exit 0이며 HEAD는 그대로입니다. 수정 문서는 기존 untracked
파일과 새 파일이므로 이 명령은 문서 자체의 자동 lint 증거가 아닙니다.

수정 파일은 이 directory의 `README.ko.md`, `README.md`, `evidence-receipt.md`뿐입니다.
Package README·Book은 framework 계약·consumer usage 변경이 없어 대상이 아닙니다.
Source, runtime, tests, shared files, 기존 immutable raw/manifest는 수정하지
않았습니다. 이 문서 작업 단위의 lead 지정 제한에 따라 tests/build/measurements/
docs CI를 실행하지 않았고 commit/remote 작업도 하지 않았습니다. 이를 새로운
사용자 권한 부여로 해석하지 않습니다. 과거 check receipt는 과거 기록이며
새 문서나 아직 없는 최종 head의 PASS 증거가 아닙니다.

남은 필수 절차는 lead의 최종 diff/preflight 대조, 완료된 head-bound 검증 receipt,
최종 exact head의 contract/code/verification review 및 필요한 EN/KO 의미·문서
검증입니다. 그 후 승인된 PR publication과 exact PR-head canonical selected
GitHub CI가 필요합니다. 최종 head 변경 시 영향받은 check/review를 갱신합니다.
기각 보고서 완성 자체는 merge·issue-close·lane-completion 권한이 아닙니다.

## English

On 2026-10-13, the checkout is `/Users/ayden/Documents/fluo/.worktrees/issue-3939`,
at HEAD `ce70426f3bf29430c4eb941f8e94baaf8f78d364`, with dirty preparation changes
preserved. This receipt covers documentation finalization only, not final
implementation exact-head verification, issue closure, lane completion, or PR readiness.

The accepted contract is the external
`/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/preflight-3939-collector-integrity.json`,
digest `59bd0578c5701d29210ee000812732034981284b578d0b4abee296d89c9ad6ba`.
The decision source is `headroom-windows-02-verdict.json` in that same root,
SHA-256 `824f5fbce13e9e473bc769c739d7e321e776b97bb76eab03b964318edb72cf20`.

The retained observations are 132/132 records, 22 conditions, 10,390,826 completed
measured requests, zero traffic failures, and zero invalid attempts. Four mean
gains exceed 3%, so headroom is `NOT_ESTABLISHED`, performance is `INCONCLUSIVE`.
Corrected collector functional success is not production runtime performance
acceptance. There is no A/A, profile, candidate, BEFORE/AFTER, or benefit claim.

During this documentation task, the read-only hash commands below authenticated
the manifest, index, lead verdict, and archive. All 132 shards,
`record-0.json` through `record-131.json`, returned `OK`. Reproducing the retained
pair means confirmed four of 22 breaches. This did not repeat the lead's actual
server/generator identity authentication or independently reanalyze all raw traffic.
The index's `NOT_EVALUATED`, earlier policies, and preparation receipts remain.
EN/KO figures, rejection reasoning, roles, commands, limitations, and remaining
requirements were compared.
`git diff --check` exited 0 and HEAD is unchanged. The edited documents are
pre-existing untracked files and a new file, so this command is not automated
lint evidence for the documents themselves.

Only `README.ko.md`, `README.md`, and `evidence-receipt.md` in this directory were
changed. Package README and Book edits are unnecessary because framework contracts
and consumer usage are unchanged. No source, runtime, tests, shared files, or
existing immutable raw/manifests were edited. Under the lead-assigned limits of
this documentation work unit, no tests, builds, measurements, docs CI, commits,
or remote actions ran. These limits are not a new user authorization. Historical check
receipts are not PASS evidence for these new documents or a final head that does
not yet exist.

Remaining requirements are lead final-diff/preflight reconciliation, a completed
head-bound verification receipt, contract/code/verification reviews of the final
exact head, and required EN/KO semantic/documentation checks. Authorized PR
publication and exact PR-head canonical selected GitHub CI follow. Refresh
affected checks/reviews when the final head changes. Completing a rejection
report grants no merge, issue-close, or lane-completion authority.

## Shared read-only commands / 공통 read-only 명령

These commands inspect existing artifacts only. / 기존 artifact만 확인합니다.
Requirements / 선행 조건: local preserved files, `jq`, `shasum`.
No output files are created. / 새 output 파일을 만들지 않습니다.

```sh
cd /Users/ayden/Documents/fluo/.worktrees/issue-3939
LANE=/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301
ROOT=tooling/benchmarks/http-comparison/results/issue-3939
git rev-parse HEAD
shasum -a 256 "$ROOT/frozen-windows-02.json" \
  "$ROOT/headroom-windows-02/raw.json" \
  "$LANE/headroom-windows-02-verdict.json" \
  "$LANE/headroom-windows-02.tar.gz"
(
  cd "$ROOT/headroom-windows-02"
  jq -r '.records[] | "\(.sha256)  \(.path)"' raw.json | shasum -a 256 -c -
)
jq -r '.conditions[] |
  [.condition, ((.pairs | add / length) * 100), .withinMeanScalingLimit] |
  @tsv' "$LANE/headroom-windows-02-verdict.json"
```

Expected hashes / 기대 hash:

| Input | SHA-256 |
| --- | --- |
| Frozen manifest | `f73658945e12343d762c6b5ee26d7d9eeeaee1930eb714679e9314c41878bc12` |
| Raw index | `8fff8d6733f2b1f9fca512d067a50afe57cf180093893c5b65d527bc5b1d9346` |
| Lead verdict | `824f5fbce13e9e473bc769c739d7e321e776b97bb76eab03b964318edb72cf20` |
| External archive | `c586b566d86ac0c258c8fa5c164e11e5c3a55f3fbdbb9654d47a90dc227aae62` |

Observed breached means / 관찰된 초과 평균:
`json-large/equivalent` 4.6180114285810445%;
`ascii-large/default` 3.34850037434693%;
`utf8-large/default` 4.026074938350269%;
`buffer/equivalent` 11.624638858720893%.
The arithmetic command uses the lead's retained pair values, not fresh samples.
산술 명령은 새 sample이 아니라 lead가 보존한 pair 값을 사용합니다.

The raw index binds each shard's hash and byte length; the manifest binds source,
prepared builds, runtimes, lockfiles, roles, and transport. Keep every original.
Raw index는 각 shard hash·byte length를, manifest는 source·prepared build·runtime·
lockfile·role·transport를 묶습니다. 모든 원본을 보존합니다.

Historical wrong-role records remain at `results/issue-3939/headroom-01/raw.json`
with `frozen-01.json`. The external lane root retains `headroom-windows-01-raw.json`,
`headroom-windows-01-scaling.json`, and `windows-headroom-utf8-incident.json`.
The earlier 60-record UTF-8 failure and its four independent scaling breaches
remain failed; the corrected collector does not recalibrate them as passed.
Wrong-role 원본과 이전 60-record UTF-8 실패·네 독립 scaling 실패는 위 경로에
보존하며 수정된 collector로 과거 실패를 PASS로 재분류하지 않습니다.
