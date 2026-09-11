# @fluojs/config

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 설정 로드, 병합, 검증, 타입 안전한 런타임 접근을 제공하는 패키지입니다.

Coordinated Node 24 릴리스를 준비한다면 패키지 업그레이드 전에 [소비자 마이그레이션 가이드](../../docs/getting-started/migrate-node24.ko.md)를 따르세요.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 기능](#주요-기능)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/config
```

패키지는 의도적으로 package-wide `engines.node`를 선언하지 않습니다. `ConfigService`, merge/validation/clone 동작, `ConfigModule.load({ defaults, processEnv, runtimeOverrides })`는 portable하며 `process.cwd()`, 기본 `.env` path, Node filesystem/path/crypto builtin을 해석하지 않습니다. Env-file loading, 기본 `.env` loading, watch mode는 Node 전용 기능입니다. 이 경로는 지원 범위 Node.js `>=24.0.0 <27`의 `process.getBuiltinModule(...)`을 통해 builtin을 lazy하게 해석하며 host가 해당 경계를 제공하지 않으면 in-memory option을 사용하거나 Node.js에서 실행하라는 guidance와 함께 `CONFIG_RUNTIME_UNAVAILABLE`을 던집니다. 이 guard는 feature capability를 확인하며 Node version 비교나 portable root import 차단을 추가하지 않습니다.

## 사용 시점

- `.env` 파일과 명시적인 `processEnv` 스냅샷을 하나의 설정 스냅샷으로 합쳐야 할 때
- 여러 소스의 우선순위를 명확하게 유지한 채 설정을 병합해야 할 때
- 애플리케이션 시작 전에 설정을 검증해서 잘못된 상태로 부팅되는 일을 막고 싶을 때
- `ConfigService`를 통해 설정 값을 타입 안전하게 읽고 싶을 때

## 빠른 시작

`ConfigModule.load(...)`로 application boundary에서 검증된 스냅샷 하나를 만든 뒤, 그 스냅샷을 주입용으로 등록하세요.

```ts
import { ConfigModule } from '@fluojs/config';
import { Module } from '@fluojs/core';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
});

const config = ConfigModule.load({
  envFilePaths: ['.env'],
  processEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
  },
  defaults: { PORT: '3000' },
  schema: EnvSchema,
});

@Module({
  imports: [ConfigModule.forRoot({ runtimeOverrides: config })],
})
class AppModule {}
```

`envFilePaths`가 유일한 파일 입력입니다. 한 파일에는 한 항목 목록을, 계층화에는 순서가 있는 목록을 사용하세요. 기본 dotenv parser 대신 다른 flat-file parser가 필요하다면 `parse`를 전달하세요.

등록 후에는 `ConfigService`를 주입해서 값을 읽습니다.

```ts
import { Inject } from '@fluojs/core';
import { ConfigService } from '@fluojs/config';

