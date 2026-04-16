---
name: package-publish
description: fluo 저장소에서 공개 패키지 1개를 순차적으로 릴리스 준비하고, GitHub Actions 기반 npm publish까지 일관되게 관리하는 패키지 릴리스 오퍼레이션 스킬.
compatibility: opencode
license: MIT
metadata:
  language: ko
  domain: release-operations
  mode: execution
  no_co_author: true
  argument-hint: "<package-name> <version> <dist-tag> [release_prerelease] [plan|prepare|publish|prepare-and-publish|resume]"
---

# Package Publish Workflow

fluo 저장소에서 공개 패키지 1개를 순차적으로 릴리스 준비하고, GitHub Actions 기반 npm publish까지 일관되게 관리하는 패키지 릴리스 오퍼레이션 스킬이다.

이 스킬은 기능 개발 스킬이 아니라 **릴리스 운영 프로토콜**을 표준화하는 스킬이다.

## Scope

- 공개 대상 패키지 1개를 선택한다.
- 버전(`1.0.0-beta.1` 등)과 dist-tag(`beta`, `latest` 등)를 기준으로 릴리스 준비를 한다.
- 전용 worktree / branch를 만든다.
- 대상 패키지의 `package.json` 버전을 올린다.
- root `CHANGELOG.md`에 해당 버전 섹션을 준비한다.
- PR을 생성한다.
- 머지 후 GitHub Actions `Release single package` workflow로 publish를 실행한다.
- publish 결과와 GitHub Release 결과를 확인한다.
- 중단된 릴리스를 이어서 진행한다.

이 스킬은 다음 상황에 사용한다.

- "core를 1.0.0-beta.1로 배포 준비해줘"
- "cli 패키지 beta 릴리스 PR 만들어줘"
- "머지됐으니 publish까지 진행해줘"
- "중단된 package publish 이어서 해줘"

다음 상황에는 사용하지 않는다.

- 여러 패키지를 한 번에 같은 PR로 배포 준비하는 경우
- 일반 기능 개발/버그 수정
- 단순 changelog 설명
- publish와 무관한 문서 정리

## Repository-Specific Assumptions

이 저장소에서는 다음 규칙을 전제로 한다.

1. **배포는 GitHub Actions only**
   - 로컬 `npm publish` 금지
   - canonical publish path:
     - `.github/workflows/release-single-package.yml`

2. **한 번에 한 패키지만 배포**
   - shared root `CHANGELOG.md`를 사용하므로 병렬 package release PR은 충돌 위험이 높다.
   - 반드시 순차적으로 진행한다.

3. **release gate는 canonical verifier를 사용**
   - `pnpm verify:release-readiness`
   - 단건 publish 준비 시:
     - `pnpm verify:release-readiness --target-package <pkg> --target-version <version> --dist-tag <tag>`

4. **GitHub Release note source는 root `CHANGELOG.md`**
   - `tooling/release/prepare-github-release.mjs`는 `## [version] - date` 섹션을 기준으로 릴리스 노트를 만든다.
   - 따라서 같은 version section 안에 다른 패키지 내용이 섞이지 않게 주의해야 한다.

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

### `prepare`
- 대상 패키지의 릴리스 준비 PR을 만든다.
- worktree 생성
- branch 생성
- version bump
- `CHANGELOG.md` 업데이트
- PR 생성
- merge 안 함
- publish 안 함

### `publish`
- 이미 머지된 패키지를 GitHub Actions workflow로 실제 publish 한다.
- `Release single package` workflow 실행
- npm publish 확인
- git tag / GitHub Release 결과 확인

### `prepare-and-publish`
- 준비 → PR → 머지 대기 → publish까지 이어지는 실행형 모드.
- 기본적으로는 merge authority가 있어야 publish 단계까지 진행한다.

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
1. 패키지명, 버전, dist-tag, prerelease 여부를 확인한다.
2. mode를 결정한다.
3. 대상 패키지가 공개 패키지인지 확인한다.

### Phase 2 — Preflight
1. 현재 저장소가 clean인지 확인한다.
2. GitHub 연동 상태를 확인한다.
3. 대상 패키지 `package.json` 현재 버전을 읽는다.
4. root `CHANGELOG.md` 구조를 확인한다.
5. 이미 같은 버전이 npm에 publish 되었는지 확인한다.
6. 열린 release PR 중 같은 패키지/버전이 있는지 확인한다.

