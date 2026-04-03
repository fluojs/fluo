# examples

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 디렉토리는 Konekti의 공식 runnable example 애플리케이션을 모아 둔 곳입니다. 각 예제는 개별 README를 가지며, docs hub와 함께 읽는 것을 전제로 합니다.

## 현재 공식 예제

- `./minimal/` — canonical starter path와 같은 가장 작은 실행 가능 앱
- `./realworld-api/` — config, DTO validation, explicit DI, CRUD를 포함한 보다 현실적인 다중 모듈 HTTP API
- `./auth-jwt-passport/` — JWT 발급과 passport core 기반 보호 라우트를 보여주는 bearer-token auth 예제
- `./ops-metrics-terminus/` — `/metrics`, `/health`, `/ready`에 초점을 둔 운영 예제

## 권장 읽기 순서

레포를 처음 읽는다면 다음 순서를 권장합니다.

1. `./minimal/README.ko.md` — 가장 작은 bootstrap과 request path
2. `./realworld-api/README.ko.md` — 첫 실제 도메인 모듈과 DTO 경계
3. `./auth-jwt-passport/README.ko.md` — auth, JWT 발급, 보호 라우트 경로
4. `./ops-metrics-terminus/README.ko.md` — metrics와 health/readiness 경로
5. `../docs/getting-started/first-feature-path.ko.md` — 스타터 앱에서 첫 기능까지 가는 공식 경로
6. `../docs/reference/package-chooser.ko.md` — 작업별 다음 패키지 선택

## 예제가 문서에서 맡는 역할

- `minimal`은 `konekti new`가 만드는 canonical starter shape를 증명합니다
- `realworld-api`는 스타터 이후 첫 실전 module/DTO/test 경로를 보여줍니다
- `auth-jwt-passport`는 현재 공식 bearer-token auth 경로를 증명합니다
- `ops-metrics-terminus`는 현재 markdown-first observability/health 경로를 증명합니다

이 예제들은 한 번에 읽을 수 있을 정도로 작게 유지하는 것이 목적이며, 패키지 README를 대체하지는 않습니다.

## 레포 루트에서 실행하기

```bash
pnpm install
pnpm vitest run examples/minimal
pnpm vitest run examples/realworld-api
pnpm vitest run examples/auth-jwt-passport
pnpm vitest run examples/ops-metrics-terminus
```

## 관련 문서

- `../README.ko.md`
- `../docs/README.ko.md`
- `../docs/getting-started/quick-start.ko.md`
- `../docs/getting-started/first-feature-path.ko.md`
