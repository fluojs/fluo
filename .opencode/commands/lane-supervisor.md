---
description: lane-supervisor — GitHub issue 묶음을 semantic lane으로 배치하고 /search-to-issue, /issue-to-pr, /pr-to-merge, /package-publish를 조율하는 fluo 상위 오케스트레이션 command harness.
argument-hint: "<문제 설명 | issue 목록 | run-id> [plan|register|execute|auto|resume|execute --full-auto] [base-branch]"
---

# lane-supervisor

이 커맨드는 fluo 저장소의 **상위 orchestration harness**다. issue 발굴, 구현, PR 리뷰, 릴리스 운영의 세부 로직을 직접 재구현하지 않고 아래 child command와 전용 `@fluo-*` agent에 위임한다.

- issue 감사/등록: `/search-to-issue`
- 단일 issue 구현/PR 생성: `/issue-to-pr`
- 단일 PR 중앙 리뷰 gate: `/pr-to-merge`
- Changesets 릴리스 운영 handoff: `/package-publish`

이 커맨드는 question-driven intake, lane planning, ledger, 권한 gate, child command 호출 순서, fix-back/merge/cleanup/main-sync policy만 소유한다. child command의 guardrail을 약화하거나 내부 auditor/reviewer/implementer logic을 복제하지 않는다.

## 사용법

```
/lane-supervisor <문제 설명 | issue 목록 | run-id> [plan|register|execute|auto|resume|execute --full-auto] [base-branch]
```

예시:

- `/lane-supervisor 이 문제를 issue로 나누고 lane별로 진행해줘 execute main`
- `/lane-supervisor 이 문제를 끝까지 자동으로 처리해줘 auto main`
- `/lane-supervisor lane-2026-05-13-a execute --full-auto main`
- `/lane-supervisor 기존 등록된 이슈들로만 이번 세션 진행해줘 plan`
- `/lane-supervisor lane-2026-05-13-a resume main`

지원 mode:

- `plan` — source choice, issue 후보, suggested additions, merge policy, lane 구조만 만든다. issue 생성/PR 생성/merge/cleanup 없음.
- `register` — `/search-to-issue` 또는 existing issue intake로 confirmed issue set을 확정하고, 승인된 issue 등록까지만 수행한다. 구현 시작 없음.
- `execute` — confirmed issue set을 lane에 배정하고 `/issue-to-pr` → `/pr-to-merge` → gated merge/cleanup/main sync까지 조율한다.
- `auto` 또는 `execute --full-auto` — 명시 opt-in full-auto authority로 interactive question gate 없이 source/issue selection, issue creation, PR merge, safe cleanup, fast-forward-only root sync까지 자동 조율한다. 단, child command verdict와 release/publish guardrail은 우회하지 않는다.
- `resume` — `.sisyphus/lane-supervisor/<run-id>.json` ledger를 읽고 마지막 안전 checkpoint부터 재개한다.

base branch 기본값은 `main`이다.

## Interactive intake contract

이 커맨드는 레거시 `lane-supervisor` skill과 동일하게 **질문 기반 intake가 기본 동작**이다. 실행자는 lane planning, issue 등록, worker dispatch, merge decision 전에 반드시 `question` tool로 사용자의 선택을 받는다.

예외는 사용자가 invocation에서 `auto` 또는 `execute --full-auto`를 명시한 경우뿐이다. 이때 full-auto profile이 upfront harness authority로 간주되어 아래 interactive gate를 자동 선택/기록할 수 있다. full-auto는 child command verdict를 override하거나 repository release/publish policy를 약화하지 않는다.

### 반드시 `question` tool을 쓰는 지점

1. **Source choice** — 다음 중 하나를 고르게 한다.
   - `기존 등록된 GitHub 이슈로 진행`
   - `search-to-issue를 먼저 실행`
2. **Search scope** — source가 `search-to-issue`이면 다음 중 하나를 고르게 한다.
   - 특정 package
   - package group
   - all
3. **Existing issue selection** — source가 existing issues이면 read-only issue 목록을 보여준 뒤 다음 중 하나를 고르게 한다.
   - 일부 선택
   - 전부 포함
   - 없음
4. **Suggested additions second pass** — confirmed issue set과 분리해 “같이 진행하면 좋은 issue”를 제안하고, 실제 포함 여부를 다시 묻는다.
5. **Merge policy** — lane planning 전에 다음 중 하나를 고르게 한다.
   - `developer-final`
   - `supervisor-auto`
   - `supervisor-with-human-escalation`

