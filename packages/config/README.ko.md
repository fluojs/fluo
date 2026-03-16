# @konekti/config

여러 설정 소스를 읽고, 병합하고, 검증해 타입이 있는 런타임 계약으로 만듭니다. 단순한 `.env` 리더가 아닙니다.

## 이 패키지가 하는 일

`@konekti/config`는 부트스트랩 시점에 여러 설정 소스를 하나의 검증된 딕셔너리로 정규화하고, 앱의 나머지 부분이 사용하는 타입 accessor(`ConfigService`)로 감쌉니다.

소스 목록 (낮은 우선순위 → 높은 우선순위):

1. `defaults` (인라인 객체)
2. env 파일 (`.env.dev`, `.env.test`, `.env.prod`, mode에 따라)
3. `process.env`
4. `overrides` (인라인 객체)

병합 후 validation이 실행됩니다. validation에 실패하면 앱이 시작을 거부합니다.

## 설치

```bash
npm install @konekti/config
```

## 빠른 시작

```typescript
import { loadConfig, ConfigService } from '@konekti/config';

const config = await loadConfig({
  mode: 'dev',
  defaults: { PORT: '3000' },
  validate: (raw) => {
    if (!raw.DATABASE_URL) throw new Error('DATABASE_URL is required');
    return raw as { PORT: string; DATABASE_URL: string };
  },
});

const service = new ConfigService(config);
service.get('DATABASE_URL');          // 없으면 throw
service.getOptional('REDIS_URL');     // 없으면 undefined 반환
service.snapshot();                   // 현재 값 복사본 반환
```

실제로는 `@konekti/runtime`의 `bootstrapApplication()`이 `loadConfig()`를 호출하고, 결과 `ConfigService`를 bootstrap-level provider로 등록합니다.

## 핵심 API

### `loadConfig(options)`

| 옵션 | 타입 | 설명 |
|---|---|---|
| `mode` | `'dev' \| 'prod' \| 'test'` | 로드할 env 파일 선택 |
| `defaults` | `Record<string, string>` | 가장 낮은 우선순위 값 |
| `overrides` | `Record<string, string>` | 가장 높은 우선순위 값 |
| `validate` | `(raw) => T` | 유효하지 않으면 throw, 타입 딕셔너리 반환 |

### `ConfigService`

```typescript
class ConfigService<T extends Record<string, string>> {
  get(key: keyof T): string           // 필수 — 없으면 throw
  getOptional(key: keyof T): string | undefined
  snapshot(): T                       // 현재 정규화된 값 복사본 반환
}
```

### 타입

- `ConfigMode` — `'dev' | 'prod' | 'test'`
- `ConfigModuleOptions`
- `ConfigLoadOptions`

## 구조

```
bootstrapApplication(options)
  → loadConfig(options)
      → defaults + env 파일 + process.env + overrides 읽기
      → 우선순위 순서로 병합
      → validate(merged)
      → ConfigDictionary
  → new ConfigService(values)
  → bootstrap-level provider로 등록
```

`ConfigService`는 부트스트랩 이후 의도적으로 읽기 전용입니다 — 동적 리로드 없음, namespace API 없음.

## 파일 읽기 순서 (기여자용)

1. `src/types.ts` — mode, options, load 계약
2. `src/load.ts` — 병합 + 검증 엔트리포인트
3. `src/service.ts` — 타입 accessor
4. `src/load.test.ts` — 병합/오버라이드/검증 baseline 테스트

## 관련 패키지

- **`@konekti/runtime`** — `loadConfig()`를 호출하고 `ConfigService`를 provider로 등록
- **`@konekti/cli`** — 생성된 앱이 `.env.dev` / `.env.test` / `.env.prod`를 배치하는 방식

## 한 줄 mental model

```
@konekti/config = 설정을 읽는 패키지가 아니라, 설정을 validated runtime contract로 바꾸는 패키지
```
