---
description: execute-lane — canonical v1 lane ledger를 strict preflight와 live Git gates 아래에서 drain하는 execution harness.
argument-hint: "<lane-id|lane-ledger-path> [resume|--full-auto] [base-branch]"
---

# execute-lane

`execute-lane`은 `/create-lane`이 만든 canonical v1 ledger의 유일한 consumer다. source discovery, issue selection, lane grouping을 다시 하지 않고 ledger에 고정된 unlocked head issue를 `/issue-to-pr`와 `/pr-to-merge`에 위임한다.

Standalone verifier는 arbitrary read-only path를 검증할 수 있다. mutation authority는 primary repository의 canonical `.omo/lanes/<lane-id>.json`에만 있으며, candidate가 strict validation을 통과하기 전에는 마지막 valid ledger를 교체하지 않는다.

## 사용법

```text
/execute-lane <lane-id|lane-ledger-path> [resume|--full-auto] [base-branch]
```

예시:

- `/execute-lane lane-2026-08-18-runtime-a main`
- `/execute-lane .omo/lanes/lane-2026-08-18-runtime-a.json resume main`
- `/execute-lane lane-2026-08-18-runtime-a --full-auto main`

base branch 기본값은 ledger의 `base_branch`다. invocation에 base branch를 주면 ledger와 exact equal이어야 하며, 다르면 side effect 없이 `needs-human-check-terminal`로 멈춘다.

`resume`은 persisted status와 live GitHub/repository state를 재검증한 뒤 같은 queue를 계속 drain한다. source, confirmed issue, suggested exclusion, backlog, release handoff, queue, lane grouping, dependency graph를 재작성하지 않는다. `--full-auto`는 `supervisor-full-auto` ledger만 소비하며 authority, review, dependency, dirty-state, security, legal, release gate를 우회하지 않는다.

## 책임 경계

이 커맨드가 소유하는 것:

1. canonical ledger path/identity 해석과 immutable strict preflight.
2. persisted ledger와 live branch/worktree/PR/check/issue 상태 parity 확인.
3. unlocked lane head의 `/issue-to-pr` dispatch와 결과 수집.
4. 각 PR의 read-only `/pr-to-merge` central gate.
5. 같은 PR/branch/worktree에서 bounded fix-back과 재검토.
6. merge policy, authority, checks, dependency, approval을 통과한 squash merge.
7. MERGED/CLOSED 확인 후 command-owned worktree cleanup과 optional root fast-forward sync.
8. release-only issue의 maintainer handoff와 terminal output.

이 커맨드가 소유하지 않는 것:

- issue discovery/audit/registration: `/search-issue`
- issue selection/lane planning/ledger creation: `/create-lane`
- 구현 세부: `/issue-to-pr`와 `@fluo-issue-implementer`
- review 세부: read-only `/pr-to-merge`와 three reviewers
- package version/publish: Changesets와 `.github/workflows/release.yml`

## Strict root and source contract

JSON parse 후 root는 다음 21개 required key와 optional `created_at`만 허용한다.

`version`, `run_id`, `lane_id`, `status`, `created_by`, `base_branch`, `source`, `merge_policy`, `pr_merge_method`, `authority_scope`, `retry_policy`, `execution`, `confirmed_issues`, `suggested_but_excluded`, `backlog_candidates`, `release_handoffs`, `completed_issues`, `issue_progress`, `lanes`, `dependency_graph`, `root_main_sync`

`version: 1`, `created_by: create-lane`, `run_id === lane_id`, path-safe lane identity, safe `base_branch`, strict UTC optional `created_at`이 필요하다. Unknown root key, producer migration marker, nested legacy evidence, missing identity는 fail closed다.

`source`는 exact `{type, search_run_id, search_ledger}`다.

