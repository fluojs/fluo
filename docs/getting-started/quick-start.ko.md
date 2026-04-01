# 빠른 시작

<p><a href="./quick-start.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 Konekti의 표준 부트스트랩 프로세스를 설명합니다.

> [!IMPORTANT]
> Konekti는 TC39 표준 데코레이터(TypeScript 5.0+)를 사용합니다. `tsconfig.json`에서 레거시 데코레이터 플래그를 활성화하지 마세요:
> - `"experimentalDecorators": true` 설정을 피하세요.
> - `"emitDecoratorMetadata": true` 설정을 피하세요.
>
> NestJS와 달리, Konekti는 레거시 데코레이터나 메타데이터 생성에 의존하지 않습니다. 표준 TypeScript 설정으로 충분합니다.

## 표준 부트스트랩 경로

새 프로젝트를 시작하는 권장 방법은 Konekti CLI를 사용하는 것입니다:

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

위 명령이 공개 온보딩의 기본 경로입니다. 특별히 전역 설치 없이 한 번만 실행하려는 경우에만 아래 보조 경로를 사용하세요.

전역 설치 없이 `dlx`를 사용한 일회성 실행도 계속 지원됩니다:

```sh
pnpm dlx @konekti/cli new starter-app
```

### 관련 문서

- `./bootstrap-paths.ko.md` - 부트스트랩 규칙과 보조 경로 참고
- `./generator-workflow.ko.md`
- `../operations/testing-guide.ko.md`
- `../reference/package-surface.ko.md`

## 생성된 스타터 앱 구조

새로 생성된 애플리케이션에는 다음이 포함됩니다:

- `src/main.ts`: Node 부트스트랩을 포함한 애플리케이션 엔트리 포인트.
- `src/app.ts`: 메인 모듈 설정.
- 기본 제공되는 `/health` 및 `/ready` 엔드포인트.
- `/health-info/`에 위치한 예제 `health/` 모듈.
- 애플리케이션 시작 및 디스패칭을 검증하는 기본 테스트 스위트.

스타터 테스트 템플릿 설명은 `../operations/testing-guide.ko.md`를 참고하세요(unit 템플릿, 런타임 integration 템플릿, `createTestApp` 기반 e2e 스타일 템플릿, repo slice 템플릿 포함).

## 프로젝트 명령어

프로젝트 루트에서 다음 명령어를 실행하세요:

```sh
pnpm dev        # 개발 서버 시작
pnpm typecheck  # TypeScript 타입 체크 실행
pnpm build      # 프로덕션 빌드
pnpm test       # 테스트 실행
```

스캐폴드는 `pnpm`, `npm`, `yarn`과 호환되는 일관된 레이아웃을 생성합니다.

## 개발 모드 동작

`pnpm dev`는 생성된 Node watch 러너를 사용하므로, 소스 코드 변경은 인프로세스 HMR이 아니라 **프로세스 재시작**으로 반영됩니다.

반면 설정 파일 변경은 애플리케이션이 `watch: true`로 부트스트랩된 경우 더 좁은 범위의 **인프로세스 설정 reload** 경로를 사용할 수 있습니다.

소유권 분리와 현재 보장 범위는 `../concepts/dev-reload-architecture.ko.md`를 참고하세요.

## 컴포넌트 생성

새 리포지토리를 생성하려면:

```sh
konekti g repo User
```

CLI는 생성된 파일을 기본적으로 `src/` 디렉토리에 작성합니다.

## DTO 검증

DTO 바인딩과 검증은 별도의 패키지에서 처리됨에 유의하세요:

```ts
import { FromBody } from '@konekti/http';
import { IsString, MinLength } from '@konekti/validation';
```

## 업그레이드 정책

- 마이너 릴리스는 안정적인 명령어 세트와 파일 구조를 유지합니다.
- 메이저 릴리스에는 공개 계약에 대한 하위 호환되지 않는 변경 사항이 포함될 수 있으며, 수동 업데이트나 코드모드(codemod)가 필요할 수 있습니다.
- 레포지토리 내의 유틸리티 명령어는 내부 개발용이며 공개 API의 일부가 아닙니다.
