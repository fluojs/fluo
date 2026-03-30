# release governance

<p><strong><kbd>한국어</kbd></strong> <a href="./release-governance.md"><kbd>English</kbd></a></p>

이 문서는 Konekti의 현재 공개 릴리스 및 거버넌스 기대 사항을 설명합니다.

## stability contract

- `0.x`: 공개 API는 여전히 안정화 단계입니다. 마이너 릴리스에서 breaking changes가 허용되며 반드시 마이그레이션 노트를 포함해야 합니다.
- `1.0+`: 공개 계약이 안정된 상태입니다. breaking changes는 메이저 버전 상향과 공개된 마이그레이션 가이드를 필요로 합니다.

### `1.0` graduation criteria

다음 조건이 모두 충족될 때만 `1.0` 버전을 릴리스합니다:

- 안정적인 공개 API 표면이 문서화되어 있고 `docs/reference/package-surface.ko.md`를 통해 검증되었습니다.
- `0.x` 기간 동안 도입된 모든 breaking change에 대한 마이그레이션 가이드가 존재합니다.
- 공개 패키지 계약에 대한 전체 테스트 커버리지(단위/통합/CLI 스모크 체크)가 CI에서 통과합니다.
- 릴리스 및 지원 정책이 공개적으로 문서화되었습니다 (changelog + GitHub Releases + release governance 문서).

## intended publish surface

다음 패키지들은 0.x 라인의 현재 공개 릴리스 대상입니다:

- `@konekti/core`
- `@konekti/config`
- `@konekti/dto`
- `@konekti/http`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/platform-fastify`
- `@konekti/platform-socket.io`
- `@konekti/microservices`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/openapi`
- `@konekti/graphql`
- `@konekti/serializer`
- `@konekti/metrics`
- `@konekti/cron`
- `@konekti/cqrs`
- `@konekti/event-bus`
- `@konekti/websocket`
- `@konekti/queue`
- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/mongoose`
- `@konekti/terminus`
- `@konekti/testing`
- `@konekti/cli`

## 지원 및 승격 정책 (support and promotion policy)

지원 티어 용어(`official`, `preview`, `experimental`)는 `../reference/glossary-and-mental-model.ko.md`에서 정의합니다.

런타임, 어댑터, 통합을 더 높은 지원 티어로 승격시키려면 다음이 필요합니다:

- 완전한 문서화 및 예제 제공
- 전체 테스트 커버리지 및 CI 검증
- 전용 트러블슈팅 가이드 제공

추가 런타임이나 통합은 package README나 거버넌스 문서에 명시적으로 문서화되지 않는 한 공개 보장이 아닙니다. 현재 공식 런타임 지원은 Node.js로 제한되며, Bun 및 fetch 스타일 어댑터는 **preview** 상태로 유지됩니다.

공개 부트스트랩 계약은 package-first를 유지합니다. `pnpm add -g @konekti/cli` 이후 `konekti new`를 사용하며, 릴리스 표면은 출판된 `@konekti/*` 패키지 제품군으로 한정됩니다.

이 패키지 목록은 `../reference/package-surface.ko.md`와 동일하게 유지되어야 합니다.

`tooling/` 아래의 툴체인 워크스페이스는 향후 명시적으로 공개 패키지 표면으로 승격되지 않는 한 내부 지원 아티팩트로 남습니다.

## versioning policy

- 공개 패키지에 semver를 적용합니다.
- 마이너 릴리스는 생성된 스타터 명령어, 툴체인 설정 형태, 문서화된 표준 CLI 부트스트랩 계약을 유지합니다.
- 메이저 릴리스는 공개 계약이 변경될 때 앱 업데이트를 요구할 수 있으며, 해당 릴리스와 함께 마이그레이션 노트를 제공해야 합니다.
- 공개 패키지 계약이 함께 변경될 때 조정된 워크스페이스 릴리스가 진행됩니다.
- 내부 워크스페이스 버전 상향은 공개 릴리스 주기를 따르지만, 그 자체로 공개 API 약속은 아닙니다.

## current extension boundary

- 프레임워크 소유의 메타데이터 카테고리만이 현재 문서화된 공개 메타데이터 계약입니다.
- 프레임워크 소유 카테고리를 넘어서는 제3자 데코레이터/메타데이터 확장은 아직 지원되는 공개 보장 대상이 아닙니다.

## changelog and deprecation policy

- 모든 공개 릴리스는 패키지 레벨의 변경 사항과 마이그레이션 노트를 포함해야 합니다.
- 패키지가 여전히 명시적으로 experimental/preview 상태가 아닌 한, 제거 전에 deprecation을 먼저 공지해야 합니다.
- 문서와 스캐폴드 출력은 인터페이스 변경이 있는 동일한 릴리스 주기에 업데이트되어야 합니다.
- 루트 `CHANGELOG.md`는 공개 릴리스 히스토리의 소스이며 Keep a Changelog 구조를 따릅니다.
- `pnpm verify:release-candidate`는 `CHANGELOG.md`의 `## [Unreleased]`에 있는 릴리스 후보 드래프트를 업데이트합니다.

## release checklist

1. `pnpm verify:release-candidate` 실행
2. 문서가 현재 패키지 표면 및 부트스트랩 계약과 일치하는지 확인
3. 매니페스트 결정 노트가 여전히 벤치마크 증거와 일치하는지 확인
4. 릴리스 태그에 대응하는 GitHub Release 본문이 `CHANGELOG.md`에서 파생되었는지 확인
5. `tooling/release/release-candidate-summary.md`를 GitHub Release에 첨부

## release-candidate gate

`pnpm verify:release-candidate`는 현재 다음을 검증합니다:

- 모노레포 루트에서 패키지 타입 체크 및 빌드 성공
- 패키징된 CLI 엔트리포인트를 통해 스캐폴딩된 스타터 프로젝트 검증 및 CLI 테스트 스위트를 통한 스타터 스캐폴딩 확인
- `pnpm` 스타터 프로젝트 경로가 `typecheck`, `build`, `test`, `konekti g repo ...`를 통과하며, CLI 테스트가 패키지 매니저 선택 동작을 별도로 커버함
- 생성된 스타터 프로젝트가 런타임 소유의 `/health` + `/ready`와 스타터 소유의 `/health-info/` 라우트를 노출함
- CLI 바이너리와 패키징된 아티팩트가 `src` 직접 실행이 아닌 `dist` 출력물에서 작동함

이 명령어는 또한 `tooling/release/release-candidate-summary.md`를 작성하며, CI는 이 요약본을 워크플로 요약 및 아티팩트로 게시합니다.

관련 CI 항목은 `.github/workflows/release-candidate.yml`에 위치합니다.

## GitHub Releases

- 태그 기반 릴리스는 `.github/workflows/github-release.yml`을 사용합니다.
- 각 `v*` 태그는 `CHANGELOG.md`의 해당 섹션을 본문으로 사용하는 GitHub Release를 생성합니다.
- 각 GitHub Release는 `tooling/release/release-candidate-summary.md`를 릴리스 에셋으로 업로드합니다.
