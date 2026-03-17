# 부트스트랩 경로 (bootstrap paths)

<p><a href="./bootstrap-paths.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 파일은 Konekti 앱을 부트스트랩하고 검증하기 위해 현재 지원되는 방법들을 기록합니다.

## 공개 부트스트랩 경로

CLI 패키지를 직접 사용하세요:

```sh
pnpm dlx @konekti/cli new my-app
```

이것이 표준 공개 부트스트랩 경로입니다.

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

## 레포지토리 로컬 smoke 경로

구현 레포지토리는 로컬 검증 명령어도 유지합니다:

```sh
pnpm --dir packages/cli run sandbox:test
pnpm --dir packages/cli run sandbox:create
pnpm --dir packages/cli run sandbox:verify
```

이것들은 구현 및 테스트 헬퍼이며, 공개 부트스트랩 계약이 아닙니다.

## 다음 단계 명령어 형태

스캐폴드는 패키지 매니저를 인식하는 다음 단계를 출력합니다. 예시:

```text
cd my-app
pnpm dev
```

## 관련 문서

- `./quick-start.md`
- `./generator-workflow.md`
- `../reference/naming-and-file-conventions.md`
