# @fluojs/event-bus

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 인프로세스(In-process) 이벤트 발행 및 구독 패키지입니다. 데코레이터 기반의 핸들러 탐색 기능을 제공하며, Redis Pub/Sub과 같은 외부 트랜스포트 어댑터를 통해 프로세스 간 통신을 지원합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
- [공개 API 개요](#공개-api-개요)
- [런타임별 및 통합 서브패스](#런타임별-및-통합-서브패스)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/event-bus
```

## 사용 시점

- 직접적인 서비스 호출 대신 이벤트를 통해 컴포넌트 간의 결합도를 낮추고 싶을 때.
- 하나의 동작에 대해 시스템의 여러 부분에서 반응해야 할 때 (예: 사용자 가입 시 환영 이메일 발송과 대시보드 업데이트를 동시에 수행).
- 분산 환경 지원이 선택적으로 필요한 간단한 인메모리 이벤트 버스가 필요할 때.

## 빠른 시작

### 1. 이벤트 및 핸들러 정의

이벤트 클래스를 정의하고, 핸들러 메서드에 `@OnEvent` 데코레이터를 사용합니다.

```typescript
import { OnEvent } from '@fluojs/event-bus';

export class UserSignedUpEvent {
  constructor(public readonly email: string) {}
}

export class NotificationService {
  @OnEvent(UserSignedUpEvent)
  async notify(event: UserSignedUpEvent) {
    console.log(`환영 이메일 전송 대상: ${event.email}`);
  }
}
```

### 2. 모듈 등록 및 이벤트 발행

`EventBusModule`을 등록하고 `EventBusLifecycleService`를 주입받아 이벤트를 발행합니다.

인프로세스 이벤트 버스 등록은 `EventBusModule.forRoot(...)`로 구성합니다.

```typescript
import { Module, Inject } from '@fluojs/core';
import { EventBusModule, EventBusLifecycleService } from '@fluojs/event-bus';

@Module({
  imports: [EventBusModule.forRoot()],
  providers: [NotificationService],
})
export class AppModule {}

export class UserService {
  @Inject(EventBusLifecycleService)
  private readonly eventBus: EventBusLifecycleService;

  async signUp(email: string) {
    // 사용자 저장 로직...
    await this.eventBus.publish(new UserSignedUpEvent(email));
  }
}
```

## 일반적인 패턴

### 분산 팬아웃 (Redis)

트랜스포트 어댑터를 연결하여 이벤트 버스를 다른 프로세스로 확장할 수 있습니다.

```typescript
import { RedisEventBusTransport } from '@fluojs/event-bus/redis';

EventBusModule.forRoot({
  transport: new RedisEventBusTransport({ 
    publishClient: redis, 
    subscribeClient: redisSubscriber 
  }),
})
```

### 버전이 명시된 이벤트 키

`static eventKey`를 사용하여 클래스 이름 변경이나 코드 압축(minification)과 관계없이 안정적인 채널 이름을 유지할 수 있습니다.

```typescript
class UserRegisteredEvent {
  static readonly eventKey = 'user.registered.v1';
}
```

## 공개 API 개요

### 핵심 구성 요소
- `EventBusModule.forRoot(...)`: 이벤트 버스 등록을 위한 기본 진입점입니다.
- `EventBusLifecycleService`: 이벤트를 발행(`publish(event)`)하기 위한 기본 서비스입니다.
- `@OnEvent(EventClass)`: 특정 메서드를 이벤트 핸들러로 지정하는 데코레이터입니다.
- `EVENT_BUS`: 발행 facade를 위한 호환성 주입 토큰입니다.
- `createEventBusPlatformStatusSnapshot(...)`: diagnostics와 health surface에서 사용하는 상태 스냅샷 헬퍼입니다.

### 인터페이스
- `EventBusTransport`: 외부 트랜스포트 어댑터 구현을 위한 계약입니다.
- `EventBus`, `EventPublishOptions`, `EventBusModuleOptions`, `EventType`: 발행, 기본값, 트랜스포트, 안정적인 이벤트 키를 위한 타입 전용 계약입니다.

## 런타임별 및 통합 서브패스

| 관심사 | 서브패스 | 내보내는 항목 |
| --- | --- | --- |
| Redis Pub/Sub 트랜스포트 | `@fluojs/event-bus/redis` | `RedisEventBusTransport`, `RedisEventBusTransportOptions` |

`RedisEventBusTransport`는 명시적인 `@fluojs/event-bus/redis` 서브패스에만 유지되어 루트 `@fluojs/event-bus` 진입점이 모듈 등록, 로컬 발행, 데코레이터, 타입 전용 계약에 집중하도록 합니다. 이 트랜스포트는 shutdown 중 자신이 등록한 채널을 unsubscribe하고 message listener를 분리하지만, 호출자가 소유한 Redis 클라이언트를 disconnect하지 않습니다.

## 관련 패키지

- `@fluojs/cqrs`: 더 정형화된 아키텍처 패턴을 위해 이벤트 버스 위에 구축된 패키지입니다.
- `@fluojs/redis`: `RedisEventBusTransport` 사용 시 필요한 클라이언트를 제공합니다.

## 예제 소스

- `packages/event-bus/src/module.test.ts`: 핸들러 탐색 및 발행/구독 테스트 예제.
- `packages/event-bus/src/public-surface.test.ts`: 공개 API 계약 검증 예제.
