# 빠른 시작 (quick start)

<p><a href="./quick-start.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 현재 Konekti의 공개 부트스트랩 경로를 설명합니다.

## 표준 부트스트랩 경로

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

이것이 현재 지원되는 공식적인 공개 엔트리포인트입니다.

한 번만 실행하는 zero-install 부트스트랩에는 아래 대안도 계속 지원됩니다:

```sh
pnpm dlx @konekti/cli new starter-app
```

`pnpm add -g @konekti/cli` + `konekti new ...` 경로가 이제 표준 공개 부트스트랩 흐름입니다.

참고 항목:

- `./bootstrap-paths.md`
- `./generator-workflow.md`
- `../reference/package-surface.md`

## 생성된 스타터 앱 구조

새 앱에는 현재 다음이 포함되어 있습니다:

- 런타임 소유의 Node 부트스트랩을 포함한 `src/main.ts`
- 스타터 모듈 연결을 포함한 `src/app.ts`
- 런타임 소유의 `/health` 및 `/ready`
- `/health-info/`를 노출하는 스타터 소유 `health/` 모듈
- 앱이 올바르게 부팅되고 디스패치되는지 증명하는 스타터 테스트

## 생성된 프로젝트 명령어

생성된 프로젝트 루트에서 실행하세요:

```sh
pnpm dev
pnpm typecheck
pnpm build
pnpm test
```

스캐폴드는 `pnpm`, `npm`, `yarn`에 대해 동일한 단일 프로젝트 레이아웃을 생성하며, 설치 및 실행 명령어는 사용 중인 패키지 매니저를 인식합니다.

## 첫 번째 생성기 명령어

프로젝트 루트에서 리포지토리를 생성합니다:

```sh
konekti g repo User
```

CLI는 생성된 앱의 `src/` 디렉토리에 파일을 기본으로 작성합니다.

## 기억해야 할 DTO 규칙

DTO 바인딩과 DTO 검증은 서로 다른 패키지에서 제공됩니다:

```ts
import { FromBody } from '@konekti/http';
import { IsString, MinLength } from '@konekti/dto-validator';
```

## 업그레이드 기대 사항

- 마이너 릴리스는 문서화된 스타터 명령어 세트와 파일 구조를 안정적으로 유지합니다. 단, 문서에서 해당 부분을 내부 전용으로 명시한 경우는 제외합니다.
- 메이저 릴리스에서는 공개 계약이 변경될 때 코드모드(codemods)나 수동 수정이 필요할 수 있습니다.
- 레포지토리 로컬의 smoke 명령어는 구현 지원용이며 공개 부트스트랩 계약이 아닙니다.
