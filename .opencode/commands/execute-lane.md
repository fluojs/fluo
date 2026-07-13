---
description: execute-lane — create-lane이 만든 lane ledger를 기준으로 issue 구현, PR 리뷰, fix-back, gated merge/cleanup을 진행하는 fluo execution harness.
argument-hint: "<lane-id|lane-ledger-path> [resume|--full-auto] [base-branch]"
---

# execute-lane

이 커맨드는 `/create-lane`이 생성한 `.omo/lanes/<lane-id>.json`을 실행하는 **execution harness**다. source discovery나 lane planning을 다시 하지 않고, ledger에 고정된 lane head issue만 순서대로 `/issue-to-pr`, `/pr-to-merge`에 위임한다.

## 사용법

```
/execute-lane <lane-id|lane-ledger-path> [resume|--full-auto] [base-branch]
```

예시:

- `/execute-lane lane-2026-06-01-runtime-a main`
- `/execute-lane .omo/lanes/lane-2026-06-01-runtime-a.json resume main`
- `/execute-lane lane-2026-06-01-runtime-a --full-auto main`

base branch 기본값은 lane ledger의 `base_branch`이며, ledger에 없을 때만 `main`을 사용한다. invocation의 base branch가 ledger와 다르면 실행하지 말고 `needs-human-check`로 멈춘다.

## 책임 경계

이 커맨드가 소유하는 것:

1. **ledger 로드/검증** — lane id 또는 path를 해석하고 `.omo/lanes/<lane-id>.json`의 schema, base branch, authority scope, lane 상태를 확인한다.
2. **lane head dispatch** — unlocked lane의 head issue만 `/issue-to-pr <issue> <base-branch>`로 위임한다.
3. **PR collection** — issue, branch, worktree, PR URL, verification summary를 ledger에 기록한다.
4. **central review gate** — 각 PR에 `/pr-to-merge <pr> <issue> <base-branch>`를 호출한다.
5. **bounded fix-back loop** — `block` verdict의 fixable blocker를 같은 PR/branch/worktree에 `/issue-to-pr --fix-back`으로 되돌린다.
6. **merge approval gate** — `/pr-to-merge` verdict, checks, ledger authority, 사용자 승인을 모두 확인한 뒤에만 merge를 고려한다.
7. **cleanup/root sync gate** — PR merge 및 linked issue close 확인 후 명시 authority가 있는 command-owned worktree/branch만 정리한다.
8. **release handoff** — release/publish issue는 OpenCode 실행 loop에서 처리하지 않고 GitHub Actions Changesets release workflow handoff로 기록한다.

이 커맨드가 소유하지 않는 것:

- issue 발굴/등록: `/search-issue`
- lane plan 생성/수정/suggested additions: `/create-lane`
- 구현 세부: `/issue-to-pr`와 `fluo-issue-implementer`
- PR review 세부: `/pr-to-merge`와 reviewer agents
- local publish: 절대 금지, release/publish는 GitHub Actions Changesets workflow 경계를 따른다.

## Ledger preflight

실행 전 반드시 확인한다.

- ledger path가 `.omo/lanes/` 아래이거나 명시된 lane ledger path다.
- `created_by`가 `create-lane`이거나 호환 가능한 migration marker가 있다.
- `base_branch`가 invocation과 충돌하지 않는다.
- root worktree status를 확인하고 dirty이면 root sync는 금지한다.
- lane status와 GitHub/repo 상태가 충돌하지 않는다.
- `authority_scope.cleanup_command_worktrees`와 `authority_scope.root_main_sync_ff_only`를 정확한 boolean으로 확인한다. 필드가 누락되었거나 `false`이거나 해석할 수 없으면 해당 side effect는 금지하고 `skipped-authority`로 기록한다.
- `authority_scope.publish_via_github_actions`는 release handoff와 별개이며, 이 커맨드는 값과 무관하게 publish를 실행하지 않는다.
- `confirmed_issues`와 lane queue가 일치한다.
- 실행 중인 worker/reviewer background task가 ledger에 남아 있으면 먼저 결과 수집 또는 상태 확인을 한다.

