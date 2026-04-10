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

`ThrottlerModule`을 등록하고 컨트롤러나 메서드에 `Throttle` 데코레이터를 적용합니다.

```typescript
import { Module } from '@fluojs/core';
import { ThrottlerModule, Throttle, SkipThrottle } from '@fluojs/throttler';
import { Controller, Post } from '@fluojs/http';

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

다중 인스턴스 배포 환경에서는 `RedisThrottlerStore`를 사용하여 모든 인스턴스 간에 속도 제한 상태를 공유하세요.

```typescript
import { ThrottlerModule, RedisThrottlerStore } from '@fluojs/throttler';
import { REDIS_CLIENT } from '@fluojs/redis';

// 프로바이더 또는 모듈 팩토리 내부에서
const redisStore = new RedisThrottlerStore(redisClient);

ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  store: redisStore,
});
```

### 커스텀 키 생성

기본적으로 클라이언트의 IP 주소를 기준으로 제한합니다. API 키나 사용자 ID 등 다른 식별자를 사용하도록 커스터마이징할 수 있습니다.

```typescript
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  keyGenerator: (context) => {
    const request = context.switchToHttp().getRequest();
    return request.headers['x-api-key'] || request.ip;
  },
});
```

## 공개 API 개요

### 모듈
- `ThrottlerModule.forRoot(options)`: 글로벌 속도 제한 동작 및 저장소를 설정합니다.

### 데코레이터
- `@Throttle({ ttl, limit })`: 클래스나 메서드에 특정 속도 제한을 설정합니다.
- `@SkipThrottle()`: 클래스나 메서드에 대해 속도 제한을 비활성화합니다.

### 가드
- `ThrottlerGuard`: 속도 제한을 강제하는 가드입니다. `ThrottlerModule.forRoot()` 사용 시 자동으로 등록됩니다.

### 저장소(Store)
- `createMemoryThrottlerStore()`: 간단한 메모리 내 저장소를 생성합니다 (기본값).
- `RedisThrottlerStore`: Redis용 저장소 어댑터입니다.

## 관련 패키지

- `@fluojs/http`: HTTP 컨텍스트 및 예외 처리를 위해 필요합니다.
- `@fluojs/redis`: `RedisThrottlerStore` 사용 시 필요합니다.

## 예제 소스

- `packages/throttler/src/module.test.ts`: 모듈 설정 및 데코레이터 오버라이드 테스트.
- `packages/throttler/src/guard.ts`: 요청 제한 및 헤더 관리 코어 로직.