사용자가 invocation 인자에서 source/mode/base branch를 이미 명확히 지정했더라도, side-effect 가능성이 있는 선택(`search-to-issue` issue creation, issue 포함 확정, merge policy, cleanup authority)은 `question` tool을 생략하지 않는다. 단, `resume` mode에서 ledger에 이미 기록된 선택을 재확인하는 경우에는 “기존 선택 유지 / 변경 / 중단” 질문으로 대체할 수 있다. `auto` 또는 `execute --full-auto`는 이 문단의 예외이며, 자동 선택 결과와 근거를 ledger에 남겨야 한다.

## Full-auto authority profile

`auto` 또는 `execute --full-auto`는 기본 interactive contract를 대체하는 **명시 opt-in harness authority mode**다. 사용자가 이 모드를 선택하면 `lane-supervisor`는 중간 질문 없이 끝까지 진행하는 것을 목표로 하며, `needs-human-check`나 반복 fix-back을 terminal stop으로 취급하지 않고 자동 remediation loop로 처리한다.

### Full-auto authority scope

full-auto mode에서는 ledger에 아래 scope를 명시한다.

```yaml
mode: full-auto
authority_scope:
  issue_selection: true
  issue_creation: true
  pr_merge: true
  publish_via_github_actions: true
  cleanup_command_worktrees: true
  root_main_sync_ff_only: true
merge_policy: supervisor-full-auto
retry_policy:
  retry_count_is_terminal: false
  max_same_failure_repeats: 3
  max_wall_clock_minutes: 180
  stop_on_child_contract_error: true
needs_human_check_policy:
  auto_remediate: true
  allowed_actions:
    - gather_more_evidence
    - rerun_reviewers
    - request_fix_back
    - rerun_verification
  merge_requires_final_child_verdict: merge
ledger_required: true
```

### Full-auto behavior

1. **Source/issue selection** — 입력이 issue 목록이면 existing issue path를 선택하고, 문제 설명이면 `search-to-issue` path를 선택한다. scope가 불명확하면 가장 좁은 package/group inference를 먼저 시도하고, 근거가 부족하면 `all` 대신 관련 package cluster만 선택한다.
2. **Issue creation** — `/search-to-issue` draft와 severity summary가 충분하고 중복 issue가 없으면 issue creation authority를 행사할 수 있다. 중복/범위 충돌은 먼저 read-only 재조회로 해소한다.
3. **Merge policy** — `supervisor-full-auto`를 기록한다. 이는 `/pr-to-merge` 최종 verdict가 `merge`이고 checks가 통과한 eligible PR에만 merge authority를 준다.
4. **`needs-human-check` remediation** — `needs-human-check`를 무시하지 않는다. 원인을 분류한 뒤 증거 보강, reviewer 재실행, verification 재실행, 좁은 fix-back 중 하나를 수행한다. 최종 child verdict가 `merge`로 바뀌기 전에는 merge하지 않는다.
5. **Retry policy** — `retry_count >= 3`은 full-auto에서 terminal stop이 아니다. 다만 같은 blocker signature가 3회 반복되거나 child command contract error가 발생하면 자동 scope expansion을 금지하고 다른 remediation action으로 전환한다. wall-clock budget을 초과하면 ledger에 `blocked-budget-exhausted`로 기록한다.
6. **Publish orchestration** — publish/release issue는 반드시 `/package-publish`로 handoff한다. GitHub Actions 기반 publish orchestration만 허용하며 local `npm publish`, `pnpm changeset publish`는 계속 금지한다.
7. **Cleanup/root sync** — command가 만든 worktree/branch이고 PR merge 및 issue close 상태가 확인된 경우에만 cleanup한다. root sync는 root worktree가 clean이고 fast-forward-only가 가능한 경우에만 수행한다.

### Full-auto hard stops

full-auto라도 아래 상황은 자동으로 넘기지 않는다.

