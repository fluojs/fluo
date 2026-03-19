# @konekti/event-bus

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


**인프로세스 전용.** Konekti 애플리케이션을 위한 인프로세스 이벤트 발행 패키지입니다. 데코레이터 기반으로 singleton provider/controller 핸들러를 찾아서 실행합니다.

## 설치

```bash
npm install @konekti/event-bus
```

> **⚠️ 범위: 인프로세스 전용.** 이 패키지는 단일 Node.js 프로세스 내에서만 이벤트를 전달합니다. 내구성 보장, 영속성, 크로스 프로세스 전달, 재생 기능을 제공하지 않습니다. 디스패치 중 애플리케이션이 크래시되면 처리 중인 이벤트는 유실됩니다. 내구성 있는 분산 이벤트 처리가 필요하면 Redis 기반의 `@konekti/queue`를 사용하세요.

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

## 런타임 동작

- 애플리케이션 부트스트랩에서 `COMPILED_MODULES` 기반 핸들러 탐색
- 이벤트 발행 시 `RUNTIME_CONTAINER`에서 핸들러 인스턴스 해석
- `instanceof` 기반 클래스 매칭으로 상속 이벤트까지 처리
- 모든 매칭 핸들러를 비동기로 실행하고 핸들러 오류는 외부로 전파하지 않음
- 핸들러 오류는 `ApplicationLogger`로 격리 로깅
- `request`/`transient` 스코프의 `@OnEvent()` 핸들러는 경고 후 제외
