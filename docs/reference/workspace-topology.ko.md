# 워크스페이스 토폴로지

<p><a href="./workspace-topology.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 현재 레포 토폴로지와 어떤 영역이 공개 제품 표면인지, 어떤 영역이 내부 구현 지원인지 정리합니다.

## 최상위 구조

```text
konekti/
├── README.md
├── docs/
├── packages/
├── tooling/
├── .github/
└── package.json / pnpm-workspace.yaml / tsconfig.tools.json
```

## 공개 워크스페이스

다음 워크스페이스는 공개 패키지 표면에 해당합니다.

- `packages/core`
- `packages/config`
- `packages/di`
- `packages/http`
- `packages/runtime`
- `packages/testing`
- `packages/dto-validator`
- `packages/jwt`
- `packages/passport`
- `packages/openapi`
- `packages/metrics`
- `packages/redis`
- `packages/prisma`
- `packages/drizzle`
- `packages/cli`

## 내부 워크스페이스 및 지원 디렉터리

- `tooling/babel`
- `tooling/tsconfig`
- `tooling/vite`
- `tooling/vitest`
- `tooling/release`

이 디렉터리들은 개발, 패키징, 검증을 지원합니다. 생성된 앱의 표면에 자동으로 포함되지는 않습니다.

## 기여자용 멘탈 모델

- `docs/` -> 패키지 간 현재 truth
- `packages/*/README*.md` -> 패키지 로컬 truth
- `tooling/` -> 내부 지원 계약과 검증 헬퍼
- GitHub Issues -> 활성 planning과 backlog

## 비목표

- 실제 워크스페이스에 더 이상 존재하지 않는 legacy package 이름을 보존하는 것
- 아직 ship되지 않은 가상의 future workspaces를 이미 존재하는 것처럼 문서화하는 것

## 관련 문서

- `./package-surface.md`
- `./toolchain-contract-matrix.md`
- `../documentation-model.md`
