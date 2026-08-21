---
description: create-lane — 확정된 GitHub issue 집합을 strict canonical v1 lane ledger로 생성하는 planning harness.
argument-hint: "<issue-url|issue-number... | search-run-id | search-ledger-path> [base-branch]"
---

# create-lane

`create-lane`은 canonical v1 lane ledger의 유일한 producer다. 기존 GitHub issue 또는 `/search-issue` artifact를 read-only로 확인하고, 사람이 승인한 issue 집합과 lane 계획을 `.omo/lanes/<lane-id>.json`에 atomic create한다.

구현, PR 생성, review, merge, cleanup, root sync, publish는 수행하지 않는다. 생성된 ledger는 `/execute-lane`만 소비하며, standalone verifier의 arbitrary path 지원은 read-only 검증에만 적용된다.

## 사용법

```text
/create-lane <issue-url|issue-number... | search-run-id | search-ledger-path> [base-branch]
```

예시:

- `/create-lane 123 124 125 main`
- `/create-lane https://github.com/fluojs/fluo/issues/123 https://github.com/fluojs/fluo/issues/124`
- `/create-lane search-2026-08-18T10+09-runtime main`
- `/create-lane .opencode/search-issue/search-2026-08-18T10+09-runtime.json main`

base branch 기본값은 `main`이다. issue 목록, search run id, search ledger path 중 정확히 한 종류의 입력만 허용한다. 입력이 비었거나 여러 종류가 섞여 해석할 수 없으면 side effect 없이 올바른 형식을 안내하고 멈춘다.

Canonical pipeline:

```text
/search-issue
/create-lane .opencode/search-issue/<search_run_id>.json main
/execute-lane <lane-id> main
```

## 책임 경계

이 커맨드가 소유하는 것:

1. issue URL/number, search run id, search ledger path 해석.
2. `gh issue view|list`와 search artifact를 사용한 read-only issue 확인.
3. confirmed issue, suggested addition, 최종 lane plan에 대한 별도 human gate.
4. issue의 semantic lane 배치, queue 순서, dependency, release handoff 계획.
5. merge policy와 후속 command authority 기록.
6. candidate strict validation과 canonical target의 atomic create.
7. `/execute-lane <lane-id> <base-branch>` handoff 출력.

이 커맨드가 소유하지 않는 것:

- issue discovery, audit, issue draft/creation: `/search-issue`
- 구현, branch/worktree, commit, push, PR: `/issue-to-pr`
- PR review verdict: `/pr-to-merge`
- execution loop, merge, cleanup, root sync: `/execute-lane`
- release/version/publish: `.github/workflows/release.yml`의 Changesets workflow

## 입력 규칙

1. search run id는 `.opencode/search-issue/<search_run_id>.json`을 가리켜야 한다.
2. search ledger는 canonical `.opencode/search-issue/` artifact여야 한다. filename, artifact의 `search_run_id`, canonical path가 정확히 일치해야 한다. 기존 `.omo/lanes/` ledger를 입력받아 덮어쓰거나 재생성하지 않는다.
3. issue 목록은 각 issue의 title, labels, package/surface, linked PR 상태를 read-only로 요약한다.
4. closed issue, 다른 repository issue, 존재하지 않는 issue, 이미 active PR에 할당된 issue는 lane plan review 전에 명시한다.
5. 한 invocation은 하나의 새 lane ledger만 생성한다.

Search artifact는 exact 3-key object다.

```json
{
  "version": 1,
  "search_run_id": "search-2026-08-18T10+09-runtime",
  "selected_issues": [2046, 2045, 2041]
}
```

- root key는 정확히 `version`, `search_run_id`, `selected_issues`다. `version`은 `1`이며 unknown key는 fail closed다.
- `search_run_id`는 `[A-Za-z0-9][A-Za-z0-9+._-]*`인 safe basename이다. `.` 또는 `.lock`으로 끝나면 안 되며 `.opencode/search-issue/<search_run_id>.json`의 basename과 정확히 일치해야 한다.
- `selected_issues`는 중복 없는 positive safe integer의 non-empty array다.
- malformed, empty, duplicate, path/id mismatch, mixed input form은 lane candidate나 target을 생성하기 전에 거부한다.
- artifact를 수정하지 않는다. `selected_issues`는 Confirmed issue gate에 제시할 candidate일 뿐이며 자동 confirmed set 또는 lane plan이 아니다.

## Human gates

아래 gate는 순서대로 각각 통과해야 한다.

1. **Confirmed issue gate**: 입력 후보를 보여주고 이번 lane에 포함할 issue를 명시적으로 선택받는다.
2. **Suggested additions gate**: 같은 package, file surface, root cause를 강하게 공유하는 추가 issue를 confirmed set과 분리해 제안한다. second explicit approval을 받은 issue만 confirmed set에 추가하고 나머지는 `suggested_but_excluded`에 둔다.
3. **Lane plan review gate**: lane 이름과 queue 순서, dependency graph, release handoff, backlog candidate, merge policy, merge method, PR merge/cleanup/root-sync authority를 모두 보여주고 생성 승인을 받는다.

