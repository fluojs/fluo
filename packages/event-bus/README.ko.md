# @konekti/event-bus

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션을 위한 이벤트 발행 패키지입니다. 기본은 인프로세스 디스패치이며, 선택적으로 transport 어댑터를 연결해 프로세스 간 fan-out을 구성할 수 있습니다.

## 설치

```bash
npm install @konekti/event-bus
```

> **⚠️ 내구성 보장은 없음.** transport를 연결하더라도 큐잉/재생/영속성은 제공하지 않습니다. 디스패치 중 애플리케이션이 크래시되면 처리 중인 이벤트는 유실될 수 있습니다. 내구성 있는 분산 처리에는 Redis 기반의 `@konekti/queue`를 사용하세요.

## 빠른 시작

```typescript
import { Inject, Module } from '@konekti/core';
import { createEventBusModule, EVENT_BUS, EventBus, OnEvent } from '@konekti/event-bus';

class UserRegisteredEvent {
  constructor(public readonly userId: string) {}
}

class WelcomeEmailService {
  @OnEvent(UserRegisteredEvent)
  async sendWelcomeEmail(event: UserRegisteredEvent) {
    // 메일 전송
  }
}

@Inject([EVENT_BUS])
class UserService {
  constructor(private readonly eventBus: EventBus) {}

  async registerUser(userId: string) {
    await this.eventBus.publish(new UserRegisteredEvent(userId));
  }
}

@Module({
  imports: [createEventBusModule()],
  providers: [WelcomeEmailService, UserService],
})
export class AppModule {}
```

## API

- `createEventBusModule()`
- `createEventBusProviders()`
- `EVENT_BUS`
- `EventBus`
- `@OnEvent(EventClass)`

### 모듈 옵션

`createEventBusModule(options)`와 `createEventBusProviders(options)`는 아래 옵션을 받습니다.

- `publish.timeoutMs` - `waitForHandlers: true`일 때 `publish()`가 핸들러별로 대기하는 최대 시간(ms)
- `publish.waitForHandlers` - 기본 대기 모드 (`true`는 대기 + timeout 적용, `false`는 비차단 fire-and-forget 디스패치)
- `transport` - 선택적 외부 pub/sub 어댑터 (`EventBusTransport` 구현체)

### event key 규약

transport 채널 키는 이벤트 클래스에서 아래 순서로 결정됩니다.

1. 이벤트 클래스에 `static eventKey = 'domain.event.v1'`가 있으면 해당 값을 사용
2. 없으면 하위 호환을 위해 클래스 이름(`constructor.name`) 사용

멀티 프로세스 환경에서는 클래스 이름 의존 대신 버전이 포함된 명시적 키를 권장합니다.

```typescript
class UserRegisteredEvent {
  static readonly eventKey = 'user.registered.v1';

  constructor(public readonly userId: string) {}
}
```

## 런타임 동작

- 애플리케이션 부트스트랩에서 `COMPILED_MODULES` 기반 핸들러 탐색
- 이벤트 발행 시 `RUNTIME_CONTAINER`에서 핸들러 인스턴스 해석
- `instanceof` 기반 클래스 매칭으로 상속 이벤트까지 처리
- 모든 매칭 핸들러에 디스패치하며, transport 사용 시 매칭된 핸들러 이벤트 타입 채널로 fan-out
- transport 수신 이벤트는 해당 채널에 등록된 핸들러에만 디스패치되어 로컬/원격 상속 매칭 결과를 일치
- timeout 경계는 `waitForHandlers: true`일 때만 적용되며, `false`일 때는 대기 없이 디스패치
- 핸들러 오류는 `ApplicationLogger`로 격리 로깅
- `request`/`transient` 스코프의 `@OnEvent()` 핸들러는 경고 후 제외
