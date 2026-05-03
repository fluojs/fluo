# @fluojs/throttler

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

메모리 내(In-memory) 및 Redis 저장소 어댑터를 지원하는 fluo 애플리케이션용 데코레이터 기반 속도 제한(Rate Limiting) 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공통 패턴](#공통-패턴)
  - [Redis 저장소 사용](#redis-저장소-사용)
  - [커스텀 키 생성](#커스텀-키-생성)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/throttler
```

## 사용 시점

- 로그인, 회원가입 등 민감한 엔드포인트에 대한 브루트 포스 공격을 방지하고 싶을 때 사용합니다.
- 단일 클라이언트의 과도한 요청으로부터 API 서버를 보호하고 싶을 때 적합합니다.
- 사용자 유형별로 사용량 할당량이나 계층화된 속도 제한을 구현할 때 사용합니다.
- 컨트롤러나 메서드에 데코레이터를 사용하여 간편하게 속도 제한을 적용하고 싶을 때 사용합니다.

## 빠른 시작

`ThrottlerModule`을 등록하고, `@UseGuards(...)`로 `ThrottlerGuard`를 연결한 뒤, 라우트별 제한이 필요한 컨트롤러나 메서드에 `Throttle` 데코레이터를 적용합니다.

```typescript
import { Module } from '@fluojs/core';
import { ThrottlerGuard, ThrottlerModule, Throttle, SkipThrottle } from '@fluojs/throttler';
import { Controller, Post, UseGuards } from '@fluojs/http';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,   // 60초
      limit: 10, // 10회 요청
    }),
  ],
})
class AppModule {}

@Controller('/auth')
@UseGuards(ThrottlerGuard)
class AuthController {
  @Post('/login')
  @Throttle({ ttl: 60, limit: 5 }) // 오버라이드: 분당 5회 요청
  login() {
    return { success: true };
  }

  @Post('/public-info')
  @SkipThrottle() // 속도 제한 제외
  getInfo() {
    return { info: '...' };
  }
}
```

## 공통 패턴

### Redis 저장소 사용

다중 인스턴스 배포 환경에서는 `RedisThrottlerStore`를 사용하여 모든 인스턴스 간에 속도 제한 상태를 공유하세요. Redis 기반 윈도우는 Redis 서버 시간을 기준으로 고정되므로, 애플리케이션 노드 간 시계 오차가 있어도 하나의 공통 reset 경계를 강제합니다.

```typescript
import { ThrottlerModule, RedisThrottlerStore } from '@fluojs/throttler';
import { REDIS_CLIENT } from '@fluojs/redis';

// 프로바이더 또는 모듈 팩토리 내부에서
const redisClient = await container.resolve(REDIS_CLIENT);
const redisStore = new RedisThrottlerStore(redisClient);

ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  store: redisStore,
});
```

`ThrottlerStore` 계약을 구현한 객체도 `store` 옵션으로 직접 전달할 수 있습니다.

### 커스텀 키 생성

기본적으로 throttler는 raw socket `remoteAddress`만으로 클라이언트 식별자를 해석합니다. 배포가 `Forwarded`, `X-Forwarded-For`, `X-Real-IP`를 덮어쓰는 신뢰 가능한 리버스 프록시 뒤에 있다면 `trustProxyHeaders: true`로 명시적으로 opt-in 하세요. 신뢰 가능한 소켓 식별자나 프록시 식별자가 없으면 서로 다른 호출자를 같은 버킷으로 합치지 않도록 예외를 던집니다. API 키나 사용자 ID 등 다른 식별자를 사용하도록 커스터마이징할 수도 있습니다.

카운터는 route identity와 client identity로 구분됩니다. route 부분에는 method, path, version, handler identity가 포함되므로 서로 다른 핸들러가 실수로 같은 버킷을 공유하지 않습니다. 요청이 거부되면 `ThrottlerGuard`는 `429`를 반환하고 `Retry-After`를 설정합니다.

```typescript
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  trustProxyHeaders: true,
});
```

```typescript
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  keyGenerator: (context) => {
    const apiKeyHeader = context.request.headers['x-api-key'];
    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;

    if (!apiKey) {
      throw new Error('Missing API key for throttler tracking.');
    }

    return `api-key:${apiKey}`;
  },
});
```

## 공개 API 개요

### 모듈
- `ThrottlerModule.forRoot(options)`: throttler 옵션, 저장소, `ThrottlerGuard`를 모듈 그래프에 제공합니다.
- 패키지 수준 등록은 `ThrottlerModule.forRoot(options)`를 통해 지원합니다. 내부 프로바이더 조합 헬퍼는 공개 계약에 포함되지 않습니다.

`ttl`과 `limit`은 양의 finite integer여야 합니다. `store`, `trustProxyHeaders`, `keyGenerator`로 persistence와 client identity를 조정할 수 있습니다.

### 데코레이터
- `@Throttle({ ttl, limit })`: 클래스나 메서드에 특정 속도 제한을 설정합니다.
- `@SkipThrottle()`: 클래스나 메서드에 대해 속도 제한을 비활성화합니다.

### 가드
- `ThrottlerGuard`: 속도 제한을 강제하는 가드입니다. `ThrottlerModule.forRoot()`는 이를 주입 가능하게 만들며, 라우트 핸들러는 `@UseGuards(ThrottlerGuard)` 같은 Fluo guard metadata로 직접 활성화해야 합니다.

### 저장소(Store)
- `createMemoryThrottlerStore()`: 간단한 메모리 내 저장소를 생성합니다 (기본값).
- `RedisThrottlerStore`: Redis용 저장소 어댑터입니다.
- `ThrottlerStore`: custom store를 위한 공개 계약입니다.

### status와 diagnostics
- `createThrottlerPlatformStatusSnapshot(...)`: 플랫폼 status snapshot을 생성합니다.
- `createThrottlerPlatformDiagnosticIssues(...)`: 잘못된 throttler 상태에 대한 diagnostic issue를 생성합니다.

메서드 수준 `@Throttle(...)`은 클래스 수준 설정보다 우선하고, 클래스 수준 설정은 모듈 기본값보다 우선합니다. `@SkipThrottle()`은 클래스나 메서드 수준 모두에서 throttling을 우회합니다.

## 관련 패키지

- `@fluojs/http`: HTTP 컨텍스트 및 예외 처리를 위해 필요합니다.
- `@fluojs/redis`: `RedisThrottlerStore` 사용 시 필요합니다.

## 예제 소스

- `packages/throttler/src/module.test.ts`: 모듈 설정 및 데코레이터 오버라이드 테스트.
- `packages/throttler/src/guard.ts`: 요청 제한 및 헤더 관리 코어 로직.
- `packages/throttler/src/redis-store.test.ts`: Redis store 계약과 server-time 동작.
- `packages/throttler/src/status.test.ts`: status 및 diagnostic helper 동작.
