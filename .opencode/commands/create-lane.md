---
description: create-lane, 확정된 GitHub issue 집합을 strict canonical v1 lane ledger로 생성하는 planning harness.
argument-hint: "<issue-url|issue-number... | search-run-id | search-ledger-path> [base-branch]"
---

# create-lane

`create-lane`은 canonical v1 lane ledger의 유일한 producer다. issue를 read-only로 확인하고, 승인된 issue 집합과 lane 계획을 `.omo/lanes/<lane-id>.json`에 atomic create한다. 실행, PR, merge, cleanup, root sync, publish는 수행하지 않는다.

## Producer and consumer envelope

세 단계의 envelope는 다음 하나뿐이다.

1. `/search-issue`는 선택된 issue와 `search_run_id`를 `.sisyphus/search-issue/<id>.json`에 기록한다.
2. `/create-lane`은 issue list 또는 그 search artifact를 읽어 `.omo/lanes/<lane-id>.json`을 만든다.
3. `/execute-lane`은 그 ledger를 strict preflight한 뒤 같은 lane queue를 소비한다. source, confirmed issue, queue, lane grouping을 재작성하지 않는다.

Standalone verifier는 arbitrary read-only path를 허용하지만 mutation authority는 canonical `.omo/lanes` 경로에만 있다.

## Canonical v1 root

필수 root key는 정확히 다음 21개다. `created_at`만 optional이며, 다른 unknown key는 fail closed다.

`version`, `run_id`, `lane_id`, `status`, `created_by`, `base_branch`, `source`, `merge_policy`, `pr_merge_method`, `authority_scope`, `retry_policy`, `execution`, `confirmed_issues`, `suggested_but_excluded`, `backlog_candidates`, `release_handoffs`, `completed_issues`, `issue_progress`, `lanes`, `dependency_graph`, `root_main_sync`

`version`은 `1`, `created_by`는 `create-lane`, 새 ledger `status`는 `ready`다. `run_id === lane_id`이며 둘 다 path-safe basename이어야 한다. basename은 비어 있지 않고 `[A-Za-z0-9][A-Za-z0-9._-]*`이며 `.`, `.lock`으로 끝나지 않는다. `created_at`이 있으면 strict UTC ISO timestamp인 `Z` 형식이어야 한다.

```json
{
  "version": 1,
  "run_id": "lane-2026-08-18-runtime-a",
  "lane_id": "lane-2026-08-18-runtime-a",
  "status": "ready",
  "created_by": "create-lane",
  "base_branch": "main",
  "source": { "type": "existing-issues", "search_run_id": null, "search_ledger": null },
  "merge_policy": "supervisor-auto",
  "pr_merge_method": "squash",
  "authority_scope": {
    "issue_creation": false,
    "pr_creation": true,
    "pr_merge": true,
    "cleanup_command_worktrees": true,
    "root_main_sync_ff_only": true,
    "publish_via_github_actions": false
  },
  "retry_policy": {
    "retry_count_is_terminal": true,
    "max_same_failure_repeats": 3,
    "max_wall_clock_minutes": 180,
    "stop_on_child_contract_error": true
  },
  "execution": { "status": "not-started", "last_command": null, "last_updated": null },
  "confirmed_issues": [123],
  "suggested_but_excluded": [],
  "backlog_candidates": [],
  "release_handoffs": [],
  "completed_issues": [],
  "issue_progress": {},
  "lanes": [{
    "name": "runtime", "queue": [123], "current_issue": 123, "status": "queued",
    "branch": null, "worktree": null, "pr": null, "retry_count": 0
  }],
  "dependency_graph": {},
  "root_main_sync": { "status": "not-started", "sha": null }
}
```

`source`는 정확히 `type`, `search_run_id`, `search_ledger`만 가진다. `existing-issues` variant는 두 search field가 모두 `null`이다. `search-issue` variant는 path-safe `search_run_id`와 정확히 `.sisyphus/search-issue/<search_run_id>.json`인 `search_ledger`를 가진다. producer provenance를 exact-key 검증 밖에 둔다는 설명은 더 이상 유효하지 않다.

`authority_scope`와 `retry_policy`도 각각 위 exact key만 허용한다. `pr_merge_method`는 항상 `squash`다. `merge_policy`가 `supervisor-full-auto`일 때만 `retry_count_is_terminal`이 `false`일 수 있고, 그 밖에는 `true`다. `lanes`와 각 `queue`는 비어 있을 수 없다. `confirmed_issues`와 queue는 중복 없는 동일한 issue 집합이어야 한다.

## Lane, progress, and sync shapes

일반 lane은 정확히 `name`, `queue`, `current_issue`, `status`, `branch`, `worktree`, `pr`, `retry_count`를 가진다. `blocked-child-contract-error` lane에만 `current_blocker`를 추가하며, 그 object는 정확히 non-empty `signature`, `evidence`다. terminal lane은 `current_issue: null`과 canonical lane `pr: null`을 가지며, legacy `review`, `merge`, `cleanup` key는 null이어도 허용하지 않고 반드시 absent여야 한다. Legacy evidence keys는 모두 forbidden이며, extra exact-schema keys를 null로 채우지 않는다.

허용 progress key는 `status`, `branch`, `worktree`, `pr`, `verification`, `retry_count`, `review_verdict`, `checks`, `reviewers`, `reviewed_head`, `commits`, `merge_commit`, `cleanup`, `issue_state`, `blockers`다. `reviewers`는 정확히 `contract`, `code`, `verification`을 가진다. blocker는 정확히 `reviewer`, `signature`, `evidence`, `fix_back_eligible`, `status`를 가진다. unknown key와 nested legacy evidence는 거부한다. root sync는 정확히 `{status, sha}`이며 status는 `not-started`, `done`, `skipped-authority`, `blocked-dirty`뿐이다.

release handoff issue는 반드시 단일 issue 전용 lane이어야 한다. `ready`에서는 progress 없이 queued로 남고, 실행 후에는 lane과 progress가 모두 `blocked-maintainer-decision`이어야 한다. release handoff는 절대 `completed`, `merged`, `done`이 되지 않는다.

## Creation gates

1. primary repository의 `.omo/lanes` 아래 target만 해석하고 symlink와 기존 target을 거부한다.
2. 사용자 승인 전에는 side effect를 만들지 않는다.
3. candidate를 strict validator로 검증한다. Focused suite는 정확히 five TEST files와 278 tests이며 `verify-lane-ledger-schema.test.ts`를 포함한다. `lane-ledger-schema.mjs`가 strict shape validation을 담당한다.
4. validation 성공 때만 target을 atomic create한다. 실패 시 파일을 만들지 않고 외부 결과만 `needs-human-check`로 보고한다.

## Must NOT

- issue scope, lane queue, source provenance를 execute 단계에서 확장하거나 재작성하지 않는다.
- legacy completion evidence를 compatibility shim으로 소비하지 않는다.
- target 이외의 file/path, branch, worktree, commit, push, PR, merge, cleanup, root sync, publish를 mutation하지 않는다.
