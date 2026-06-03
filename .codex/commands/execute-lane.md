---
description: execute-lane — create-lane이 만든 lane ledger를 실행해 issue-to-pr, pr-to-merge, fix-back, squash merge, cleanup, main sync를 조율하는 command harness.
argument-hint: "<lane-run-id|.sisyphus/lane/<run-id>.json> [--resume] [base-branch]"
---

# execute-lane

`execute-lane`은 3단계 lane pipeline의 3단계다. 이 커맨드는 `/create-lane`이 만든 `.sisyphus/lane/<run-id>.json`만 입력으로 받는다.

issue discovery와 lane planning은 이 커맨드의 책임이 아니다. 이 커맨드는 confirmed issue set을 변경하지 않고, ledger의 lane queue를 drain한다.

## 사용법

```text
/execute-lane .sisyphus/lane/<run-id>.json
/execute-lane lane-2026-05-31-001 --resume main
```

## 책임 경계

| 항목 | 내용 |
| --- | --- |
| Inputs | `.sisyphus/lane/<run-id>.json` 또는 lane run-id |
| Outputs | 갱신된 lane ledger, PR/merge/cleanup/main sync 결과 |
| Allowed | `/issue-to-pr`, `/pr-to-merge`, bounded fix-back, approved squash merge, command-owned cleanup, fast-forward-only root main sync |
| Forbidden | issue discovery, issue creation, issue selection 변경, lane regrouping, suggested additions, non-squash merge, local publish |

## Ledger preflight

실행 전 반드시 확인한다.

1. ledger가 존재한다.
2. `status`가 `ready`, `running`, `blocked-child-contract-error`, `needs-human-check-terminal`, 또는 terminal resume 가능한 값이다.
3. `confirmed_issues`와 `lanes[*].queue`가 일치한다.
4. 각 lane의 `current_issue`는 해당 lane queue 안에 있다.
5. 같은 PR이 둘 이상의 lane에 매핑되지 않는다.
6. `merge_policy`와 `authority_scope`가 존재한다.
7. `pnpm verify:lane-ledger -- <ledger>`가 통과한다.

preflight 실패 시 branch/worktree/PR state를 변경하지 않는다.

## Drain loop invariant

`execute-lane`은 단발성 dispatch command가 아니라 lane drain loop다.

1. 각 lane은 항상 queue의 head issue만 실행한다.
2. head issue가 merge되어 `completed_issues`에 들어가기 전에는 같은 lane의 다음 issue를 dispatch하지 않는다.
3. `queued`, `running`, `in_review`, `merged` 상태 lane이 남아 있으면 최종 보고하지 않는다.
4. `/pr-to-merge`의 `block` verdict는 terminal이 아니라 fix-back 입력이다.
5. 진짜 terminal 상태는 `done`, `blocked-terminal`, `needs-human-check-terminal`, `blocked-budget-exhausted`, `blocked-maintainer-decision`, `blocked-child-contract-error`, `blocked-ledger-conflict`뿐이다.
6. `execute-lane`은 confirmed issue selection을 mutate하지 않고, issue scope를 expand하지 않는다.

### Per-lane progress, no global batch barrier

Lane 간 진행 판단은 독립적이다. 여러 unlocked lane head issue를 동시에 dispatch한 경우에도, 먼저 완료된 lane item은 다른 lane worker 완료를 기다리지 않고 즉시 PR collection → `/pr-to-merge` → fix-back/merge gate로 진행해야 한다.

- 허용되는 barrier는 **같은 lane 내부**의 head issue barrier뿐이다. 같은 lane의 다음 issue는 현재 head issue가 merge되어 `completed_issues`에 기록되기 전까지 dispatch하지 않는다.
- 금지되는 barrier는 **전체 lane batch barrier**다. 예를 들어 6개 lane을 dispatch했다면 6개 `/issue-to-pr`가 모두 끝날 때까지 기다린 뒤 한꺼번에 PR collection 또는 `/pr-to-merge`를 시작하지 않는다.
- child completion barrier는 해당 child/lane item의 완료 보고 없이 그 item의 commit, push, PR 생성, fix-back 완료 처리를 진행하지 말라는 뜻이다. 다른 lane item의 완료를 막는 전역 join 조건으로 해석하지 않는다.
- PR URL 또는 명시적 blocker가 수집된 lane item은 다른 dispatched item 상태와 무관하게 즉시 다음 gate를 평가한다.
- runner는 background child 완료 이벤트 또는 수집 가능한 완료 보고를 발견할 때마다 해당 lane item만 ledger에 반영하고, 그 lane item의 다음 gate를 즉시 평가한다.