- `existing-issues`는 두 search field가 `null`이다.
- `search-issue`의 `search_run_id`는 `[A-Za-z0-9][A-Za-z0-9+._-]*`이며 내부 `+`를 허용한다. `search_ledger`는 정확히 `.opencode/search-issue/<search_run_id>.json`이다.
- `run_id`와 `lane_id`에는 `+`를 허용하지 않는다.

`authority_scope`는 exact `issue_creation`, `pr_creation`, `pr_merge`, `cleanup_command_worktrees`, `root_main_sync_ff_only`, `publish_via_github_actions`다. 값은 각각 `false`, `true`, `true`, boolean, boolean, `false`다.

`retry_policy`는 exact `retry_count_is_terminal`, `max_same_failure_repeats`, `max_wall_clock_minutes`, `stop_on_child_contract_error`다. `supervisor-full-auto`만 `retry_count_is_terminal: false`이며 나머지 merge policy는 `true`다.

`execution`은 exact `status`, `last_command`, `last_updated`다. ready ledger는 `not-started`와 null command/timestamp를 사용하고, 그 외에는 root status와 일치하는 status 및 non-empty command/timestamp를 기록한다.

## Status, queue, and progress contract

root status는 `ready`, `running`, `done`, `blocked-terminal`, `needs-human-check-terminal`, `blocked-budget-exhausted`, `blocked-maintainer-decision`, `blocked-child-contract-error`, `blocked-ledger-conflict`다. lane/progress는 active `queued`, `running`, `in_review`, `merged`와 같은 terminal status를 사용한다.

| queue position | required progress |
| --- | --- |
| prior entry | `done` |
| current entry | lane status와 matching progress status |
| later entry | absent 또는 `queued` |
| merged cursor | current issue가 `completed_issues`에 있고 matching `merged` progress |
| post-merge cleanup failure | cleanup authority가 true일 때만 terminal `blocked-terminal` progress가 merged evidence를 보존하고 later entry는 absent 또는 `queued` |
| done lane | 모든 queue issue가 `done` progress |

active lane의 `current_issue`는 positive integer이며 queue에서 `completed_issues`에 없는 첫 issue다. terminal lane은 `current_issue: null`, canonical lane `pr: null`이다. 같은 lane 다음 issue는 이전 issue가 `done` progress가 되기 전 dispatch하지 않는다. `completed_issues`는 merge-completed issue 집합이며 `merged`, `done`, post-merge cleanup failure progress issue와 exact equal이어야 한다.

queued lane에 progress가 없으면 branch/worktree/PR은 null이고 retry count는 0이다. progress가 있으면 lane과 progress의 branch/worktree는 양쪽 모두 absent 또는 exact equal이고, PR은 canonical normalization 후 equal이며 retry count도 같다. `running`은 safe branch와 matching worktree가 필수지만 PR은 null일 수 있다. `in_review`는 branch/worktree, canonical `fluojs/fluo` PR, non-empty verification이 필수다. `merged`도 canonical PR identity가 필수다. 서로 다른 issue의 non-null branch와 worktree는 각각 globally unique해야 한다.

일반 lane key는 exact `name`, `queue`, `current_issue`, `status`, `branch`, `worktree`, `pr`, `retry_count`다. `blocked-child-contract-error`만 exact `current_blocker: {signature, evidence}`를 추가한다.

status별 `issue_progress` key allowlist는 다음과 같다.

- non-completion (`queued`, `running`, `in_review`, terminal blocker statuses): `status`, `branch`, `worktree`, `pr`, `verification`, `retry_count`, `blockers`만 허용한다.
- `merged`: base key에 `review_verdict`, `checks`, `reviewers`, `reviewed_head`, `commits`, `merge_commit`, `issue_state`를 추가한다. `cleanup`은 없다.
- `done`: merged key에 `cleanup`을 추가한다.
- post-merge cleanup failure는 `blocked-terminal`에 한해 complete merged key를 보존할 수 있지만 `cleanup`은 금지한다.

