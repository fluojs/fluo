# Versioning & Release Rules

<p><strong><kbd>한국어</kbd></strong> <a href="./release-governance.md"><kbd>English</kbd></a></p>

## Stability Tiers

| Tier | Version window | Release rule | Contract level |
| --- | --- | --- | --- |
| Experimental | `0.x` | 공개 API는 마이너 릴리스에서 바뀔 수 있습니다. 프리릴리스 버전은 반드시 `latest`가 아닌 dist-tag로 배포해야 합니다. | 안정 업그레이드를 보장하지 않습니다. |
| Preview | `0.x` 또는 프리릴리스 빌드 | 외부 사용을 전제로 하지만, 파괴적 변경은 여전히 `0.x` 마이너 버전 규칙을 따르고 `CHANGELOG.md`에 마이그레이션 노트를 남겨야 합니다. | 문서화된 동작이 테스트와 릴리스 노트와 함께 유지되어야 합니다. |
| Official | `1.0+` | 안정 릴리스는 `latest`로 배포합니다. 파괴적 변경은 메이저 버전 증가가 필요합니다. | 공개 API, 문서화된 동작, 릴리스 절차를 안정 계약으로 취급합니다. |

## Semver Rules

- 모든 공개 `@fluojs/*` 패키지는 Semantic Versioning을 따릅니다.
- `major`는 `1.0+`에서 파괴적 변경이 있을 때 필요합니다.
- `minor`는 하위 호환 기능 추가에 사용하며, `0.x` 단계의 파괴적 변경에도 같은 증가 규칙을 사용합니다.
- `patch`는 문서화된 동작을 유지하는 하위 호환 수정, 보안 수정, 문서 또는 툴링 변경에만 사용합니다.
- 프리릴리스 버전은 하이픈 접미사가 있는 버전입니다. 이런 버전은 `next`, `beta`, `rc` 같은 non-`latest` dist-tag로 배포해야 합니다.
- 프리릴리스 접미사가 없는 안정 버전은 `latest` dist-tag로 배포해야 합니다.
- 공개 배포 대상 패키지의 매니페스트는 내부 `@fluojs/*` 의존성에 대해 dependency, optional dependency, peer dependency, dev dependency 전부에서 `workspace:^`를 사용해야 합니다.

## Breaking Change Rules

- 기존 사용자 코드나 설정을 바꿔야 계속 동작하는 경우, API 형태 변경, 문서화된 동작 변경, 설정 형태 변경, 부트스트랩 순서 변경, 어댑터 계약 변경, 공개 패키지 제거를 파괴적 변경으로 취급합니다.
- `0.x`에서는 파괴적 변경을 마이너 릴리스에서만 배포할 수 있고, 해당 릴리스는 `CHANGELOG.md`에 마이그레이션 노트를 포함해야 합니다.
- `1.0+`에서는 파괴적 변경을 메이저 릴리스로만 배포해야 합니다.
- 라이프사이클 순서, 종료 동작, 어댑터 동작, 준비 상태 동작, 공개 CLI 및 스타터 계약의 문서화된 보장을 바꾸는 경우 patch나 minor로 분류하면 안 됩니다.
- 파괴적 규칙이 바뀌면 구현, 테스트, governed 문서를 같은 변경에 함께 갱신해야 합니다.

## Graduation Requirements

패키지가 `1.0` 및 Official tier로 승격되려면 다음 조건이 계속 참이어야 합니다.

1. 패키지는 `packages/*` 아래의 기존 워크스페이스 패키지여야 하고, 공개 패키지 상태를 유지하며, `publishConfig.access`를 `public`으로 유지해야 합니다.
2. 패키지는 `docs/reference/package-surface.md`와 이 문서의 `## intended publish surface` 목록 양쪽에 모두 있어야 합니다.
3. public export는 저장소 TSDoc 기준을 충족해야 하고, 계약 문서는 영어와 한국어 parity를 유지해야 합니다.
4. 릴리스 검증은 canonical 저장소 명령을 통과해야 합니다: `pnpm build`, `pnpm typecheck`, `pnpm vitest run --project packages`, `pnpm vitest run --project apps`, `pnpm vitest run --project examples`, `pnpm vitest run --project tooling`, `pnpm --dir packages/cli sandbox:matrix`, `pnpm verify:platform-consistency-governance`, `pnpm verify:release-readiness`.
5. `CHANGELOG.md`는 `## [Unreleased]` 섹션을 유지해야 하고, 모든 `0.x` 파괴적 릴리스는 안정적인 `1.0+` 계약을 선언하기 전에 마이그레이션 노트를 포함해야 합니다.

## Release Metadata Contract

Changesets(`.changeset/*.md`)는 canonical release metadata 도구입니다. 기여자는 PR 시점에 committed changeset 파일에 semver intent와 changelog text를 기록하고, Changesets GitHub Action은 이 파일들을 소비해 패키지 버전을 올리고, changelog를 생성하며, npm에 publish합니다. 패키지별 changelog는 자동으로 생성되고, 루트 `CHANGELOG.md`는 repo-wide narrative로 남습니다. GitHub Releases는 Changesets action이 자동으로 생성합니다.

각 changeset은 다음을 포함해야 합니다.

1. 영향받는 패키지 이름, published `@fluojs/*` package name을 사용합니다.
2. 패키지별 semver intent, `major`, `minor`, `patch` 중 하나입니다.
3. 변경 사항을 설명하는 summary.

