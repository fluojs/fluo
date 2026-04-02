# @konekti/throttler

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

메모리 내(in-memory) 및 Redis 저장소 어댑터를 갖춘 Konekti용 데코레이터 기반 속도 제한(Rate Limiting)입니다.

## 설치

```bash
npm install @konekti/throttler
```

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import { createThrottlerModule, Throttle, SkipThrottle } from '@konekti/throttler';
import { Controller, Get, Post } from '@konekti/http';

@Module({
  imports: [
    createThrottlerModule({
      ttl: 60,
      limit: 100,
    }),
  ],
})
class AppModule {}

@Controller('/auth')
class AuthController {
  @Post('/login')
  @Throttle({ ttl: 60, limit: 5 })
  login() {}

  @Post('/refresh')
  @SkipThrottle()
  refresh() {}
}
```

## API

### `createThrottlerModule(options)`

글로벌 쓰로틀러 가드를 등록합니다. 옵션:

| 옵션 | 타입 | 설명 |
|---|---|---|
| `ttl` | `number` | 윈도우 길이(초) |
| `limit` | `number` | 윈도우당 최대 요청 수 |
| `keyGenerator` | `(ctx) => string` | 커스텀 키 생성 함수. 기본값은 원격 IP |
| `store` | `ThrottlerStore` | 저장소 어댑터. 기본값은 메모리 내 저장소 |

### `@Throttle({ ttl, limit })`

특정 컨트롤러 클래스나 핸들러 메서드에 대해 모듈 레벨의 기본값을 오버라이드합니다.

### `@SkipThrottle()`

특정 컨트롤러 클래스나 핸들러 메서드에 대해 속도 제한을 완전히 무시합니다.

### `THROTTLER_GUARD`

등록된 `ThrottlerGuard`를 위한 DI 토큰입니다. 명시적인 가드로 사용하려면 이를 주입하세요.

```typescript
import { UseGuards } from '@konekti/http';
import { THROTTLER_GUARD } from '@konekti/throttler';

@UseGuards(THROTTLER_GUARD)
@Controller('/api')
class ApiController {}
```

### `createThrottlerPlatformStatusSnapshot(input)` / `createThrottlerPlatformDiagnosticIssues(input)`

`src/status.ts`의 상태 어댑터입니다. 쓰로틀러 저장소 모드와 백킹 스토어 준비 상태를 공유 platform snapshot/diagnostic 형식에 맞게 매핑합니다.

## Redis 저장소

```typescript
import { createThrottlerModule, RedisThrottlerStore } from '@konekti/throttler';
import { REDIS_CLIENT } from '@konekti/redis';
import type Redis from 'ioredis';

@Inject([REDIS_CLIENT])
class AppBootstrap {
  constructor(private readonly redis: Redis) {}

  buildModule() {
    return createThrottlerModule({
      ttl: 60,
      limit: 100,
      store: new RedisThrottlerStore(this.redis),
    });
  }
}
```

## 동작 방식

- 속도 제한 키의 기본값은 `socket.remoteAddress`입니다. 헤더 기반 키(예: `x-api-key`)를 사용하려면 `keyGenerator`를 제공하세요.
- 저장소 키는 `throttler:<encoded-handler-key>:<encoded-client-key>` 형태로 구성됩니다. 두 키 세그먼트는 모두 `encodeURIComponent(...)`로 인코딩되므로 IPv6 주소처럼 `:`를 포함하는 클라이언트 키도 구분자 경계와 충돌하지 않습니다. 디코딩된 `<handler-key>`는 경로의 `method`, `path`, `version`, 그리고 `handler` 메서드 이름으로 구성되며, 모두 클래스명 식별자 대신 데이터 값이므로 minification에도 안정적입니다.
- 제한을 초과하면 `ThrottlerGuard`는 `TooManyRequestsException` (HTTP 429)을 발생시키고, `Retry-After` 응답 헤더에 현재 윈도우에 남은 시간을 초 설정합니다.
- 메서드 레벨의 `@Throttle`은 클래스 레벨의 `@Throttle`을 오버라이드하며, 클래스 레벨은 모듈 레벨의 기본값을 오버라이드합니다 (이 우선순위 순서대로 적용).
- 어느 레벨에서든 `@SkipThrottle()`이 설정되면 무조건 우선권을 갖습니다.
- `@Throttle()` 옵션은 메타데이터가 기록/조회될 때 복사되므로, 나중에 공유 옵션 객체를 변경해도 이미 등록된 쓰로틀 정책에는 영향을 주지 않습니다.
- 메모리 내 저장소는 만료 시점이 가장 빠른 키를 기준으로 만료된 키들을 정리하며, 그 후 남은 활성 윈도우를 바탕으로 다음 정리 시점을 업데이트합니다.
- 메모리 내 저장소는 `ThrottlerGuard` 인스턴스별로 관리되며 클러스터된 워커 간에 공유되지 않습니다. 인스턴스 간 정책 강제를 위해 `RedisThrottlerStore`를 사용하세요.

## 플랫폼 상태 스냅샷 의미

`createThrottlerPlatformStatusSnapshot(...)`를 사용하면 공유 platform contract에 맞는 소유권/준비 상태/health 출력을 만들 수 있습니다.

- `storeKind`와 `operationMode`는 로컬 전용, 분산, fallback 동작을 구분합니다.
- `readinessCritical`은 백킹 스토어를 사용할 수 없을 때 readiness 영향도를 제어합니다:
  - `false` (기본값): 요청 트래픽은 계속 가능하므로 readiness는 `degraded`입니다.
  - `true`: readiness는 `not-ready`입니다.
- `ownership`은 `storeOwnershipMode` (`framework` vs `external`)에서 파생됩니다.
- `details.telemetry.labels`는 공유 라벨 키 (`component_id`, `component_kind`, `operation`, `result`)를 따릅니다.

`createThrottlerPlatformDiagnosticIssues(...)`를 사용하면 패키지 접두사가 붙은 코드와 실행 가능한 `fixHint` 텍스트를 가진 안정적인 진단 이슈를 출력할 수 있습니다.

## 관련 패키지

- `@konekti/http` — `Guard`, `GuardContext`, `TooManyRequestsException` 제공
- `@konekti/redis` — Redis 클라이언트, `RedisThrottlerStore`에 `REDIS_CLIENT` 전달