structured `question` surface를 사용할 수 없으면 `.omo/lanes/`에 쓰지 않는다. 선택지와 proposed plan을 한국어로 보고하고 사용자 응답을 기다린다. 앞 단계 승인은 뒤 단계 승인으로 추정하지 않는다.

## Merge authority and method

1. `pr_merge_method`는 항상 `squash`다.
2. 기본 `merge_policy`는 `supervisor-auto`이며 `authority_scope.pr_merge`는 strict schema상 항상 `true`다.
3. `developer-final`을 선택해도 `authority_scope.pr_merge`를 낮추지 않는다. 대신 `/execute-lane`이 `gh pr merge` 직전에 사용자 또는 상위 harness의 별도 human-final approval을 요구한다.
4. `supervisor-with-human-escalation`은 자동으로 해결할 수 없는 verdict와 policy 판단을 human gate로 보낸다.
5. `supervisor-full-auto`는 retry policy를 변경할 수 있지만 review, checks, dependency, squash, dirty-state, release, security, legal gate를 우회하지 않는다.
6. cleanup과 root fast-forward sync authority는 PR merge authority와 별개로 review한다.
7. `publish_via_github_actions`는 `false`이며 이 커맨드는 publish authority를 행사하지 않는다.
8. lane plan review에서 선택한 authority를 보여주지만 `create-lane` 자체는 merge, cleanup, sync를 실행하지 않는다.

## Lane planning rules

1. 각 lane은 한 시점에 queue의 issue 하나만 current issue로 실행한다.
2. 같은 package/file/surface를 강하게 건드리는 issue는 같은 lane에 두고 순차 실행한다.
3. ordering은 dependency, `priority:p0` > `priority:p1` > `priority:p2`, `wave:1` > `wave:2` > `wave:3`, foundation-first 순으로 결정한다.
4. dependency가 있는 issue는 선행 issue가 완료되기 전 unlock하지 않는다.
5. release/publish 자체가 핵심인 issue는 전용 single-issue lane과 `release_handoffs`에 기록한다.
6. 계획 중 발견했지만 승인되지 않은 작업은 queue에 자동 추가하지 않고 `backlog_candidates`에만 기록한다.
7. `confirmed_issues`와 모든 lane queue의 합집합은 중복 없는 동일한 issue 집합이어야 한다.

## Canonical v1 root

필수 root key는 정확히 다음 21개다. `created_at`만 optional이며 다른 unknown key는 fail closed다.

`version`, `run_id`, `lane_id`, `status`, `created_by`, `base_branch`, `source`, `merge_policy`, `pr_merge_method`, `authority_scope`, `retry_policy`, `execution`, `confirmed_issues`, `suggested_but_excluded`, `backlog_candidates`, `release_handoffs`, `completed_issues`, `issue_progress`, `lanes`, `dependency_graph`, `root_main_sync`

`version`은 `1`, `created_by`는 `create-lane`, 새 ledger `status`는 `ready`다. `run_id === lane_id`이며 둘 다 `[A-Za-z0-9][A-Za-z0-9._-]*`인 path-safe basename이다. `.`, `.lock`으로 끝나면 안 된다. `created_at`이 있으면 strict UTC ISO timestamp인 `Z` 형식이다.

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

`source`는 정확히 `type`, `search_run_id`, `search_ledger`만 가진다.

- `existing-issues`: 두 search field가 모두 `null`이다.
- `search-issue`: `search_run_id`는 `[A-Za-z0-9][A-Za-z0-9+._-]*`인 safe basename이다. 내부 `+`는 timezone-bearing producer ID를 보존하기 위해 source ID에만 허용된다. `search_ledger`는 정확히 `.opencode/search-issue/<search_run_id>.json`이다.

`authority_scope`, `retry_policy`, `execution`도 example의 exact key만 허용한다. `merge_policy`가 `supervisor-full-auto`일 때만 `retry_count_is_terminal`은 `false`이고 그 밖에는 `true`다.

## Dependency graph contract

`dependency_graph`는 sparse object다.

- key는 dependency를 가진 confirmed issue의 canonical positive-safe-integer decimal string이다.
- value는 unique positive-safe-integer prerequisite issue number array다.
- confirmed set 외부의 prerequisite는 이미 존재하는 external prerequisite를 표현할 수 있으므로 value에 허용된다.
- prerequisite가 없는 confirmed issue는 key를 생략한다.
- duplicate prerequisite, self dependency, cycle은 fail closed다.
- runtime dispatch는 graph에 기록된 모든 prerequisite의 완료를 live evidence와 함께 확인한 뒤 issue를 unlock한다.

## Lane, progress, and sync shapes