`reviewers`는 exact `contract`, `code`, `verification`이다. blocker는 exact `reviewer`, `signature`, `evidence`, `fix_back_eligible`, `status`이며 blocker `status`는 정확히 `unresolved | remediated`다. merged/done evidence는 `review_verdict: merge`, `checks: PASS`, three reviewer PASS, 40-character `merge_commit`, `issue_state: CLOSED`를 요구한다. Legacy nested merge/issue/cleanup evidence와 status에 맞지 않는 completion evidence는 fail closed다.

cleanup authority가 true인 done progress는 exact `{status: done, worktree_removed: true, local_branch_deleted: true, remote_branch_deleted: true}`다. authority가 false이면 cleanup failure를 만들 수 없고 즉시 `done` progress로 전환해 exact `{status: skipped-authority}`를 기록한다.

## Dependency and release contract

`dependency_graph`는 sparse object다. key는 confirmed positive-safe-integer issue이며 value는 unique positive-safe-integer prerequisite array다. external prerequisite는 value에 허용되지만 duplicate, self dependency, cycle은 금지한다. dispatch와 merge 직전에 모든 prerequisite의 current GitHub/repository completion evidence를 확인한다.

release handoff issue는 dedicated single-issue lane이다. ready ledger에서는 progress 없이 queued다. 실행 후 lane/progress는 `blocked-maintainer-decision`이며 branch, worktree, PR identity가 없어야 한다. release handoff를 `/issue-to-pr`로 dispatch하거나 completed, merged, done으로 기록하지 않는다.

## Ledger preflight

side effect 전에 다음 순서로 preflight한다.

1. lane id 또는 path를 primary `<repo-root>/.omo/lanes/<lane-id>.json`으로 canonicalize한다. path escape, symlink, mismatched filename/identity, non-primary mutation target을 거부한다.
2. 원본 bytes와 identity를 보존한 채 candidate를 별도 snapshot으로 만들고 pure validator를 실행한다.
3. focused gate는 정확히 five TEST files와 364 tests다. `lane-ledger-schema.mjs`, `lane-ledger-progress-schema.mjs`, `lane-ledger-dependency.mjs`는 implementation module이며 test file 수에 포함하지 않는다.
4. root worktree가 registered primary checkout인지, exact base branch인지, clean한지 확인한다. dirty root에서는 merge 후 sync를 실행하지 않는다.
5. 각 persisted worktree가 registered이고 `.worktrees/<branch>` realpath containment, symlink-free path, exact checked-out branch, clean state를 만족하는지 확인한다.
6. live PR의 head/base, linked issue, state, checks, reviewed head가 ledger와 일치하는지 확인한다. stale child/reviewer 결과는 사용하지 않는다.
7. lane cursor, dependency, release identity, authority, retry, execution, root sync relationship을 확인한다.
8. candidate update마다 strict validation 성공 후에만 atomic replace한다. 실패하면 마지막 valid ledger를 유지하고 `blocked-ledger-conflict`로 멈춘다.

Authority 누락, false, ambiguous state를 사용자 승인으로 추정해 보충하지 않는다. Side effect별 authority를 exact boolean으로 확인하고 fail closed한다.

## Execution loop invariant

`execute-lane`은 단발 dispatch가 아니라 모든 lane을 terminal까지 drain하는 loop다.

1. 각 lane은 queue의 head issue 하나만 실행한다.
2. unlocked lane은 병렬 dispatch할 수 있지만 각 lane의 state transition은 독립적이다.
3. `block` verdict는 terminal 결과가 아니라 먼저 same-PR fix-back input이다.
4. queued/running/in_review/merged lane, retry 여지가 있는 blocker, pending/stale evidence, unlock된 후속 issue가 남으면 final report를 내지 않는다.
5. 모든 lane이 `done` 또는 terminal blocker status이고 strict ledger와 live state가 일치할 때만 final report를 낸다. Strict post-merge cleanup failure는 terminal `blocked-terminal`로 보고할 수 있다.

### Per-lane progress, no global batch barrier

