# ops-metrics-terminus 예제

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

`@konekti/metrics`와 `@konekti/terminus`에 초점을 둔 runnable Konekti 운영 예제입니다. 작은 앱에서 runtime health/readiness, Prometheus scrape, custom metric이 어떻게 함께 맞물리는지를 보여줍니다.

## 이 예제가 보여주는 것

- `MetricsModule.forRoot()`를 통한 `/metrics`
- `createTerminusModule(...)`을 통한 `/health`, `/ready`
- `MetricsModule`이 scrape하는 shared Registry에 등록한 custom Prometheus counter 하나
- terminus와 metrics에 함께 노출되는 runtime-aligned health/readiness semantics
- `@konekti/testing`을 사용한 unit / integration / e2e 스타일 검증

## 라우트

- `GET /ops/jobs/trigger` — 예제용 custom counter 증가
- `GET /metrics` — Prometheus scrape endpoint
- `GET /health`
- `GET /ready`

## 실행 방법

저장소 루트에서:

```sh
pnpm install
pnpm vitest run examples/ops-metrics-terminus
```

## 프로젝트 구조

```text
examples/ops-metrics-terminus/
├── src/
│   ├── app.ts
│   ├── main.ts
│   ├── app.test.ts
│   └── ops/
│       ├── ops.module.ts
│       ├── ops.controller.ts
│       └── ops-metrics.service.ts
└── README.md
```

## 권장 읽기 순서

1. `src/app.ts` — metrics + terminus 등록
2. `src/ops/metrics-registry.ts` — shared Registry와 custom metric 등록
3. `src/ops/ops-metrics.service.ts` — counter를 증가시키는 비즈니스 액션
4. `src/ops/ops.controller.ts` — metrics 상태를 바꾸는 라우트
5. `src/app.test.ts` — `/health`, `/ready`, `/metrics`, custom route 검증

## 관련 문서

- `../README.ko.md` — 공식 examples 인덱스
- `../../docs/getting-started/first-feature-path.ko.md`
- `../../docs/concepts/observability.ko.md`
- `../../packages/metrics/README.ko.md`
- `../../packages/terminus/README.ko.md`
