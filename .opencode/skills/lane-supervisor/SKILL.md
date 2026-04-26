---
name: lane-supervisor
description: fluo 저장소에서 문제를 GitHub issue 단위로 정리하고, lane별로 issue-to-pr를 배정한 뒤, pr-to-merge 기반 중앙 리뷰 게이트와 merge/cleanup/main sync까지 관리하는 repo-local 오케스트레이션 스킬.
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: git-workflow
  mode: orchestration
  no_co_author: true
  argument-hint: "<문제 설명 | 이슈 집합> [plan|register|execute|resume] [base-branch]"
---

# Lane Supervisor Workflow

fluo 저장소에서 여러 문제를 GitHub issue 단위로 쪼개고, 각 issue를 lane별로 병렬/직렬 배치해 `issue-to-pr`로 실행한 뒤, `pr-to-merge` 기반 중앙 리뷰 게이트와 merge/cleanup/main sync까지 관리하는 repo-local 오케스트레이션 스킬이다.

이 스킬은 **질문 기반 intake**, **repo-local `search-to-issue`**, **repo-local `issue-to-pr`**, **repo-local `pr-to-merge`**, 그리고 fluo의 supervised-auto 운영 규칙을 반영한 repo-local 오케스트레이터다.

## Scope

- 문제를 실행 가능한 GitHub issue 묶음으로 정리한다.
- 각 issue를 semantic lane에 배정한다.
- lane별로 `issue-to-pr`를 실행한다.
- PR이 생기면 `pr-to-merge`를 중앙 게이트로 사용해 merge/block/needs-human-check를 판단한다.
- merge policy에 따라 머지/cleanup/main sync까지 이어간다.

이 스킬은 다음 상황에 사용한다.

- "이 문제를 여러 issue로 나눠서 끝까지 처리해"
- "lane 나눠서 병렬로 진행해"
- "search-to-issue 먼저 하고 그 결과로 진행해"
- "기존 GitHub issue들만 골라서 lane으로 진행해"

다음 상황에는 사용하지 않는다.

- 단일 trivial 이슈 하나만 처리하면 되는 경우
- 단순 코드 설명/리뷰만 필요한 경우
- 사용자가 issue 생성/머지 같은 외부 사이드이펙트를 전혀 원하지 않는 경우

## Repository-Specific Assumptions

이 저장소에서는 다음을 전제로 한다.

1. 기본 base branch는 `main`이다.
2. issue 발굴/등록은 repo-local `search-to-issue`를 사용한다.
3. 단일 issue 구현/PR 생성은 repo-local `issue-to-pr`를 사용한다.
4. PR 중앙 리뷰 게이트는 repo-local `pr-to-merge`를 사용한다.
5. worktree canonical path는 `.worktrees/`다.
6. merge 판단은 merge policy와 `pr-to-merge` verdict를 함께 따른다.
7. 패키지 릴리스 준비/배포는 repo-local `package-publish`가 담당하며, root `CHANGELOG.md`와 `tooling/release/intents/*.json` release intent record를 source of truth로 본다.

## Authority Boundary

- 이 스킬은 **오케스트레이션만** 담당한다.
- issue 발굴/등록은 `search-to-issue`, 구현/PR 생성은 `issue-to-pr`, PR verdict는 `pr-to-merge`, 패키지 배포는 `package-publish`의 책임이다.
- child skill의 guardrail을 우회하지 않는다.

## Language Policy

- 이 스킬이 사용자에게 직접 보여주는 모든 문구는 한국어로 작성한다.
- All user-facing communication produced while using this skill must be written in Korean.
- GitHub URL, 브랜치명, 파일 경로, 패키지명, 라벨, 명령어, 코드 식별자, 저장소 고정 문자열은 원문을 유지한다.
- Raw command output, log output, quoted source text는 번역하지 않는다. 필요하면 별도로 한국어 설명을 붙인다.

## Core Model

### 1. lane은 session이 아니라 논리적 소유권이다

- `foundation lane`, `runtime lane`, `infra-messaging lane`, `docs lane`처럼 목적이 드러나는 lane 이름을 사용한다.
- subagent `session_id`는 재사용되면 좋지만, lane identity의 근거가 아니다.
- session이 끊겨도 `lane -> issue -> branch/worktree/PR` 매핑만 있으면 복구할 수 있어야 한다.

