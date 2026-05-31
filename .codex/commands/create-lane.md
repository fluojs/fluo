---
description: create-lane — 기존 GitHub issue 목록 또는 search artifact를 실행 가능한 lane ledger로 변환하는 read-only planning command.
argument-hint: "<issue-number|issue-url|search-artifact> [...] [base-branch] [--merge-policy developer-final|supervisor-auto|supervisor-with-human-escalation|supervisor-full-auto]"
---

# create-lane

`create-lane`은 3단계 lane pipeline의 2단계다. 입력으로 받은 기존 GitHub issue set을 검증하고 semantic lane으로 묶어 `.sisyphus/lane/<run-id>.json` ledger를 작성한다.

이 커맨드는 실행자가 아니다. issue 생성, branch/worktree 생성, PR 생성, review, merge, cleanup을 하지 않는다.

## 사용법

```text
/create-lane 2046 2045 2041 --merge-policy supervisor-auto
/create-lane .sisyphus/search-issue/<run-id>.json --merge-policy developer-final
```

base branch 기본값은 `main`이다.

## 책임 경계

| 항목 | 내용 |
| --- | --- |
| Inputs | issue number, issue URL, 또는 `.sisyphus/search-issue/<run-id>.json` |
| Outputs | `.sisyphus/lane/<run-id>.json` with `status: ready` |
| Allowed | read-only GitHub issue 조회, dependency/surface 분석, lane grouping, merge policy 기록, authority scope 기록, ledger validation |
| Forbidden | `gh issue create`, `/issue-to-pr`, `git worktree add`, branch 생성, PR 생성, `/pr-to-merge`, `gh pr merge`, cleanup, publish |

## 입력 규칙

1. 입력은 기존 GitHub issue 또는 search artifact만 허용한다.
2. issue가 없으면 lane ledger를 만들지 않는다.
3. search artifact를 받으면 `selected_issues` 또는 `created_issues`만 사용한다.
4. 이 단계에서 issue scope를 새로 제안하거나 확장하지 않는다.
5. issue가 닫혔거나 target repository가 다르면 `blocked-invalid-issue-set`로 중단한다.

## Preflight

- `gh issue view <issue>`로 title, body, state, labels, linked PR hint를 read-only로 확인한다.
- `CONTRIBUTING.md`, `docs/contracts/behavioral-contract-policy.md`, `.github/PULL_REQUEST_TEMPLATE.md` 존재를 확인한다.
- base branch가 존재하는지 확인한다.
- root worktree가 dirty여도 ledger 작성은 가능하지만, `root_main_sync.status`는 `not-started`로 둔다.

## Lane grouping

confirmed issue를 semantic lane에 배정한다. lane identity는 session id가 아니라 logical ownership이다.

권장 lane 이름:

- `foundation`
- `docs`
- `cli`
- `runtime`
- `auth`
- `persistence`
- `infra-messaging`
- `protocol-adapters`
- `request-pipeline`

원칙:

1. 같은 파일/package/surface를 강하게 건드리는 issue는 같은 lane에 넣는다.
2. dependency가 있으면 같은 lane에 순서대로 배치하거나 `dependency_graph`에 선행 조건을 기록한다.
3. 한 lane은 실행 시점에 issue 1개만 진행한다고 가정한다.
4. ordering은 `priority:p0`, `priority:p1`, 기반 레이어, contract risk, 공통 surface 순서로 정한다.

## Ledger schema

ledger는 다음 shape를 따른다.

```json
{
  "version": 1,
  "run_id": "lane-2026-05-31-001",
  "status": "ready",
  "created_by": "create-lane",
  "base_branch": "main",
  "source": {
    "type": "issues|search-artifact",
    "artifact": ".sisyphus/search-issue/<run-id>.json"
  },
  "merge_policy": "developer-final|supervisor-auto|supervisor-with-human-escalation|supervisor-full-auto",
  "authority_scope": {
    "issue_selection": false,
    "issue_creation": false,
    "pr_merge": false,
    "publish_via_github_actions": false,
    "cleanup_command_worktrees": false,
    "root_main_sync_ff_only": false
  },
  "retry_policy": {
    "retry_count_is_terminal": true,
    "max_same_failure_repeats": 3,
    "max_wall_clock_minutes": 180,
    "stop_on_child_contract_error": true
  },
  "confirmed_issues": [2046],
  "lanes": [
    {
      "name": "runtime",
      "queue": [2046],
      "current_issue": 2046,
      "status": "queued",
      "branch": null,
      "worktree": null,
      "pr": null,
      "retry_count": 0
    }
  ],
  "dependency_graph": {},
  "completed_issues": [],
  "release_handoffs": [],
  "root_main_sync": { "status": "not-started", "sha": null }
}
```

## Validation

ledger 작성 후 반드시 실행한다.

```bash
pnpm verify:lane-ledger -- .sisyphus/lane/<run-id>.json
```

validation이 실패하면 ledger를 실행 가능한 것으로 보고하지 않는다.

## Output contract

최종 보고는 한국어로 작성하고 다음을 포함한다.

```yaml
result: lane ledger ready
ledger: .sisyphus/lane/<run-id>.json
base branch: main
merge policy: <policy>
confirmed issues: [<issue-number>]
lanes:
  - name: <lane-name>
    queue: [<issue-number>]
next command: /execute-lane .sisyphus/lane/<run-id>.json
```

## Must NOT

- issue를 만들지 않는다.
- implementation worker를 dispatch하지 않는다.
- branch/worktree/PR을 만들지 않는다.
- `/pr-to-merge`를 호출하지 않는다.
- merge, cleanup, main sync를 하지 않는다.
- issue selection을 실행 중에 확장하지 않는다.
