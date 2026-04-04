# @konekti/cli

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 공식 CLI — 새 앱을 부트스트랩하거나 기존 프로젝트에 파일을 생성합니다.

## 관련 문서

- `../../docs/getting-started/quick-start.ko.md`
- `../../docs/getting-started/bootstrap-paths.ko.md`
- `../../docs/getting-started/generator-workflow.ko.md`

## 이 패키지가 하는 일

`@konekti/cli`는 다섯 가지 최상위 커맨드와 alias를 제공합니다.

- **`konekti new`** — 기본값 기반으로 스타터 프로젝트 스캐폴드 → 의존성 설치
- **`konekti generate <kind> <name>`** — 하나 이상의 파일을 생성하고, 필요한 경우 모듈 등록도 함께 갱신
- **`konekti inspect <module-path>`** — 공유 런타임 플랫폼 snapshot/diagnostic payload(JSON/Mermaid 의존 그래프) 또는 opt-in 부트스트랩 타이밍을 출력
- **`konekti migrate <path>`** — 안전한 NestJS → Konekti codemod 실행 (기본 dry-run)
- **`konekti help [command]`** — 최상위 또는 커맨드별 도움말 출력

현재 공개 scaffold 계약은 하나의 안정적인 generated project shape입니다. package-manager 차이는 install/run 명령과 lockfile 출력에만 한정되며, 별도의 current-directory-init 모드나 package-manager별 scaffold template 계열은 현재 없습니다.

이 안정적인 스타터 shape에는 `src/main.ts`의 `const app = await KonektiFactory.create(AppModule, {}); await app.listen();`, 런타임 모듈 엔트리포인트를 canonical `*.forRoot(...)` 네이밍(예: `ConfigModule.forRoot(...)`)으로 유지하는 `AppModule` import, 런타임 소유 `/health` + `/ready`, 스타터 소유 `/health-info/`, 그리고 공식 스타터 테스트 템플릿(`src/health/*.test.ts`, `src/app.test.ts`, `src/app.e2e.test.ts`)이 포함됩니다.

생성/마이그레이션 가이드의 네이밍 정책:

- 런타임 모듈 엔트리포인트는 `docs/reference/package-surface.ko.md` 규칙에 따라 canonical 이름(`forRoot(...)`, 필요 시 `forRootAsync(...)`, `register(...)`, `forFeature(...)`)을 사용합니다.
- 런타임 모듈 엔트리포인트가 아닌 helper/builder는 `create*` 네이밍을 유지합니다(`createTestingModule(...)`, `createHealthModule()`).

## 설치

```bash
pnpm add -g @konekti/cli
```

설치 후에는 `konekti` 바이너리를 직접 사용하면 됩니다.

처음 실행하는 표준 경로는 다음과 같습니다: CLI 설치 -> `konekti new my-app` -> `cd my-app` -> `pnpm dev`.

## 빠른 시작

### 새 프로젝트 부트스트랩

```bash
konekti new my-app
cd my-app
pnpm dev
```

첫 실행은 위 흐름을 사용하고, 필요할 때만 아래 override를 추가하세요.

```bash
konekti new my-app
# 필요할 때만 override:
#   --package-manager <pnpm|npm|yarn>
#   --target-directory <path>
```

`--target-directory`는 인자 순서와 무관하게 positional 프로젝트 이름보다 항상 우선합니다.

생성된 `dev` 스크립트는 Node watch mode와 `tsx` 기반의 재시작 경로를 사용합니다. 즉, 소스 수정 시 인프로세스 HMR이 아니라 프로세스 재시작이 일어납니다.

한 번만 실행하는 zero-install 부트스트랩에는 `pnpm dlx @konekti/cli new my-app`도 보조 경로로 계속 지원됩니다.

전체 온보딩 흐름은 `../../docs/getting-started/quick-start.ko.md`부터 시작하세요.

### 기존 프로젝트에 파일 생성

```bash
konekti generate module users
konekti generate controller users
konekti generate service users
konekti generate repo users
konekti generate request-dto create-user
konekti generate response-dto user-profile
```

구현된 generator 종류는 `controller`, `guard`, `interceptor`, `middleware`, `module`, `repository`/`repo`, `request-dto`, `response-dto`, `service`입니다.

각 generator는 kebab-case 파일명과 PascalCase 클래스명을 가진 하나 이상의 파일을 생성합니다.

생성 후 CLI 출력에는 다음이 포함됩니다:
- 작성된 각 파일에 대한 `CREATE` 라인.
- **Wiring** 상태 라인: `auto-registered`(클래스가 도메인 모듈에 추가됨) 또는 `files only`(수동 등록 필요).
- 해당 generator 종류에 맞는 권장 후속 작업이 포함된 **Next steps** 힌트.

### NestJS 마이그레이션 codemod 실행

```bash
# 기본 동작: dry-run
konekti migrate ./src

# 실제 파일 쓰기
konekti migrate ./src --apply

# transform 선택/제외
konekti migrate ./src --only imports,bootstrap,testing
konekti migrate ./src --skip testing
```

현재 1차 안전 변환 범위:

- import rewriting (`@nestjs/common` → `@konekti/core` / `@konekti/http`)
- `@Injectable()` 제거 + scope 매핑 (`@Scope('singleton'|'request'|'transient')`)
- bootstrap rewrite (안전한 기본 startup 형태만): `NestFactory.create(AppModule[, options])` + `app.listen(port)` → `KonektiFactory.create(..., { port })` + `await app.listen()`
- testing rewrite (안전한 metadata/chain만): `Test.createTestingModule({ imports: [RootModule] })` 또는 `{ rootModule: RootModule }` → `createTestingModule({ rootModule: RootModule })`
- `tsconfig.json` rewrite (`experimentalDecorators`, `emitDecoratorMetadata` 제거)

마이그레이션 codemod는 helper-style `create*` API(예: `createTestingModule(...)`)를 의도적으로 유지합니다. 이는 해당 API가 런타임 모듈 엔트리포인트가 아니라 빌더이기 때문입니다.

마이그레이션 커맨드는 constructor `@Inject(TOKEN)` 파라미터 데코레이터, `@RequestDto` 구조로 옮겨야 하는 요청 파라미터 데코레이터, pipe/converter 전환 지점, 지원하지 않는 Nest bootstrap 형태(타입 인자/adapter-specific startup), 지원하지 않는 Nest testing metadata/chain 같은 수동 후속 작업 항목을 warning/report로 출력합니다.

### 런타임 플랫폼 snapshot + diagnostics 검사

```bash
konekti inspect ./src/app.module.mjs --json
konekti inspect ./src/app.module.mjs --mermaid
konekti inspect ./src/app.module.mjs --timing
```

`inspect`는 대상 모듈을 애플리케이션 컨텍스트로 로드한 뒤 런타임 `PLATFORM_SHELL`을 해석하고, `platformShell.snapshot()`에서 공유 플랫폼 snapshot/diagnostic 스키마를 직접 내보냅니다. `--json`은 Studio가 소비하는 canonical snapshot 직렬화 출력이고, `--mermaid`는 같은 snapshot 기반 컴포넌트 의존 체인을 렌더링합니다. `--timing`은 별도의 opt-in 버전 고정 타이밍 payload를 유지합니다. 루트 모듈 export 이름이 `AppModule`이 아니면 `--export <symbol>`을 사용하세요.

## 공식 generated 테스트 템플릿

CLI는 기본 실행 가능성과 학습 난이도를 함께 고려한 공식 테스트 템플릿 계열을 제공합니다.

- 스타터 unit 템플릿: `src/health/*.test.ts`
- 스타터 integration 템플릿: `src/app.test.ts`
- 스타터 e2e 스타일 템플릿: `src/app.e2e.test.ts` (`@konekti/testing`의 `createTestApp` 사용)
- Repo unit 템플릿: `konekti g repo User` → `src/users/user.repo.test.ts`
- Repo slice/integration 템플릿: `konekti g repo User` → `src/users/user.repo.slice.test.ts` (`createTestingModule` 사용)

선택 기준:

- 빠른 로직 검증에는 unit 템플릿을 사용합니다.
- 모듈 wiring/프로바이더 해석 검증에는 integration/slice 템플릿을 사용합니다.
- 앱 dispatch 경로 기반 라우트 동작 검증에는 e2e 스타일 템플릿을 사용합니다.

## 로컬 샌드박스 워크플로

Konekti 모노레포 안에서 작업할 때는 prerelease를 publish하지 말고 패키지 전용 샌드박스를 사용하세요.

```bash
pnpm --dir packages/cli run sandbox:test
```

이 명령은 `@konekti/cli`를 다시 빌드하고, standalone temp 샌드박스 경로 자체에 `starter-app`을 스캐폴드한 뒤, 워크스페이스 로컬 tarball을 설치합니다. 이후 `typecheck`/`build`/`test`를 검증하고 `konekti g repo User` 실행 후 생성된 repo 템플릿까지 포함해 `typecheck`와 `test`를 다시 검증합니다.

가장 무거운 end-to-end 검증(로컬 패키지 cold build/pack/install + 생성 프로젝트 명령 검증)은 이 샌드박스 경로에서 수행하세요.

`KONEKTI_CLI_SANDBOX_ROOT=/path`는 고급 override로 계속 사용할 수 있지만, 반드시 모노레포 워크스페이스 바깥의 전용 디렉터리를 가리켜야 합니다. repo 내부 경로를 지정하면 harness가 경고를 출력하고 temp 샌드박스 루트로 자동 fallback해서 `pnpm install`이 워크스페이스 install로 흡수되지 않게 합니다.

반복 작업 시에는 아래 명령을 사용하면 됩니다.

```bash
pnpm --dir packages/cli run sandbox:create
pnpm --dir packages/cli run sandbox:verify
pnpm --dir packages/cli run sandbox:clean
```

패키지 전용 Vitest 스위트는 `pnpm --dir packages/cli run test`로 실행할 수 있습니다. 이 스위트는 일반 CI 시간 예산에 맞춰 스타터 스캐폴드 계약 검증을 인밴드로 유지하고, cold 로컬 build/pack/install 스모크는 `pnpm --dir packages/cli run sandbox:test` 경로로 분리합니다.

## 핵심 API

| 익스포트 | 위치 | 설명 |
|---|---|---|
| `runCli(argv?, runtime?)` | `src/cli.ts` | CLI 바이너리 진입점 |
| `runNewCommand(argv, runtime?)` | `src/commands/new.ts` | 프롬프트 → 스캐폴드 → 설치 → 안내 출력 |

패키지 루트는 `newUsage`, `CliRuntimeOptions`, `GenerateOptions`, `GeneratedFile`, `GeneratorKind`, `ModuleRegistration`도 함께 re-export합니다.

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
