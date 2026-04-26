---
name: package-publish
description: fluo 저장소에서 Changesets 기반 공개 패키지 릴리스 준비와 GitHub Actions 기반 npm publish를 일관되게 관리하는 릴리스 오퍼레이션 스킬.
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: release-operations
  mode: execution
  no_co_author: true
  argument-hint: "<mode> [options] — mode: plan|add-changeset|version|publish|status|resume"
---

# Package Publish Workflow

fluo 저장소에서 Changesets 기반 공개 패키지 릴리스 준비와 GitHub Actions 기반 npm publish까지 일관되게 관리하는 패키지 릴리스 오퍼레이션 스킬이다.

이 스킬은 기능 개발 스킬이 아니라 **릴리스 운영 프로토콜**을 표준화하는 스킬이다.

## Scope

- Changesets 기반 릴리스 workflow를 관리한다.
- 기여자가 작성한 `.changeset/*.md` 파일을 확인하고, Version Packages PR 상태를 점검한다.
- 필요 시 Changeset을 추가하거나 prerelease mode를 관리한다.
- publish 결과와 GitHub Release 결과를 확인한다.
- 중단된 릴리스를 이어서 진행한다.

이 스킬은 다음 상황에 사용한다.

- "changeset 추가해줘"
- "Version Packages PR 상태 확인해줘"
- "prerelease mode 진입/종료해줘"
- "publish 결과 확인해줘"
- "중단된 package publish 이어서 해줘"

다음 상황에는 사용하지 않는다.

- 일반 기능 개발/버그 수정
- 단순 changelog 설명
- publish와 무관한 문서 정리

## Repository-Specific Assumptions

이 저장소에서는 다음 규칙을 전제로 한다.

1. **배포는 GitHub Actions only**
   - 로컬 `npm publish` 금지
   - canonical publish path:
      - `.github/workflows/release.yml`

2. **Changesets가 릴리스 단위를 결정**
   - pending changeset이 있는 public package를 Version Packages PR에서 함께 version/publish한다.
   - private example/tooling workspace는 `.changeset/config.json`의 `ignore` 목록으로 release 대상에서 제외한다.

3. **release gate는 canonical verifier를 사용**
   - `pnpm verify:release-readiness`
   - Version Packages PR 검토 시:
      - `pnpm changeset status --since=main`

4. **GitHub Release note source는 Changesets가 생성한 package-level changelog**
   - Changesets action이 자동으로 GitHub Release를 생성하므로 수동 노트 준비는 더 이상 필요하지 않다.
   - Package-level changelog는 `changeset version` 실행 시 자동 생성된다.

5. **release metadata는 Changesets가 관리**
   - 기여자는 PR 시점에 `pnpm changeset add`로 `.changeset/*.md` 파일을 작성한다.
   - Changesets는 pending changeset을 모아 "Version Packages" PR을 자동으로 생성한다.
   - 메인테이너는 Version Packages PR을 리뷰/머지하면 CI가 자동으로 publish한다.
   - `tooling/release/intents/*.json`는 legacy reference로 보존하지만, 새 릴리스에서는 Changesets를 사용한다.

## Authority Boundary

- `prepare`는 **PR 생성**까지만 담당한다.
- `publish`는 **이미 머지된 준비 상태**를 전제로 한다.
- 이 스킬은 준비와 배포를 모두 다룰 수 있지만, 두 단계를 자동으로 섞어 추측하지 않는다.
- merge authority가 없으면 `prepare-and-publish`는 publish 전에 반드시 멈춘다.

## Language Policy

- 이 스킬이 사용자에게 직접 보여주는 모든 문구는 한국어로 작성한다.
- All user-facing communication produced while using this skill must be written in Korean.
- GitHub URL, 브랜치명, 파일 경로, 패키지명, 라벨, 명령어, workflow 이름은 원문을 유지한다.
- Raw command output, log output, quoted source text는 번역하지 않는다. 필요하면 별도로 한국어 설명을 붙인다.