### 2. worker는 PR 생성까지만

- lane worker는 반드시 `issue-to-pr`를 사용한다.
- worker는 **PR 생성까지만** 허용한다.
- merge/close/cleanup은 중앙 reviewer 단계 이후에만 한다.

### 3. merge는 policy-driven supervisor gate다

- `pr-to-merge`가 먼저 verdict를 낸다.
- merge policy가 허용하고, `pr-to-merge` verdict가 `merge`일 때만 supervisor가 머지를 진행한다.
- `block`은 fix-back loop로, `needs-human-check`는 사용자 확인으로 간다.

## Modes

### `plan`
- scope, issue set, lane 구조, merge policy만 정리한다.
- issue 등록/실행은 하지 않는다.

### `register`
- search-to-issue 또는 existing issue intake를 통해 issue set을 확정하고, 필요한 issue만 등록한다.
- 실행은 시작하지 않는다.

### `execute`
- intake → issue 확정 → lane 배정 → worker dispatch → review/merge/cleanup까지 진행한다.

### `resume`
- 기존 run ledger를 읽고 중단된 위치부터 재개한다.

## Required Persistent State

반드시 run ledger를 유지한다. 권장 경로:

- `.sisyphus/lane-supervisor/<run-id>.json`

최소 필드:

```json
{
  "run_id": "lane-2026-04-16-a",
  "mode": "execute",
  "base_branch": "main",
  "source_mode": "search-to-issue",
  "merge_policy": "supervised-auto",
  "issue_creation_authority": "approved",
  "confirmed_issues": [1134, 1135],
  "suggested_but_excluded": [1138],
  "lanes": [
    {
      "name": "foundation",
      "queue": [1134, 1135],
      "current_issue": 1134,
      "status": "in_review",
      "branch": "issue-1134-vitest-worker-timeout-attribution",
      "worktree": ".worktrees/issue-1134-vitest-worker-timeout-attribution",
      "pr": 1139,
      "retry_count": 1
    }
  ],
  "dependency_graph": {
    "1135": [1134]
  },
  "completed_issues": [1134],
  "root_main_sync": {
    "status": "done",
    "sha": "abc123"
  }
}
```

## Question-Driven Intake

이 스킬은 **lane planning 전에 반드시 질문 기반 intake를 끝낸다.**

### Question 1 — Source choice

먼저 다음 둘 중 무엇으로 진행할지 묻는다.

- `기존 등록된 GitHub 이슈로 진행`
- `search-to-issue를 먼저 실행`

### Question 2A — search-to-issue scope path

`search-to-issue`를 고른 경우에는, repo-local `search-to-issue` 흐름을 먼저 진행한다.

반드시 아래를 묻는다.

- 특정 패키지들만 할지
- 특정 패키지 그룹만 할지
- 전체 패키지를 대상으로 할지

그 후 `search-to-issue`가 issue 초안과 severity summary를 만든 뒤, 사용자 승인/등록 과정을 거친다.

### Question 2B — existing-issue selection path

기존 등록된 이슈로 진행을 고른 경우에는 다음을 수행한다.

1. 열린 GitHub issue의 **제목 + 짧은 요약**을 리스트업한다.
2. 이번 run에 포함할 issue를 묻는다.
   - 일부 선택
   - 전부 포함
   - 없음

### Question 3 — suggested issue second pass

초기 confirmed issue set이 정해진 뒤에는, 사용자가 선택하지 않았더라도 **이번 세션에 같이 진행해야 할만한 issue**를 한 번 더 제안한다.

- 반드시 `question` 도구를 사용한다.
- suggested issue는 confirmed issue와 분리해 보여준다.
- 사용자가 다시 확인하기 전에는 자동으로 포함하지 않는다.
- suggested issue 제안 기준은 최소 다음 중 하나를 만족해야 한다.
  - 같은 파일/패키지 표면을 강하게 공유한다.
  - 같은 root cause/fix theme를 공유한다.
  - 같은 lane에서 같이 처리하지 않으면 다시 충돌할 가능성이 높다.

### Question 4 — merge policy

lane planning 전에 반드시 merge policy를 묻는다.

