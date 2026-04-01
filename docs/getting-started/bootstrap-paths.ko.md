# 부트스트랩 경로 (bootstrap paths)

<p><a href="./bootstrap-paths.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 문서는 표준 첫 실행 경로를 이해한 뒤 참고하는 Konekti 부트스트랩 경로를 정리합니다.

## 표준 첫 실행 경로

전역 설치된 CLI를 사용하세요:

```sh
pnpm add -g @konekti/cli
konekti new my-app
cd my-app
pnpm dev
```

이것이 공개 온보딩의 기본 경로입니다.

한 번만 실행하는 zero-install 부트스트랩에는 아래 대안도 계속 지원됩니다:

```sh
pnpm dlx @konekti/cli new my-app
```

zero-install 경로는 여전히 지원되는 convenience이지만, 표준 공개 엔트리포인트는 아닙니다.

현재 지원되는 계약에는 별도의 공개 `create-konekti` wrapper가 없습니다. 나중에 compatibility wrapper가 추가되더라도, 암묵적인 별칭이 아니라 추가적인 surface로 명시적으로 문서화되어야 합니다.

## 다음 단계 명령어 형태

스캐폴드는 패키지 매니저를 인식하는 다음 단계를 출력합니다. 예시:

```text
cd my-app
pnpm dev
```

## 현재 입력 흐름

`konekti new`는 현재 다음 순서로 입력을 결정합니다:

1. 프로젝트 이름 (`--name` 또는 위치 인자)
2. 패키지 매니저 (`--package-manager`로 재정의 가능, 미지정 시 자동 감지)
3. 대상 디렉토리 (`--target-directory`로 재정의 가능, 미지정 시 `./<project-name>`)

의도적으로 묻지 않는 사항들:

- ORM이나 데이터베이스 선택 프롬프트 없음
- 테스트 러너 선택 프롬프트 없음
- 설치 건너뛰기 프롬프트 없음
- 번들된 `g resource` 생성기 흐름 없음

## 현재 scaffold 경계

현재 공개 scaffold 계약은 의도적으로 좁게 유지됩니다:

- 지원되는 패키지 매니저 전반에 걸쳐 하나의 안정적인 generated project shape 유지
- package-manager-aware install 및 run 명령 제공
- current-directory initialization 계약은 현재 제공하지 않음
- package-manager별 scaffold/template divergence는 현재 제공하지 않음

나중에 current-directory init이나 package-manager-specific output이 공식 지원이 되더라도, 암묵적 convenience가 아니라 명시적인 supported surface로 추가되어야 합니다.

## 레포지토리 로컬 smoke 경로

구현 레포지토리는 로컬 검증 명령어도 유지합니다:

```sh
pnpm --dir packages/cli run sandbox:test
pnpm --dir packages/cli run sandbox:create
pnpm --dir packages/cli run sandbox:verify
```

이것들은 구현 및 테스트 헬퍼이며, 공개 부트스트랩 계약이 아닙니다.

## 관련 문서

- `./quick-start.ko.md` - 표준 첫 실행 가이드로 돌아가기
- `./generator-workflow.ko.md`
- `../reference/toolchain-contract-matrix.ko.md`
