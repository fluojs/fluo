# Versioning & Release Rules

<p><strong><kbd>한국어</kbd></strong> <a href="./release-governance.md"><kbd>English</kbd></a></p>

auth/auth-http 분리는 기존 Passport·HTTP Principal·JwtPrincipal import와 class/error/DI identity를 유지하는 additive release입니다. 새 패키지는 Changesets로 versioning하며 기존 패키지의 import 제거·strategy signature 강제 변경·Principal 축소에는 별도의 major 승인과 migration 계약이 필요합니다.

## Stability Tiers

| Tier | Version window | Release rule | Contract level |
| --- | --- | --- | --- |
| Experimental | `0.x` | 공개 API는 마이너 릴리스에서 바뀔 수 있습니다. 프리릴리스 버전은 반드시 `latest`가 아닌 dist-tag로 배포해야 합니다. | 안정 업그레이드를 보장하지 않습니다. |
| Preview | `0.x` 또는 프리릴리스 빌드 | 외부 사용을 전제로 하지만, 파괴적 변경은 여전히 `0.x` 마이너 버전 규칙을 따르고 `CHANGELOG.md`에 소비자 대상 업그레이드 요구사항을 남겨야 합니다. | 문서화된 동작이 테스트와 릴리스 노트와 함께 유지되어야 합니다. |
| Official | `1.0+` | 안정 릴리스는 `latest`로 배포합니다. 파괴적 변경은 메이저 버전 증가가 필요합니다. | 공개 API, 문서화된 동작, 릴리스 절차를 안정 계약으로 취급합니다. |

## Semver Rules

- 모든 공개 `@fluojs/*` 패키지는 Semantic Versioning을 따릅니다.
- `major`는 `1.0+`에서 파괴적 변경이 있을 때 필요합니다.
- `minor`는 하위 호환 기능 추가에 사용하며, `0.x` 단계의 파괴적 변경에도 같은 증가 규칙을 사용합니다.
- `patch`는 문서화된 동작을 유지하는 하위 호환 수정, 보안 수정, 문서 또는 툴링 변경에만 사용합니다.
- 공개 tooling 패키지에서 README에 문서화되는 CLI command, flag, 생성 starter mode 또는 script, inspect artifact/output mode, programmatic entrypoint 추가는 소비자에게 보이는 feature work이므로 `minor` release metadata가 필요합니다. `patch`는 새 caller path를 추가하지 않고 이미 문서화된 계약을 수정하거나 보존하는 경우에만 해당 surface를 언급할 수 있습니다.
- Official 패키지의 `engines.node`를 좁히는 것은 기존에 지원하던 runtime을 제거하므로 파괴적 변경입니다. Release lane은 패키지의 이전 published `@fluojs/<name>@<version>` manifest tag를 baseline으로 사용하고, `--base-ref`는 변경된 candidate manifest를 고르는 데만 사용합니다. 제거되는 Node.js 지원과 대체할 Node.js version 또는 range를 명시적으로 식별하는 비어 있지 않은 `Migration:` 문단 또는 구조화된 `Migration Guide` / `Upgrade Guidance` section 및 `major` metadata가 필요합니다. `0.x`와 프리릴리스 Preview 패키지는 이 Official-tier major 규칙에서 제외됩니다.
- 프리릴리스 버전은 하이픈 접미사가 있는 버전입니다. 이런 버전은 `next`, `beta`, `rc` 같은 non-`latest` dist-tag로 배포해야 합니다.
- 프리릴리스 접미사가 없는 안정 버전은 `latest` dist-tag로 배포해야 합니다.
- 공개 배포 대상 패키지의 매니페스트는 내부 `@fluojs/*` 의존성에 대해 dependency, optional dependency, peer dependency, dev dependency 전부에서 `workspace:^`를 사용해야 합니다.

## Breaking Change Rules