## Execution loop invariant

`execute-lane`은 단발성 dispatch command가 아니라 **lane drain loop**다. 실행을 시작했다면 아래 불변식을 지킨다.

1. 최종 보고 금지 조건:
   - `queued`, `running`, `in_review`, `merged` 상태 lane이 남아 있음
   - `block` verdict를 받았지만 retry policy상 fix-back 여지가 남아 있음
   - 선행 issue merge 이후 unlock된 후속 issue가 남아 있음
   - evidence/check 상태가 pending, skipped, stale, in_progress임
2. 진짜 terminal 상태는 `done`, `blocked-terminal`, `needs-human-check-terminal`, `blocked-budget-exhausted`, `blocked-maintainer-decision`, `blocked-child-contract-error`, `blocked-ledger-conflict`뿐이다.
3. 각 lane은 항상 queue의 head issue만 실행한다.
4. `/pr-to-merge`의 `block`은 먼저 fix-back 입력으로 취급한다.
5. 모든 lane이 `done` 또는 진짜 terminal 상태이고 ledger가 현재 GitHub/repo 상태와 일치할 때만 최종 보고한다.

### Per-lane progress, no global batch barrier

Lane 간 진행 판단은 독립적이다. 여러 unlocked lane head issue를 동시에 dispatch한 경우에도, 먼저 완료된 lane item은 다른 lane worker 완료를 기다리지 않고 즉시 PR collection → `/pr-to-merge` → fix-back/merge gate로 진행해야 한다.

- 허용되는 barrier는 **같은 lane 내부**의 head issue barrier뿐이다. 같은 lane의 다음 issue는 현재 head issue가 merge되어 `completed_issues`에 기록되기 전까지 dispatch하지 않는다.
- 금지되는 barrier는 **전체 lane batch barrier**다. 예를 들어 6개 lane을 dispatch했다면 6개 `/issue-to-pr`가 모두 끝날 때까지 기다린 뒤 한꺼번에 PR collection 또는 `/pr-to-merge`를 시작하지 않는다.
- child completion barrier는 해당 child/lane item의 완료 보고 없이 그 item의 PR 생성, fix-back 완료, merge gate를 진행하지 말라는 뜻이다. 다른 lane item의 완료를 막는 전역 join 조건으로 해석하지 않는다.
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

각 unlocked lane head issue에 대해 `/issue-to-pr <issue-number|url> <base-branch>`를 호출한다.

worker prompt에는 반드시 다음을 포함한다.

```md
Use /issue-to-pr for this issue.
Rules:
- fresh dedicated worktree only under .worktrees/
- respect existing docs/contract guardrails
- create PR only; do not merge, close issue, push cleanup, or remove worktree/branch
- report issue, branch, worktree, PR URL, verification summary, remaining risks
```

PR URL이나 verification summary가 불명확하면 terminal로 끝내지 말고 같은 worker session에 1회 이상 “PR URL/branch/worktree/verification 또는 blocker를 반드시 보고하라”고 재지시한다. 재지시 후에도 결과가 없고 repo/GitHub read-only 확인에서 worktree/branch/PR이 없으면 `blocked-child-contract-error`로 표시한다.

## Central review gate

PR마다 `/pr-to-merge <pr-url|number> <linked-issue> <base-branch>`를 호출한다.

허용 verdict는 정확히 다음 셋이다.

```
merge | block | needs-human-check
```

`/pr-to-merge`는 read-only gate이므로 branch/worktree/PR state를 바꾸지 않는다. 실제 merge 판단과 실행은 이 커맨드의 merge gate와 명시 authority를 별도로 통과해야 한다.

## Bounded fix-back loop

`/pr-to-merge` verdict가 `block`이면 같은 branch / 같은 worktree / 같은 PR로 fix-back을 지시한다. 새 PR을 만들지 않는다.