#### Background completion event handling

완료 알림을 받은 순간에는 남은 worker 수를 이유로 대기하거나 상태 보고만 하고 멈추지 않는다. 해당 알림이 가리키는 lane item에 대해 아래 순서를 즉시 수행한다.

1. `background_output(<task_id>)`로 완료 보고를 수집한다.
2. 보고된 PR URL/branch/worktree/verifier summary 또는 blocker를 해당 lane item에 기록한다.
3. PR URL이 있으면 즉시 `/pr-to-merge <pr> <issue> <base-branch>`를 호출한다.
4. `merge | block | needs-human-check` verdict를 해당 lane item에 기록한다.
5. `block`이면 같은 PR/branch/worktree로 fix-back loop를 시작하고, `merge`이면 merge approval gate를 평가하며, `needs-human-check`이면 terminal 여부를 판단한다.
6. 이 전체 흐름은 다른 lane worker 완료 여부와 독립적으로 진행한다.

금지 예시: “3 tasks still in progress” 같은 알림 문구를 근거로 완료된 lane item의 PR collection, `/pr-to-merge`, fix-back/merge gate를 뒤로 미루지 않는다.

## Worker dispatch

각 unlocked lane의 head issue에 대해 다음을 호출한다.

```text
/issue-to-pr <issue-number|url> <base-branch>
```

`/issue-to-pr`가 `@fluo-issue-implementer` 또는 fallback executor를 선택한다. `execute-lane`은 worker 내부 구현 logic을 복제하지 않는다.

worker 결과에서 다음을 ledger에 기록한다.

- issue number / URL
- PR number / URL
- branch
- worktree path
- commit hash 또는 blocker
- verifier summary
- remaining risks

## Child completion barrier

`execute-lane`은 child implementer가 완료 보고를 반환하기 전에는 해당 worktree의 부분 변경을 직접 인계해 commit, push, PR 생성, fix-back 완료 처리로 진행하지 않는다.

완료 보고에는 다음 값이 필요하다.

- issue URL/number
- branch name
- worktree path
- changed files
- commit hash 또는 명시적 blocker
- 실행한 verifier와 pass/fail 결과
- `.changeset/*.md` 추가 여부와 근거
- remaining risks
- mode: `new-pr | fix-back`

보고 누락 시 같은 child session에 1회 이상 재보고를 요청한다. 그 뒤에도 보고가 없으면 lane을 `blocked-child-contract-error`로 기록하고 worktree 변경을 되돌리지 않는다.

## Central review gate

PR마다 다음을 호출한다.

```text
/pr-to-merge <pr-url|number> <linked-issue> <base-branch>
```

`/pr-to-merge`는 read-only gate이며 `merge | block | needs-human-check` 중 하나만 반환한다.

## Bounded fix-back loop

`block` verdict를 받으면 같은 PR/branch/worktree로 fix-back을 지시한다.

```text
/issue-to-pr <issue-number> <base-branch> --fix-back <pr> <branch> <worktree>
```

규칙:

- 새 branch, 새 worktree, 새 PR을 만들지 않는다.
- `/pr-to-merge`가 반환한 blocker만 최소 수정한다.
- fix-back 후 같은 PR에 대해 `/pr-to-merge`를 다시 실행한다.
- `retry_count <= 2`는 자동 fix-back 가능하다.
- `retry_count >= 3`은 interactive policy에서 `needs-human-check-terminal` 후보다.
- 같은 blocker signature가 반복되면 `blocker_signatures`와 `same_failure_count`를 ledger에 기록한다.

