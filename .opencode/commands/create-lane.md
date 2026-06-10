---
description: create-lane — GitHub issue 묶음을 사람이 확정한 뒤 semantic lane ledger로 등록하는 fluo planning command harness.
argument-hint: "<issue-url|issue-number... | search-run-id | search-ledger-path> [base-branch]"
---

# create-lane

이 커맨드는 fluo 작업을 실행하기 전에 **issue set을 lane plan으로 고정**하는 planning harness다. `/search-issue`가 만든 issue, 기존 GitHub issue, 또는 search ledger를 입력으로 받아 사람이 검토 가능한 lane ledger를 생성한다.

`create-lane`은 실행자가 아니다. 구현, PR 생성, review gate, merge, cleanup, publish는 이 커맨드의 범위 밖이며 다음 단계인 `/execute-lane`이 lane ledger를 입력으로 받아 처리한다.

## 사용법

```
/create-lane <issue-url|issue-number... | search-run-id | search-ledger-path> [base-branch]
```

예시:

- `/create-lane 123 124 125 main`
- `/create-lane https://github.com/fluojs/fluo/issues/123 https://github.com/fluojs/fluo/issues/124`
- `/create-lane search-2026-06-01-runtime main`
- `/create-lane .sisyphus/search-issue/search-2026-06-01-runtime.json main`

base branch 기본값은 `main`이다.

## 책임 경계

이 커맨드가 소유하는 것:

1. **입력 해석** — issue URL/number, search run id, search ledger path 중 하나를 해석한다.
2. **issue set 확정** — read-only `gh issue view|list`와 search ledger를 기준으로 후보 issue를 요약한다.
3. **사용자 포함 gate** — 이번 lane에 포함할 issue를 `question` tool로 확정한다.
4. **Suggested additions gate** — 같이 처리하면 좋은 issue를 confirmed set과 분리해 제안하고, 명시 승인된 항목만 포함한다.
5. **Merge/cleanup authority 계획** — 실제 merge/cleanup 권한을 행사하지 않지만, lane ledger에 후속 실행의 PR merge authority와 merge method를 고정하고 cleanup 권한은 별도로 기록한다.
6. **semantic lane planning** — issue를 logical lane에 배치하고 dependency/order를 정한다.
7. **lane ledger 생성** — `.sisyphus/lanes/<lane-id>.json`을 생성하고 다음 `/execute-lane <lane-id>` handoff를 출력한다.

이 커맨드가 소유하지 않는 것:

- package audit, issue draft, issue creation: `/search-issue`
- 단일 issue 구현/PR 생성/fix-back: `/issue-to-pr`
- 단일 PR read-only review verdict: `/pr-to-merge`
- lane 실행 loop, merge gate, cleanup, root sync: `/execute-lane`
- release/version/publish orchestration: GitHub Actions Changesets release workflow

## 입력 규칙

1. 한 번에 하나의 lane run만 생성한다.
2. 입력이 search run id이면 `.sisyphus/search-issue/<run-id>.json`을 우선 찾는다.
3. 입력이 ledger path이면 `.sisyphus/search-issue/` 아래 search ledger 또는 `.sisyphus/lanes/` 아래 lane ledger인지 확인한다. 기존 lane ledger를 받으면 새 lane을 덮어쓰지 말고 `needs-human-check`로 멈춘다.
4. 입력이 issue 목록이면 각 issue를 read-only로 조회해 title, labels, package/surface hint, linked PR 여부를 요약한다.
5. 입력이 비어 있거나 여러 종류가 섞여 해석이 불가능하면 side effect 없이 필요한 입력 형식을 한국어로 안내하고 멈춘다.

## Human gates

이 커맨드는 planning command이지만 lane ledger 생성은 이후 실행의 기준이 되므로 아래 gate를 반드시 통과한다.

1. **Confirmed issue gate** — 후보 issue 목록을 보여주고 포함할 issue를 선택하게 한다.
2. **Suggested additions gate** — 같은 package/file/root-cause를 강하게 공유하는 issue만 별도 제안하고, 승인된 항목만 포함한다.
3. **Lane plan review gate** — lane 이름, queue 순서, dependency graph, release handoff 후보, authority scope를 보여주고 ledger 생성을 승인받는다.

`question` tool을 사용할 수 없는 런타임이면 `.sisyphus/lanes/` 파일을 만들지 말고 선택지를 한국어로 제시한 뒤 사용자 응답을 기다린다.

## Merge authority and method

`create-lane`은 lane ledger 생성 시 후속 `/execute-lane`이 사용할 PR merge authority와 merge method를 결정한다.