@Inject(ConfigService)
class MyService {
  constructor(private readonly config: ConfigService) {
    const port = this.config.get('PORT');
    const dbUrl = this.config.getOrThrow('DATABASE_URL');
  }
}
```

## 주요 기능

### NestJS 등록 마이그레이션

`ConfigModule`은 동기 `forRoot(...)` registration만 노출하며 `ConfigModule.forRootAsync(...)`에 대응하는 API는 없습니다. `@nestjs/config`에서 마이그레이션할 때는 다음 경계를 따르세요.

- Remote secret과 다른 비동기 source는 module graph를 정의하기 전에 application-owned bootstrap boundary에서 resolve한 뒤, 최종 값을 동기 registration call에 전달합니다.
- NestJS `load` factory는 `defaults` 또는 `runtimeOverrides`의 nested plain object로 옮깁니다. Deep merge와 dot-path `ConfigService` 접근을 위해 nesting을 그대로 유지하세요.
- `@fluojs/config`는 ambient environment variable을 scan하지 않으므로 명시적 `processEnv` snapshot을 전달합니다.
- NestJS `validate` callback은 `schema`에 전달하는 동기 Standard Schema로 바꿉니다. 비동기 schema 결과는 거부됩니다.
- NestJS `isGlobal`이 아니라 `global`을 사용합니다. Visibility는 기본적으로 global이며, `global: false`로 module-local visibility를 선택합니다.
- Call site는 single-key 형태로 재작성합니다. `ConfigService.get(key)`와 `getOrThrow(key)`는 key 하나만 받으며 NestJS default-value 또는 options overload를 노출하지 않습니다. 기본값은 `defaults` 또는 `schema` output이 소유하거나, `get(key)` 결과에 명시적인 `??` fallback을 적용합니다.

공유 validated snapshot bootstrap pattern과 HTTP adapter boundary는 canonical [NestJS configuration migration guide](../../docs/getting-started/migrate-from-nestjs.ko.md)를 참고하세요.

### 명확한 소스 우선순위

설정은 `runtimeOverrides` → `processEnv` 옵션으로 전달한 환경 스냅샷 → env 파일 → `defaults` 순서로 병합됩니다.

`@fluojs/config`는 주변 환경 변수를 자동으로 스캔하지 않습니다. 환경 기반 값을 우선순위에 포함하려면 부트스트랩 경계에서 `processEnv` 스냅샷을 명시적으로 전달하세요.

`envFilePaths`가 유일한 파일 입력입니다. 한 파일에는 한 항목 목록을, 계층화에는 순서가 있는 목록을 사용하세요. 상대 entry는 `cwd`에서 해석합니다. Option을 생략하면 file-capable load에서만 기본 `<cwd>/.env`를 선택하며, 명시적 in-memory `defaults`, `processEnv`, `runtimeOverrides` source는 이 기본값을 억제합니다. `envFilePaths: []`는 파일 loading을 해제합니다. `envFile`과 `envFilePath`는 제거되었고 JavaScript consumer도 TypeScript consumer와 같은 migration 안내를 받도록 `INVALID_CONFIG`로 실패합니다. `parse`를 사용하면 flat key/value 파일을 위한 custom parser로 dotenv parsing을 대체할 수 있습니다. 누락된 env file은 load 시 빈 입력처럼 처리됩니다. watch mode에서는 parent directory도 관찰하므로 나중에 파일을 생성해도 reload를 트리거할 수 있습니다.

### 순서가 있는 다중 env file loading

`envFilePaths`는 명시적으로 순서가 정해진 env file 목록 하나를 받습니다. 목록은 낮은 우선순위에서 높은 우선순위로 병합되어 단일 env-file tier를 구성하므로, 여전히 `defaults`보다 위에 있고 `processEnv`와 `runtimeOverrides`보다 아래에 있습니다.

```ts
const config = ConfigModule.load({
  envFilePaths: ['.env', '.env.production', '.env.production.local'],
  processEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
  },
  schema: EnvSchema,
});
```

contract는 다음과 같습니다.

- 뒤쪽 entry가 앞쪽 entry를 이깁니다. plain object는 여전히 deep merge되고 array는 여전히 교체됩니다.
- 상대 경로 entry는 `cwd`(기본값 `process.cwd()`) 기준으로 해석되고, 절대 경로 entry는 그대로 사용됩니다.
- 누락된 파일은 아무 값도 기여하지 않으며 load를 실패시키지 않습니다.
- `envFilePaths: []`는 기본 `<cwd>/.env` fallback을 포함해 env-file loading 자체를 명시적으로 해제합니다.
- `envFilePaths`가 유일한 파일 입력 option입니다. `envFile: '.env.local'` 또는 `envFilePath: '.env.local'`은 `envFilePaths: ['.env.local']`로 이행하세요. 해석 결과가 중복된 경로나 빈 entry는 계속 `INVALID_CONFIG`로 실패합니다.
- schema는 개별 파일이 아니라 완전히 병합된 결과를 한 번만 검증합니다.
- watch mode에서는 서로 다른 parent directory마다 watcher를 하나씩만 시작하고, 목록에 포함된 파일이 변경되면 전체 목록을 다시 계산하며, 우선순위가 높은 파일을 삭제하면 남은 파일로 fallback합니다. 검증 실패 시에는 마지막 유효 snapshot을 유지합니다.
- 자동 profile 탐색은 패키지 밖에 남습니다. 정확한 목록과 순서는 caller가 결정합니다.

패키지는 `NODE_ENV`에서 env file 이름을 유도하지 않습니다. 환경별 계층화가 필요하다면 bootstrap boundary에서 목록을 직접 구성하세요.

Standalone reload에는 같은 명시적 파일 목록으로 manager 하나를 만드세요.

```ts
const reloader = ConfigReloadManager.create({
  envFilePaths: ['.env', '.env.local'],
  watch: true,
  schema: EnvSchema,
});
```

`ConfigModule.forRoot({ watch: true })`는 주입된 service 자동 reload를 위한 module-registration 경로입니다. 같은 등록이 manual `reload()`, success/error subscription, listener failure rollback, terminal `close()` 동작을 가진 하나의 `CONFIG_RELOADER` instance를 노출하므로 같은 파일에 두 번째 reload manager를 등록하지 마세요.

Root `@fluojs/config` 패키지를 import하는 것만으로는 Node filesystem, path, crypto builtin을 해석하지 않습니다. `ConfigService`, option type, 또는 명시적 in-memory 입력을 쓰는 `ConfigModule.load(...)` consumer는 non-Node runtime에서도 지원됩니다. Env-file, 기본 `.env`, watch 실행은 Node 전용이며 `process.getBuiltinModule(...)`을 제공하는 host가 필요합니다. 지원하지 않는 host에서는 eager import failure 대신 문서화된 `CONFIG_RUNTIME_UNAVAILABLE` error가 발생합니다.

### 객체 단위 딥 머지

일반 객체는 키 기준으로 깊게 병합되고, 배열과 원시값은 더 높은 우선순위 소스가 전체를 덮어씁니다.

### 부트스트랩 전 검증

`schema` 옵션은 Zod, Valibot, ArkType 같은 동기식 [Standard Schema](https://standardschema.dev/schema) 호환 validator를 받습니다. 스키마는 모든 소스가 합쳐진 뒤 실행되고, 검증된 `value`가 최종 config snapshot이 됩니다. schema issue가 보고되면 bootstrap/load/reload는 `INVALID_CONFIG`로 실패합니다.

`@fluojs/config`의 load와 reload API는 동기식입니다. 비동기 Standard Schema 결과는 `INVALID_CONFIG`로 거부되므로 config 검증에는 동기 스키마를 사용하세요.

### 런타임 접근과 리로드 비용 모델

`ConfigService.get('a.b.c')`는 dot-path 세그먼트를 순서대로 탐색하므로 조회 비용은 path 깊이에 비례합니다. `get()`, `getOrThrow()`, `snapshot()`이 객체 형태의 값을 반환할 때는 분리된 clone을 반환합니다. 따라서 clone 비용은 반환되는 subtree 크기에 비례하며, 호출자 mutation은 활성 config snapshot에 영향을 주지 않습니다.

`ConfigReloadManager.reload()`는 리로드 작업을 직렬화합니다. 현재 리로드가 listener 알림을 수행하는 동안 다른 리로드가 요청되면 후속 리로드는 큐에 들어가 활성 알림이 끝난 뒤 적용됩니다. 활성 알림이 실패하면 직전 snapshot을 복구하고 큐에 있던 리로드는 폐기합니다. 동일한 직렬화와 rollback 계약은 `ConfigReloadManager.create(...).reload()`에도 적용되며, watch로 시작된 알림 중 큐에 들어간 manual reload도 이 계약을 따릅니다.

Module registration과 standalone reloader 생성은 `schema`로 전달한 nested Standard Schema validator object를 포함해 caller-owned options를 저장하기 전에 snapshot으로 분리합니다. 이 캡처는 provider resolution이나 application bootstrap보다 앞선 `ConfigModule.forRoot(...)`, `ConfigReloadManager.create(...)` 호출 시점에 동기적으로 일어납니다. Config dictionary, `processEnv`, Standard Schema descriptor는 분리하고, `parse`, `onReloadError`, schema validator 같은 callable value는 해당 호출에서 캡처한 reference를 유지합니다. 이후 option object나 snapshot으로 분리된 nested object를 변경해도 bootstrap, manual reload, watch reload 입력은 바뀌지 않습니다. `ConfigModule.forRoot({ watch: true, ... })`를 사용하면 module은 application bootstrap 중 하나의 env-file watcher를 시작하고, 먼저 injected `ConfigService`를 watch reloader baseline과 맞춘 다음 watch reload가 성공한 뒤 같은 injected `ConfigService` instance를 갱신합니다. `ConfigModule`의 automatic watch reload 실패를 애플리케이션이 소유해야 한다면 `onReloadError`를 전달하세요. Watch mode에서는 목록의 각 env file parent directory를 한 번씩 watch하므로, 나중에 목록의 env file을 생성하거나 atomic replacement로 교체해도 reload가 트리거될 수 있습니다. Watch reload는 reload 전에 최종 순서형 env-file content를 마지막으로 commit된 watch baseline과 비교하므로, 내용이 바뀌지 않은 저장이나 변경 후 debounce 안에서 원래 내용으로 되돌린 burst는 인프로세스 config snapshot을 교체하지 않습니다.

`ConfigModule`이 유일한 module registration 경로입니다. manual reload와 subscription을 위한 공유 `CONFIG_RELOADER` 계약을 항상 export하며, `watch: true`일 때만 Node watcher를 만들고 module shutdown 중에 닫습니다. `ConfigReloadManager`의 종료는 최종 상태입니다. `close()` 또는 `onModuleDestroy()` 이후에는 대체 reloader나 watcher를 다시 생성하지 않고, `reload()`, `subscribe()`, `subscribeError()`는 `InvariantError`를 던지며, `current()`는 마지막으로 commit된 스냅샷을 계속 반환합니다. `ConfigReloadModule`을 import하지 말고 동일한 `ConfigModule.forRoot(...)` registration에서 `CONFIG_RELOADER`를 주입하세요.

## 공개 API

| 클래스/헬퍼 | 설명 |
|---|---|
| `ConfigModule` | 설정, `ConfigService`, 공유 `CONFIG_RELOADER` 계약을 등록하는 유일한 모듈 경로이며 `ConfigModule.load(options)`는 standalone validated loader입니다. |
| `ConfigReloadManager` | 주입된 `ConfigService`의 리로드를 조정하며, 서비스 identity는 유지하고 스냅샷만 리로드 경로로 교체합니다. `ConfigReloadManager.create(options)`는 standalone terminal manager를 생성합니다. |
| `CONFIG_RELOADER` | 공유 config reloader 계약을 위한 주입 토큰입니다. |
| `ConfigService` | 설정 값에 타입 안전하게 접근하기 위한 읽기 전용 서비스입니다. 스냅샷 교체는 config reload 경로 내부에만 남습니다. |

이 패키지는 `ConfigModuleOptions`, `ConfigLoadOptions`, `ConfigReloadSubscription`, `ConfigReloadReason` 같은 option/subscription 타입도 export합니다.

`ConfigReloadManager.reload()`는 기존 `ConfigService` 인스턴스를 갱신하므로 소비자는 주입받은 서비스 identity를 유지하면서 새 스냅샷을 관찰합니다. 리로드 listener가 에러를 던지면 매니저는 직전 스냅샷을 복구하고 listener 에러를 다시 던집니다. `ConfigReloadManager.create(...)`도 standalone reloader snapshot에 대해 같은 listener 직렬화, rollback, terminal close 동작을 따릅니다.

## 관련 패키지

- `@fluojs/runtime`: configuration loading을 transitive하게 제공하지 않습니다. `ConfigModule.forRoot(...)`를 사용하거나 `ConfigService`를 주입하는 애플리케이션은 `@fluojs/config`를 direct dependency로 선언해야 합니다.
- Standard Schema validator: Zod, Valibot, ArkType 및 호환 schema 라이브러리를 `schema` 옵션으로 전달할 수 있습니다.

## 예제 소스

- `packages/config/src/load.ts`
- `packages/config/src/options.ts`
- `packages/config/src/module.ts`
- `packages/config/src/service.ts`
- `packages/config/src/load.test.ts`
- [구성 및 환경](../../docs/architecture/config-and-environments.ko.md)
- [개발 리로드 아키텍처](../../docs/architecture/dev-reload-architecture.ko.md)