## Merge execution

`merge` verdict는 merge permission이 아니다. merge 직전 current state를 다시 확인한다.

필수 gate:

1. `/pr-to-merge` verdict가 `merge`다.
2. merge policy와 authority scope가 PR merge를 허용한다.
3. PR이 open, non-draft이고 base branch가 ledger와 일치한다.
4. PR head branch와 worktree가 ledger와 일치한다.
5. current checks가 통과했고 stale/pending/skipped required check가 없다.
6. worktree에 uncommitted change나 unpushed remediation commit이 없다.

fluo repository의 PR merge method는 항상 **squash merge**다.

```bash
gh pr merge <pr> --squash
```

`--merge` 또는 `--rebase`를 사용하지 않는다. squash merge가 branch protection이나 repository policy 때문에 거부되면 다른 merge method로 재시도하지 않고 `needs-human-check-terminal`로 멈춘다.

merge 후에는 `gh pr view <pr>`로 `MERGED` 상태와 merge SHA를 확인하고, linked issue가 `CLOSED`인지 확인한다. linked issue close가 확인되기 전에는 cleanup하지 않는다.

## Cleanup

cleanup은 PR `MERGED`와 linked issue `CLOSED`가 확인된 뒤에만 수행한다.

조건:

- ledger의 worktree path가 `<repo-root>/.worktrees/<branch>` 아래다.
- branch/worktree가 command-owned임이 확인된다.
- worktree가 dirty가 아니다.
- branch가 다른 worktree에서 사용 중이 아니다.
- cleanup authority가 있다.

순서:

1. `git worktree remove <worktree>`
2. local branch 삭제
3. remote branch cleanup authority가 있으면 remote head branch 삭제
4. `git worktree list`, local branch 조회로 제거 확인
5. `pnpm verify:lane-ledger -- <ledger>` 재실행

dirty worktree는 force remove하지 않는다. 사용자가 별도 승인했거나 ledger가 generated-only 상태를 증명할 때만 force cleanup을 고려한다.

## Main sync

root worktree가 clean이면 fast-forward-only sync만 허용한다.

```bash
git pull --ff-only origin <base-branch>
```

root worktree가 dirty이거나 non-fast-forward이면 sync하지 않고 ledger에 `root_main_sync.status`를 기록한다.

## Release handoff

release/publish 자체가 목표인 issue는 `/package-publish`로 넘긴다. local `npm publish` 또는 `pnpm publish`는 금지한다.

## Final validation

최종 보고 전 반드시 실행한다.

```bash
pnpm verify:lane-ledger -- <ledger>
```

validation이 실패하면 완료로 보고하지 않는다.

## Output contract

모든 사용자-facing 출력은 한국어로 작성한다.

```yaml
result: lane execution complete|blocked|needs-human-check
ledger: .sisyphus/lane/<run-id>.json
merge policy: <policy>
lanes:
  - name: <lane-name>
    status: <status>
    queue: [<issue-number>]
mapping:
  - issue: <issue-number>
    PR: <pr-number|null>
    branch: <branch|null>
    worktree: <worktree|null>
merge/cleanup/main sync:
  merge: <done|skipped|blocked>
  cleanup: <done|skipped|blocked>
  main sync: <done|skipped|blocked-dirty>
remaining backlog: [<issue-number>]
```

## Must NOT

- issue discovery를 하지 않는다.
- issue를 만들지 않는다.
- issue selection 또는 lane grouping을 변경하지 않는다.
- suggested additions를 제안하지 않는다.
- `/pr-to-merge`의 `merge` verdict만 보고 merge하지 않는다.
- squash 외 merge method를 사용하지 않는다.
- 여러 lane의 `/issue-to-pr` 완료를 모두 기다리는 global batch barrier를 만들지 않는다. 먼저 끝난 lane item은 즉시 PR collection과 `/pr-to-merge`로 진행한다.
- PR merge 및 linked issue close 확인 없이 cleanup하지 않는다.
- root worktree가 dirty인 상태에서 main sync를 시도하지 않는다.
- local publish를 실행하지 않는다.
