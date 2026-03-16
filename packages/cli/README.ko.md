# @konekti/cli

Konekti 공식 CLI — 새 앱을 부트스트랩하거나 기존 프로젝트에 파일을 생성합니다.

## 이 패키지가 하는 일

`@konekti/cli`는 두 가지 최상위 커맨드를 제공합니다.

- **`konekti new`** — 기본값 기반으로 스타터 프로젝트 스캐폴드 → 의존성 설치
- **`konekti generate <kind> <name>`** — 기존 프로젝트 안에 단일 파일(module, controller, service, repo, dto) 생성

## 설치

```bash
pnpm dlx @konekti/cli new my-app
```

## 빠른 시작

### 새 프로젝트 부트스트랩

```bash
pnpm dlx @konekti/cli new my-app
# 필요할 때만 override:
#   --package-manager <pnpm|npm|yarn>
#   --target-directory <path>
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

## 로컬 샌드박스 워크플로

Konekti 모노레포 안에서 작업할 때는 prerelease를 publish하지 말고 패키지 전용 샌드박스를 사용하세요.

```bash
pnpm --dir packages/cli run sandbox:test
```

이 명령은 `@konekti/cli`를 다시 빌드하고, standalone temp 샌드박스 경로 자체에 `starter-app`을 스캐폴드한 뒤, 워크스페이스 로컬 tarball을 설치하고 생성된 앱에서 `typecheck`, `build`, `test`, `pnpm exec konekti g repo User`까지 검증합니다.

`KONEKTI_CLI_SANDBOX_ROOT=/path`는 고급 override로 계속 사용할 수 있지만, 반드시 모노레포 워크스페이스 바깥의 전용 디렉터리를 가리켜야 합니다. repo 내부 경로를 지정하면 harness가 경고를 출력하고 temp 샌드박스 루트로 자동 fallback해서 `pnpm install`이 워크스페이스 install로 흡수되지 않게 합니다.

반복 작업 시에는 아래 명령을 사용하면 됩니다.

```bash
pnpm --dir packages/cli run sandbox:create
pnpm --dir packages/cli run sandbox:verify
pnpm --dir packages/cli run sandbox:clean
```

패키지 전용 Vitest 스위트는 `pnpm --dir packages/cli run test`로 실행할 수 있습니다.

## 핵심 API

| 익스포트 | 위치 | 설명 |
|---|---|---|
| `runCli(options?)` | `src/cli.ts` | CLI 바이너리 진입점 |
| `runNewCommand(argv, runtime?)` | `src/commands/new.ts` | 프롬프트 → 스캐폴드 → 설치 → 안내 출력 |

## 구조

Generator는 `GeneratedFile[]`을 반환하며 파일 시스템에 직접 접근하지 않습니다. 파일 쓰기는 커맨드 레이어가 담당합니다. 이 분리 덕분에 generator를 디스크 없이 테스트할 수 있고, 향후 dry-run이나 preview 모드로 확장하기도 쉽습니다.

`repo` generator는 generic-only입니다. persistence stack을 전제하지 않는 레포지토리 stub을 만들고, Prisma나 Drizzle service를 자동으로 연결하지 않습니다.

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
    → 기본값 해석
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

- **`@konekti/prisma`** / **`@konekti/drizzle`** — 앱이 필요할 때 직접 추가하는 optional adapter

## 한 줄 mental model

```
@konekti/cli = Konekti의 canonical bootstrap + generator command surface
```