먼저 완료된 lane item은 다른 worker를 기다리지 않고 PR collection, strict candidate update, `/pr-to-merge`, fix-back 또는 merge gate로 즉시 진행한다.

- child completion barrier는 해당 lane item의 완료 보고 없이는 그 item의 다음 gate로 가지 않는다는 lane-local barrier다.
- 같은 lane의 다음 issue는 current issue가 `done` progress가 되기 전 dispatch하지 않는다.
- 여러 lane worker를 모두 join한 뒤 일괄 review하는 global batch barrier는 금지한다.
- PR URL 또는 explicit blocker가 수집되면 남은 worker 수와 무관하게 해당 item을 처리한다.

#### Background completion event handling

완료 알림을 받으면 다음을 즉시 수행한다.

1. `background_output(<task_id>)`으로 해당 child 결과를 수집한다.
2. issue, branch, worktree, PR, verification 또는 blocker를 candidate의 해당 progress에 기록한다.
3. candidate를 strict validate하고 성공한 경우에만 ledger를 atomic replace한다.
4. PR이 있으면 즉시 `/pr-to-merge <pr> <issue> <base-branch>`를 호출한다.
5. exact `merge | block | needs-human-check` verdict를 schema가 허용하는 형태로 처리한다. `block`은 `blockers`에 기록할 수 있지만, `merge` verdict의 completion fields는 PR이 실제 MERGED가 되기 전 `in_review` progress에 쓰지 않고 harness-local gate state로 유지한다.
6. `block`은 same-PR fix-back, `merge`는 merge execution contract, `needs-human-check`는 policy와 terminal escalation을 평가하고, persisted candidate는 매 transition마다 다시 strict validate한다.
7. 다른 lane worker가 남았다는 이유로 이 흐름을 미루지 않는다.

## Worker dispatch

unlocked head issue는 `/issue-to-pr <issue> <base-branch>`로 위임한다. 신규 작업은 dedicated `.worktrees/<branch>`를 사용하고 fix-back은 기존 PR/branch/worktree를 재사용한다.

`/issue-to-pr` harness는 명시 authority 아래 branch/worktree 준비, push, PR 생성/갱신을 조율할 수 있다. scoped implementer child는 할당 worktree에서 구현·검증·commit만 수행하며 직접 push, PR 생성, merge, issue close, cleanup, publish를 하지 않는다. 어떤 child도 merge/cleanup/publish authority를 갖지 않는다.

결과는 issue, branch, worktree, PR URL, verification summary, remaining risks를 포함해야 한다. 누락되면 같은 child session에 정확히 한 번 contract-complete report를 재요청한다. 재요청 후에도 결과가 없고 read-only repo/GitHub 확인으로 복구할 수 없으면 lane/progress를 `blocked-child-contract-error`로 기록하고 exact blocker evidence를 남긴다.

## Central review gate

각 PR은 read-only `/pr-to-merge <pr> <issue> <base-branch>`로 검토한다. contract, code, verification reviewer가 모두 실행되어야 하며 허용 verdict는 정확히 다음 셋이다.

```text
merge | block | needs-human-check
```

`/pr-to-merge`는 파일, branch, worktree, PR state를 변경하지 않는다. `merge` verdict도 실제 merge authority가 아니며, blocker는 stable signature, evidence, fix-back eligibility를 제공해야 한다.

## Bounded fix-back loop

`block`이면 `/issue-to-pr --fix-back`에 같은 issue, PR, branch, worktree와 exact blocker만 전달한다. 새 branch/worktree/PR은 만들지 않는다.

