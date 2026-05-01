# Config Schema & Rules

<p><a href="./config-and-environments.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/config`가 구현하는 설정 source 모델, load 및 reload 시점에 강제되는 validation barrier, 그리고 패키지 코드가 `process.env`를 직접 읽어서는 안 된다는 저장소 규칙을 정의합니다.

## Config Sources

`packages/config/src/load.ts`는 설정 source를 낮은 우선순위에서 높은 우선순위 순으로 병합합니다.

| Precedence | Source | Entry point | Current rule |
| --- | --- | --- | --- |
| 1, lowest | `defaults` | `loadConfig(options)` 또는 `ConfigModule.forRoot(options)` | 기본 스냅샷 값입니다. |
| 2 | env file | `envFile` 또는 `envFilePath` | 기본값은 `<cwd>/.env`이며, 설정된 파일 경로에서 파싱됩니다. |
| 3 | `processEnv` snapshot | 명시적 `processEnv` option | 로더에 전달된 값만 병합에 참여합니다. 주변 `process.env`는 자동으로 읽지 않습니다. |
| 4, highest | `runtimeOverrides` | 명시적 `runtimeOverrides` option | 명시적 런타임 값의 최종 override 계층입니다. |

현재 병합 동작:

| Case | Rule | Source anchor |
| --- | --- | --- |
| 여러 source에 존재하는 plain object | key 기준으로 deep merge 됩니다. | `packages/config/src/load.ts` |
| 배열과 primitive | 우선순위가 더 높은 값이 낮은 값을 대체합니다. | `packages/config/src/load.ts`, `packages/config/README.md` |
| env file이 없음 | 해당 source는 `{}`로 처리되고 load는 계속됩니다. | `packages/config/src/load.ts` |
| `envFilePath`와 `envFile`이 모두 설정됨 | `envFilePath`가 우선합니다. | `packages/config/src/load.ts`, `packages/config/src/load.test.ts` |
| `processEnv` 내부의 `undefined` 항목 | sanitize 과정에서 제거되며 낮은 우선순위 값을 덮어쓰지 않습니다. | `packages/config/src/load.ts`, `packages/config/src/load.test.ts` |

## Validation Rules

| Rule | Statement | Source anchor |
| --- | --- | --- |
| Merge before schema validation | `schema` validator는 모든 설정 source가 병합된 뒤 실행됩니다. | `packages/config/src/load.ts`, `packages/config/README.md` |
| Fail-fast startup | 초기 load 중 `schema`가 issue를 보고하면 config load는 code `INVALID_CONFIG`를 가진 `FluoError`를 발생시킵니다. | `packages/config/src/load.ts` |
| No partial snapshot | 유효하지 않은 설정은 전체가 거부됩니다. load 경로는 부분 병합 결과를 반환하지 않습니다. | `packages/config/src/load.ts` |
| Reload keeps previous snapshot on listener failure | reload 중 listener가 실패하면 이전 스냅샷이 복원됩니다. | `packages/config/src/load.ts`, `packages/config/src/reload-module.ts` |
| Watch reload keeps last valid snapshot on validation failure | watch 모드에서 validation이 실패하면 오류를 보고하고 현재 스냅샷은 그대로 유지됩니다. | `packages/config/src/load.ts`, `packages/config/src/load.test.ts`, `docs/architecture/dev-reload-architecture.md` |
| Typed read access | `ConfigService.get(...)`와 `getOrThrow(...)`는 dot-path를 포함한 읽기 전용 접근을 제공합니다. | `packages/config/src/service.ts` |

최소 schema 계약:

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
});

ConfigModule.forRoot({
  envFile: '.env',
  processEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
  },
  defaults: { PORT: '3000' },
  schema: EnvSchema,
});
```

Config schema는 동기식으로 검증되어야 합니다. Standard Schema validator가 `Promise`를 반환하면 config loader는 이를 await하지 않고 `INVALID_CONFIG`로 실패합니다.

## Access Constraints

| Constraint | Statement | Source anchor |
| --- | --- | --- |
| No direct environment reads in packages | 패키지는 `process.env`를 직접 읽어서는 안 됩니다. | `docs/contracts/behavioral-contract-policy.md`, `docs/CONTEXT.md` |
| Config entry boundary | 설정은 애플리케이션 경계에서 `@fluojs/config`를 통해 유입된 뒤, 명시적 매개변수나 주입된 서비스 형태로 패키지 코드에 들어가야 합니다. | `docs/contracts/behavioral-contract-policy.md`, `packages/config/README.md` |
| No ambient process scan | `@fluojs/config`는 호출자가 명시적 `processEnv` 스냅샷을 전달하지 않는 한 live `process.env`를 스캔하지 않습니다. | `packages/config/src/load.ts`, `packages/config/src/load.test.ts`, `packages/config/README.md` |
| Package consumption path | 런타임 코드는 패키지 내부에서 `process.env`를 호출하는 대신, 주입된 `ConfigService` 또는 명시적 옵션을 통해 설정을 소비해야 합니다. | `packages/config/src/module.ts`, `packages/config/src/service.ts` |
| Reload activation | 프로세스 내부 config reload는 명시적 기능입니다. watch 모드는 호출자가 `watch: true`를 켰을 때만 활성화됩니다. | `packages/config/src/load.ts`, `docs/architecture/dev-reload-architecture.md` |

하드 제약:

- 패키지는 `process.env`를 직접 읽어서는 안 됩니다.
- 설정은 반드시 `@fluojs/config`를 통해 흘러야 합니다.
- process 기반 값은 애플리케이션 bootstrap 경계에 속하며, 일반적으로 `ConfigModule.forRoot(...)` 또는 `loadConfig(...)`에 전달하는 명시적 `processEnv` 스냅샷 형태여야 합니다.
- `ConfigService`는 읽기 전용 런타임 facade입니다. 스냅샷 교체는 config reload 경로 내부에만 남아 있습니다.