- child command verdict가 `block`으로 남아 있거나 unresolved `needs-human-check`인 상태의 merge/publish.
- maintainer policy decision, security disclosure, legal/license 판단처럼 자동 증거 보강으로 결론낼 수 없는 사안.
- release lane policy 위반, local publish 요구, GitHub Actions 외 publish 경로.
- dirty root worktree, non-fast-forward root update, command-owned 여부가 확인되지 않는 worktree/branch cleanup.
- child command contract를 우회하거나 `/search-to-issue`, `/issue-to-pr`, `/pr-to-merge`, `/package-publish` 내부 workflow를 복제하는 행위.

### 권장 `question` 옵션 문구

- Source choice header: `진행 방식`
- Search scope header: `감사 범위`
- Issue selection header: `포함할 이슈`
- Suggested additions header: `추가 이슈`
- Merge policy header: `머지 정책`

질문 전에는 사용자가 이해할 수 있도록 현재 mode, base branch, 확인된 입력, 아직 확정되지 않은 항목을 1-2문장으로 요약한다. 질문 후에는 선택 결과를 ledger의 `source_mode`, `confirmed_issues`, `suggested_but_excluded`, `merge_policy`에 반영한다.

## 권한 경계

1. 이 커맨드는 **mega-agent가 아니다**. package audit, implementation, PR review, release publish 세부 판단은 child command와 전용 agent가 소유한다.
2. `/pr-to-merge`는 read-only verdict gate다. 실제 merge authority는 이 커맨드의 merge policy와 명시 승인 gate를 별도로 통과해야 한다.
3. `/issue-to-pr` worker는 PR 생성까지만 수행한다. worker에게 merge, issue close, branch/worktree cleanup을 허용하지 않는다.
4. `/package-publish` handoff는 Changesets/GitHub Actions-only release boundary를 따른다. 로컬 `npm publish`는 금지한다.
5. GitHub issue creation, PR merge, package publish, worktree/branch cleanup, root `main` sync는 각각 명시 gate를 통과해야 한다.

## Run ledger

상태 추적이 필요한 run은 다음 경로를 사용한다.

```
.sisyphus/lane-supervisor/<run-id>.json
```

권장 compact schema:

```json
{
  "run_id": "lane-2026-05-13-a",
  "mode": "plan|register|execute|full-auto|resume",
  "base_branch": "main",
  "source_mode": "search-to-issue|existing-issues",
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
  "decisions": [],
  "issue_creation_authority": "none|approved",
  "confirmed_issues": [123],
  "suggested_but_excluded": [124],
  "lanes": [
    {
      "name": "foundation",
      "queue": [123],
      "current_issue": 123,
      "status": "queued|running|in_review|blocked|needs-human-check|merged|done",
      "branch": "issue-123-short-title",
      "worktree": ".worktrees/issue-123-short-title",
      "pr": 456,
      "retry_count": 0
    }
  ],
  "dependency_graph": {},
  "completed_issues": [],
  "release_handoffs": [],
  "root_main_sync": { "status": "not-started|done|blocked-dirty", "sha": null }
}
```

`resume`는 ledger의 mode, source_mode, merge_policy, authority_scope, retry_policy, lane status, retry_count, PR/worktree mapping이 현재 repository/GitHub 상태와 충돌하지 않는지 먼저 확인한다. 모순되면 interactive mode에서는 `needs-human-check`로 멈추고, full-auto mode에서는 증거 보강으로 모순 해소를 먼저 시도하되 해소되지 않으면 `blocked-ledger-conflict`로 멈춘다.

## 필수 human gates

lane planning이나 side effect 전에 아래 gate를 순서대로 통과한다.

이 섹션의 gate는 단순 안내 문구가 아니라 `question` tool 기반 stop point다. `question` tool을 사용할 수 없는 런타임이면 side effect를 진행하지 말고, 필요한 선택지를 한국어로 제시한 뒤 사용자 응답을 기다린다. 단, `auto` 또는 `execute --full-auto`는 이 섹션의 interactive stop point를 full-auto authority profile로 대체한다.

1. **Source choice gate** — `기존 등록된 GitHub 이슈로 진행` 또는 `search-to-issue를 먼저 실행` 중 하나를 사용자에게 확인한다.
2. **Source-specific gate**
   - `search-to-issue`: package / package group / all 범위를 확인한 뒤 `/search-to-issue <scope>`를 호출한다. `/search-to-issue`의 severity summary와 사용자 선택 gate 전에는 `gh issue create`를 수행하지 않는다.
   - `existing-issues`: 열린 issue 제목/요약을 read-only로 보여주고 이번 run에 포함할 issue를 사용자에게 선택하게 한다.
