---
name: issue-to-pr
description: fluo 저장소의 GitHub issue를 전용 worktree에서 해결하고, fluo 거버넌스와 PR 템플릿을 지키는 PR까지 생성하는 repo-local 실행 스킬.
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: git-workflow
  mode: execution
  no_co_author: true
  argument-hint: "<github-issue-link> [base-branch]"
---

# Issue-to-PR Workflow

fluo 저장소의 GitHub issue를 전용 worktree에서 해결하고, fluo의 behavioral contract / release / testing 거버넌스를 지키는 PR까지 생성하는 repo-local 실행 스킬이다.

이 스킬은 **fluo의 `.worktrees/` 관례, package README contract, PR template, split CI/test governance, release-readiness contract**를 반영한 repo-local 실행 스킬이다.

## Scope

- GitHub issue 1개를 기준으로 전용 branch/worktree를 만든다.
- 해당 이슈를 해결하는 변경을 만든다.
- 필요한 docs/tests를 함께 맞춘다.
- PR을 생성한다.
- 사용자가 명시적으로 요청하지 않으면 merge/cleanup까지 자동으로 진행하지 않는다.

이 스킬은 다음 상황에 사용한다.

- "이 이슈 해결해서 PR 만들어줘"
- "issue-to-pr로 이슈 하나 처리해줘"
- "이 브랜치 대상으로 PR만 열어줘"

다음 상황에는 사용하지 않는다.

- 추상적인 리팩터링 제안
- 여러 이슈를 한 번에 처리하는 오케스트레이션
- 단순 조사/리뷰만 필요한 경우

## Repository-Specific Assumptions

이 저장소에서는 다음 규칙을 전제로 한다.

1. 기본 base branch는 `main`이다.
2. worktree canonical path는 `.worktrees/`다.
3. package/runtime 변경은 `README.md`와 behavioral contract를 binding contract로 본다.
4. PR body는 `.github/PULL_REQUEST_TEMPLATE.md`의 축을 실질적으로 채워야 한다.
5. release/tooling/CI 관련 변경은 `docs/contracts/release-governance.md`, `docs/contracts/testing-guide.md`와 정합해야 한다.
6. 패키지 버전업/배포 준비 자체는 root `CHANGELOG.md`와 `tooling/release/intents/*.json` release intent record를 함께 다룬다.
7. `1.0.0-beta.2` 이상 후보 릴리스는 release intent record가 필요하며, Changesets/Beachball은 현재 승인된 릴리스 경로가 아니다.

## Authority Boundary

- 이 스킬은 기본적으로 **issue -> PR 생성**까지만 담당한다.
- merge authority가 명시적으로 주어지지 않으면 merge/cleanup까지 자동 진행하지 않는다.
- 중앙 merge 판단은 `pr-to-merge` 또는 상위 supervisor의 책임이다.

## Language Policy

- 이 스킬이 사용자에게 직접 보여주는 모든 문구는 한국어로 작성한다.
- All user-facing communication produced while using this skill must be written in Korean.
- GitHub URL, 브랜치명, 파일 경로, 패키지명, 라벨, 명령어, workflow 이름, 코드 식별자는 원문을 유지한다.
- Raw command output, log output, quoted source text는 번역하지 않는다. 필요하면 별도로 한국어 설명을 붙인다.

## Workflow

### 1. Resolve target
- 입력은 보통 GitHub issue URL 1개와 optional base branch다.
- base branch 기본값은 `main`이다.
- 사용자 지정 branch가 있으면 그 branch를 대상으로 PR을 연다.
- issue 번호를 URL에서 추출한다.

### 2. Prepare issue context
- `gh issue view <issue-url>`로 title/body/URL을 읽는다.
- 현재 local repo remote가 해당 issue repo와 일치하는지 확인한다.

### 3. Discover fluo change rules before implementation
반드시 다음 우선순위로 문서를 읽고 영향을 파악한다.

1. 공통 문서
   - `CONTRIBUTING.md`
   - `docs/contracts/behavioral-contract-policy.md`
   - `.github/PULL_REQUEST_TEMPLATE.md`

2. 패키지/모듈 문서
   - 영향받는 `packages/*/README.md`
   - 필요시 `README.ko.md`

3. 주제별 보강 문서
   - release / publish / CLI / tooling 관련 변경:
      - `docs/contracts/release-governance.md`
      - `docs/contracts/testing-guide.md`
      - `tooling/release/intents/README.md`
      - `docs/reference/toolchain-contract-matrix.md`
   - public API / docs contract 관련 변경:
      - `docs/contracts/public-export-tsdoc-baseline.md`
   - platform/runtime 계약 관련 변경:
      - `docs/contracts/platform-conformance-authoring-checklist.md`

### 4. Create branch in dedicated worktree
- 먼저 remote 상태를 갱신한다: `git fetch origin`
- branch name pattern: `issue-<number>-<short-title>`
- worktree path는 반드시 `.worktrees/<branch-name>` 규칙을 따른다.
- 예:
  - `REPO_ROOT="$(git rev-parse --show-toplevel)"`
  - `WORKTREE_PATH="${REPO_ROOT}/.worktrees/${BRANCH_NAME}"`
- 생성 규칙:
  - `git worktree add -b "${BRANCH_NAME}" "${WORKTREE_PATH}" "origin/${BASE_BRANCH}"`
  - local-only base branch면 `origin/${BASE_BRANCH}` 대신 `${BASE_BRANCH}` 사용

