---
description: package-publish — fluo Changesets 기반 릴리스 운영 command harness. plan|add-changeset|version|publish|resume 모드를 분리하고 GitHub Actions-only publish 및 권한 게이트를 강제한다.
argument-hint: "<plan|add-changeset|version|publish|resume> [package-name] [version] [dist-tag] [run-id]"
---

# package-publish

이 커맨드는 fluo 저장소의 패키지 릴리스 운영을 위한 **command harness**이다. 자유 형식 publish 에이전트가 아니라, Changesets 기반 상태 전이와 권한 게이트를 고정된 모드로 실행한다.

전체 릴리스 지식은 `.opencode/skills/package-publish/SKILL.md`와 `.opencode/skills/fluo-release-operations/SKILL.md`의 정책을 따른다. 충돌 시 root `AGENTS.md`, `docs/contracts/release-governance.md`, `.changeset/config.json`, `.github/workflows/release.yml`을 우선한다.

## 사용법

```
/package-publish <mode> [package-name] [version] [dist-tag] [run-id]
```

지원 mode:

- `plan` — 릴리스 순서, semver intent, readiness checklist만 산출한다. 파일 변경, PR 생성, publish 없음.
- `add-changeset` — public `@fluojs/*` package 변경에 대한 `.changeset/*.md` 추가만 수행한다. Version Packages PR 생성/머지/publish 없음.
- `version` — pending changeset과 Version Packages PR 상태를 검토하거나, 권한이 명시된 경우 version 작업까지만 수행한다. merge/publish 없음.
- `publish` — 이미 `main`에 머지된 Version Packages PR 이후 `.github/workflows/release.yml` 실행 결과와 npm/tag/GitHub Release 산출물을 확인한다. 로컬 publish 없음.
- `resume` — `.sisyphus/package-publish/<run-id>.json` ledger를 읽고 마지막 안전 상태부터 같은 mode boundary 안에서 재개한다.

예시:

- `/package-publish plan @fluojs/core 1.0.0-beta.1 beta`
- `/package-publish add-changeset @fluojs/core patch`
- `/package-publish version`
- `/package-publish publish pkg-publish-2026-04-16-core-beta1`
- `/package-publish resume pkg-publish-2026-04-16-core-beta1`

## 불변 정책

1. **Changesets ONLY** — `.changeset/*.md`가 versioning과 changelog의 sole source of truth이다.
2. **GitHub Actions-only publish** — publish의 canonical path는 `.github/workflows/release.yml`이다.
3. **Local publish forbidden** — 로컬 `npm publish` 실행, 권장, 우회, 수동 승인 모두 금지한다.
4. **Version Packages PR 경계** — pending changeset은 Changesets action의 Version Packages PR에서 package version, package-level changelog와 함께 소모되어야 한다.
5. **Human gate required** — PR merge, package publishing, tag/release 생성, worktree/branch cleanup은 사용자 또는 상위 command harness의 명시 권한 없이는 진행하지 않는다.
6. **No premature release artifacts** — publish 성공 전에 git tag, GitHub Release, npm release를 수동 생성하지 않는다.
7. **Public package scope** — `.changeset/config.json`의 `ignore` 대상 private examples/tooling workspace는 release package로 선택하지 않는다.

## 상태와 ledger

상태 추적이 필요한 실행은 다음 경로에 run ledger를 유지한다.

```
.sisyphus/package-publish/<run-id>.json
```

권장 ledger schema:

```json
{
  "run_id": "pkg-publish-2026-04-16-core-beta1",
  "mode": "plan|add-changeset|version|publish|resume",
  "package_name": "@fluojs/core",
  "package_dir": "packages/core",
  "target_version": "1.0.0-beta.1",
  "dist_tag": "beta",
  "release_prerelease": true,
  "branch": "core/1.0.0-beta-1",
  "worktree": ".worktrees/core-1.0.0-beta-1",
  "changesets": [],
  "version_packages_pr": null,
  "merged": false,
  "publish_workflow_run": null,
  "published": false,
  "git_tag": null,
  "github_release_url": null,
  "authority": {
    "merge": false,
    "publish": false,
    "cleanup": false
  }
}
```

`resume`는 ledger의 `mode`, `merged`, `publish_workflow_run`, `published`, `authority`를 먼저 검증한다. 누락되거나 모순된 ledger는 `needs-human-check`로 멈춘다.

## 모드별 state transition

### `plan`

허용 transition:

```
intake -> release-policy-summary -> readiness-plan -> report
```

필수 확인:

- root `AGENTS.md`의 Changesets-only, no-local-publish, explicit approval 정책.
- `.changeset/config.json`의 `baseBranch`, `access`, `ignore` 목록.
- `.github/workflows/release.yml`이 Changesets action으로 version PR 또는 publish를 수행하는지 여부.

금지:

- 파일 변경.
- PR 생성/머지.
- publish, tag, GitHub Release 생성.

### `add-changeset`

허용 transition:

```
intake -> preflight -> changeset-authoring -> changeset-review -> ledger-update -> report
```

필수 확인:

- 대상 package가 public `@fluojs/*`이고 `.changeset/config.json`의 `ignore`에 포함되지 않는지 확인한다.
- semver bump가 `patch|minor|major` 중 하나인지 확인한다.
- changeset summary가 사용자 영향과 behavioral contract impact를 설명하는지 확인한다.

권한 경계:

- `.changeset/*.md` 생성까지만 허용한다.
- Version Packages PR 생성, merge, publish는 수행하지 않는다.

### `version`

허용 transition:

```
intake -> preflight -> pending-changeset-check -> version-packages-pr-check -> release-readiness-gate -> report
```

필수 확인:

- `pnpm changeset status --since=main` 결과와 pending `.changeset/*.md`가 일치하는지 확인한다.
- Version Packages PR이 package version bump, generated changelog, consumed changeset을 함께 포함하는지 확인한다.
- release readiness verifier는 `pnpm verify:release-readiness`를 canonical gate로 취급한다.

권한 경계:

- 명시 권한 없이 PR merge 금지.
- publish workflow를 직접 trigger하거나 package publish를 시작하지 않는다.

### `publish`

허용 transition:

```
intake -> merged-version-pr-confirmation -> release-workflow-check -> npm-tag-release-verification -> report
```

필수 확인:

- Version Packages PR이 이미 `main`에 머지되었는지 확인한다.
- `.github/workflows/release.yml`의 `Changesets Release` workflow run이 publish를 수행했는지 확인한다.
- npm package version, scoped git tag, GitHub Release URL을 read-only로 확인한다.
- 같은 package version이 이미 npm에 존재하고 workflow publish가 아직 수행되지 않았다면 즉시 중단한다.

권한 경계:

- 로컬 `npm publish` 금지.
- tag/GitHub Release 수동 생성 금지.
- workflow dispatch, rerun, merge, cleanup은 별도 명시 권한 없이는 금지.

### `resume`

허용 transition:

```
ledger-read -> ledger-validate -> mode-boundary-restore -> next-safe-checkpoint -> report
```

필수 확인:

- `.sisyphus/package-publish/<run-id>.json` ledger가 존재해야 한다.
- 현재 repository state가 ledger의 branch/worktree/PR/workflow 상태와 충돌하지 않아야 한다.
- 재개 후에도 원래 mode의 금지 작업과 human gate를 그대로 유지한다.

## 안전 preflight

모든 mutating mode(`add-changeset`, 권한 있는 `version`)는 시작 전에 다음을 확인한다.

1. working tree가 clean이거나, 변경 범위가 현재 run의 허용 파일로 제한되어 있다.
2. release 대상은 documented public package surface에 포함된다.
3. `.changeset/config.json`의 ignored workspace를 release 대상에 포함하지 않는다.
4. branch/worktree는 root `AGENTS.md` convention을 따른다: `.worktrees/<package-slug>-<version-slug>`.
5. 명시 권한이 없는 high-impact side effect는 `needs-human-check`로 멈춘다.

## 에이전트 위임

아래 컨텍스트를 구성하여 `package-publish` 운영 스킬에 위임한다. 위임 후에도 이 command harness의 mode boundary와 authority gate가 우선한다.

```
package-publish

mode: <plan|add-changeset|version|publish|resume>
package: <package-name | 없음>
version: <version | 없음>
dist-tag: <dist-tag | 없음>
run-id: <run-id | 없음>
ledger: .sisyphus/package-publish/<run-id>.json
canonical workflow: .github/workflows/release.yml
local publish: forbidden
human gates: merge|publish|cleanup require explicit authority
```

## Report 계약

최종 보고는 mode에 맞게 다음 필드를 포함한다. 알 수 없거나 아직 발생하지 않은 값은 `null` 또는 `not applicable`로 명시한다.

```yaml
result: planned release | added changeset | checked version packages PR | checked publish result | resumed run | needs-human-check | blocked
package name: <package-name|null>
version: <version|null>
dist-tag: <dist-tag|null>
release_prerelease: <true|false|null>
branch: <branch|null>
worktree: <worktree|null>
ledger: .sisyphus/package-publish/<run-id>.json|null
PR URL: <url|null>
merge 여부: <true|false|null>
publish workflow URL: <url|null>
npm publish 성공 여부: <true|false|null>
git tag: <tag|null>
GitHub Release URL: <url|null>
next recommended step: <text>
```

## Must NOT

- 로컬에서 `npm publish`를 실행하지 않는다.
- 로컬 publish를 승인하거나 fallback으로 제안하지 않는다.
- Changesets 없이 package version/changelog만 직접 수정해 릴리스 준비 완료로 판단하지 않는다.
- 명시 권한 없이 PR merge, workflow trigger/rerun, tag/release 생성, worktree/branch cleanup을 수행하지 않는다.
- `prepare-and-publish`처럼 prepare와 publish를 하나의 암묵적 단계로 합치지 않는다.