1. 기본값은 `authority_scope.pr_merge: true`다. 이는 `/pr-to-merge`의 `merge` verdict, 최신 PR/check 검증, dependency gate를 모두 통과한 PR에 한해 `/execute-lane`이 merge authority를 행사할 수 있음을 뜻한다.
2. PR merge method는 항상 `pr_merge_method: "squash"`로 기록한다.
3. `developer-final` 정책은 사람의 최종 확인 gate를 추가하는 정책일 뿐, ledger의 기본 merge authority를 `false`로 낮추지 않는다.
4. cleanup, root main sync, publish 권한은 PR merge authority와 별개이며 기본값은 `false`다.

## Lane planning rules

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
- `release`

원칙:

1. 한 lane은 동시에 issue 1개만 실행한다.
2. 같은 파일/package/surface를 강하게 건드리는 issue는 같은 lane에 넣는다.
3. dependency가 있으면 같은 lane에 연속 배치하거나 선행 issue 완료 후 unlock되도록 기록한다.
4. ordering은 `priority:p0` > `priority:p1` > `priority:p2`, `wave:1` > `wave:2` > `wave:3`, 기반 레이어, 계약 리스크, 공통 기반 순서로 정한다.
5. release/publish 자체가 핵심인 issue는 `release_handoffs`에 기록하고 실행 단계에서 OpenCode 구현 loop를 중단한 뒤 GitHub Actions Changesets release workflow로 handoff하도록 표시한다.
6. 실행 중 새로 발견된 issue는 현재 lane에 자동 추가하지 않고 `backlog_candidates`에 기록한다.

## Lane ledger

생성 경로:

```
.sisyphus/lanes/<lane-id>.json
```

권장 schema:

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
  "merge_policy": "developer-final|supervisor-auto|supervisor-with-human-escalation|supervisor-full-auto",
  "pr_merge_method": "squash",
  "authority_scope": {
    "issue_creation": false,
    "pr_creation": true,
    "pr_merge": true,
    "cleanup_command_worktrees": false,
    "root_main_sync_ff_only": false,
    "publish_via_github_actions": false
  },
  "confirmed_issues": [123],
  "suggested_but_excluded": [124],
  "backlog_candidates": [],
  "lanes": [
    {
      "name": "runtime",
      "queue": [123],
      "current_issue": 123,
      "status": "queued",
      "branch": null,
      "worktree": null,
      "pr": null,
      "retry_count": 0
    }
  ],
  "dependency_graph": {},
  "release_handoffs": [],
  "completed_issues": [],
  "root_main_sync": {
    "status": "not-started",
    "sha": null
  },
  "execution": {
    "status": "not-started",
    "last_command": null,
    "last_updated": null
  }
}
```

`create-lane`은 새 lane ledger를 만들 때 같은 `lane_id` 파일이 이미 있으면 덮어쓰지 않는다. 변경이 필요하면 새 `lane_id`를 만들고 기존 ledger를 `supersedes`로 참조한다.

## Output contract

최종 보고는 한국어로 작성하고 아래 항목을 포함한다.

```yaml
result: lane ledger 생성 | 중단 | needs-human-check
lane id: <lane-id>
ledger: .sisyphus/lanes/<lane-id>.json
base branch: <base-branch>
source: <search-issue|existing-issues>
merge policy: <policy>
merge method: squash
PR merge authority: authority_scope.pr_merge=true
confirmed issues: [<issue-number>]
suggested but excluded: [<issue-number>]
lanes:
  - name: <lane-name>
    queue: [<issue-number>]
dependency graph: <summary>
release handoffs: [<issue-number>]
next command: /execute-lane <lane-id> <base-branch>
```

## Must NOT

- `/search-issue`의 package audit, auditor invocation, issue draft bundling logic을 복제하지 않는다.
- 명시 승인 없이 후보 issue를 confirmed set에 포함하지 않는다.
- Suggested issue를 second-pass 승인 없이 lane queue에 넣지 않는다.
- `/issue-to-pr`, `/pr-to-merge`를 호출하지 않는다.
- package publish, Version Packages PR merge, GitHub Actions workflow trigger/rerun을 수행하지 않는다.
- branch/worktree 생성, 파일 수정, commit, push, PR 생성, merge, cleanup, root sync를 수행하지 않는다.
- 기존 `.sisyphus/lanes/<lane-id>.json`을 덮어쓰지 않는다.
- 실행 중 새로 발견될 수 있는 작업을 현재 lane scope에 자동 추가하지 않는다.
