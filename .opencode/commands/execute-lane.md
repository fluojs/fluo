---
description: execute-lane, canonical v1 lane ledger를 strict preflight와 live Git gates 아래에서 drain하는 execution harness.
argument-hint: "<lane-id|lane-ledger-path> [resume|--full-auto] [base-branch]"
---

# execute-lane

`execute-lane`은 `create-lane`이 만든 canonical v1 ledger의 consumer다. source discovery나 queue 재작성은 하지 않는다. 항상 lane head 하나만 진행하고, 모든 evidence가 durable하게 기록된 뒤 다음 gate로 간다.

## Path와 immutable preflight

1. lane ID는 primary repository의 `.omo/lanes/<lane-id>.json`에서만 해석한다. 명시 path는 regular non-symlink file이어야 하며 `lstat`와 모든 parent component의 symlink 검사를 통과하고 `realpath`가 primary `.omo/lanes` 안에 있어야 한다.
2. ledger bytes와 마지막 valid serialized snapshot을 읽고, JSON parse, exact canonical v1 schema, base branch, authority, status matrix를 검증한다.
3. preflight는 worker dispatch, issue/PR mutation, ledger write, merge, cleanup, root sync보다 먼저 끝낸다. 실패한 preflight는 파일과 외부 상태를 전혀 바꾸지 않고 외부 결과만 `needs-human-check`로 보고한다.
4. standalone `verify-lane-ledger`의 arbitrary path boundary는 read-only tooling일 뿐이며 execute-lane의 mutation authority가 아니다.

## Canonical contract

root status는 `ready`, `running`, `done`, `blocked-terminal`, `needs-human-check-terminal`, `blocked-budget-exhausted`, `blocked-maintainer-decision`, `blocked-child-contract-error`, `blocked-ledger-conflict`만 사용한다. lane/progress status는 `queued`, `running`, `in_review`, `merged`, `done` 및 위 terminal status만 사용한다. root sync status는 `not-started`, `done`, `skipped-authority`, `blocked-dirty`만 사용한다. `release-handoff`와 임의 status는 금지한다.

`authority_scope`는 정확히 `issue_creation`, `pr_creation`, `pr_merge`, `cleanup_command_worktrees`, `root_main_sync_ff_only`, `publish_via_github_actions`만 가진다. 값은 각각 `false`, `true`, `true`, boolean, boolean, `false`여야 한다. `retry_policy`는 정확히 `retry_count_is_terminal`, `max_same_failure_repeats`, `max_wall_clock_minutes`, `stop_on_child_contract_error`를 가진다. `merge_policy`가 `supervisor-full-auto`일 때만 `retry_count_is_terminal: false`를 허용하고, 그 외에는 `true`여야 한다.

`execution`은 정확히 `status`, `last_command`, `last_updated`를 가진다. root가 `ready`면 execution status는 `not-started`이고 두 timestamp/value는 null이다. 그 외에는 root status와 같고 두 값 모두 non-empty string이어야 한다.

상태 관계 matrix는 다음과 같다.

| surface | 허용 상태 | 필수 관계 |
| --- | --- | --- |
| root | `ready`, `running`, `done`, `blocked-terminal`, `needs-human-check-terminal`, `blocked-budget-exhausted`, `blocked-maintainer-decision`, `blocked-child-contract-error`, `blocked-ledger-conflict` | `ready`는 모든 lane `queued`, 빈 `completed_issues`, 빈 `issue_progress`, root sync `not-started`다. `done`은 모든 lane `done`이고 root sync가 `not-started`가 아니다. terminal root는 active lane을 가질 수 없다. |
| lane | `queued`, `running`, `in_review`, `merged`, `done` 및 terminal status | active lane의 `current_issue`는 queue의 첫 미완료 issue다. terminal lane의 `current_issue`는 `null`이고 lane-level `pr`, `review`, `merge`, `cleanup` evidence는 없다. `done` lane의 모든 queue issue는 `done` progress다. |
| progress | `queued`, `running`, `in_review`, `merged`, `done` 및 terminal status | progress key는 confirmed issue와 queue에 모두 속한다. `merged` 또는 `done` key 집합은 `completed_issues`와 같다. `queued` issue만 실행 전 progress를 생략할 수 있다. |
| root sync | `not-started`, `done`, `skipped-authority`, `blocked-dirty` | `done`, `skipped-authority`, `blocked-dirty`는 모든 lane이 terminal이어야 한다. `done`은 authority true와 40자리 SHA, 나머지는 null SHA를 사용한다. |

