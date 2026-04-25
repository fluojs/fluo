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

커밋된 release-intent record는 릴리스 준비를 위한 장기 canonical machine input입니다. 루트 `CHANGELOG.md`는 사람이 읽는 narrative로 남고, GitHub Releases는 supervised CI-only flow가 만드는 generated artifact입니다.

각 release intent entry는 다음 필드를 포함해야 합니다.

1. 패키지 이름, published `@fluojs/*` package name을 사용합니다.
2. Semver intent, `major`, `minor`, `patch`, 또는 패키지 릴리스가 없을 때의 `none` 중 하나입니다.
3. Prerelease 또는 stable intent, 패키지를 릴리스하는 경우 expected dist-tag를 포함합니다.
4. Summary, maintainer와 release reviewer가 읽는 설명입니다.
5. 패키지의 stability tier에서 breaking으로 분류되는 semver intent인 경우 migration note입니다.
6. Affected-package rationale, 패키지가 release set에 포함되거나 제외되는 이유입니다.

릴리스 준비 run의 모든 패키지는 하나의 disposition을 사용해야 합니다.

- `release`: release-readiness가 통과한 뒤 supervised CI-only release workflow를 통해 이 패키지를 publish합니다.
- `no-release`: 현재 release set에서 이 패키지를 publish하지 않고, release-intent record에 rationale을 남깁니다.
- `downstream-evaluate`: upstream 변경이 이 패키지에 영향을 줄 수 있어 review하지만, 이 disposition을 automatic downstream publishing으로 취급하지 않습니다.

이 작업이 landing된 뒤 준비되는 릴리스에는 package-scoped notes와 release-intent records가 필요합니다. `1.0.0-beta.2`는 첫 enforced fixture/candidate version이며, `1.0.0-beta.1` 이하의 릴리스는 legacy-compatible로 유지됩니다.


## Migration Assessment: Changesets and Beachball

현재 repo-local intent model이 승인된 release metadata path로 남습니다. 이 모델은 release decision을 committed JSON records 안에 두고, package disposition을 명시적으로 요구하며, `downstream-evaluate`를 automatic publish trigger가 아니라 review decision으로 취급합니다. `.github/workflows/release-single-package.yml`이 release-readiness 통과 뒤 `refs/heads/main`에서 요청된 패키지 하나만 publish하므로 supervised CI-only workflow와도 맞습니다.

Changesets는 contributor가 작성한 semver intent와 changelog text를 committed files에 기록한 뒤 version과 publish step에서 소비하므로 좋은 비교 대상입니다. Beachball은 PR에서 review 가능한 change files를 기록하고, 해당 파일 존재를 검증하며, version bump를 계산하고, changelog를 생성하고, package publish까지 수행할 수 있으므로 좋은 비교 대상입니다. 두 도구 모두 fluo의 release contract를 유지하면서 local publish path를 추가하지 않고 single-package CI boundary를 넓히지 않는다는 점이 증명되기 전까지는 승인하지 않습니다.

향후 migration proposal의 go/no-go criteria는 다음과 같습니다.

1. **Packages per release**: 일반 릴리스가 여러 `@fluojs/*` 패키지를 자주 포함하고 현재 single-package intent records가 generated release files보다 review하기 어려워질 때만 migration을 다시 검토합니다.
2. **Downstream evaluation frequency**: migration은 `downstream-evaluate` decision이 얼마나 자주 발생하는지 보여야 하며, 이를 automatic dependent-package release가 아니라 human review gate로 유지해야 합니다.
3. **Intent maintenance cost**: migration은 generated 또는 tool-managed change files가 repo-local intent JSON보다 maintainer work를 줄인다는 점을 증명해야 하며, package rationale을 review에서 숨기면 안 됩니다.
4. **Generated package changelog need**: migration은 maintainer가 root `CHANGELOG.md` narrative와 generated GitHub Release notes를 넘어 package-level changelogs를 필요로 할 때까지 기다려야 합니다.
5. **CI-only single-package compatibility**: migration은 main-only workflow dispatch, release-readiness preflight, OIDC npm publish, tag creation, GitHub Release generation을 `.github/workflows/release-single-package.yml` 안에 유지해야 하며, local `npm publish` replacement를 만들면 안 됩니다.

Recommendation: migration을 defer합니다. Package-aware release notes와 release intent gates가 적어도 한 번의 실제 release cycle을 완료하고 위 criteria가 migration이 release surface를 넓히는 대신 risk를 줄인다는 점을 보여주기 전까지 Changesets, Beachball, 또는 다른 release automation dependency를 설치하지 않습니다.

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
pnpm verify:release-readiness --target-package @fluojs/cli --target-version 0.1.0 --dist-tag latest
```

- `pnpm verify:platform-consistency-governance`는 heading parity와 governed 문서 일관성을 검사합니다.
- `pnpm verify:release-readiness`는 canonical build, typecheck, 분리된 Vitest, sandbox, package-surface 동기화, publish-safety 검사를 다시 실행합니다.
- `pnpm verify:public-export-tsdoc`는 governed 패키지에 적용되는 public export 문서 기준을 강제합니다.
- `pnpm generate:release-readiness-drafts`는 메인테이너가 릴리스 노트를 준비할 때 release-readiness summary 초안과 `CHANGELOG.md`의 draft release block을 갱신합니다.
- `pnpm verify:release-readiness --target-package ... --target-version ... --dist-tag ...`는 `.github/workflows/release-single-package.yml`이 사용하는 단건 패키지 publish preflight입니다.