- 매 시도마다 lane/progress `retry_count`를 함께 증가시킨다.
- `retry_count <= 2`: fixable blocker를 최소 수정하고 같은 PR을 재검토한다.
- `retry_count >= 3`: 기본 mode와 terminal retry policy에서는 `needs-human-check-terminal`로 escalate한다.
- `supervisor-full-auto`: count만으로 멈추지 않지만 같은 blocker signature가 `max_same_failure_repeats`에 도달하거나 wall-clock budget이 끝나면 `blocked-budget-exhausted`로 멈춘다.
- child contract error는 policy가 요구하면 즉시 `blocked-child-contract-error`다.
- maintainer-only decision, scope 재정의, security/privacy/legal 판단, release ambiguity는 자동 수정하지 않고 `needs-human-check-terminal` 또는 `blocked-maintainer-decision`으로 보낸다.
- remediation 후 반드시 동일 PR에 `/pr-to-merge`를 다시 실행한다. stale reviewed head를 재사용하지 않는다.

## Merge execution contract

다음 조건을 모두 만족해야 merge를 고려한다.

1. 최신 `/pr-to-merge` verdict가 `merge`다.
2. `authority_scope.pr_merge === true`다.
3. live PR head/base/linked issue가 ledger와 일치하고 PR이 mergeable하다.
4. required CI/checks/diagnostics/tests/build/typecheck가 실제 PASS다.
5. reviewed head가 current PR head와 일치하고 blocker가 모두 remediated다.
6. dependency prerequisite가 완료됐다.
7. `pr_merge_method === squash`이며 실제 명령도 squash다.
8. release/security/legal/maintainer escalation이 남아 있지 않다.

조건 통과 직전에 live state를 다시 읽는다. merge 후 PR `MERGED`, linked issue `CLOSED`, merge commit SHA를 확인한 뒤에만 `merged` progress와 `completed_issues`를 기록한다. 검증되지 않은 결과로 ledger를 먼저 진행시키지 않는다.

### developer-final approval gate

`merge_policy: developer-final`은 `authority_scope.pr_merge=true`여도 자동 merge가 아니다. 위 조건을 모두 통과한 직후, `gh pr merge` 바로 전에 사용자 또는 상위 harness의 explicit human-final approval을 받아야 한다.

approval receipt가 없거나 stale하면 merge하지 않고 `needs-human-check-terminal`로 기록한다. `--full-auto`와 이전 lane-plan approval은 이 gate를 우회하거나 대체하지 않는다.

`supervisor-with-human-escalation`도 unresolved human verdict를 자동 승인하지 않는다. 승인된 merge만 `gh pr merge <pr> --squash`로 실행하며 merge/rebase method를 임의 선택하지 않는다.

## Cleanup and root sync

cleanup은 merge와 별도 safety gate다.

1. PR `MERGED`와 linked issue `CLOSED`를 live 재확인한다.
2. path가 exact command-owned registered `.worktrees/<branch>`이고 branch parity와 realpath containment를 만족하는지 확인한다.
3. cleanup authority가 true이고 worktree가 dirty, symlinked, unregistered, detached, mismatched이면 force cleanup하지 않는다. 해당 item을 terminal blocker로 남기며 invalid cleanup object를 쓰지 않는다.
4. `cleanup_command_worktrees: true`일 때만 worktree, local branch, remote branch를 안전한 순서로 제거하고 모두 성공한 후 done cleanup object를 기록한다.
5. authority가 false면 cleanup failure 또는 `blocked-terminal`을 만들지 않는다. 삭제 없이 곧바로 `done` progress에 exact `{status: skipped-authority}`를 기록한다.
6. `merged` progress에는 cleanup을 기록하지 않는다. cleanup evidence가 완성된 후에만 `done`으로 전환한다.
7. authority가 true인 cleanup이 dirty, symlinked, unregistered, detached, mismatched state로 실패할 때만 lane/progress를 `blocked-terminal`로 전환한다. lane cursor, branch, worktree, PR은 null이며 progress는 complete flat merged evidence, no `cleanup`, exact unresolved non-fix-back blocker를 보존한다. 이 blocker는 exact blocker key를 가지며 `status: unresolved`, `fix_back_eligible: false`여야 한다.
8. cleanup failure issue는 `completed_issues`에 남고 같은 lane의 다음 issue는 absent 또는 `queued`로 잠근다. Resume은 순서대로 live merge evidence를 다시 검증하고, 같은 issue의 cleanup을 재시도하고, canonical done cleanup을 기록하고, 해당 blocker를 `remediated`로 바꾸고, candidate strict validation을 통과시킨 뒤에만 later issue를 dispatch한다.

