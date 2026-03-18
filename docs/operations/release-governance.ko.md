# 릴리스 거버넌스

<p><a href="./release-governance.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 문서는 Konekti의 현재 공개 릴리스 및 거버넌스 기대 사항을 설명합니다.

## 배포 대상 패키지

이 패키지들은 저장소가 현재의 프라이빗 워크스페이스 상태를 벗어난 후 공개 릴리스될 대상입니다:

- `@konekti/core`
- `@konekti/config`
- `@konekti/http`
- `@konekti/jwt`
- `@konekti/openapi`
- `@konekti/metrics`
- `@konekti/passport`
- `@konekti/redis`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/testing`
- `@konekti/cli`

현재 공개 릴리스 경계는 package-first입니다. 지원되는 공개 bootstrap 계약은 `pnpm add -g @konekti/cli` 후 `konekti new`이며, 공개 릴리스 표면은 출판되는 `@konekti/*` 패키지 제품군까지만 포함합니다.

`tooling/` 아래의 toolchain 워크스페이스는 향후 별도 이슈를 통해 공개 패키지로 승격되기 전까지 internal support artifact로 유지됩니다.

## 버전 관리 정책

- 공개 패키지에는 semver를 적용함
- 마이너(minor) 릴리스는 생성된 스타터 명령, 툴체인 설정 형태 및 문서화된 정식 CLI 부트스트랩 계약을 유지함
- 메이저(major) 릴리스는 공개 계약이 변경될 때 앱 업데이트를 요구할 수 있으며, 해당 릴리스와 함께 마이그레이션 노트를 제공해야 함
- 공개 패키지 계약이 함께 변경될 때 조정된 워크스페이스 릴리스를 진행함
- 내부 워크스페이스 버전 상향은 공개 릴리스 주기를 따르지만, 그 자체로 공개 API 보장을 의미하지는 않음

## 현재 extension 경계

- framework-owned metadata category만이 현재 문서화된 공개 metadata 계약입니다.
- 그 범위를 넘는 third-party decorator/metadata extension은 아직 지원되는 공개 보장이 아닙니다.

## 변경 로그 및 지원 중단(Deprecation) 정책

- 모든 공개 릴리스는 패키지 단위의 변경 사항과 마이그레이션 노트를 포함해야 함
- 패키지가 명시적으로 실험적/프리뷰 상태가 아닌 이상, 기능 제거 전 지원 중단을 먼저 공지해야 함
- 패키지 인터페이스 변경이 있는 동일한 릴리스 주기에 문서와 스캐폴드 출력을 업데이트해야 함

## 릴리스 체크리스트

1. `pnpm verify:release-candidate` 실행
2. 문서가 현재 패키지 인터페이스 및 부트스트랩 계약과 일치하는지 확인
3. 매니페스트 결정 노트가 여전히 벤치마크 증거와 일치하는지 확인

## 릴리스 후보(Release-Candidate) 게이트

`pnpm verify:release-candidate`는 현재 다음 사항을 검증합니다:

- 모노레포 루트에서 패키지 타입 체크 및 빌드 성공 여부
- 패키징된 CLI 엔트리포인트를 통해 스캐폴딩된 스타터 프로젝트 검증 및 `pnpm verify:release-candidate` 내에서 실행되는 CLI 테스트 스위트로 스타터 스캐폴딩 확인
- `pnpm`, `npm`, `yarn` 스타터 프로젝트 모두 `typecheck`, `build`, `test` 및 `konekti g repo ...` 통과 여부
- 생성된 스타터 프로젝트가 런타임 소유의 `/health`, `/ready`, `/metrics`, `/openapi.json`을 노출하는지 확인
- CLI 바이너리와 패키징된 아티팩트가 `src` 직접 실행이 아닌 `dist` 출력물에서 작동하는지 확인

또한 이 명령은 `tooling/release/release-candidate-summary.md`를 작성하며, CI는 이 요약본을 워크플로 요약 및 아티팩트로 게시합니다.

관련 CI 항목은 `.github/workflows/release-candidate.yml`에 위치합니다.
