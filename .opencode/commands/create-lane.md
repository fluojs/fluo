---
description: create-lane, 확정된 GitHub issue 집합을 strict canonical v1 lane ledger로 생성하는 planning harness.
argument-hint: "<issue-url|issue-number... | search-run-id | search-ledger-path> [base-branch]"
---

# create-lane

`create-lane`은 실행 전에 issue 집합과 lane 계획을 고정하는 producer다. 실행, merge, cleanup, root sync, publish는 수행하지 않는다. 생성 대상은 primary repository의 `.omo/lanes/<lane-id>.json`뿐이다.

## 사용법

```text
/create-lane <issue-url|issue-number... | search-run-id | search-ledger-path> [base-branch]
```

입력 issue를 read-only로 조회하고, 사용자가 confirmed issue, suggested additions, lane 순서, dependency, authority scope를 승인한 뒤 ledger를 만든다. 기존 파일은 덮어쓰지 않는다.

## Canonical v1 schema

새 ledger는 다음 필드를 모두 기록한다. `version`은 `1`, `created_by`는 `create-lane`, `status`는 `ready`다.

```json
{
  "version": 1,
  "run_id": "lane-2026-06-01-runtime-a",
  "status": "ready",
  "lane_id": "lane-2026-06-01-runtime-a",
  "created_by": "create-lane",
  "base_branch": "main",
  "source": {
    "type": "search-issue|existing-issues",
    "search_run_id": null,
    "search_ledger": null
  },
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
  "suggested_but_excluded": [124],
  "backlog_candidates": [],
  "release_handoffs": [],
  "completed_issues": [],
  "issue_progress": {},
  "lanes": [{
    "name": "runtime",
    "queue": [123],
    "current_issue": 123,
    "status": "queued",
    "branch": null,
    "worktree": null,
    "pr": null,
    "retry_count": 0
  }],
  "dependency_graph": {},
  "root_main_sync": { "status": "not-started", "sha": null }
}
```

`authority_scope`는 위 6개 key만 허용한다. `issue_creation`은 `false`, `pr_creation`과 `pr_merge`는 `true`, `publish_via_github_actions`는 `false`여야 한다. cleanup과 root sync key만 boolean 선택값이다.

`retry_policy`는 위 4개 key만 허용한다. `max_same_failure_repeats`와 `max_wall_clock_minutes`는 positive safe integer, 두 나머지는 boolean이다. `merge_policy`가 `supervisor-full-auto`이면 `retry_count_is_terminal`은 `false`, 그 외 정책이면 `true`다. 허용 정책은 `developer-final`, `supervisor-auto`, `supervisor-with-human-escalation`, `supervisor-full-auto`뿐이다. `pr_merge_method`는 항상 `squash`다.

`release_handoffs`는 release-only issue number의 배열이다. 각 값은 positive integer이고 `confirmed_issues`에 속해야 하며 중복할 수 없다. release-only issue는 `release-handoffs` 같은 status로 기록하지 않는다. 실행 단계에서 `blocked-maintainer-decision`과 이 배열로만 handoff를 표현한다.

`issue_progress`는 새 `ready` ledger에서 반드시 `{}`다. 실행 후에는 key가 confirmed issue와 lane queue에 모두 속하는 문자열 issue number여야 한다. 기존 progress entry는 unique해야 하며, queued issue는 실행 전까지 progress entry가 없어도 된다. `confirmed_issues`와 lane queue는 중복 없는 동일한 issue 집합이어야 한다. 완료된 issue는 반드시 progress entry를 가져야 하고 `completed_issues`는 `status`가 `merged` 또는 `done`인 progress key의 집합과 정확히 같아야 한다.

허용 root status는 `ready`, `running`, `done`, `blocked-terminal`, `needs-human-check-terminal`, `blocked-budget-exhausted`, `blocked-maintainer-decision`, `blocked-child-contract-error`, `blocked-ledger-conflict`다. lane과 progress에는 `queued`, `running`, `in_review`, `merged` 및 위 terminal status만 사용한다. root sync status는 `not-started`, `done`, `skipped-authority`, `blocked-dirty`뿐이다. 다른 status, version 생략, legacy evidence, `missing issue_progress` compatibility는 허용하지 않는다.

## 생성 gate와 불변성

1. lane ID는 primary `.omo/lanes` 아래에서만 해석한다. path는 명시된 execute path가 아니며, symlink를 통과해 다른 위치로 나갈 수 없다.
2. 사용자 승인 전에는 파일, branch, worktree, issue, PR에 side effect를 만들지 않는다.
3. target path를 `lstat`로 확인한다. target이 이미 존재하면 기존 ledger를 읽거나 대체하지 않고 외부 결과만 `needs-human-check`로 보고한다.
4. target이 존재하지 않을 때만 승인한 계획으로 candidate snapshot을 메모리에서 만든다.
5. candidate를 `pnpm verify:lane-ledger -- .omo/lanes/<lane-id>.json`과 동일한 strict validator로 메모리에서 검증한다.
6. validation 성공 때만 target을 atomic create한다. create 실패나 validation 실패 시 ledger 파일을 만들지 않고 외부 결과만 `needs-human-check`로 보고한다.

standalone verifier는 arbitrary path boundary를 지원하는 read-only tooling이다. 이를 `create-lane`의 mutation authority나 primary lane path 우회 수단으로 사용하지 않는다.

## Output

최종 보고는 한국어로 작성하고 `result`, `lane id`, `ledger`, `base branch`, `merge policy`, `confirmed issues`, `release handoffs`, `lanes`, `dependency graph`, `next command`를 포함한다. validator 실패 결과는 `needs-human-check`이며 ledger에 unsupported status를 쓰지 않는다.

## Must NOT

- issue를 명시 승인 없이 confirmed set에 넣지 않는다.
- 기존 ledger를 덮어쓰거나 legacy completion evidence를 migration/shim으로 소비하지 않는다.
- 승인된 candidate가 strict validation을 통과한 경우에만 target ledger를 atomic create한다. target 이외의 file/path, branch, worktree, commit, push, PR, merge, cleanup, root sync, publish는 mutation하지 않는다.
- `release-handoff` status나 새 version/status를 발명하지 않는다.