## Modes

### `plan`
- 릴리스 순서와 버전 정책만 정리한다.
- PR 생성 안 함
- publish 안 함

### `add-changeset`
- `pnpm changeset add`를 실행해 새 changeset 파일을 생성한다.
- changed packages와 bump 타입을 선택한다.
- PR 생성은 하지 않는다.

### `version`
- `pnpm version-packages`를 실행하거나 Version Packages PR 상태를 확인한다.
- changeset을 소모하고 package version을 올린다.
- changelog를 업데이트한다.
- merge 안 함

### `publish`
- 이미 머지된 Version Packages PR을 전제로 publish 상태를 확인한다.
- `.github/workflows/release.yml` 실행 결과 확인
- npm publish / git tag / GitHub Release 결과 확인

### `prepare-and-publish` (deprecated)
- 이전 single-package workflow의 legacy 모드.
- Changesets 마이그레이션 후에는 `add-changeset`과 `version`을 따로 사용한다.

### `resume`
- 이전 run ledger를 읽고 중단된 지점부터 재개한다.

## Required Persistent State

반드시 run ledger를 유지한다.

권장 경로:
- `.sisyphus/package-publish/<run-id>.json`

예시:

```json
{
  "run_id": "pkg-publish-2026-04-16-core-beta1",
  "mode": "prepare",
  "package_name": "@fluojs/core",
  "package_dir": "packages/core",
  "target_version": "1.0.0-beta.1",
  "dist_tag": "beta",
  "release_prerelease": true,
  "branch": "core/1.0.0-beta-1",
  "worktree": "/repo/.worktrees/core-1.0.0-beta-1",
  "pr": 1152,
  "pr_url": "https://github.com/fluojs/fluo/pull/1152",
  "merged": false,
  "publish_workflow_run": null,
  "published": false,
  "git_tag": null,
  "github_release_url": null
}
```

## Branch / Worktree Naming

### Branch naming
브랜치 이름은 다음 규칙을 사용한다.

- `<package-slug>/<version-slug>`

예:
- `core/1.0.0-beta-1`
- `cli/1.0.0-beta-1`
- `platform-fastify/1.0.0-beta-1`

### Package slug
- scope 제거
- 예:
  - `@fluojs/core` → `core`
  - `@fluojs/platform-fastify` → `platform-fastify`

### Version slug
- branch에 쓰기 위해 `.`를 일부 `-`로 정규화할 수 있다.
- 권장:
  - `1.0.0-beta.1` → `1.0.0-beta-1`

### Worktree naming
- `.worktrees/<package-slug>-<version-slug>`

예:
- `.worktrees/core-1.0.0-beta-1`

## Workflow

### Phase 1 — Intake
1. 현재 mode를 확인한다 (changeset 추가 / Version Packages PR 확인 / prerelease 관리 / publish 확인).
2. 저장소의 Changesets 상태를 확인한다 (`pnpm changeset status`).
3. pending changeset 목록을 확인한다.

### Phase 2 — Preflight
1. 현재 저장소가 clean인지 확인한다.
2. GitHub 연동 상태를 확인한다.
3. `.changeset/` 디렉토리에 pending changeset이 있는지 확인한다.
4. 열린 Version Packages PR이 있는지 확인한다.
5. 현재 prerelease mode 상태를 확인한다.

### Phase 3 — Add Changeset (mode가 changeset 추가인 경우)
1. `pnpm changeset add`를 실행한다.
2. changed packages를 자동 감지하거나 수동으로 선택한다.
3. bump 타입을 선택한다.
4. summary를 작성한다.
5. 생성된 `.changeset/*.md` 파일을 확인한다.

### Phase 4 — Version Packages PR
1. Changesets action이 자동으로 생성한 Version Packages PR을 확인한다.
2. PR이 package version bump, changelog 업데이트, changeset 소모를 정확히 수행하는지 확인한다.
3. merge는 사용자 또는 supervisor authority 없이는 진행하지 않는다.