- 기존 사용자 코드나 설정을 바꿔야 계속 동작하는 경우, API 형태 변경, 문서화된 동작 변경, 설정 형태 변경, 부트스트랩 순서 변경, 어댑터 계약 변경, 공개 패키지 제거를 파괴적 변경으로 취급합니다.
- 이전 released manifest에서 지원하던 Node.js version을 제외하는 더 좁은 `engines.node` range는 파괴적 변경으로 취급합니다.
- `0.x`에서는 파괴적 변경을 마이너 릴리스에서만 배포할 수 있고, 해당 릴리스는 `CHANGELOG.md`에 소비자 대상 업그레이드 요구사항을 포함해야 합니다.
- `1.0+`에서는 파괴적 변경을 메이저 릴리스로만 배포해야 합니다.
- 라이프사이클 순서, 종료 동작, 어댑터 동작, 준비 상태 동작, 공개 CLI 및 스타터 계약의 문서화된 보장을 바꾸는 경우 patch나 minor로 분류하면 안 됩니다.
- 파괴적 규칙이 바뀌면 구현, 테스트, governed 문서를 같은 변경에 함께 갱신해야 합니다.

## Graduation Requirements

패키지가 `1.0` 및 Official tier로 승격되려면 다음 조건이 계속 참이어야 합니다.

1. 패키지는 `packages/*` 아래의 기존 워크스페이스 패키지여야 하고, 공개 패키지 상태를 유지하며, `publishConfig.access`를 `public`으로 유지해야 합니다.
2. 패키지는 `docs/reference/package-surface.md`와 이 문서의 `## intended publish surface` 목록 양쪽에 모두 있어야 합니다.
3. public export는 저장소 TSDoc 기준을 충족해야 하고, 계약 문서는 영어와 한국어 parity를 유지해야 합니다.
4. 릴리스 검증은 canonical 저장소 명령을 통과해야 합니다: `pnpm build`, `pnpm typecheck`, `pnpm vitest run --project packages --maxWorkers=1`, `pnpm vitest run --project apps --maxWorkers=1`, `pnpm vitest run --project examples --maxWorkers=1`, `pnpm vitest run --project tooling --maxWorkers=1`, `pnpm --dir packages/cli sandbox:matrix`, `pnpm verify:platform-consistency-governance`, `pnpm verify:release-readiness`.
5. `CHANGELOG.md`는 `## [Unreleased]` 섹션을 유지해야 하고, 모든 `0.x` 파괴적 릴리스는 안정적인 `1.0+` 계약을 선언하기 전에 소비자에게 필요한 업그레이드 요구사항을 문서화해야 합니다.

## Release Metadata Contract