### Phase 3 — Prepare
1. `main`에서 fresh worktree 생성
2. branch 생성
3. 대상 패키지 `package.json` 버전 갱신
4. root `CHANGELOG.md`에 `## [version] - YYYY-MM-DD` 섹션 작성
5. 해당 섹션에는 **이번 패키지 내용만** 넣는다.
6. canonical verifier 실행:
   - `pnpm verify:release-readiness --target-package ... --target-version ... --dist-tag ...`
7. 필요시 관련 docs/gate 통과 확인

### Phase 4 — PR
1. 브랜치 push
2. PR 생성
3. PR 제목/본문 표준 형식 사용
4. merge는 사용자 또는 supervisor authority 없이는 진행하지 않는다.

### Phase 5 — Merge Gate
1. PR checks 확인
2. verifier 결과 확인
3. `CHANGELOG.md`가 다른 패키지 내용으로 오염되지 않았는지 확인
4. authority가 있으면 머지
5. 없으면 여기서 멈추고 사용자 승인 대기

### Phase 6 — Publish
머지 완료 후에만:
1. GitHub Actions `Release single package` workflow 실행
2. 입력:
   - `package_name`
   - `package_version`
   - `dist_tag`
   - `release_prerelease`
3. workflow 결과 확인
4. npm publish 성공 확인
5. git tag 확인
6. GitHub Release 생성 확인

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

## CHANGELOG Rules

이 저장소는 root `CHANGELOG.md` 하나만 사용한다.

따라서 반드시:

- 한 번에 한 패키지 PR만 준비한다.
- 같은 version section 안에 다른 패키지 내용을 섞지 않는다.
- `## [version] - date` 형식을 유지한다.
- `tooling/release/prepare-github-release.mjs`가 버전 섹션을 그대로 release note source로 쓴다는 점을 항상 고려한다.

### Good
```md
## [1.0.0-beta.1] - 2026-04-16

### Changed

- `@fluojs/core`: prepared the package for the first sequential beta release without changing runtime behavior.
- `@fluojs/core`: added the versioned changelog section needed for release-note extraction and GitHub release generation.
```

### Bad
```md
## [1.0.0-beta.1] - 2026-04-16

### Changed

- `@fluojs/core`: ...
- `@fluojs/cli`: ...
- `@fluojs/runtime`: ...
```

## behavioral contract guardrail

릴리스 준비는 단순 파일 수정이 아니라 저장소가 문서화한 publish contract를 만족시키는 작업으로 본다.

- `docs/operations/release-governance.md`와 `docs/operations/testing-guide.md`를 릴리스 경계로 취급한다.
- documented public package surface 밖의 패키지를 publish 대상으로 취급하지 않는다.
- `CHANGELOG.md` 섹션은 release note source이므로, 패키지별 순차 릴리스에서는 다른 패키지 내용을 섞지 않는다.
- package README나 공개 contract가 달라지는 변경이 포함되면 docs/test를 같은 PR에 포함한다.

## Mandatory Rules

- 반드시 **한 번에 한 패키지만** 준비한다.
- shared `CHANGELOG.md` 때문에 병렬 release PR을 만들지 않는다.
- 배포는 반드시 GitHub Actions workflow로만 한다.
- 로컬 `npm publish`를 실행하지 않는다.
- publish 전에는 tag/release를 만들지 않는다.
- `package.json` version과 workflow input version이 반드시 일치해야 한다.
- 같은 버전이 이미 npm에 있으면 publish를 중단한다.
- PR 생성 후 merge/cleanup/publish는 mode와 authority를 따르지 않으면 진행하지 않는다.
- branch naming은 반드시 `<package-slug>/<version-slug>` 규칙을 따른다.
- worktree를 반드시 사용한다.
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

- shared `CHANGELOG.md`를 여러 PR에서 병렬 편집하지 않는다.
- version을 바꾸지 않고 changelog만 수정한 채 publish 준비를 완료했다고 판단하지 않는다.
- `Release single package` 대신 로컬에서 직접 npm publish 하지 않는다.
- publish 성공 전에 git tag/GitHub Release를 만들지 않는다.
- 여러 패키지를 한 PR에 섞지 않는다.
- 같은 version section에 여러 패키지 노트를 섞지 않는다.