3. **Suggested additions gate** — confirmed issue set과 분리해 “같이 진행하면 좋은 issue”만 제안한다. 사용자가 명시 승인하기 전에는 자동 포함하지 않는다.
4. **Merge policy gate** — lane planning 전에 다음 중 하나를 확정한다.
    - `developer-final`: 항상 개발자가 최종 merge/cleanup을 승인한다.
    - `supervisor-auto`: `/pr-to-merge` verdict가 `merge`이고 checks가 통과하면 supervisor가 승인된 범위 내에서 merge를 진행할 수 있다.
    - `supervisor-with-human-escalation`: 기본은 supervisor 판단, `needs-human-check`/release/security/cross-lane ambiguity는 사용자 확인.
    - `supervisor-full-auto`: full-auto mode 전용. `needs-human-check`는 자동 remediation 대상이며, 최종 `merge` verdict와 통과한 checks가 있는 PR만 merge할 수 있다.
5. **`needs-human-check` gate** — `/pr-to-merge`가 `needs-human-check`를 반환하면 즉시 중단하고 사용자 결정을 받는다.
6. **Merge approval gate** — merge policy가 developer approval을 요구하거나 checks가 불완전하면 merge하지 않는다.
7. **Publish handoff gate** — release/publish 자체가 목표인 issue는 `/package-publish <mode> ...`로 넘기고, publish/Version Packages PR merge는 별도 명시 권한 없이는 수행하지 않는다.
8. **Cleanup authority gate** — PR merge와 issue close 상태를 확인하고 cleanup 명시 권한이 있을 때만 `git worktree remove`, branch 삭제, remote branch 삭제를 고려한다.
9. **Dirty root sync stop** — root worktree가 dirty이면 `git pull --ff-only origin <base-branch>`를 시도하지 않고 보고한다.

## Orchestration workflow

### 1. Intake

- 사용자 목표, mode, base branch를 파싱한다.
- 한 번에 unrelated goal이 여러 개면 진행하지 않는다.
- 현재 입력 요약을 한국어로 보고한다.
- `question` tool로 source choice gate를 먼저 실행한다. source choice 없이 lane planning으로 넘어가지 않는다.
- `auto` 또는 `execute --full-auto`이면 `mode = full-auto`, `merge_policy = supervisor-full-auto`, full-auto authority scope를 ledger에 기록하고 source choice를 자동 inference한다.

### 2. Source expansion

#### `search-to-issue` path

1. `question` tool로 감사 scope를 package / group / all 중 하나로 확정한다.
2. `/search-to-issue <scope>`를 호출한다.
3. `/search-to-issue`가 생성한 draft, severity summary, 등록 승인 결과만 받아 confirmed issue set을 만든다.
4. 이 커맨드에서 package auditor logic 또는 issue draft bundling logic을 다시 구현하지 않는다.

#### `existing-issues` path

1. `gh issue list --state open` 등 read-only 조회로 issue 제목/짧은 요약을 보여준다.
2. `question` tool로 이번 run에 포함할 issue를 묻는다.
3. 사용자가 선택한 issue만 confirmed issue set에 넣는다.
4. 선택되지 않은 issue는 suggested additions gate 전까지 자동 포함하지 않는다.

### 3. Suggested additions

confirmed issue set 기준으로 아래 조건 중 하나 이상을 만족하는 issue만 별도 제안한다.

- 같은 파일/package surface를 강하게 공유한다.
- 같은 root cause 또는 fix theme를 공유한다.
- 같은 lane에서 같이 처리하지 않으면 충돌 가능성이 높다.

제안은 confirmed issue와 분리해 표시하고, `question` tool로 second-pass 승인을 받은 항목만 ledger의 `confirmed_issues`에 추가한다. 거절분은 `suggested_but_excluded`에 기록한다.

### 4. Merge policy

`question` tool로 merge policy를 확정하고 ledger에 기록한다. 확정 전에는 lane planning, `/issue-to-pr`, `/pr-to-merge`, merge decision을 시작하지 않는다. full-auto mode에서는 `supervisor-full-auto`를 자동 확정하고 결정 근거를 `decisions`에 기록한다.

### 5. Preflight

safe static/read-only checks만 먼저 수행한다.