Canonical release workflow는 Node `24.x`에서 publish하며 Node 26은 사용하지 않습니다. Release job은 정확히 checkout된 release commit의 공통 `extended` 검증을 먼저 요구하며 이전 정기 실행 결과로 대체할 수 없습니다. Profile별 실행 task와 expanded job 수는 [Node.js Support의 canonical 표](../reference/node-support.ko.md#support-matrix)를 따르며 scoped PR은 영향 범위에 따라 선택합니다. Full PR은 고정된 primary Node 24의 전체 검증을 유지하고, exact `24.11.0`과 고정된 Node 26에서는 runtime별 fresh build를 수행하는 package 4개 shard와 4종 starter smoke task 1개를 실행하며 기존 native, packed-consumer, docs gate를 유지합니다. 보조 버전의 전체 static/tooling/apps/examples/browser 검증은 매 PR에서 정기 실행 및 publish 전 extended profile로 이동합니다. 이는 PR 검증 범위의 변경이며 package engine 지원 범위는 바꾸지 않습니다. Exact `24.0.0`은 workspace 설치와 Babel 없이 실행하는 필수 built-runtime 검증을 유지합니다. 로컬과 원격은 Linux/arm64 task catalog와 provenance-bound artifact를 공유합니다. [지원 및 마이그레이션](../reference/node-support.ko.md)을 참조하며, #3679는 기존 coordinated Node migration release를 계속 조정합니다.

Changesets(`.changeset/*.md`)는 canonical release metadata 도구입니다. 기여자는 PR 시점에 committed changeset 파일에 semver intent와 changelog text를 기록하고, Changesets GitHub Action은 이 파일들을 소비해 패키지 버전을 올리고, changelog를 생성하며, npm에 publish합니다. 패키지별 changelog는 자동으로 생성되고, 루트 `CHANGELOG.md`는 repo-wide narrative로 남습니다. GitHub Releases는 Changesets action이 자동으로 생성합니다.

각 changeset은 다음을 포함해야 합니다.

1. 영향받는 패키지 이름, published `@fluojs/*` package name을 사용합니다.
2. 패키지별 semver intent, `major`, `minor`, `patch` 중 하나입니다.
3. 변경 사항을 설명하는 summary.

Release reviewer는 semver metadata를 승인하기 전에 `.changeset/*.md`, generated package `CHANGELOG.md` section, 영향받은 package `README.md` 계약, 그리고 변경된 package `engines.node` range를 이전 published manifest tag와 비교해야 합니다. Official package가 `engines.node`를 좁히면 changeset은 `major`여야 하고, 제거되는 Node.js 지원과 대체할 Node.js version 또는 range를 명시적으로 연결하는 비어 있지 않은 `Migration:` 문단 또는 구조화된 `Migration Guide` / `Upgrade Guidance` section을 포함해야 하며 `verify:changeset-release-lane`이 이를 강제합니다. Changesets가 pending metadata를 소비한 뒤 생성된 major version delta는 생성된 `CHANGELOG.md` section에 `### Major Changes`와 소비자 migration guidance가 있을 때만 유효한 release output입니다. `@fluojs/cli` entry가 README에 문서화된 공개 CLI, starter, inspect, programmatic surface를 add, expose, support, introduce, enable, provide한다고 설명하면 해당 entry는 `minor`여야 하며, Version Packages PR을 merge하기 전에 patch metadata를 수정해야 합니다.

changeset에 없는 패키지는 해당 릴리스에서 version이 올라가거나 publish되지 않습니다. Downstream dependent 패키지는 Changesets의 내부 dependency graph를 통해 평가되며, dependent 버전 bump는 versioning 단계에서 자동으로 계산됩니다.

`.github/workflows/release.yml`의 릴리스 workflow는 `main`에 push될 때 자동으로 트리거됩니다. pending changeset이 있으면 Changesets action이 "Version Packages" PR을 열어 버전을 올리고, changelog를 업데이트하며, 소비된 changeset을 제거합니다. 이 PR을 merge하면 publish 단계가 트리거되어 npm token 기반 인증과 provenance로 영향받는 패키지를 npm에 publish하고, scoped git tag와 GitHub Release를 생성합니다. publish step은 같은 `secrets.NPM_TOKEN` 값을 Changesets action용 `NPM_TOKEN`과 `actions/setup-node`가 생성한 npm user config path용 `NODE_AUTH_TOKEN`으로 모두 전달합니다.

`main`은 단일 stable release lane입니다. `main` 대상 pull request와 release workflow는 모두 changeset lane gate를 실행합니다. `.github/workflows/release.yml`은 Changesets action이 Version Packages PR을 만들거나 publish하기 전에 checkout된 `main` commit에서 `pnpm verify:release-readiness`를 실행한 다음 `pnpm verify:changeset-release-lane -- --lane=stable --base-ref=${{ github.event.before }}`를 실행합니다. Stable gate는 `patch`, `minor`, `major` changeset과 generated package version delta를 모두 허용하되 release metadata 형태를 계속 검증합니다. 변경된 각 manifest의 `engines.node`는 패키지의 이전 published tag와 비교하며, Official package narrowing에는 `major` metadata 및 `Migration:` 안내가 필요합니다. Stable patch, minor, major release는 모두 canonical `main` Changesets GitHub Actions workflow를 통해 stable dist-tag policy로 publish합니다.

`major` changeset을 포함한 PR은 merge 전에 explicit maintainer approval과 consumer-facing migration note가 필요합니다. 이 승인 경로를 피하려고 semver intent를 낮추면 안 됩니다. 위 규칙상 breaking change라면 `major` changeset을 유지하고 migration impact를 문서화합니다.

Prerelease workflow는 Changesets prerelease mode(`changeset pre enter <tag>`)를 사용합니다. 필요할 때 dedicated branch에서 prerelease mode에 진입하고, stable 릴리스 전에 `changeset pre exit`로 종료합니다.

## Production Input Declarations

**범위와 소유자.** 소비자에게 보이는 변경의 Changeset 의무는 tarball에 직접 들어가는 파일뿐 아니라 배포 파일을 생성하거나 런타임에서 읽는 저장소 입력에도 적용됩니다. 내부 선언은 [`tooling/governance/package-production-inputs.json`](../../tooling/governance/package-production-inputs.json)이 소유하며, 이 절이 선언·신뢰·유지보수 계약을 정합니다. 각 공개 패키지와 producer의 `owner`는 입력 완전성을 검토할 책임자입니다. 초기 소유자는 `.github/CODEOWNERS`의 `@ayden94`를 따릅니다. 이 내부 계약 도입만으로 package runtime/API/publish 설정이나 버전을 바꾸지 않습니다.

**선언 형식.** 닫힌 version `1` 자료형은 `packages`, `producers`, `manifests`, `nonProduction`을 가집니다. 패키지는 생산 입력과 비배포 범위를, producer는 소비 공개 패키지와 build/generation/runtime reader의 전이 입력 및 실행 코드·설정 정의를 기록합니다. root/tooling/sibling consumer도 포함합니다. 경로는 저장소 상대 exact file 또는 `/`로 끝나는 directory prefix이며 glob, 상위 경로 이동, 중복과 없는 경로는 거부합니다. directory 입력의 `excludeTests`는 `.test.*`, 선택적인 `excludeTestFixtures`는 `.test-fixture.*` module에만 적용되는 명시적 규칙이고, `excludeDirectories`는 해당 입력 아래 존재하는 literal directory prefix만 허용합니다. 비배포 규칙의 `testsOnly`가 `true`이면 같은 test module 범위로 제한됩니다.

**판정 순서와 실패.** 공유 검증기 [`package-production-inputs.mjs`](../../tooling/governance/package-production-inputs.mjs)는 실제 issue head와 비교 base의 Git object를 읽습니다. 패키지 경계나 테스트·fixture·Markdown 이름보다 declared production 입력을 먼저 조회합니다. 개별 생산 입력이나 다른 producer의 입력 선언은 directory/test 제외와 `nonProduction`을 덮어씁니다. packed dist/bin/assets, manifest/runtime metadata, package-root README/LICENSE 및 starter/template의 소비자 영향도 유지합니다. 유효한 비배포 근거가 없는 변경은 보수적으로 consumer-visible입니다. 누락·잘못된 선언, public package inventory 불일치, 읽기 실패, 지원하지 않는 packaging 근거와 stale 정의는 면제 근거가 아니며 governance 검증도 nonzero로 실패합니다.

**유지보수와 한계.** 구조 검사는 임의 프로그램의 입력 완전성이나 비의존성을 증명하지 않습니다. package/build 소유자는 새 reader, 복사, import, 동적 경로 계산 또는 directory discovery가 실제 읽는 exact path나 충분한 directory 범위를 선언하고 검토해야 합니다. 문자열 검색 무일치, 테스트 이름, 외부 파일 부재 또는 선언 자체를 그 증명으로 사용하지 않습니다. 실행·설정 파일은 실제 bytes의 SHA-256으로, root/workspace manifest는 명령과 runtime layout의 의미 있는 projection으로 freshness를 확인합니다. 새 manifest나 생산 명령·lifecycle 연결, producer/config 정의가 바뀌면 근거를 갱신하고 소유자가 재검토합니다. payload, package version, dependency version 값만 바뀌어도 모든 producer 정의를 다시 고정하도록 만들지는 않습니다.

기존 입력·producer·consumer·정의의 삭제나 축소로 release impact를 지우지 않습니다. 현재 head는 모든 freshness 검사를 통과해야 합니다. coverage를 비교하는 과거 선언은 구조·inventory·경로·digest 형식을 검증하되 실행 코드와 manifest digest가 과거 bytes와 일치할 필요는 없습니다. 후속 커밋이 coverage를 유지하면서 stale 근거를 복구할 수 있기 때문입니다. classifier는 이 비교 base의 근거도 유지하고, governance는 제거·축소 또는 사용할 수 없는 과거 선언을 거부합니다. 새로운 선언이 없는 old base는 비배포의 증거가 아닙니다. 최초 선언의 구조 검증 성공도 old-base diff 면제를 뜻하지 않습니다. 그런 제외가 필요하면 merge 이후 유효한 선언이 있는 새 main에 대해 정식으로 재-preflight하며, Changeset 검사를 피하려고 진행 중인 lane의 고정 base나 engine을 바꾸지 않습니다.

선택적인 `definitionScopes`는 실행 코드·설정 정의만 담는 literal directory prefix를 지정합니다. 그 안에 새 tracked 파일이 생기면 실제 digest 항목이 없을 때 검증이 실패합니다. 현재 workflow 정의 inventory도 이 범위로 유지합니다. payload와 version 데이터는 `inputs`에 두며 이 정의 snapshot 범위에 넣지 않습니다.

**실행 근거.** plan은 build나 임의 선언 코드를 실행하지 않습니다. 기존 `pnpm verify:platform-consistency-governance`가 동일 검증기를 호출합니다.

```bash
node tooling/governance/package-production-inputs.mjs
pnpm verify:platform-consistency-governance
```

[`package-production-inputs.test.ts`](../../tooling/governance/package-production-inputs.test.ts)는 구조·경로·inventory·freshness·생산 우선순위·이전 입력 보존을 검증하고, [`verify-platform-consistency-governance.test.ts`](../../tooling/governance/verify-platform-consistency-governance.test.ts)는 실제 runner의 거부 전파를 검증합니다. CLI의 Git/worktree 회귀는 실제 monorepo의 비배포 테스트와 base부터 존재하는 계산된 root/sibling consumer, test 모양 입력의 산출물과 Changeset 전이를 함께 확인합니다. 새 reader와 그 입력·근거를 함께 갱신하는 것이 올바른 변경이며, `files` 밖이거나 `.test.mjs`라는 이유만으로 생산 입력을 면제하는 것은 잘못된 변경입니다.

## Deno deprecation advisory and registry metadata

Deno 지원은 제거되었습니다. `@fluojs/platform-deno`, `@fluojs/websockets/deno`, CLI Deno 대상을 [#3938](https://github.com/fluojs/fluo/issues/3938)에 따라 활성 워크스페이스에서 삭제했으며 아래 publish catalog에서도 `@fluojs/platform-deno`를 제거합니다. README URL은 아카이브 안내로 남고 이전 구현은 Git history와 npm tarball에 보존됩니다. [Canonical 이전 가이드](../getting-started/migrate-from-deno.ko.md)를 따르세요.

1단계에서는 호환성을 유지하는 폐기 안내를 제공했으며 `@fluojs/platform-deno`의 최종 공개 릴리스는 `2.0.2`입니다. 제거 전 source revision의 WebSockets와 CLI 버전은 `2.0.3`과 `4.0.1`이었지만, workspace 버전만으로 어떤 릴리스가 안내를 실행했는지 증명하지 않습니다. 2단계에서는 public subpath, starter 입력과 lifecycle 실행 계약을 제거하므로 `@fluojs/websockets`와 `@fluojs/cli`에 **MAJOR** Changeset(WebSockets 3, CLI 5)이 필요합니다. 두 공유 패키지 전체를 폐기하지 않습니다.

Phase 1의 canonical release workflow는 Changesets action 뒤에 `node tooling/release/deprecate-platform-deno.mjs`를 실행했습니다. Helper는 public npm의 `latest` version과 description이 advisory workspace manifest와 일치한 뒤에만 `@fluojs/platform-deno@*`에 npm deprecation metadata를 적용했고, 불일치는 metadata write 없이 `pending-advisory-release`를 반환했습니다. Write 전에 canonical migration guide가 raw GitHub URL로 공개 접근 가능한지 확인했으며 기존 `secrets.NPM_TOKEN`에서 전달받은 `NODE_AUTH_TOKEN`을 사용했습니다. Local publish 경로가 아닙니다.

1단계 canonical Changesets workflow에는 배포 후 일회성 npm 폐기를 위한 helper가 포함되어 있었습니다. 실제 안내 버전, 공개 이전 가이드와 prerelease를 포함한 모든 배포 버전을 확인하도록 설계되었습니다. 별도의 2026-11-03 npm registry 조회에서 18개 버전 전체의 deprecation metadata를 확인했습니다. 이는 최종 registry 상태의 증거이며, 어떤 workflow나 행위자가 변경했는지의 증거는 아닙니다. 상태 확인을 마친 2단계에서는 완료된 일회성 helper와 release step을 제거합니다. 로컬 publish나 unpublish를 추가하지 않습니다.

## intended publish surface

`@fluojs/diagnostics`는 Preview(`0.x`) portable 계약 패키지입니다. 공유 선언 소유권과 reader API는 기존 public import와 version-1 artifact를 유지하며 filter, transport, lifecycle 및 기능 status 정책은 기존 패키지에 남습니다.

- `@fluojs/diagnostics`
- `@fluojs/auth`
- `@fluojs/auth-http`
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
- `@fluojs/i18n`
- `@fluojs/jwt`
- `@fluojs/metrics`
- `@fluojs/microservices`
- `@fluojs/mongoose`
- `@fluojs/notifications`
- `@fluojs/openapi`
- `@fluojs/passport`
- `@fluojs/persistence`
- `@fluojs/platform-bun`
- `@fluojs/platform-cloudflare-workers`
- `@fluojs/platform-express`
- `@fluojs/platform-fastify`
- `@fluojs/platform-nextjs`
- `@fluojs/platform-nodejs`
- `@fluojs/prisma`
- `@fluojs/queue`
- `@fluojs/react`
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
- `@fluojs/vite`
- `@fluojs/websockets`

## Enforcement

버전 규칙, 릴리스 거버닝 문서, 공개 배포 대상 패키지가 바뀌면 다음 명령을 실행합니다.

```bash
pnpm build
pnpm typecheck
pnpm vitest run --project packages --maxWorkers=1
pnpm vitest run --project apps --maxWorkers=1
pnpm vitest run --project examples --maxWorkers=1
pnpm vitest run --project tooling --maxWorkers=1
pnpm --dir packages/cli sandbox:matrix
pnpm verify:public-export-tsdoc
pnpm verify:platform-consistency-governance
pnpm verify:release-readiness
pnpm verify:changeset-release-lane -- --lane=stable
pnpm generate:release-readiness-drafts
pnpm changeset status --since=main
```

- `pnpm verify:platform-consistency-governance`는 heading parity와 governed 문서 일관성을 검사합니다.
- `pnpm verify:release-readiness`는 canonical build, typecheck, 분리된 Vitest, sandbox, package-surface 동기화, publish-safety 검사를 다시 실행합니다.
- `pnpm verify:changeset-release-lane -- --lane=stable --base-ref=<ref>`는 PR CI와 Changesets action이 stable Version Packages PR을 만들거나 publish하기 전 단계에서 pending changeset과 generated package version delta를 검증합니다.
- `pnpm verify:public-export-tsdoc`는 governed 패키지에 적용되는 public export 문서 기준을 강제합니다.
- `pnpm generate:release-readiness-drafts`는 메인테이너가 릴리스 노트를 준비할 때 release-readiness summary 초안과 `CHANGELOG.md`의 draft release block을 갱신합니다.
- `pnpm changeset status --since=main`은 Version Packages PR을 merge하기 전에 Changesets가 version할 package와 semver bucket을 미리 보여줍니다.
