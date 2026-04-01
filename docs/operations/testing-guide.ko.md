# testing guide

<p><strong><kbd>한국어</kbd></strong> <a href="./testing-guide.md"><kbd>English</kbd></a></p>

이 가이드는 Konekti의 현재 테스트 및 검증 기준선을 설명합니다.

## commands

저장소 루트에서 다음 명령을 사용합니다:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm verify:release-readiness
```

생성된 스타터 프로젝트도 선택한 패키지 매니저를 통해 동일한 명령을 제공합니다.

## official testing API

`@konekti/testing`은 현재 다음과 같은 최소하지만 실용적인 공개 테스트 인터페이스를 제공합니다:

- `createTestingModule(...)`
- 프로바이더 오버라이드(override) 지원
- `TestingModuleRef.resolve(...)`
- `TestingModuleRef.dispatch(...)`
- 엔드투엔드 스타일 요청 실행을 위한 `createTestApp(...)`
- 빌더 없이 직접 요청을 실행하는 `TestApp.dispatch(...)`
- 요청 principal 주입을 포함한 플루언트 request 빌더
- `createTestApp().close()`를 통한 예측 가능한 정리(cleanup)

현재 public boundary:

- `@konekti/testing`은 최소 public testing baseline으로 유지합니다.
- 공개 표면은 모듈 컴파일, dispatch, 경량 request 헬퍼에 집중합니다.
- 현재 공식 generated 템플릿은 다음을 포함합니다:
  - 스타터 unit 템플릿: `src/health/*.test.ts`
  - 스타터 integration 템플릿: `src/app.test.ts`
  - 스타터 e2e 스타일 템플릿: `src/app.e2e.test.ts` (`createTestApp` 사용)
  - 슬라이스 unit 템플릿: `konekti g repo <Name>`가 생성하는 `<name>.repo.test.ts`
  - 슬라이스 integration 템플릿: `konekti g repo <Name>`가 생성하는 `<name>.repo.slice.test.ts` (`createTestingModule` 사용)
- 빠른 로직 검증에는 unit 템플릿을, 모듈 wiring/라우트 수준 검증에는 slice/e2e 템플릿을 선택하세요.

주요 근거 자료:

- `packages/testing/src/module.ts`
- `packages/testing/src/app.ts`
- `packages/testing/src/http.ts`
- `packages/testing/src/module.test.ts`
- `packages/testing/README.ko.md`

## runtime and slice coverage

테스트를 확장할 때 다음 파일들을 계약 예시로 참고하세요:

- `packages/runtime/src/application.test.ts`
- `packages/http/src/dispatcher.test.ts`
- `packages/prisma/src/vertical-slice.test.ts`
- `packages/drizzle/src/vertical-slice.test.ts`

## generated app expectations

`konekti new`는 integration과 e2e 스타일 모두를 포함한 스타터 테스트(`src/app.test.ts`, `src/app.e2e.test.ts`)를 생성합니다. `packages/cli/src/cli.test.ts`의 스캐폴드 통합 커버리지는 새 프로젝트가 설치 직후 `typecheck`, `build`, `test`를 실행할 수 있는지 검증하고, 이어서 repo 슬라이스를 생성한 뒤 `user.repo.test.ts`, `user.repo.slice.test.ts` 템플릿과 함께 `typecheck` 및 `test`를 다시 검증합니다.

기여자를 위한 수동 검증용으로 `packages/cli`는 이제 영구적인 샌드박스 하네스를 제공합니다:

```sh
pnpm --dir packages/cli run sandbox:test
```

이 명령은 로컬에 패키징된 워크스페이스 패키지를 사용하여 임시 샌드박스 경로의 `starter-app`을 갱신한 뒤, 생성 앱 체크(`typecheck`, `build`, `test`)를 실행하고 설치된 CLI 바이너리로 `konekti g repo User`를 수행한 다음, 생성된 repo 템플릿까지 포함해 `typecheck`와 `test`를 다시 검증합니다.

고급 로컬 설정을 위해 `KONEKTI_CLI_SANDBOX_ROOT=/path`를 여전히 사용할 수 있지만, 반드시 모노레포 워크스페이스 외부의 전용 디렉터리를 가리켜야 합니다. 레포 내부 경로는 경고와 함께 자동으로 임시 샌드박스 루트로 대체되어, 기여자 검증이 독립된 앱 환경에서 유지되도록 합니다.

모노레포 외부 게이트의 경우 `pnpm verify:release-readiness`를 사용하세요. 이 명령은 현재 공개 릴리스 준비도 체크이며, 문서화된 `@konekti/cli` 흐름을 지원하는 패키징된 CLI 엔트리포인트와 스타터 스캐폴딩을 CLI 테스트 스위트로 실행합니다. 또한 `tooling/release/release-readiness-summary.md`를 생성하고, 루트 `CHANGELOG.md`의 `## [Unreleased]`에 릴리스 준비도 드래프트 항목을 갱신합니다.