root sync는 모든 lane이 terminal인 뒤에만 수행한다.

- `root_main_sync_ff_only: false`면 exact `{status: skipped-authority, sha: null}`다.
- authority가 true여도 primary root가 dirty이면 exact `{status: blocked-dirty, sha: null}`다.
- authority가 true이고 registered primary checkout이 clean하며 exact base branch일 때만 `git pull --ff-only origin <base-branch>`를 실행하고 40-character SHA와 `done`을 기록한다.
- reset, rebase, merge commit, forced checkout, dirty-root 자동 정리는 금지한다.

## Release handoff

`release_handoffs` issue는 worker dispatch, branch/worktree, PR, merge, cleanup, done transition을 하지 않는다. target package/version/dist-tag, prerelease intent, pending changesets, Version Packages PR 상태, required verifier, lane id를 maintainer에게 보고하고 lane/progress를 `blocked-maintainer-decision`으로 기록한다.

이 커맨드는 Version Packages PR merge, workflow dispatch/rerun, package publish, tag/release 생성을 실행하지 않는다. release는 Changesets와 `.github/workflows/release.yml`만 수행한다.

## Output contract

최종 보고는 한국어로 작성하고 다음 값을 포함한다.

```yaml
result: 진행 PR <M>건, 머지 <K>건, 보류 <L>건
lane id: <lane-id>
ledger: .omo/lanes/<lane-id>.json
base branch: <base-branch>
merge policy: <policy>
approval: <not-required|approved|missing|stale>
lanes:
  - name: <lane-name>
    status: <status>
    queue: [<issue-number>]
mapping:
  - issue: <issue-number>
    PR: <pr-number|url|null>
    branch: <branch|null>
    worktree: <worktree|null>
merge/cleanup/root sync:
  merge: <done|skipped|blocked>
  cleanup: <done|skipped-authority|blocked>
  root sync: <done|skipped-authority|blocked-dirty>
authority scope: <summary>
retry/remediation: <counts and unresolved blocker signatures>
remaining backlog: [<issue-number>]
release handoffs: [<issue-number>]
next recommended step: <text>
```

final report 전 candidate strict validation, live PR/issue/worktree parity, terminal lane/progress, non-stale evidence, root sync terminal state를 다시 확인한다.

## Must NOT

- issue search/audit/creation, source choice, suggested additions, scope expansion, queue/grouping/dependency rewrite를 수행하지 않는다.
- invalid ledger 또는 candidate로 마지막 valid ledger를 덮어쓰지 않는다.
- 모든 lane child 완료를 기다리는 global batch barrier를 만들지 않는다.
- child에게 merge, issue close, cleanup, root sync, publish를 위임하지 않는다.
- read-only `/pr-to-merge` verdict만으로 checks/authority/dependency/approval 재확인 없이 merge하지 않는다.
- `block`을 fix-back 전에 terminal completion으로 보고하지 않는다.
- same-PR fix-back에서 새 branch/worktree/PR을 만들지 않는다.
- `developer-final` approval을 full-auto 또는 이전 승인으로 추정하지 않는다.
- MERGED/CLOSED 확인 전 cleanup하거나 dirty worktree를 force remove하지 않는다.
- dirty/wrong-branch root를 reset, rebase, merge, forced checkout으로 자동 복구하지 않는다.
- missing progress, legacy evidence, version/status/authority를 compatibility shim 또는 default로 보충하지 않는다.
- release handoff를 `release-handoff`, completed, merged, done status로 기록하지 않는다.
- local `npm publish`, `pnpm changeset publish`, Version Packages PR merge, workflow dispatch/rerun을 실행하거나 권장하지 않는다.