- `retry_count`는 PR/lane item별로 증가한다.
- `retry_count <= 2`: 같은 `/issue-to-pr` worker 컨텍스트에 좁은 blocker 해결만 재지시한다.
- `retry_count >= 3`: 기본 interactive mode에서는 `needs-human-check-terminal`로 escalate한다.
- `--full-auto`: `retry_count >= 3`만으로 멈추지 않되 같은 blocker signature가 3회 반복되거나 child command contract error가 있으면 `blocked-*` 상태로 멈춘다.
- fix-back 이후에는 반드시 동일 PR에 대해 `/pr-to-merge`를 재실행한다.
- maintainer-only decision, legal/security disclosure, release policy exception처럼 자동 수정으로 판단할 수 없는 경우에만 terminal escalation으로 전환한다.

fix-back prompt에는 반드시 다음을 포함한다.

```md
Use /issue-to-pr fix-back mode for the existing PR.
ISSUE: <issue-number>
PR: <pr-url>
BRANCH: <existing-branch>
WORKTREE: <existing-worktree>
BLOCKERS:
- <exact blocker from /pr-to-merge>
Rules:
- Work only inside the existing WORKTREE.
- Reuse the existing branch and PR; do not create a new branch or PR.
- Fix only listed blockers and directly required verification/doc evidence.
- Run changed-file diagnostics and the verifier that failed or was incomplete.
- Commit on the existing branch; do not push unless the command harness has explicit push authority.
- Report updated commit(s), verification, remaining risks, and whether a push is required.
```

## Merge execution contract

merge는 아래 조건을 모두 만족할 때만 고려한다.

1. `/pr-to-merge` verdict가 `merge`다.
2. ledger `authority_scope.pr_merge`가 true다. 사용자 명시 승인은 누락된 ledger authority를 대체하지 않으며, 필요한 경우 별도 정책 gate로만 추가된다.
3. CI/checks/diagnostics/tests/build/typecheck가 해당 변경 성격에 맞게 실제 통과했다.
4. dependency graph 상 선행 issue가 완료 상태다.
5. PR head branch, worktree, linked issue, base branch가 ledger와 현재 GitHub/repo 상태 모두에서 일치한다.
6. ledger `pr_merge_method`가 `squash`이고 repository merge policy와 일치한다.

`merge_policy: "developer-final"`은 `authority_scope.pr_merge=true`를 유지하더라도 자동 merge 권한이 아니다. 이 정책에서는 위 gate를 모두 통과한 뒤에도 사용자 또는 상위 harness의 명시 human-final approval 없이는 `gh pr merge`를 실행하지 않는다.

금지:

- `/pr-to-merge`의 `merge` verdict만 보고 checks/current PR state 재확인 없이 merge하지 않는다.
- ledger `pr_merge_method`가 없거나 `squash`가 아니면 임의로 `--squash`, `--merge`, `--rebase` 중 하나를 선택하지 않고 `needs-human-check-terminal`로 멈춘다.
- PR이 merge되지 않았거나 linked issue close 상태가 확인되지 않은 상태에서 cleanup하지 않는다.
- command-owned 여부가 불명확한 branch/worktree를 삭제하지 않는다.

## Cleanup and root sync

cleanup은 merge의 부속 단계지만 별도 safety gate다.

