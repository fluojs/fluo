# @fluojs/config

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 설정 로드, 병합, 검증, 타입 안전한 런타임 접근을 제공하는 패키지입니다.

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

## 사용 시점

- `.env`와 환경 변수, 런타임 오버라이드를 하나의 설정 스냅샷으로 합쳐야 할 때
- 여러 소스의 우선순위를 명확하게 유지한 채 설정을 병합해야 할 때
- 애플리케이션 시작 전에 설정을 검증해서 잘못된 상태로 부팅되는 일을 막고 싶을 때
- `ConfigService`를 통해 설정 값을 타입 안전하게 읽고 싶을 때

## 빠른 시작

```ts
import { ConfigModule } from '@fluojs/config';
import { Module } from '@fluojs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFile: '.env',
      processEnv: {
        DATABASE_URL: process.env.DATABASE_URL,
      },
      defaults: { PORT: '3000' },
      validate: (config) => {
        if (!config.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다');
        return config;
      },
    }),
  ],
})
class AppModule {}
```

등록 후에는 `ConfigService`를 주입해서 값을 읽습니다.

```ts
import { ConfigService } from '@fluojs/config';

class MyService {
  constructor(private readonly config: ConfigService) {
    const port = this.config.get('PORT');
    const dbUrl = this.config.getOrThrow('DATABASE_URL');
  }
}
```

## 주요 기능

### 명확한 소스 우선순위

설정은 `runtimeOverrides` → `processEnv` 옵션으로 전달한 환경 스냅샷 → env 파일 → `defaults` 순서로 병합됩니다.

`@fluojs/config`는 주변 환경 변수를 자동으로 스캔하지 않습니다. 환경 기반 값을 우선순위에 포함하려면 부트스트랩 경계에서 `processEnv` 스냅샷을 명시적으로 전달하세요.

### 객체 단위 딥 머지

일반 객체는 키 기준으로 깊게 병합되고, 배열과 원시값은 더 높은 우선순위 소스가 전체를 덮어씁니다.

### 부트스트랩 전 검증

`validate` 함수는 모든 소스가 합쳐진 뒤 실행되며, 에러를 던지면 부트스트랩이 즉시 중단됩니다.

### 런타임 접근과 리로드 비용 모델

`ConfigService.get('a.b.c')`는 dot-path 세그먼트를 순서대로 탐색하므로 조회 비용은 path 깊이에 비례합니다. `get()`, `getOrThrow()`, `snapshot()`이 객체 형태의 값을 반환할 때는 분리된 clone을 반환합니다. 따라서 clone 비용은 반환되는 subtree 크기에 비례하며, 호출자 mutation은 활성 config snapshot에 영향을 주지 않습니다.

`ConfigReloadManager.reload()`는 리로드 작업을 직렬화합니다. 현재 리로드가 listener 알림을 수행하는 동안 다른 리로드가 요청되면 후속 리로드는 큐에 들어가 활성 알림이 끝난 뒤 적용됩니다. 활성 알림이 실패하면 이전 snapshot을 복구하고 큐에 있던 리로드는 폐기합니다. 동일한 직렬화와 rollback 계약은 `createConfigReloader(...).reload()`에도 적용되며, watch로 시작된 알림 중 큐에 들어간 manual reload도 이 계약을 따릅니다.

## 공개 API

| 클래스/헬퍼 | 설명 |
|---|---|
| `ConfigModule` | 설정을 전역 또는 지역으로 등록하기 위한 모듈입니다. |
| `ConfigReloadModule` | 리로드 매니저를 등록하고 의존성 주입용 공유 `CONFIG_RELOADER` 토큰을 내보냅니다. |
| `ConfigReloadManager` | 주입된 `ConfigService`의 리로드를 조정하며, 서비스 identity는 유지하고 스냅샷만 리로드 경로로 교체합니다. |
| `CONFIG_RELOADER` | 공유 config reloader 계약을 위한 주입 토큰입니다. |
| `ConfigService` | 설정 값에 타입 안전하게 접근하기 위한 읽기 전용 서비스입니다. 스냅샷 교체는 config reload 경로 내부에만 남습니다. |
| `loadConfig(options)` | 설정을 수동으로 로드하기 위한 함수형 엔트리 포인트입니다. |
| `createConfigReloader(options)` | 동적 설정 업데이트를 위한 리로더를 생성합니다. |

`ConfigReloadManager.reload()`는 기존 `ConfigService` 인스턴스를 갱신하므로 소비자는 주입받은 서비스 identity를 유지하면서 새 스냅샷을 관찰합니다. 리로드 listener가 에러를 던지면 매니저는 이전 스냅샷을 복구하고 listener 에러를 다시 던집니다. `createConfigReloader(...).reload()`도 standalone reloader snapshot에 대해 동일한 listener 직렬화와 rollback 동작을 따릅니다.

## 관련 패키지

- `@fluojs/runtime`: 부트스트랩 중 `loadConfig()`를 호출합니다.
- `@fluojs/validation`: `validate` 함수 안에서 스키마 기반 검증을 조합할 수 있습니다.

## 예제 소스

- `packages/config/src/load.ts`
- `packages/config/src/service.ts`
- `packages/config/src/load.test.ts`
