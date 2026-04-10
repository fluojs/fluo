# @fluojs/cli

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 공식 CLI — 새 애플리케이션 부트스트랩, 컴포넌트 생성, 그리고 레거시 프레임워크로부터의 마이그레이션을 지원합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add -g @fluojs/cli
```

설치 없이 직접 실행하려면:

```bash
pnpm dlx @fluojs/cli new my-app
```

## 사용 시점

- **부트스트랩**: 표준적이고 검증 가능한 구조로 새 프로젝트를 시작할 때.
- **코드 생성**: 일관된 네이밍 규칙과 자동 연결 기능을 갖춘 모듈, 컨트롤러, 서비스, 레포지토리를 생성할 때.
- **마이그레이션**: 기존 NestJS 애플리케이션을 fluo의 표준 데코레이터 모델로 전환할 때.
- **검사(Inspection)**: 런타임 의존성 그래프를 시각화하고 플랫폼 수준의 문제를 진단할 때.

## 빠른 시작

### 1. 새 프로젝트 생성
몇 초 만에 완전한 스타터 애플리케이션을 스캐폴딩합니다.

```bash
fluo new my-app
cd my-app
pnpm dev
```

### 2. 기능 추가
컨트롤러와 서비스가 포함된 새 리소스를 추가하고, 모듈에 자동으로 연결합니다.

```bash
fluo generate module users
fluo generate controller users
fluo generate service users
```

## 주요 패턴

### NestJS에서 fluo로 마이그레이션
코드베이스를 TC39 표준 데코레이터에 맞게 조정하기 위해 안전한 1차 codemod를 실행합니다.

```bash
# 변경 사항 미리보기 (dry-run)
fluo migrate ./src

# 변환 적용
fluo migrate ./src --apply
```

**주요 변환 사항:**
- `@nestjs/common` 임포트를 `@fluojs/core` 또는 `@fluojs/http`로 재작성합니다.
- `@Injectable()`을 제거하고 스코프를 `@Scope()`로 매핑합니다.
- `tsconfig.json`을 업데이트하여 `experimentalDecorators`를 비활성화하고 `baseUrl` 기반 경로 별칭을 TS6-safe `paths` 엔트리로 재작성합니다.

### 런타임 검사 (Inspection)
애플리케이션 구조를 시각화하고 초기화 문제를 해결합니다.

```bash
# 의존성 그래프를 Mermaid 형식으로 내보내기
fluo inspect ./src/app.module.ts --mermaid

### @fluojs/studio용 snapshot 내보내기
fluo inspect ./src/app.module.ts --json > snapshot.json
```

## 공개 API 개요

다른 도구 내에서 CLI 동작을 트리거하기 위해 패키지를 프로그래밍 방식으로 사용할 수 있습니다.

| 익스포트 | 설명 |
|---|---|
| `runCli(argv?, options?)` | 모든 CLI 명령을 실행하는 메인 진입점입니다. |
| `runNewCommand(argv, options?)` | 프로젝트 스캐폴딩 로직에 대한 프로그래밍적 접근을 제공합니다. |
| `GeneratorKind` | 지원되는 모든 생성기 유형(예: `'controller'`, `'service'`)의 유니온 타입입니다. |

## 관련 패키지

- **[@fluojs/runtime](../runtime/README.ko.md)**: 검사 및 부트스트랩에 사용되는 기본 엔진입니다.
- **[@fluojs/studio](../studio/README.ko.md)**: `inspect --json` 출력을 시각화하기 위한 웹 기반 UI입니다.
- **[@fluojs/testing](../testing/README.ko.md)**: 통합 및 E2E 테스트를 위해 생성된 테스트 템플릿에서 사용됩니다.
- **[Canonical Runtime Package Matrix](../../docs/reference/package-surface.ko.md)**: 공식 런타임/패키지 조합을 보여주는 기준 문서입니다.

## 예제 소스

- [cli.ts](./src/cli.ts) - 명령 디스패처 및 인자 파싱.
- [commands/new.ts](./src/commands/new.ts) - 프로젝트 스캐폴딩 구현.
- [generators/](./src/generators/) - 템플릿 기반 파일 생성 로직.
- [transforms/](./src/transforms/) - 마이그레이션 codemod 구현.