기본 선택지는 다음 셋을 권장한다.

- `항상 개발자가 최종 결정`
- `항상 supervisor가 판단`
- `기본은 supervisor, 필요할 때만 개발자 확인`

merge policy가 확정되기 전에는 lane planning이나 `pr-to-merge` 기반 merge decision으로 넘어가지 않는다.

## Workflow

### Phase 1 — Intake

1. 사용자의 목표를 파악한다.
2. mode를 결정한다.
3. Question 1로 source choice를 받는다.

### Phase 2 — Source expansion

#### A. `search-to-issue` path
1. package / group / all 범위를 묻는다.
2. repo-local `search-to-issue`를 실행한다.
3. search-to-issue의 승인/등록 흐름을 끝낸다.
4. 등록된 issue들을 confirmed issue set으로 사용한다.

#### B. `existing issues` path
1. 열린 GitHub issue들의 제목/요약을 보여준다.
2. 포함할 issue를 고르게 한다.
3. 선택된 issue들을 confirmed issue set으로 사용한다.

### Phase 3 — Suggested additions gate

1. confirmed issue set을 바탕으로 “같이 진행하면 좋은 이슈”를 제안한다.
2. 반드시 `question` 도구로 **정말 포함할 건지** 다시 확인한다.
3. 승인된 것만 confirmed issue set에 추가한다.

### Phase 4 — Merge policy gate

1. merge policy를 질문한다.
2. policy를 ledger에 기록한다.

### Phase 5 — Preflight

1. `gh label list`, `gh issue list --state open`으로 GitHub 상태를 확인한다.
2. 루트 worktree 상태를 확인한다.
3. `base_branch`가 유효한지 확인한다.

### Phase 6 — Lane Planning

confirmed issue set을 lane에 배정한다.

기본 원칙:
1. 한 lane에는 동시에 한 issue만 넣는다.
2. 같은 파일/패키지/표면을 강하게 건드리는 이슈는 같은 lane으로 묶는다.
3. 의존성이 있는 issue는 같은 lane에 연속 배치하거나 선행 lane merge 후 unlock 한다.

기본 ordering 규칙:
1. `priority:p0` > `priority:p1` > `priority:p2`
2. `wave:1` > `wave:2` > `wave:3`
3. 기반 레이어 우선
4. 계약 리스크 큰 것 우선
5. 같은 우선순위면 공통 기반 이슈 우선

### Phase 7 — Dispatch

각 lane에 대해:
1. dependency가 모두 해소된 첫 issue를 선택한다.
2. `issue-to-pr`를 배경 worker로 실행한다.
3. 프롬프트에는 반드시 아래를 명시한다.
   - fresh worktree only
   - existing docs/contract guardrails 준수
   - PR 생성까지만, merge/close/cleanup 금지
   - 검증 결과 요약 보고

### Phase 8 — PR Collection

worker가 PR을 만들면 다음 상태로 전환한다.

- `queued` → `running`
- `running` → `in_review`

수집해야 할 정보:
- issue 번호
- PR 번호 / URL
- branch
- worktree 경로
- 검증 요약
- 남은 리스크

### Phase 9 — Central Review Gate (`pr-to-merge`)

PR이 생기면 반드시 repo-local `pr-to-merge`를 호출한다.

- 입력:
  - PR URL/번호
  - linked issue
  - base branch
- 출력:
  - `merge`
  - `block`
  - `needs-human-check`

### Phase 10 — Fix-back Loop

`pr-to-merge` verdict가 `block`이면:

1. 같은 branch / 같은 worktree / 같은 PR로 되돌려 보낸다.
2. 새 PR를 만들지 않는다.
3. fix 범위를 명확하게 좁혀서 지시한다.
4. `retry_count += 1`

기본 정책:
- 1~2회는 정상 수정 루프
- 3회 실패 시 자동 반복을 멈추고 사용자에게 escalate

### Phase 11 — Merge Gate

다음 조건을 모두 만족해야 머지한다.

1. `pr-to-merge` verdict가 `merge`
2. merge policy가 supervisor merge를 허용함
3. 관련 checks/diagnostics/tests/build/typecheck가 실제로 통과함
4. dependency graph 상 선행 issue merge 완료

