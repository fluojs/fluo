# 배포 요구사항 (Deployment Requirements)

<p><strong><kbd>한국어</kbd></strong> <a href="./deployment.md">English</a></p>

## 프로덕션 체크리스트 (Production Checklist)

| 항목 | 요구사항 |
| --- | --- |
| Build output | 패키징 또는 publish 전에 `pnpm build`를 실행해야 합니다. 루트 스크립트는 `packages/*` 아래 모든 workspace package를 빌드합니다. |
| Type safety | 배포 전에 `pnpm typecheck`를 실행해야 합니다. 루트 스크립트는 tooling, examples, 각 package의 typecheck 스크립트를 검사합니다. |
| Test gate | 전체 로컬 게이트에는 `pnpm verify`를 사용하거나, release readiness와 같은 split Vitest project 순서인 `pnpm vitest run --project packages`, `apps`, `examples`, `tooling`을 실행해야 합니다. |
| Release gate | public release 준비 시 `pnpm verify:release-readiness`를 실행해야 합니다. 이 게이트는 `pnpm --dir packages/cli sandbox:matrix`와 `pnpm verify:platform-consistency-governance`도 함께 실행합니다. |
| Adapter bootstrap | 애플리케이션은 명시적 adapter를 통해 배포해야 합니다. 저장소 예제는 `FluoFactory.create(AppModule, { adapter: createFastifyAdapter({ port: 3000 }) })` 형태로 부트스트랩합니다. |
| Health registration | 프로덕션 probe가 dependency state를 보고해야 한다면 `TerminusModule.forRoot(...)`를 등록하여 `/health`와 `/ready`가 runtime 및 indicator 상태를 노출하도록 해야 합니다. |
| Config boundary | process 기반 설정은 bootstrap 시점에 명시적 `processEnv` snapshot으로 `@fluojs/config`에 전달해야 합니다. package 코드가 ambient `process.env` 읽기에 의존하면 안 됩니다. |

## 환경 변수 (Environment Variables)

| 변수 또는 소스 | 요구사항 |
| --- | --- |
| `NODE_ENV` | 프로덕션 배포에서는 `production`으로 설정해야 합니다. 현재 배포 예제 Dockerfile과 Cloudflare Workers 예시 모두 이 값을 사용합니다. |
| `PORT` | 배포 환경이 예제 기본값 `3000`을 사용하지 않는다면 listener port를 애플리케이션 설정으로 전달해야 합니다. 저장소 예제는 `createFastifyAdapter(...)`에 `port: 3000`을 명시적으로 전달합니다. |
| 명시적 `processEnv` snapshot | process 기반 설정이 필요하면 필요한 키만 `ConfigModule.forRoot({ processEnv: ... })` 또는 `loadConfig(...)`에 전달해야 합니다. `@fluojs/config`는 ambient `process.env`를 자동 스캔하지 않습니다. |
| 애플리케이션별 secret | 데이터베이스나 외부 API 자격 증명 같은 값은 package 내부가 아니라 애플리케이션 bootstrap config에 속합니다. 필수 키가 없으면 validation이 즉시 실패해야 합니다. |

## 헬스 체크 엔드포인트 (Health Check Endpoints)

| 엔드포인트 | 기본 계약 | 출처 |
| --- | --- | --- |
| `GET /health` | `HealthModule.forRoot(...)`가 제공하는 runtime health endpoint입니다. `TerminusModule.forRoot(...)`를 사용하면 응답에 `checkedAt`, `contributors`, `details`, `error`, `info`, `platform`, `status`가 포함됩니다. HTTP 200은 aggregate status `ok`, HTTP 503은 aggregate status `error`를 의미합니다. | `packages/terminus/src/module.ts`, `docs/architecture/observability.md` |
| `GET /ready` | `HealthModule.forRoot(...)`가 제공하는 runtime readiness endpoint입니다. 앱이 준비되기 전과 애플리케이션/컨텍스트 종료가 시작된 뒤에는 HTTP 503과 `{"status":"starting"}`, readiness check 실패 시 HTTP 503과 `{"status":"unavailable"}`, 준비 완료 시 HTTP 200과 `{"status":"ready"}`를 반환합니다. | `docs/architecture/observability.md` |
| Prefix가 붙은 health route | health module에 base path를 설정하면 runtime contract는 `{path}/health`, `{path}/ready`가 됩니다. | `docs/architecture/observability.md` |
| Metrics scrape endpoint | `MetricsModule.forRoot(...)`가 scrape path를 노출하면 `GET /metrics`는 active `prom-client` Registry content type으로 Prometheus text를 반환합니다. 운영 배포에서는 이 route를 endpoint middleware로 보호하거나 ingress boundary가 준비될 때까지 `path: false`로 비활성화해야 합니다. | `packages/metrics/README.md`, `docs/architecture/observability.md` |
| 저장소 예제 검증 | `examples/ops-metrics-terminus/src/app.test.ts`는 현재 example app 설정에서 `/health`, `/ready`, `/metrics`, `GET /ops/jobs/trigger`가 HTTP 200을 반환하는지 검증합니다. | `examples/ops-metrics-terminus/src/app.test.ts` |

- `TerminusModule.forRoot(...)`는 `/health` 응답 계산 시 indicator health, `platformShell.health()`, `platformShell.ready()`를 함께 결합합니다.
- `execution.indicatorTimeoutMs`를 설정하면 느린 indicator는 무기한 대기 대신 `down`으로 처리됩니다.
- 현재 저장소는 `/health`와 `/ready`를 분리된 route로 유지하지만, Terminus는 aggregate `/health` 상태 계산에 platform readiness도 포함합니다.
