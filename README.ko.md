# konekti

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti는 **TC39 표준 데코레이터** 기반으로, 명시적 DI와 예측 가능한 런타임 흐름을 빠르게 시작할 수 있게 만든 TypeScript 백엔드 프레임워크입니다.

## 빠른 시작

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

생성 직후 바로 얻는 것:

- 런타임 소유 부트스트랩 (`src/main.ts`)
- 기본 상태 확인 엔드포인트 (`/health`, `/ready`)
- 스타터 예제 라우트 (`/health-info/`)
- 즉시 실행 가능한 `dev`, `build`, `typecheck`, `test` 스크립트

## Konekti가 다른 이유

- **표준 데코레이터 중심**: `"experimentalDecorators": true`와 `emitDecoratorMetadata`에 의존하지 않음
- **리플렉션 매직 없는 DI**: 토큰 기반으로 의존성을 명시해 읽기와 검증이 쉬움
- **패키지 경계가 명확한 확장**: auth, OpenAPI, metrics, queue, microservices, Redis, Prisma, Drizzle 등을 필요한 만큼 조합
- **CLI 우선 온보딩**: 생성 -> 개발 -> 검증 흐름이 일관됨

## 문서부터 보는 경로

- `docs/README.md` - 전체 읽기 순서와 문서 소유권 맵
- `docs/getting-started/quick-start.md` - 가장 빠른 실행 경로
- `docs/concepts/architecture-overview.md` - 아키텍처/패키지 경계
- `docs/reference/package-surface.md` - 현재 공개 패키지 표면

패키지별 API 상세는 `packages/*/README.md`를 각 패키지의 단일 출처로 참고하세요.

## 릴리스 히스토리

- `CHANGELOG.md`
- `https://github.com/konektijs/konekti/releases`

## 기여 가이드

- 패키지 간 계약이 바뀌면 `docs/`를 업데이트
- 패키지 API가 바뀌면 해당 `packages/*/README*.md`를 업데이트
- 향후 작업은 레포 내 상태 문서 대신 GitHub Issue로 관리