`needs-human-check`이거나 merge policy가 개발자 승인을 요구하면 여기서 멈추고 사용자에게 묻는다.

### Phase 11.5 — Release handoff

- confirmed issue가 패키지 릴리스 준비/배포 자체를 다루는 경우에는 `issue-to-pr` 대신 `package-publish` handoff를 고려한다.
- `1.0.0-beta.2` 이상 후보 릴리스는 release intent record가 필요하므로, handoff에는 target package, target version, dist-tag, release_prerelease, release_intent_file 여부를 포함한다.
- Changesets/Beachball 기반 version PR이나 local publish 흐름으로 우회하지 않는다.
- lane ledger와 package-publish ledger를 하나로 합치지 않는다.
- package publish run state는 `package-publish`가 source of truth를 가진다.

### Phase 12 — Cleanup

merge 확인 후에만:
1. PR merge state 확인
2. issue close state 확인
3. `git worktree remove --force <worktree>`
4. `git branch -D <branch>`
5. remote branch 삭제

### Phase 13 — Main Sync

1. 루트 worktree가 clean인지 먼저 확인한다.
2. clean이면 `git pull --ff-only origin <base_branch>`
3. dirty면 sync를 중단하고 사용자에게 보고한다.

### Phase 14 — Continue / Finish

1. lane queue에서 다음 unlocked issue를 선택한다.
2. 없으면 해당 lane을 `done` 처리한다.
3. 모든 lane이 `done`이면 전체 run을 종료한다.
4. 마지막에 생성/머지/보류/실패/남은 이슈를 정리해 보고한다.

## Mandatory Rules

- 사용자-facing 문구는 모두 한국어로 작성한다.
- source choice 질문 없이 바로 lane planning으로 가지 않는다.
- `search-to-issue` path와 `existing issues` path를 한 풀로 섞지 않는다.
- suggested issue는 second-pass 질문 없이 자동 포함하지 않는다.
- merge policy를 확정하기 전에는 merge 판단 단계로 가지 않는다.
- lane identity는 semantic lane name으로 관리하고 `session_id`에 의존하지 않는다.
- `issue-to-pr`는 반드시 PR 생성까지만 허용한다.
- `pr-to-merge`는 반드시 read-only verdict gate로만 사용한다.
- 루트 worktree가 dirty이면 `main` sync를 시도하지 않는다.
- worktree cleanup은 merge 확인 후에만 한다.

## Recommended Lane Naming

- `foundation`
- `docs`
- `cli`
- `runtime`
- `auth`
- `persistence`
- `infra-messaging`
- `protocol-adapters`
- `request-pipeline`

## Human Stop Points

최소한 다음 지점은 명시적인 stop point다.

1. `search-to-issue` 등록 전
2. existing issue 선택 후 suggested issue 추가 전
3. merge policy 확정 전
4. `pr-to-merge` verdict가 `needs-human-check`일 때
5. merge policy가 개발자 승인을 요구할 때
6. retry_count 3회 초과 시
7. root dirty 상태에서 main sync 직전

## Output Contract

매 단계 요약은 한국어로 짧고 명확하게 보고한다.

최종 보고에는 다음을 포함한다.

- `result: 생성 이슈 N건, 진행 PR M건, 머지 K건, 보류 L건`
- source mode (`search-to-issue` 또는 `existing issues`)
- merge policy
- lane별 상태 표
- issue → PR → branch/worktree 매핑 요약
- merge/cleanup/main sync 완료 여부
- 남은 backlog와 다음 권장 순서

## Example Prompts

- `/lane-supervisor 이 문제를 issue로 나누고 lane별로 진행해줘`
- `/lane-supervisor 기존 등록된 이슈들로만 이번 세션 진행해줘`

## Must NOT

- source choice 질문 없이 search/existing issue를 임의 선택하지 않는다.
- suggested issue를 확인 없이 plan에 집어넣지 않는다.
- merge policy 없이 `pr-to-merge` verdict만으로 머지하지 않는다.
- `issue-to-pr` / `search-to-issue` / `pr-to-merge`의 contract guardrail을 약화시키지 않는다.
- discovery, execution, merge를 완전 블랙박스로 한 번에 처리하지 않는다.
