# 테스트 가이드

<p><a href="./testing-guide.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 Konekti의 현재 테스트 및 검증 기준선을 설명합니다.

## 명령

저장소 루트에서 다음 명령을 사용합니다:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm verify:release-candidate
```

생성된 스타터 프로젝트도 선택한 패키지 매니저를 통해 동일한 명령을 제공합니다.

## 공식 테스트 API

`@konekti/testing`은 현재 다음과 같은 최소한의 공개 테스트 인터페이스를 제공합니다:

- `createTestingModule(...)`
- 프로바이더 오버라이드(override) 지원
- 부트스트랩/런타임 생명주기를 통한 예측 가능한 정리(cleanup)

현재 public boundary:

- `@konekti/testing`은 최소 public testing baseline으로 유지합니다.
- public testing API surface를 지금 확장하지 않습니다.
- 더 풍부한 generated test-template 계열도 지금 추가하지 않습니다.

주요 근거 자료:

- `packages/testing/src/module.ts`
- `packages/testing/src/module.test.ts`

## 런타임 및 슬라이스 커버리지

테스트를 확장할 때 다음 파일들을 계약 예시로 참고하세요:

- `packages/runtime/src/application.test.ts`
- `packages/http/src/dispatcher.test.ts`
- `packages/prisma/src/vertical-slice.test.ts`
- `packages/drizzle/src/vertical-slice.test.ts`

## 생성된 앱에 대한 기대 사항

`konekti new`는 실행 가능한 `src/app.test.ts`가 포함된 스타터 앱을 생성합니다. `packages/cli/src/cli.test.ts`의 스캐폴드 통합 커버리지는 새 프로젝트가 설치 직후 `typecheck`, `build`, `test`, `konekti g ...`를 실행할 수 있는지 검증하며, 생성된 앱 테스트 자체는 `/health`, `/ready`, `/metrics`, `/openapi.json` 작동 여부를 증명합니다.

기여자를 위한 수동 검증용으로 `packages/cli`는 이제 영구적인 샌드박스 하네스를 제공합니다:

```sh
pnpm --dir packages/cli run sandbox:test
```

이 명령은 로컬에 패키징된 워크스페이스 패키지를 사용하여 임시 샌드박스 경로의 `starter-app`을 갱신한 뒤, 설치된 CLI 바이너리에 대해 동일한 생성 앱 체크(`typecheck`, `build`, `test`, `pnpm exec konekti g repo User`)를 다시 실행합니다.

고급 로컬 설정을 위해 `KONEKTI_CLI_SANDBOX_ROOT=/path`를 여전히 사용할 수 있지만, 반드시 모노레포 워크스페이스 외부의 전용 디렉터리를 가리켜야 합니다. 레포 내부 경로는 경고와 함께 자동으로 임시 샌드박스 루트로 대체되어, 기여자 검증이 독립된 앱 환경에서 유지되도록 합니다.

모노레포 외부 게이트의 경우 `pnpm verify:release-candidate`를 사용하세요. 이 명령은 현재 CI용 공개 릴리스 후보 체크이며, 문서화된 `@konekti/cli` 흐름을 지원하는 패키징된 CLI 엔트리포인트와 스타터 스캐폴딩을 CLI 테스트 스위트로 실행합니다. 또한 CI에서 체크리스트 아티팩트로 게시할 수 있도록 `tooling/release/release-candidate-summary.md`를 생성합니다.
