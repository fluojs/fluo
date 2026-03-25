# @konekti/config

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


여러 설정 소스를 읽고, 병합하고, 검증해 타입이 있는 런타임 계약으로 만듭니다. 단순한 `.env` 리더가 아닙니다.

## 관련 문서

- `../../docs/concepts/config-and-environments.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`

## 이 패키지가 하는 일

`@konekti/config`는 부트스트랩 시점에 여러 설정 소스를 하나의 검증된 딕셔너리로 정규화하고, 앱의 나머지 부분이 사용하는 타입 accessor(`ConfigService`)로 감쌉니다.

소스 목록 (낮은 우선순위 → 높은 우선순위):

1. `defaults` (인라인 객체)
2. env 파일 (`envFile` 옵션으로 지정, 기본값 `.env`)
3. `process.env`
4. `runtimeOverrides` (인라인 객체)

병합 후 validation이 실행됩니다. validation에 실패하면 앱이 시작을 거부합니다.

병합 규칙:

- 일반 객체 값은 키 기준으로 **deep merge** 됩니다.
- 일반 객체가 아닌 값(배열 포함)은 우선순위가 높은 소스가 이전 값을 치환합니다.
- 중첩 객체의 일부 키만 override해도 하위 트리가 조용히 유실되지 않습니다.

## 설치

```bash
npm install @konekti/config
```

## 빠른 시작

```typescript
import { loadConfig, ConfigService } from '@konekti/config';

const config = loadConfig({
  envFile: '.env',
  defaults: { PORT: '3000' },
  validate: (raw) => {
    if (!raw.DATABASE_URL) throw new Error('DATABASE_URL is required');
    return raw as { PORT: string; DATABASE_URL: string };
  },
});

const service = new ConfigService(config);
service.get('DATABASE_URL');          // 없으면 throw
service.getOptional('REDIS_URL');     // 없으면 undefined 반환
service.snapshot();                   // 현재 값 deep clone 스냅샷 반환
```

실제로는 루트 모듈에서 `@konekti/config`의 `ConfigModule.forRoot()`를 사용합니다. 부트스트랩 시 `loadConfig()`를 호출하고, 결과 `ConfigService`를 provider로 등록합니다.

## 핵심 API

### `loadConfig(options)`

| 옵션 | 타입 | 설명 |
|---|---|---|
| `envFile` | `string` | 로드할 env 파일 경로 (기본값 `.env`) |
| `defaults` | `ConfigDictionary` | 가장 낮은 우선순위 값 |
| `cwd` | `string` | env 파일을 해석할 작업 디렉터리 지정 |
| `processEnv` | `NodeJS.ProcessEnv` | 실제 `process.env` 대신 사용할 소스 |
| `runtimeOverrides` | `ConfigDictionary` | 가장 높은 우선순위 값 |
| `validate` | `(raw) => T` | 유효하지 않으면 throw, 타입 딕셔너리 반환 |
| `watch` | `boolean` | `createConfigReloader(options)`에서 env 파일 watch 리로드를 활성화할 때 사용 |

### `createConfigReloader(options)`

```typescript
type ConfigReloadReason = 'manual' | 'watch';

type ConfigReloader = {
  current(): ConfigDictionary;
  reload(): ConfigDictionary;
  subscribe(listener: (snapshot: ConfigDictionary, reason: ConfigReloadReason) => void): { unsubscribe(): void };
  subscribeError(listener: (error: unknown, reason: ConfigReloadReason) => void): { unsubscribe(): void };
  close(): void;
};
```

리로드 알림과 에러는 `subscribe(...)`, `subscribeError(...)`를 통해 명시적으로 전달됩니다. 전역 process 이벤트 사이드이펙트는 사용하지 않습니다.

### `ConfigService`

```typescript
class ConfigService {
  get<T>(key: string): T              // 필수 — 없으면 throw
  getOptional<T>(key: string): T | undefined
  snapshot(): ConfigDictionary        // 현재 정규화된 값을 deep clone으로 반환
}
```

### 타입

- `ConfigDictionary`
- `ConfigModuleOptions`
- `ConfigLoadOptions`

## 구조

```
bootstrapApplication(options)
  → loadConfig(options)
      → defaults + env 파일 + process.env + runtimeOverrides 읽기
      → 우선순위 순서로 병합
      → validate(merged)
      → ConfigDictionary
  → new ConfigService(values)
  → bootstrap-level provider로 등록

createConfigReloader(options)
  → 스냅샷 로드 + 검증
  → subscribe(listener) / subscribeError(listener)
  → reload()로 수동 리로드
  → `watch: true`면 env 파일 감시
  → close()로 감시 중단 + 구독 정리
```

`ConfigService`는 부트스트랩 이후 의도적으로 읽기 전용입니다. 동적 리로드가 필요하면 `createConfigReloader()`를 명시적으로 사용합니다.

## 파일 읽기 순서 (기여자용)

1. `src/types.ts` — options, load 계약
2. `src/load.ts` — 병합 + 검증 엔트리포인트
3. `src/service.ts` — 타입 accessor
4. `src/load.test.ts` — 병합/오버라이드/검증 baseline 테스트

## 관련 패키지

- **`@konekti/runtime`** — `loadConfig()`를 호출하고 `ConfigService`를 provider로 등록
- **`@konekti/cli`** — 생성된 앱의 `.env` 파일 배치 방식

## 한 줄 mental model

```
@konekti/config = 설정을 읽는 패키지가 아니라, 설정을 validated runtime contract로 바꾸는 패키지
```
