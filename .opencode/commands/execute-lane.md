---
description: execute-lane, canonical v1 lane ledger를 strict preflight와 live Git gates 아래에서 drain하는 execution harness.
argument-hint: "<lane-id|lane-ledger-path> [resume|--full-auto] [base-branch]"
---

# execute-lane

`execute-lane`은 `create-lane` producer envelope의 유일한 consumer다. source discovery, issue selection, queue 재작성은 하지 않는다. arbitrary path verifier는 read-only지만 mutation은 primary `.omo/lanes/<lane-id>.json`에만 허용한다.

## Strict preflight and exact root

JSON parse 후 root key는 다음 필수 21개와 optional `created_at`만 허용한다.

`version`, `run_id`, `lane_id`, `status`, `created_by`, `base_branch`, `source`, `merge_policy`, `pr_merge_method`, `authority_scope`, `retry_policy`, `execution`, `confirmed_issues`, `suggested_but_excluded`, `backlog_candidates`, `release_handoffs`, `completed_issues`, `issue_progress`, `lanes`, `dependency_graph`, `root_main_sync`

`version: 1`, `created_by: create-lane`, `run_id === lane_id`, path-safe basename identity, safe `base_branch`, and strict UTC optional `created_at` are required. `source`는 정확히 `{type, search_run_id, search_ledger}`이며 `existing-issues`는 null search fields, `search-issue`는 exact `.sisyphus/search-issue/<id>.json` path를 사용한다. Unknown root/source key, nested legacy evidence, missing identity, or producer provenance outside exact-key validation은 모두 fail closed다.

`authority_scope`는 정확히 `issue_creation`, `pr_creation`, `pr_merge`, `cleanup_command_worktrees`, `root_main_sync_ff_only`, `publish_via_github_actions`다. 값은 각각 `false`, `true`, `true`, boolean, boolean, `false`다. `retry_policy`는 정확히 `retry_count_is_terminal`, `max_same_failure_repeats`, `max_wall_clock_minutes`, `stop_on_child_contract_error`다. full-auto에서만 terminal retry count가 false다. `execution`은 정확히 `status`, `last_command`, `last_updated`이며 ready일 때 각각 `not-started`, null, null이고 그 외에는 root status와 non-empty values가 일치한다.

## Status and queue matrix

root status는 `ready`, `running`, `done`, `blocked-terminal`, `needs-human-check-terminal`, `blocked-budget-exhausted`, `blocked-maintainer-decision`, `blocked-child-contract-error`, `blocked-ledger-conflict`다. lane/progress는 `queued`, `running`, `in_review`, `merged`, `done`과 terminal status를 사용한다. root sync는 `not-started`, `done`, `skipped-authority`, `blocked-dirty`만 사용한다.

| queue position | required progress |
| --- | --- |
| prior entries | `done` |
| current entry | lane status와 progress status가 일치 |
| later entries | absent 또는 `queued` |
| merged cursor | 이전 `merged` item은 insufficient하며 cursor가 전진하기 전에 progress가 `done`이 되어야 한다 |
| done lane | 모든 queue issue가 `done` progress |
| previous merged entry | `completed_issues`나 `merged` progress만으로는 부족하며 cursor 전진 전에 `done` progress가 필요 |

Queued lane에 progress가 없으면 `branch`, `worktree`, `pr`는 null이고 `retry_count`는 0이어야 한다. progress가 있으면 lane과 branch/worktree는 양쪽 모두 absent 또는 exact equal이어야 하고, PR은 canonical normalization 후 exact equal이어야 하며 retry count도 같다. running은 PR이 null일 수 있다. `in_review`와 `merged`는 matching PR이 필수다. canonical PR은 positive integer 또는 `https://github.com/fluojs/fluo/pull/<number>`뿐이다.

일반 lane key는 정확히 `name`, `queue`, `current_issue`, `status`, `branch`, `worktree`, `pr`, `retry_count`다. `blocked-child-contract-error`에서만 exact `current_blocker: {signature, evidence}`를 추가한다. progress allowlist는 `status`, `branch`, `worktree`, `pr`, `verification`, `retry_count`, `review_verdict`, `checks`, `reviewers`, `reviewed_head`, `commits`, `merge_commit`, `cleanup`, `issue_state`, `blockers`다. reviewer는 exact `contract`, `code`, `verification`; blocker는 exact `reviewer`, `signature`, `evidence`, `fix_back_eligible`, `status`다.

Cleanup evidence는 `done` progress에만 허용한다. cleanup authority가 true면 정확히 `{status, worktree_removed, local_branch_deleted, remote_branch_deleted}`이고 모두 true인 `done`; false면 정확히 `{status: skipped-authority}`다. `merged`에는 cleanup이 없다. root sync는 exact `{status, sha}`이며 terminal lanes 이후에만 `done`, `skipped-authority`, `blocked-dirty`가 될 수 있다. `done`은 authority true와 40자리 SHA, 나머지는 null SHA다.

## Release handoff lifecycle

`release_handoffs`는 unique positive issue numbers이며 confirmed set에 속한다. 각 issue는 dedicated single-issue lane이어야 한다. ready ledger에서는 lane이 queued이고 progress가 없다. 실행 후에는 lane과 progress가 모두 `blocked-maintainer-decision`이다. release handoff는 `/issue-to-pr`로 보내지 않으며, 어떤 경우에도 completed, merged, done으로 기록하지 않는다. 실제 release는 GitHub Actions Changesets workflow에 handoff한다.

## Live Git and worktree gates

ledger branch/worktree values는 live state를 대체하지 않는다. worktree는 정확히 `.worktrees/<branch>` 또는 primary root의 absolute equivalent이고 branch와 exact parity를 가져야 한다. registered worktree, clean state, symlink-free realpath containment를 확인한다. PR merge 전 live PR head/base, checks, linked issue, dependency를 재확인하고 squash만 사용한다. merge 확인과 issue CLOSED 확인 전 cleanup하지 않으며, dirty cleanup은 force 없이 blocked evidence로 남긴다. root sync는 registered primary checkout, exact base branch, clean root에서만 `git pull --ff-only`로 수행한다.

## Execution loop

같은 lane에서는 head issue만 dispatch한다. 전역 batch barrier는 없다. child 완료 즉시 output을 수집하고, candidate에 issue/branch/worktree/PR/verification/blocker를 기록한 뒤 strict validator, `/pr-to-merge`, verdict, same branch/worktree/PR fix-back and retry gate를 진행한다. 모든 lane과 progress가 terminal이고 stale evidence가 없을 때만 final report를 낸다.

Focused validation은 `lane-ledger-schema.mjs`와 `verify-lane-ledger-schema.test.ts`를 포함한 five-file gate이며 exactly 278 tests다.

## Must NOT

- preflight 전에 side effect를 만들지 않는다.
- invalid candidate로 마지막 valid ledger를 덮어쓰지 않는다.
- missing issue_progress compatibility, nested legacy evidence, version/status shim을 추가하지 않는다.
- release-only 작업을 `release-handoff`, completed, merged, done status로 기록하지 않는다.
- dirty, symlink, unregistered, detached, mismatched, force-required 상태에서 mutation하지 않는다.
