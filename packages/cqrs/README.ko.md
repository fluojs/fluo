# @konekti/cqrs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 애플리케이션을 위한 CQRS 패키지입니다. 부트스트랩 시점 핸들러 탐색, Command/Query 디스패치, 그리고 `@konekti/event-bus` 위임 기반 이벤트 발행 기능을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공통 패턴](#공통-패턴)
  - [Saga 프로세스 매니저](#saga-프로세스-매니저)
  - [호환성 토큰](#호환성-토큰)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @konekti/cqrs
```

## 사용 시점

- "의도"(Command/Query)와 "실행"(Handler)을 분리하고 싶을 때 사용합니다.
- 쓰기 모델과 읽기 모델의 명확한 분리가 필요한 복잡한 비즈니스 로직을 구현할 때 적합합니다.
- 도메인 이벤트에 의해 트리거되는 다단계 프로세스(Saga)를 오케스트레이션할 때 사용합니다.
- 단일 애플리케이션 내에서 Command, Query, Event를 위한 중앙 집중식 버스가 필요할 때 사용합니다.

## 빠른 시작

`CqrsModule`을 등록하고 첫 번째 Command와 Handler를 정의합니다.

```typescript
import { Inject, Module } from '@konekti/core';
import {
  CqrsModule,
  CommandHandler,
  ICommand,
  ICommandHandler,
  CommandBusLifecycleService,
} from '@konekti/cqrs';

// 1. Command 정의
class CreateUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

// 2. Handler 구현
@CommandHandler(CreateUserCommand)
class CreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
  async execute(command: CreateUserCommand): Promise<string> {
    console.log(`사용자 생성 중: ${command.name}`);
    return 'user-id-123';
  }
}

// 3. Command Bus 사용
@Inject([CommandBusLifecycleService])
class UserService {
  constructor(private readonly commandBus: CommandBusLifecycleService) {}

  async create(name: string) {
    return this.commandBus.execute(new CreateUserCommand(name));
  }
}

@Module({
  imports: [CqrsModule.forRoot()],
  providers: [CreateUserHandler, UserService],
})
class AppModule {}
```

## 공통 패턴

### Saga 프로세스 매니저

Saga를 사용하면 이벤트를 구독하고 새로운 Command를 트리거하여 복잡한 장기 실행 워크플로우를 구성할 수 있습니다.

```typescript
import { Inject } from '@konekti/core';
import { Saga, ISaga, IEvent, CommandBusLifecycleService } from '@konekti/cqrs';

class UserCreatedEvent implements IEvent {
  constructor(public readonly userId: string) {}
}

class SendWelcomeEmailCommand implements ICommand {
  constructor(public readonly userId: string) {}
}

@Inject([CommandBusLifecycleService])
@Saga(UserCreatedEvent)
class UserSaga implements ISaga<UserCreatedEvent> {
  constructor(private readonly commandBus: CommandBusLifecycleService) {}

  async handle(event: UserCreatedEvent): Promise<void> {
    await this.commandBus.execute(new SendWelcomeEmailCommand(event.userId));
  }
}
```

### 호환성 토큰

Class-first DI로 전환 중이거나 명시적 Symbol 토큰이 필요한 경우 다음을 사용할 수 있습니다.

```typescript
import { Inject } from '@konekti/core';
import { COMMAND_BUS, QUERY_BUS, EVENT_BUS } from '@konekti/cqrs';

@Inject([COMMAND_BUS, QUERY_BUS, EVENT_BUS])
class LegacyService {
  constructor(commandBus, queryBus, eventBus) {}
}
```

## 공개 API 개요

### 모듈 및 프로바이더
- `CqrsModule.forRoot(options)`: 메인 진입점입니다. 버스를 등록하고 탐색을 시작합니다.
- `CommandBusLifecycleService`: Command 실행을 위한 기본 서비스입니다.
- `QueryBusLifecycleService`: Query 실행을 위한 기본 서비스입니다.
- `CqrsEventBusService`: Event 발행을 위한 기본 서비스입니다.

### 데코레이터
- `@CommandHandler(Command)`: 클래스를 특정 Command와 연결합니다.
- `@QueryHandler(Query)`: 클래스를 특정 Query와 연결합니다.
- `@EventHandler(Event)`: 클래스를 특정 Event와 연결합니다.
- `@Saga(Event | Event[])`: 클래스를 Saga 리스너로 표시합니다.

### 인터페이스
- `ICommand`, `IQuery<T>`, `IEvent`: 메시지 마커 인터페이스입니다.
- `ICommandHandler<C, R>`, `IQueryHandler<Q, R>`, `IEventHandler<E>`, `ISaga<E>`: 핸들러 계약입니다.

## 관련 패키지

- `@konekti/event-bus`: `CqrsEventBusService`에서 사용하는 하위 이벤트 분산 패키지입니다.
- `@konekti/core`: `@Module` 및 `@Inject` 데코레이터를 위해 필요합니다.

## 예제 소스

- `packages/cqrs/src/module.test.ts`: 모듈 등록 및 기본 버스 사용 예제.
- `packages/cqrs/src/buses/saga-bus.test.ts`: 복잡한 Saga 워크플로우 예제.