### Phase 5 — Merge Gate
1. PR checks 확인
2. package version bump가 올바른지 확인
3. changelog 생성이 정상적인지 확인
4. authority가 있으면 머지
5. 없으면 여기서 멈추고 사용자 승인 대기

### Phase 6 — Publish
Version Packages PR 머지 후 자동으로 실행:
1. `.github/workflows/release.yml`가 자동으로 publish 실행
2. OIDC provenance로 npm publish 확인
3. scoped git tag 생성 확인
4. GitHub Release 생성 확인

### Phase 7 — Cleanup
1. worktree 제거
2. local branch 제거
3. remote branch 제거
4. root `main` fast-forward sync

### Phase 8 — Report
1. PR URL
2. merge 여부
3. publish workflow URL
4. npm publish 결과
5. git tag
6. GitHub Release URL
7. 다음 패키지 권장 순서

## Changeset Rules

이 저장소는 Changesets가 package-level changelog와 GitHub Release notes를 생성한다.

따라서 반드시:

- 사용자 영향이 있는 public package 변경은 `.changeset/*.md`에 기록한다.
- changeset frontmatter에는 영향받는 public package와 `patch`/`minor`/`major` bump를 명시한다.
- private example/tooling workspace는 release package로 선택하지 않는다.
- Version Packages PR에서 generated changelog, package version, consumed changeset을 함께 검토한다.
- package version만 수동으로 올리거나 changelog section만 직접 추가한 상태를 release 준비 완료로 판단하지 않는다.

### Good
```md
---
"@fluojs/core": patch
---

Prepare the core package for the next beta release without changing runtime behavior.
```

### Bad
```md
---
"@fluojs/core": patch
"@fluojs/example-minimal": patch
---

Mix a publishable package with a private example workspace.
```

## behavioral contract guardrail

릴리스 준비는 단순 파일 수정이 아니라 저장소가 문서화한 publish contract를 만족시키는 작업으로 본다.

- `docs/contracts/release-governance.md`와 `docs/contracts/testing-guide.md`를 릴리스 경계로 취급한다.
- documented public package surface 밖의 패키지를 publish 대상으로 취급하지 않는다.
- `.changeset/*.md`는 package별 semver intent와 release summary의 source of truth로 취급한다.
- Changesets가 생성한 package-level changelog는 GitHub Release note source로 취급한다.
- package README나 공개 contract가 달라지는 변경이 포함되면 docs/test를 같은 PR에 포함한다.

## Mandatory Rules

- 배포는 반드시 GitHub Actions workflow로만 한다.
- 로컬 `npm publish`를 실행하지 않는다.
- publish 전에는 tag/release를 만들지 않는다.
- Version Packages PR의 package version과 generated changelog가 pending changeset과 일치해야 한다.
- changeset 없이 package version만 올린 상태를 릴리스 준비 완료로 판단하지 않는다.
- 같은 버전이 이미 npm에 있으면 publish를 중단한다.
- PR 생성 후 merge/cleanup/publish는 mode와 authority를 따르지 않으면 진행하지 않는다.
- co-author trailer를 넣지 않는다.

## Output Contract

최종 보고에는 다음을 포함한다.

- `result: prepared 1 package PR` 또는 `published 1 package`
- package name
- version
- dist-tag
- release_prerelease
- branch
- worktree
- PR URL
- merge 여부
- publish workflow URL
- npm publish 성공 여부
- git tag
- GitHub Release URL
- 다음 패키지 추천 순서

## Example Prompts

- `/package-publish prepare @fluojs/core 1.0.0-beta.1 beta`
- `core 머지됐으니 publish까지 해줘`

## Must NOT

- 로컬에서 직접 npm publish 하지 않는다.
- publish 성공 전에 git tag/GitHub Release를 만들지 않는다.