`release_handoffs`는 unique positive issue number만 담고 모두 `confirmed_issues`에 속해야 한다. release-only issue는 `/issue-to-pr`로 보내지 않고 `blocked-maintainer-decision` progress와 `release_handoffs`에 기록해 GitHub Actions Changesets release workflow로 handoff한다. handoff status는 만들지 않는다.

`issue_progress`는 confirmed issue와 queue에 속한 문자열 key만 허용한다. 기존 entry는 unique해야 한다. queued issue는 실행 전까지 entry가 없을 수 있지만, 완료 issue는 반드시 entry가 있어야 한다. `completed_issues`는 `merged` 또는 `done` progress key와 정확히 같은 unique 집합이어야 한다.

## State and completion evidence

progress의 durable evidence는 `status`, `branch`, `worktree`, `pr`, `verification`, `retry_count`, `review_verdict`, `checks`, `reviewers`, `merge_commit`, `issue_state`, `cleanup`이다. canonical PR은 positive integer 또는 `https://github.com/fluojs/fluo/pull/<number>`뿐이다. `reviewers`는 정확히 `contract`, `code`, `verification`을 가지며 완료 시 모두 `PASS`, `checks`는 `PASS`, `review_verdict`는 `merge`, `verification`은 non-empty여야 한다. 완료 progress에는 40자리 lowercase SHA `merge_commit`, `issue_state: CLOSED`가 필요하다. `reviewed_head`는 있으면 40자리 SHA, `commits`는 있으면 non-empty 7부터 40자리 lowercase hex 배열이다. blocker가 남아 있으면 완료할 수 없고, 기록한다면 모두 `status: remediated`여야 한다.

`status: merged`는 merge 확인 후 cleanup 전 상태다. `status: done`은 PR `MERGED`, linked issue `CLOSED`, strict evidence, cleanup 판단을 모두 마친 뒤에만 사용한다. cleanup authority가 true이면 cleanup object는 정확히 `status`, `worktree_removed`, `local_branch_deleted`, `remote_branch_deleted`이고 네 값이 모두 true인 `done`이어야 한다. authority가 false이면 정확히 `{ "status": "skipped-authority" }`만 허용한다. 그 외 status에서 cleanup `done` 또는 `skipped-authority`는 금지한다.

## Live worktree and Git gates

ledger 값은 live filesystem/Git 상태를 대체하지 않는다.

- `git rev-parse --path-format=absolute --git-common-dir`로 primary repository의 common dir를 확인한다.
- ledger worktree는 정확히 `.worktrees/<branch>` 또는 primary root의 absolute `.worktrees/<branch>`여야 한다. branch name은 safe branch name이어야 한다.
- worktree path와 각 component는 `lstat`로 확인하고 symlink를 거부한다. `realpath`가 primary root의 `.worktrees` 아래에 containment되어야 한다.
- `git worktree list --porcelain`에서 해당 worktree가 registered 상태이고 ledger branch를 checkout 중이어야 한다. branch와 worktree는 정확히 일치해야 하며 dirty worktree, force removal, force checkout은 금지한다.
- merge 전에는 live PR head/base, checks, linked issue, dependency를 다시 확인한다. `pr_merge_method`는 `squash`이고 repository policy와 일치해야 한다. verdict만으로 merge하지 않는다.
- cleanup은 PR `MERGED`와 issue `CLOSED`를 다시 확인하고 command-owned registered worktree에서만 수행한다. dirty이면 force 없이 `blocked-dirty-worktree` evidence를 기록한다.

root sync는 모든 lane이 terminal인 뒤에만 한다. primary registered checkout인지 확인하고, `git symbolic-ref --quiet --short HEAD`가 정확히 `base_branch`인지 확인한다. detached HEAD, branch mismatch, dirty root, unregistered checkout은 거부한다. clean root에서만 `git pull --ff-only origin <base_branch>`를 사용하며 force, reset, rebase, merge commit은 금지한다. 성공 시 `root_main_sync: { "status": "done", "sha": "<40-char SHA>" }`, 권한 미승인 시 `skipped-authority`와 null SHA, dirty 시 `blocked-dirty`와 null SHA를 기록한다.

