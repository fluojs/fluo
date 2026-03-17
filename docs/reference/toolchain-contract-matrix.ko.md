# 툴체인 계약 매트릭스

<p><a href="./toolchain-contract-matrix.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 매트릭스는 생성된 앱 및 릴리스 후보 예시를 위한 공개 툴체인 계약을 고정합니다.

| 영역 | 상태 | 계약 내용 |
| --- | --- | --- |
| 생성된 앱의 `tsconfig.json` | `generated (stable)` | 번들러 모듈 해석, `strict: true`, 선언 파일 활성, `rootDir: src`, Node 타입만 사용 |
| 생성된 앱의 `tsconfig.build.json` | `generated (stable)` | 메인 설정을 확장하며, `dist`로 선언 파일 및 JS를 출력하고 `src/**/*.test.ts` 제외 |
| 생성된 앱의 `babel.config.cjs` | `generated (stable)` | `@babel/preset-typescript`와 `{ version: '2023-11' }` 설정의 데코레이터 플러그인 포함 |
| 생성된 앱의 `vitest.config.ts` | `generated (stable)` | Node 테스트 환경, `src/**/*.test.ts`, Konekti 데코레이터 플러그인 사용 |
| 생성된 개발 의존성 | `public contract` | `@babel/cli ^7.26.4`, `@babel/core ^7.26.10`, `@babel/plugin-proposal-decorators ^7.28.0`, `@babel/preset-typescript ^7.27.1`, `@types/babel__core ^7.20.5`, `@types/node ^22.13.10`, `tsx ^4.20.4`, `typescript ^5.8.2`, `vite ^6.2.1`, `vitest ^3.0.8` |
| 생성된 패키지 스크립트 | `public contract` | `dev`, `build`, `typecheck`, `test`, `test:watch` 등 현재의 단일 앱 명령 형태 유지 |
| `@konekti/cli` 프롬프트 흐름 | `public contract` | 정식 경로는 `pnpm dlx @konekti/cli new` |
| 워크스페이스 루트 TypeScript / Vite / Vitest 구성 | `internal-only` | 패키지 개발을 위한 루트 레포 설정 파일이며 생성된 앱으로 복사되지 않음 |
| 패키징된 타르볼 로컬 부트스트랩 경로 | `internal-only` | `.konekti/packages/*`는 릴리스 후보 검증만을 위한 테스트 지원용임 |

## 미지원 또는 제한적 보장 조합

- 생성 앱에 Babel 대신 `esbuild` 사용 — 현재 데코레이터 변환 및 생성된 빌드 계약이 Babel에서만 검증되었으므로 지원하지 않음
- 생성 앱에 Vitest 대신 `Jest` 사용 — 스타터 테스트 하네스 및 릴리스 후보 게이트가 Vitest 기반으로 구축되었으므로 지원하지 않음

## 공식 예시(Official-Example) 계약

- 생성된 스타터 및 릴리스 후보 스캐폴드 테스트는 위에 나열된 것과 동일한 TypeScript/Babel/Vite/Vitest 버전을 고정함
- 공식 예시는 가이드에서 특정 파일을 `internal-only`로 명시하지 않는 한, 생성된 앱과 동일한 설정 형태를 사용해야 함

## runtime 및 manifest parity 메모

- Node.js는 첫 번째 official runtime입니다.
- Bun과 fetch-style adapters는 여전히 preview surface입니다.
- 공유 Babel decorators transform 계약은 제품 계약이며, generated apps와 official packages는 같은 metadata transform 모델을 사용해야 합니다.
- runtime helper reads는 semantic source of truth로 유지됩니다.
- compile-time manifest generation은 이후 최적화가 될 수 있지만, observable framework semantics를 바꾸면 안 됩니다.
- semantic parity 없는 benchmark 이득만으로는 manifest adoption을 정당화할 수 없습니다.

## 현재 public packaging 입장

- `tooling/*` 워크스페이스는 internal-only support package로 유지됩니다.
- 현재 공개 bootstrap 계약은 `@konekti/cli`를 통한 package-first 경로를 유지합니다.
- 추가 public toolchain package surface는 현재 약속하지 않습니다.
