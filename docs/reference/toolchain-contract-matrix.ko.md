# toolchain contract matrix

<p><strong><kbd>한국어</kbd></strong> <a href="./toolchain-contract-matrix.md"><kbd>English</kbd></a></p>

이 매트릭스는 생성된 앱 및 릴리스 후보 예시를 위한 공개 툴체인 계약을 고정합니다.

| Surface | Status | Contract |
| --- | --- | --- |
| 생성된 앱의 `tsconfig.json` | `generated (stable)` | 번들러 모듈 해석, `strict: true`, 선언 파일 활성, `rootDir: src`, Node 타입만 사용 |
| 생성된 앱의 `tsconfig.build.json` | `generated (stable)` | 메인 설정을 확장하며, `dist`로 선언 파일 및 JS를 출력하고 `src/**/*.test.ts` 제외 |
| 생성된 앱의 `babel.config.cjs` | `generated (stable)` | `@babel/preset-typescript`와 `{ version: '2023-11' }` 설정의 데코레이터 플러그인 포함 |
| 생성된 앱의 `vitest.config.ts` | `generated (stable)` | Node 테스트 환경, `src/**/*.test.ts`, Konekti 데코레이터 플러그인 사용 |
| Generated dev dependencies | `public contract` | `@babel/cli ^7.26.4`, `@babel/core ^7.26.10`, `@babel/plugin-proposal-decorators ^7.28.0`, `@babel/preset-typescript ^7.27.1`, `@types/babel__core ^7.20.5`, `@types/node ^22.13.10`, `tsx ^4.20.4`, `typescript ^5.8.2`, `vite ^6.2.1`, `vitest ^3.0.8` |
| Generated package scripts | `public contract` | `dev`, `build`, `typecheck`, `test`, `test:watch` 등 현재의 단일 앱 명령 형태 유지 |
| `@konekti/cli` prompt flow | `public contract` | 정식 경로는 `pnpm add -g @konekti/cli` 후 `konekti new` |
| Workspace root TypeScript / Vite / Vitest wiring | `internal-only` | 패키지 개발을 위한 루트 레포 설정 파일이며 생성된 앱으로 복사되지 않음 |
| Packed tarball local-bootstrap path | `internal-only` | `.konekti/packages/*`는 릴리스 후보 검증만을 위한 테스트 지원용임 |

## unsupported or narrower-guarantee combinations

- 생성 앱에 Babel 대신 `esbuild` 사용 — 현재 데코레이터 변환 및 생성된 빌드 계약이 Babel에서만 검증되었으므로 지원하지 않음
- 생성 앱에 Vitest 대신 `Jest` 사용 — 스타터 테스트 하네스 및 릴리스 후보 게이트가 Vitest 기반으로 구축되었으므로 지원하지 않음

## official-example contract

- 생성된 스타터 및 릴리스 후보 스캐폴드 테스트는 위에 나열된 것과 동일한 TypeScript/Babel/Vite/Vitest 버전을 고정함
- 공식 예시는 가이드에서 특정 파일을 `internal-only`로 명시하지 않는 한, 생성된 앱과 동일한 설정 형태를 사용해야 함

## runtime and manifest parity notes

- 런타임 지원 티어와 부트스트랩 정책 변경 사항은 `../operations/release-governance.ko.md`에서 문서화합니다.
- 공유 Babel decorators transform 계약은 제품 계약입니다.
- runtime helper reads는 semantic source of truth로 유지됩니다.
- compile-time manifest generation은 이후 최적화가 될 수 있지만, observable framework semantics를 바꾸면 안 됩니다.
- semantic parity 없는 benchmark 이득만으로는 manifest adoption을 정당화할 수 없습니다.

## current public packaging stance

- `tooling/*` 워크스페이스는 internal-only support package로 유지됩니다.
- 현재 공개 bootstrap 계약은 `@konekti/cli`를 통한 package-first 경로를 유지합니다.
- 추가 public toolchain package surface는 현재 약속하지 않습니다.

## 명명 및 생성 규칙 (naming and generation conventions)

Konekti CLI는 일관된 접미사 규칙과 세분화된 생성 철학을 따릅니다.

### 명명 규칙 (naming conventions)

생성된 파일은 다음 접미사 패턴을 따릅니다:

- **Controllers**: `user.controller.ts`
- **Services**: `user.service.ts`
- **Repositories**: `user.repo.ts`
- **Request DTOs**: `user.request.dto.ts`
- **Response DTOs**: `user.response.dto.ts`

### 생성기 철학 (generator philosophy)

- **세분성 (Granularity)**: 개별 생성기를 사용하여 컴포넌트를 빌드합니다.
- **명시적 DTO**: 요청 및 응답 DTO는 별도의 스키마틱을 통해 관리됩니다.
- **단순성**: 복잡한 모놀리식 생성기보다는 명시적인 구성을 지향합니다.

### 패키지 매니저 선택

스캐폴드는 기본적으로 활성 패키지 매니저를 자동 감지합니다. 이 동작은 `konekti new` 실행 시 `--package-manager` 플래그를 사용하여 명시적으로 선택할 수 있습니다.