changeset에 없는 패키지는 해당 릴리스에서 version이 올라가거나 publish되지 않습니다. Downstream dependent 패키지는 Changesets의 낶은 dependency graph를 통해 평가되며, dependent 버전 bump는 versioning 단계에서 자동으로 계산됩니다.

릴리스 workflow는 `main`에 push될 때 자동으로 트리거됩니다. pending changeset이 있으면 Changesets action이 "Version Packages" PR을 열어 버전을 올리고, changelog를 업데이트하며, 소비된 changeset을 제거합니다. 이 PR을 merge하면 publish 단계가 트리거되어 OIDC provenance와 함께 영향받는 패키지를 npm에 publish하고, scoped git tag와 GitHub Release를 생성합니다.

Prerelease workflow는 Changesets prerelease mode(`changeset pre enter <tag>`)를 사용합니다. 필요할 때 dedicated branch에서 prerelease mode에 진입하고, stable 릴리스 전에 `changeset pre exit`로 종료합니다.

레거시 `tooling/release/intents/*.json` record는 역사적 참고용으로 보존하지만, 새 릴리스에서는 더 이상 필요하지 않습니다.


## Migration Assessment: Changesets and Beachball

Changesets가 primary release automation 도구로 채택되었습니다. 이는 기존 repo-local JSON intent model을 표준 contributor-authored changeset workflow로 교체합니다. `.github/workflows/release.yml`이 versioning, publishing, GitHub Release 생성을 자동으로 처리합니다.

이전 single-package manual dispatch workflow는 deprecated됩니다. 새 workflow는 Version Packages PR이 merge될 때 pending changeset이 있는 모든 패키지를 publish하며, CI-only, OIDC-provenanced, `main`-branch publish를 유지합니다.

Beachball은 여전히 유효한 비교 대상이지만 채택되지 않습니다. 아래 evaluation criteria는 Changesets가 적합하지 않은 경우를 대비해 보존됩니다.

1. **Packages per release**: Changesets는 여러 패키지를 자동으로 한 번에 릴리스합니다.
2. **Downstream evaluation frequency**: Changesets는 versioning 중 dependent 패키지를 자동으로 bump합니다.
3. **Intent maintenance cost**: Changeset 파일은 기여자가 PR 시점에 작성하므로 maintainer의 릴리스 시점 작업이 줄어듭니다.
4. **Generated package changelog need**: Changesets는 패키지별 changelog를 자동으로 생성합니다.
5. **CI-only compatibility**: 새 `.github/workflows/release.yml`은 CI-only publish와 OIDC provenance를 유지합니다.

## intended publish surface

- `@fluojs/cache-manager`
- `@fluojs/cli`
- `@fluojs/config`
- `@fluojs/core`
- `@fluojs/cqrs`
- `@fluojs/cron`
- `@fluojs/email`
- `@fluojs/discord`
- `@fluojs/di`
- `@fluojs/drizzle`
- `@fluojs/event-bus`
- `@fluojs/graphql`
- `@fluojs/http`
- `@fluojs/jwt`
- `@fluojs/metrics`
- `@fluojs/microservices`
- `@fluojs/mongoose`
- `@fluojs/notifications`
- `@fluojs/openapi`
- `@fluojs/passport`
- `@fluojs/platform-bun`
- `@fluojs/platform-cloudflare-workers`
- `@fluojs/platform-deno`
- `@fluojs/platform-express`
- `@fluojs/platform-fastify`
- `@fluojs/platform-nodejs`
- `@fluojs/prisma`
- `@fluojs/queue`
- `@fluojs/redis`
- `@fluojs/runtime`
- `@fluojs/serialization`
- `@fluojs/slack`
- `@fluojs/socket.io`
- `@fluojs/studio`
- `@fluojs/terminus`
- `@fluojs/testing`
- `@fluojs/throttler`
- `@fluojs/validation`
- `@fluojs/websockets`

## Enforcement

버전 규칙, 릴리스 거버닝 문서, 공개 배포 대상 패키지가 바뀌면 다음 명령을 실행합니다.

```bash
pnpm build
pnpm typecheck
pnpm vitest run --project packages
pnpm vitest run --project apps
pnpm vitest run --project examples
pnpm vitest run --project tooling
pnpm --dir packages/cli sandbox:matrix
pnpm verify:public-export-tsdoc
pnpm verify:platform-consistency-governance
pnpm verify:release-readiness
pnpm generate:release-readiness-drafts
pnpm changeset status --since=main
```

- `pnpm verify:platform-consistency-governance`는 heading parity와 governed 문서 일관성을 검사합니다.
- `pnpm verify:release-readiness`는 canonical build, typecheck, 분리된 Vitest, sandbox, package-surface 동기화, publish-safety 검사를 다시 실행합니다.
- `pnpm verify:public-export-tsdoc`는 governed 패키지에 적용되는 public export 문서 기준을 강제합니다.
- `pnpm generate:release-readiness-drafts`는 메인테이너가 릴리스 노트를 준비할 때 release-readiness summary 초안과 `CHANGELOG.md`의 draft release block을 갱신합니다.
- `pnpm changeset status --since=main`은 Version Packages PR을 merge하기 전에 Changesets가 version할 package와 semver bucket을 미리 보여줍니다.