- `gh label list`
- `gh issue list --state open`
- root worktree status 확인
- base branch 존재 확인
- relevant docs/contract guardrails 존재 확인: `CONTRIBUTING.md`, `docs/contracts/behavioral-contract-policy.md`, `.github/PULL_REQUEST_TEMPLATE.md`

### 6. Lane planning

confirmed issue를 semantic lane에 배정한다. lane identity는 `session_id`가 아니라 logical ownership이다.

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

1. 한 lane은 동시에 issue 1개만 실행한다.
2. 같은 파일/package/surface를 강하게 건드리는 issue는 같은 lane에 넣는다.
3. dependency가 있으면 같은 lane에 연속 배치하거나 선행 issue merge 후 unlock한다.
4. ordering은 `priority:p0` > `priority:p1` > `priority:p2`, `wave:1` > `wave:2` > `wave:3`, 기반 레이어, 계약 리스크, 공통 기반 순서로 정한다.

### 7. Worker dispatch

각 unlocked lane의 첫 issue에 대해 `/issue-to-pr <issue-number|url> <base-branch>`를 호출한다.

worker prompt에는 반드시 다음을 포함한다.

```md
Use /issue-to-pr for this issue.
Rules:
- fresh dedicated worktree only under .worktrees/
- respect existing docs/contract guardrails
- create PR only; do not merge, close issue, push cleanup, or remove worktree/branch
- report issue, branch, worktree, PR URL, verification summary, remaining risks
```

`@fluo-issue-implementer` 또는 fallback executor 위임 여부는 `/issue-to-pr`가 결정한다.

### 8. PR collection

worker 결과에서 다음을 수집해 ledger에 기록한다.

- issue number / URL
- PR number / URL
- branch
- worktree path
- verification summary
- remaining risks

lane status는 `queued -> running -> in_review`로만 전이한다. PR URL이 없거나 verification summary가 불명확하면 `needs-human-check`로 멈춘다.

### 9. Central review gate

PR마다 `/pr-to-merge <pr-url|number> <linked-issue> <base-branch>`를 호출한다.

`/pr-to-merge`는 `@fluo-contract-reviewer`, `@fluo-code-reviewer`, `@fluo-verification-reviewer`를 호출하는 read-only gate이며, 이 커맨드는 그 내부 리뷰 logic을 복제하지 않는다.

허용 verdict는 정확히 다음 셋이다.

```
merge | block | needs-human-check
```

### 10. Bounded fix-back loop

`/pr-to-merge` verdict가 `block`이면 같은 branch / 같은 worktree / 같은 PR로 fix-back을 지시한다. 새 PR을 만들지 않는다.

- `retry_count`는 PR/lane별로 증가한다.
- `retry_count <= 2`: 같은 `/issue-to-pr` worker 컨텍스트에 좁은 blocker 해결만 재지시한다.
- `retry_count >= 3`: 자동 반복을 멈추고 `needs-human-check`로 escalate 한다.

full-auto mode에서는 `retry_count >= 3`만으로 멈추지 않는다. 대신 blocker signature를 기록하고 같은 signature가 `retry_policy.max_same_failure_repeats`를 초과하면 다른 remediation action으로 전환한다. child command contract error, maintainer-only decision, wall-clock budget 초과는 `blocked-*` 상태로 멈춘다.

fix-back prompt는 blocker 목록, 금지된 scope expansion, 기존 PR URL, 기존 worktree/branch를 포함해야 한다.

### 10-A. Full-auto `needs-human-check` loop

full-auto mode에서 `/pr-to-merge` 또는 child command가 `needs-human-check`를 반환하면 아래 순서로 자동 처리한다.

1. `needs-human-check` 원인을 intent gap, CI/evidence gap, security/release ambiguity, cross-lane ambiguity, maintainer-only decision으로 분류한다.
2. intent/CI/evidence gap이면 GitHub/CI/docs/ledger를 read-only로 재수집하고 `/pr-to-merge`를 재실행한다.
3. 코드/테스트 보강이 필요한 gap이면 같은 `/issue-to-pr` worker 컨텍스트에 좁은 fix-back을 지시한다.
4. release ambiguity이면 `/package-publish plan|resume`로 handoff해 GitHub Actions/Changesets 경로에서만 해소한다.
5. maintainer-only decision이면 full-auto라도 `blocked-maintainer-decision`으로 멈추고 merge/publish하지 않는다.

### 11. Merge gate