## Candidate update protocol

각 변경은 현재 serialized ledger의 safe candidate snapshot에서 시작한다. candidate에 evidence와 상태를 적용하고 strict validator를 실행한다. 성공한 candidate만 원자적으로 replace한다. validation 실패, live gate 실패, side effect 실패 시 마지막 valid serialized ledger를 보존하고 unsupported 상태를 기록하지 않는다. 최종 보고 전에도 validator를 다시 실행한다. 모든 lane이 `done` 또는 진짜 terminal이고 pending, skipped, stale, in_progress evidence가 없을 때만 보고한다.

## Loop and gates

lane 간에는 global batch barrier를 두지 않으며, 같은 lane에서는 head issue만 dispatch한다. `/pr-to-merge` verdict는 `merge`, `block`, `needs-human-check`만 허용한다. `block`은 같은 branch, worktree, PR에 bounded fix-back으로 되돌리고 retry policy를 적용한다. retry limit, repeated failure, child contract error, maintainer-only decision은 각각 지정된 `blocked-*` terminal status로 기록한다.

worker prompt에는 fresh dedicated `.worktrees/` worktree, PR만 생성, merge/close/cleanup 금지, issue/branch/worktree/PR URL/verification/blocker 보고를 명시한다. 불명확한 child 결과는 재지시 후에도 evidence가 없을 때만 `blocked-child-contract-error`로 끝낸다.

## Per-lane progress, no global batch barrier

각 lane은 독립적으로 진행한다. sibling lane의 worker가 끝날 때까지 완료된 lane item의 다음 gate를 기다리지 않는다.

1. child 완료 알림을 받으면 `background_output(<task-id>)`로 해당 child output을 즉시 수집한다.
2. 수집한 보고의 issue, branch, worktree, PR, verification summary 또는 blocker를 해당 lane item의 candidate ledger에 기록하고 strict validator를 통과시킨 뒤 저장한다.
3. PR URL 또는 명시된 blocker가 있으면 sibling lane 상태와 무관하게 즉시 `/pr-to-merge <pr> <issue> <base-branch>`를 실행한다.
4. `merge`, `block`, `needs-human-check` verdict를 candidate에 기록한다. `block`이면 같은 PR, branch, worktree에 fix-back을 수행하고, fix-back마다 반드시 새 `/pr-to-merge`를 다시 실행한다.
5. fresh `/pr-to-merge`는 동일한 세 reviewer role/surface인 `contract`, `code`, `verification`을 모두 다시 확인한 결과여야 하며, 이 fresh evidence 없이는 merge eligibility를 부여하지 않는다.
6. fresh verdict가 `merge`이고 checks, live GitHub/repo gate, authority, dependency gate가 모두 통과할 때만 merge eligibility를 평가한다. `needs-human-check`는 해당 lane item의 terminal 판단으로 처리한다.

완료 child를 수집한 뒤 남은 worker 수를 이유로 대기하거나 전역 join을 만들지 않는다. 허용되는 barrier는 같은 lane의 현재 head issue가 완료되기 전 다음 issue를 dispatch하지 않는 것뿐이다.

## Output

최종 보고는 한국어로 작성하고 `result`, `lane id`, `ledger`, `base branch`, lane status, issue/PR/branch/worktree mapping, merge/cleanup/root sync 결과, retry/remediation, remaining backlog를 포함한다. `needs-human-check`는 외부 보고용 결과이며 ledger status가 아니다.

## Must NOT

- preflight 전에 side effect를 만들지 않는다.
- 기존 serialized ledger를 invalid candidate로 덮어쓰지 않는다.
- `missing issue_progress` compatibility, legacy lane-level completion evidence, version/status shim을 추가하지 않는다.
- release-only 작업을 `release-handoff` status로 기록하지 않는다.
- dirty, symlink, unregistered, detached, mismatched, force-required 상태에서 filesystem/Git mutation을 수행하지 않는다.
- local publish, workflow trigger, tag/release 생성, PR merge 권한 없는 merge를 수행하지 않는다.