1. `authority_scope.cleanup_command_worktrees`가 정확히 `true`일 때만 cleanup을 고려한다. 누락 또는 `false`이면 worktree/local branch/remote branch를 삭제하지 않고 `cleanup: skipped-authority`로 기록한다.
2. PR merge state가 `MERGED`인지 재확인한다.
3. linked issue close state가 `CLOSED`인지 확인한다.
4. ledger의 worktree path가 `<repo-root>/.worktrees/<branch>`이고 해당 worktree가 ledger branch를 checkout 중인지 확인한다.
5. worktree가 dirty이면 `git worktree remove --force`를 실행하지 않고 `cleanup: blocked-dirty-worktree`로 기록한다.
6. local/remote branch cleanup은 cleanup authority와 command-owned 확인이 모두 있을 때만 수행한다.
7. `authority_scope.root_main_sync_ff_only`가 정확히 `true`일 때만 root main sync를 고려한다. 누락 또는 `false`이면 root branch를 변경하지 않고 `root_main_sync.status = skipped-authority`로 기록한다.
8. root worktree가 dirty이면 `git pull --ff-only origin <base-branch>`를 시도하지 않고 `root_main_sync.status = blocked-dirty`로 기록한다.
9. root main sync는 clean root worktree에서 `git pull --ff-only origin <base-branch>`만 허용한다. 강제 checkout, reset, rebase, merge commit 또는 dirty-root 자동 정리는 금지한다.

## Release handoff

lane item이 package release 준비/배포 자체를 다루거나 Version Packages PR/publish workflow 판단이 핵심이면 `/issue-to-pr`를 실행하지 않는다. 이 커맨드는 lane item을 `release-handoff` 상태로 기록하고, 사용자가 GitHub Actions Changesets release workflow와 repository release docs를 기준으로 별도 처리하도록 안내한다.

handoff payload에는 target package, target version, dist-tag, release_prerelease, pending changeset, Version Packages PR 상태, required verifier, lane ledger id를 포함한다. 이 커맨드는 package publish, Version Packages PR merge, GitHub Actions workflow trigger/rerun, tag/release 생성을 수행하지 않는다.

## Output contract

최종 보고는 한국어로 작성하고 아래 항목을 포함한다.

```yaml
result: 진행 PR <M>건, 머지 <K>건, 보류 <L>건
lane id: <lane-id>
ledger: .omo/lanes/<lane-id>.json
base branch: <base-branch>
lanes:
  - name: <lane-name>
    status: <status>
    queue: [<issue-number>]
mapping:
  - issue: <issue-number|url>
    PR: <pr-number|url|null>
    branch: <branch|null>
    worktree: <worktree|null>
merge/cleanup/main sync:
  merge: <done|skipped|blocked>
  cleanup: <done|skipped|blocked>
  main sync: <done|skipped|blocked-dirty>
authority scope: <interactive|full-auto scope summary>
retry/remediation: <retry counts and unresolved blocker signatures>
remaining backlog: [<issue-number>]
next recommended step: <text>
```

## Must NOT

- source discovery, issue search, package audit, issue draft, issue creation을 수행하지 않는다.
- `/create-lane`이 확정한 lane queue를 임의 재작성하거나 새 issue를 자동 추가하지 않는다.
- `/search-issue`, `/issue-to-pr`, `/pr-to-merge`의 내부 workflow를 복제하지 않는다.
- package publish, Version Packages PR merge, GitHub Actions workflow trigger/rerun, tag/release 생성을 수행하지 않는다.
- `/issue-to-pr` worker에게 merge/cleanup/issue close를 맡기지 않는다.
- `/pr-to-merge` verdict만으로 merge하지 않는다.
- `block` verdict를 최종 보고 사유로 즉시 사용하지 않는다. 먼저 bounded fix-back loop를 수행한다.
- 여러 lane의 `/issue-to-pr` 완료를 모두 기다리는 global batch barrier를 만들지 않는다. 먼저 끝난 lane item은 즉시 PR collection과 `/pr-to-merge`로 진행한다.
- PR merge 및 linked issue close 확인 없이 worktree/local branch/remote branch를 cleanup하지 않는다.
- `queued`, `running`, `in_review`, non-terminal `blocked` lane이 남아 있는데 최종 보고하지 않는다.
- `--full-auto`에서도 child verdict가 `block` 또는 unresolved `needs-human-check`인 상태로 merge/publish하지 않는다.
- root worktree가 dirty인 상태에서 main sync를 시도하지 않는다.
- 로컬 `npm publish` 또는 `pnpm changeset publish`를 실행하거나 권장하지 않는다.
