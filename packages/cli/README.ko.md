# @konekti/cli

Konekti 공식 CLI — 새 앱을 부트스트랩하거나 기존 프로젝트에 파일을 생성합니다.

## 이 패키지가 하는 일

`@konekti/cli`는 두 가지 최상위 커맨드를 제공합니다.

- **`konekti new`** — 대화형 프롬프트 → 스타터 프로젝트 스캐폴드 → 의존성 설치
- **`konekti generate <kind> <name>`** — 기존 프로젝트 안에 단일 파일(module, controller, service, repo, dto) 생성

## 설치

```bash
pnpm dlx @konekti/cli new my-app
```

## 빠른 시작

### 새 프로젝트 부트스트랩

```bash
pnpm dlx @konekti/cli new my-app
# 대화형 프롬프트 진행:
#   프로젝트 이름, ORM (Prisma / Drizzle), 데이터베이스, 패키지 매니저, 대상 디렉터리
```

### 기존 프로젝트에 파일 생성

```bash
konekti generate module users
konekti generate controller users
konekti generate service users
konekti generate repo users
konekti generate dto create-user
```

각 generator는 kebab-case 파일명과 PascalCase 클래스명을 가진 파일을 생성합니다.

## 핵심 API

| 익스포트 | 위치 | 설명 |
|---|---|---|
| `runCli(options?)` | `src/cli.ts` | CLI 바이너리 진입점 |
| `runNewCommand(argv, runtime?)` | `src/commands/new.ts` | 프롬프트 → 스캐폴드 → 설치 → 안내 출력 |

## 구조

Generator는 `GeneratedFile[]`을 반환하며 파일 시스템에 직접 접근하지 않습니다. 파일 쓰기는 커맨드 레이어가 담당합니다. 이 분리 덕분에 generator를 디스크 없이 테스트할 수 있고, 향후 dry-run이나 preview 모드로 확장하기도 쉽습니다.

`repo` generator는 **preset-aware**합니다. `{ preset: 'prisma' }` 또는 `{ preset: 'drizzle' }`를 넘기면 선택한 ORM에 맞는 트랜잭션-aware 레포지토리 템플릿이 생성됩니다.

```
konekti generate:
  runGenerateCommand(kind, name, targetDir, options?)
    → generator 선택
    → 이름 변환 (kebab / Pascal)
    → GeneratedFile[]
    → mkdir targetDir
    → 각 파일 디스크에 쓰기

konekti new:
  runNewCommand(argv)
    → 프롬프트 답변 수집
    → 지원 티어 안내 출력
    → scaffoldBootstrapApp(options)
    → 설치
    → 다음 단계 안내 출력
```

## 파일 읽기 순서 (기여자용)

1. `src/types.ts` — generator 종류와 파일 shape
2. `src/generators/utils.ts` — 이름 변환
3. `src/generators/*.ts` — 종류별 generator
4. `src/commands/generate.ts` — 오케스트레이션
5. `src/generators.test.ts` — 출력 baseline 테스트

## 관련 패키지

- **`@konekti/prisma`** / **`@konekti/drizzle`** — preset-aware repo generator가 생성하는 결과물

## 한 줄 mental model

```
@konekti/cli = Konekti의 canonical bootstrap + generator command surface
```