### 5. Implement in the worktree
- worktree로 이동해서 수정한다.
- 변경 전에 문서화된 contract가 무엇인지 다시 확인한다.
- 구현 변경과 함께 docs/tests도 같이 맞춘다.

다음 원칙을 따른다.

- runtime behavior가 바뀌면 package README/docs를 같은 PR에 포함한다.
- documented limitation은 issue가 명시하지 않는 이상 조용히 없애지 않는다.
- contract-affecting change는 regression test를 반드시 포함한다.
- release/tooling/CI 계약을 바꾸면 related docs와 governance checks를 같이 맞춘다.
- 패키지 릴리스 준비 PR이면 `package.json` version, root `CHANGELOG.md`, `tooling/release/intents/*.json`, `pnpm verify:release-readiness --target-package ... --target-version ... --dist-tag ...`를 같은 릴리스 단위로 맞춘다.
- `downstream-evaluate`는 자동 publish 트리거가 아니라 명시적 review decision으로 취급한다.
- `Co-Authored-By` trailer를 절대 넣지 않는다.

### 6. Verification before PR
- changed files 대상 diagnostics를 확인한다.
- 관련 tests/build/typecheck를 실행한다.
- 변경 성격에 따라 가장 가까운 canonical verifier를 고른다.

예:
- 일반 코드 변경: `pnpm verify` 또는 관련 package test/build/typecheck
- docs/governance 변경: `pnpm verify:platform-consistency-governance`
- release/publish/tooling 변경: `pnpm verify:release-readiness`
- 단건 패키지 릴리스 준비: `pnpm verify:release-readiness --target-package <pkg> --target-version <version> --dist-tag <tag>` 및 필요 시 `--release-intent-file <path>`
- public export docs 변경: `pnpm lint` 및 필요시 `pnpm verify:public-export-tsdoc:baseline`

### 7. Commit
- branch 위에 명확한 커밋을 만든다.
- co-author metadata를 넣지 않는다.
- 저장소의 최근 커밋 스타일과 language를 따른다.

### 8. Open PR
- 대상 branch로 PR을 생성한다.
- PR 제목은 `Resolve #<number>:`로 시작한다.
- PR body에는 반드시 `Closes #<number>`를 포함한다.
- `.github/PULL_REQUEST_TEMPLATE.md`의 축을 반영해 다음을 요약한다.
  - Summary
  - Changes
  - Testing
  - Public export documentation
  - Behavioral contract
  - Platform consistency governance (필요 시)

### 9. Merge / close / cleanup
- 이 스킬은 기본적으로 PR 생성까지만을 보장한다.
- 사용자가 merge까지 명시적으로 요청한 경우에만 merge/close/cleanup을 진행한다.
- merge 후에만 worktree/branch/remote branch 정리를 수행한다.

### 10. Report
- 최종 보고에는 다음을 포함한다.
  - linked issue
  - branch name
  - base branch
  - worktree path
  - PR URL
  - 검증 요약
  - cleanup 여부

## behavioral contract guardrail

fluo에서 package/runtime/tooling behavior는 문서 경계의 일부다.

- affected package `README.md`를 먼저 읽는다.
- `docs/contracts/behavioral-contract-policy.md`를 binding policy로 취급한다.
- documented supported behavior를 silent narrowing 하지 않는다.
- behavior가 바뀌면 docs/test를 같은 PR에 포함한다.
- release/tooling contract를 바꾸면 `release-governance`와 `testing-guide`도 함께 확인한다.
- release intent가 필요한 버전에서 `tooling/release/intents/*.json` 갱신이 빠졌으면 PR 생성 전에 보완한다.

## Mandatory Rules

- 모든 사용자-facing 문구는 한국어로 작성한다.
- default base branch는 `main`이다.
- branch는 반드시 그 base branch에서 만든다.
- 구현은 반드시 git worktree 안에서 격리한다.
- `.worktrees/` 경로 규칙을 사용한다.
- affected package README와 공통 거버넌스 문서를 읽기 전에는 구현하지 않는다.
- `Co-Authored-By` metadata를 넣지 않는다.
- PR body에는 반드시 `Closes #<number>`를 넣는다.
- `.github/PULL_REQUEST_TEMPLATE.md` 축을 무시한 빈 PR body를 만들지 않는다.
- merge 전에는 checks/diagnostics/tests가 실제로 통과했는지 확인한다.

## Output Contract

- `result: PR 생성 완료`를 기본값으로 한다.
- merge가 명시적으로 요청되고 실제로 수행된 경우에만 `result: PR 생성 및 머지 완료`를 사용한다.
- linked issue
- branch
- base branch
- worktree
- PR URL
- verification summary
- cleanup status

## Example Prompts

- `/issue-to-pr https://github.com/fluojs/fluo/issues/123`
- `https://github.com/fluojs/fluo/issues/123 해결해서 PR 만들어줘`

## Must NOT

- PR 생성을 생략하지 않는다.
- `main` 또는 사용자 지정 branch가 아닌 곳으로 머지하지 않는다.
- 다른 issue를 닫지 않는다.
- 문서화된 runtime behavior를 조용히 지우지 않는다.
- docs/test가 필요한 변경에서 코드만 바꾸고 끝내지 않는다.
- `Co-Authored-By` trailer를 commit message에 넣지 않는다.