아래 조건을 모두 만족할 때만 merge를 고려한다.

1. `/pr-to-merge` verdict가 `merge`다.
2. merge policy가 supervisor merge를 허용하거나 사용자가 해당 PR merge를 명시 승인했다.
3. CI/checks/diagnostics/tests/build/typecheck가 해당 변경 성격에 맞게 실제 통과했다.
4. dependency graph 상 선행 issue가 merge 완료 상태다.

조건이 하나라도 부족하면 `needs-human-check` 또는 `blocked`로 보고하고 merge하지 않는다.

### 12. Release handoff

confirmed issue가 package release 준비/배포 자체를 다루거나 Version Packages PR/publish workflow 판단이 핵심이면 `/issue-to-pr` 대신 또는 merge 이후에 `/package-publish <plan|add-changeset|version|publish|resume> ...`로 handoff한다.

handoff payload에는 target package, target version, dist-tag, release_prerelease, pending changeset, Version Packages PR 상태, lane ledger run-id를 포함한다. `/package-publish` ledger인 `.sisyphus/package-publish/<run-id>.json`은 lane ledger와 합치지 않는다.

### 13. Cleanup

merge 확인 후, cleanup authority gate가 명시적으로 통과한 경우에만 아래 순서로 진행한다.

1. PR merge state 확인
2. linked issue close state 확인
3. `git worktree remove --force <worktree>`
4. local branch 삭제
5. remote branch 삭제

명시 권한이 없으면 cleanup status를 `skipped — authority required`로 남긴다. full-auto mode에서는 `authority_scope.cleanup_command_worktrees = true`가 cleanup 명시 권한으로 간주되지만, command-owned worktree/branch 확인은 여전히 필수다.

### 14. Main sync

root worktree가 clean이면 `git pull --ff-only origin <base-branch>`를 고려한다. dirty이면 sync를 중단하고 `root_main_sync.status = blocked-dirty`로 기록한다. full-auto mode에서도 non-fast-forward update는 금지한다.

### 15. Continue / finish

각 lane에서 다음 unlocked issue를 선택한다. 더 이상 실행할 issue가 없으면 lane을 `done` 처리한다. interactive mode에서는 모든 lane이 `done`, `blocked`, 또는 `needs-human-check` terminal state이면 최종 보고를 작성한다. full-auto mode에서는 unresolved `needs-human-check`를 먼저 remediation loop로 되돌리고, 해소 불가능한 경우 `blocked-*`로 최종 보고한다.

## Output contract

모든 사용자-facing 출력은 한국어로 작성한다. Raw command output은 번역하지 않는다.

최종 보고에는 다음을 포함한다.

```yaml
result: 생성 이슈 <N>건, 진행 PR <M>건, 머지 <K>건, 보류 <L>건
source mode: search-to-issue | existing-issues
merge policy: developer-final | supervisor-auto | supervisor-with-human-escalation | supervisor-full-auto
ledger: .sisyphus/lane-supervisor/<run-id>.json
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

- interactive mode에서 Source choice 질문 없이 `search-to-issue` 또는 existing issue path를 임의 선택하지 않는다.
- interactive mode에서 `question` tool을 생략하고 source choice, suggested additions, merge policy를 임의 확정하지 않는다.
- interactive mode에서 Suggested issue를 second-pass 승인 없이 confirmed issue set에 넣지 않는다.
- Merge policy 없이 lane planning, `/issue-to-pr`, `/pr-to-merge`, merge decision으로 넘어가지 않는다.
- full-auto mode가 아닌데 `supervisor-full-auto` authority를 행사하지 않는다.
- `/search-to-issue`, `/issue-to-pr`, `/pr-to-merge`, `/package-publish`의 내부 workflow를 verbatim 복제하지 않는다.
- `/pr-to-merge` verdict만으로 merge하지 않는다.
- `/issue-to-pr` worker에게 merge/cleanup/issue close를 맡기지 않는다.
- interactive mode에서 retry_count 3회 이상 자동 fix-back을 계속하지 않는다.
- full-auto mode에서 child verdict가 `block` 또는 unresolved `needs-human-check`인 상태로 merge/publish하지 않는다.
- root worktree가 dirty인 상태에서 main sync를 시도하지 않는다.
- 명시 권한 없이 issue creation, PR merge, publish, cleanup을 수행하지 않는다.