일반 lane은 정확히 `name`, `queue`, `current_issue`, `status`, `branch`, `worktree`, `pr`, `retry_count`를 가진다. `blocked-child-contract-error`만 exact `current_blocker: {signature, evidence}`를 추가한다. active lane은 positive integer `current_issue`, terminal lane은 `current_issue: null`과 `pr: null`을 사용한다. legacy lane-level `review`, `merge`, `cleanup` key는 null이어도 금지한다.

`issue_progress` key는 confirmed issue number의 decimal string이다. status별 key allowlist는 다음과 같다.

- non-completion (`queued`, `running`, `in_review`, terminal blocker statuses): `status`, `branch`, `worktree`, `pr`, `verification`, `retry_count`, `blockers`만 허용한다.
- `merged`: base key에 `review_verdict`, `checks`, `reviewers`, `reviewed_head`, `commits`, `merge_commit`, `issue_state`를 추가한다. `cleanup`은 금지한다.
- `done`: merged key에 `cleanup`을 추가한다.
- post-merge cleanup failure는 기존 `blocked-terminal` status를 사용한다. lane cursor, branch, worktree, PR은 null이며 progress는 complete merged evidence와 unresolved non-fix-back blocker를 보존하고 `cleanup`을 포함하지 않는다.

`reviewers`는 exact `contract`, `code`, `verification`이며 blocker는 exact `reviewer`, `signature`, `evidence`, `fix_back_eligible`, `status`다. nested legacy evidence와 unknown key는 금지한다.

`running` progress는 safe branch와 matching worktree가 필수이며 PR은 null일 수 있다. `in_review`는 branch/worktree에 canonical PR과 non-empty verification을 추가로 요구한다. 서로 다른 issue는 같은 non-null branch 또는 worktree를 공유할 수 없다. lane과 현재 issue progress가 같은 identity를 mirror하는 것은 중복 assignment가 아니다.

release handoff는 dedicated single-issue lane이다. ready ledger에서는 progress 없이 `queued`이며, 실행 후 lane/progress가 모두 `blocked-maintainer-decision`이다. branch, worktree, PR identity를 기록하지 않고 절대 completed, merged, done이 되지 않는다.

`root_main_sync`는 exact `{status, sha}`이며 status는 `not-started`, `done`, `skipped-authority`, `blocked-dirty`만 허용한다.

## Creation gates

1. primary repository root를 확정하고 target을 정확히 `<primary-root>/.omo/lanes/<lane-id>.json`으로 계산한다.
2. `.omo/lanes`와 target의 realpath containment를 확인하고 symlink, path escape, existing target을 거부한다.
3. 세 human gate가 모두 통과하기 전에는 candidate나 target을 쓰지 않는다.
4. approved plan으로 별도 candidate snapshot을 만들고 strict validator를 실행한다.
5. focused gate는 정확히 five TEST files와 364 tests다. `lane-ledger-schema.mjs`, `lane-ledger-progress-schema.mjs`, `lane-ledger-dependency.mjs`는 validator implementation module이며 test file 수에 포함하지 않는다.
6. validation이 성공하고 target 부재를 다시 확인한 경우에만 target을 atomic create한다.
7. validation 또는 atomic create가 실패하면 target은 absent 상태여야 하고 기존 ledger는 변경하지 않는다. 결과만 `needs-human-check`로 보고한다.

## Output contract

최종 보고는 한국어로 작성하고 다음 값을 포함한다.

```yaml
result: lane ledger 생성 | 중단 | needs-human-check
lane id: <lane-id>
ledger: .omo/lanes/<lane-id>.json
base branch: <base-branch>
source: <existing-issues|search-issue>
merge policy: <developer-final|supervisor-auto|supervisor-with-human-escalation|supervisor-full-auto>
merge method: squash
authority scope: <pr merge, cleanup, root sync summary>
confirmed issues: [<issue-number>]
suggested but excluded: [<issue-number>]
lanes:
  - name: <lane-name>
    queue: [<issue-number>]
dependency graph: <summary>
release handoffs: [<issue-number>]
backlog candidates: [<issue-number>]
next command: /execute-lane <lane-id> <base-branch>
```

## Must NOT

- 명시 승인 없이 issue를 confirmed set 또는 queue에 넣지 않는다.
- suggested issue를 second explicit approval 없이 포함하지 않는다.
- 기존 target을 덮어쓰거나 unsupported `supersedes`/migration marker/extra key를 추가하지 않는다.
- `/issue-to-pr`, `/pr-to-merge`, 구현 worker를 호출하지 않는다.
- branch/worktree 생성, 파일 구현, commit, push, PR 생성/merge/close, cleanup, root sync를 수행하지 않는다.
- issue discovery/audit/registration 또는 execution-stage source choice를 복제하지 않는다.
- legacy completion evidence나 missing field를 compatibility shim/default로 변환하지 않는다.
- release publish, Version Packages PR merge, workflow dispatch/rerun, tag/release 생성, local publish를 수행하지 않는다.
- 실행 중 발견될 작업을 현재 scope에 자동 추가하지 않는다.
