# @konekti/cqrs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 애플리케이션을 위한 CQRS 패키지입니다. 부트스트랩 시점 핸들러 탐색, command/query 디스패치, 그리고 `@konekti/event-bus` 위임 기반 이벤트 발행을 제공합니다.

## 설치

```bash
npm install @konekti/cqrs
```

## 빠른 시작

```typescript
import { Inject, Module } from '@konekti/core';
import {
  CommandBus,
  CommandHandler,
  COMMAND_BUS,
  CqrsEventBus,
  createCqrsModule,
  EVENT_BUS,
  EventHandler,
  ICommand,
  ICommandHandler,
  IEvent,
  IEventHandler,
  IQuery,
  IQueryHandler,
  QueryBus,
  QueryHandler,
  QUERY_BUS,
} from '@konekti/cqrs';

class CreateUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

class GetUserCountQuery implements IQuery<number> {
  readonly __queryResultType__?: number;
}

class UserCreatedEvent implements IEvent {
  constructor(public readonly name: string) {}
}

class UserStore {
  count = 0;
}

@Inject([UserStore])
@CommandHandler(CreateUserCommand)
class CreateUserHandler implements ICommandHandler<CreateUserCommand, number> {
  constructor(private readonly store: UserStore) {}

  execute(command: CreateUserCommand): number {
    void command;
    this.store.count += 1;
    return this.store.count;
  }
}

@Inject([UserStore])
@QueryHandler(GetUserCountQuery)
class GetUserCountHandler implements IQueryHandler<GetUserCountQuery, number> {
  constructor(private readonly store: UserStore) {}

  execute(_query: GetUserCountQuery): number {
    return this.store.count;
  }
}

@EventHandler(UserCreatedEvent)
class AuditLogProjection implements IEventHandler<UserCreatedEvent> {
  handle(event: UserCreatedEvent): void {
    console.log('user created', event.name);
  }
}

@Inject([COMMAND_BUS, QUERY_BUS, EVENT_BUS])
class UserService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly eventBus: CqrsEventBus,
  ) {}

  async create(name: string): Promise<number> {
    const count = await this.commandBus.execute<CreateUserCommand, number>(new CreateUserCommand(name));
    await this.eventBus.publish(new UserCreatedEvent(name));
    return count;
  }

  async getCount(): Promise<number> {
    return this.queryBus.execute<GetUserCountQuery, number>(new GetUserCountQuery());
  }
}

@Module({
  imports: [
    createCqrsModule({
      commandHandlers: [CreateUserHandler],
      eventHandlers: [AuditLogProjection],
      queryHandlers: [GetUserCountHandler],
    }),
  ],
  providers: [UserStore, CreateUserHandler, GetUserCountHandler, AuditLogProjection, UserService],
})
export class AppModule {}
```

## API

- `createCqrsModule({ commandHandlers?, queryHandlers?, eventHandlers?, eventBus? })` - 글로벌 `COMMAND_BUS`, `QUERY_BUS`, CQRS `EVENT_BUS`를 등록하고 내부적으로 `createEventBusModule()`을 import합니다.
- `createCqrsProviders()` - 수동 조합을 위한 raw provider 목록을 반환합니다.
- `COMMAND_BUS` - `CommandBus`용 DI 토큰입니다.
- `QUERY_BUS` - `QueryBus`용 DI 토큰입니다.
- `EVENT_BUS` - 이슈 기대치에 맞춘 `CqrsEventBus`용 CQRS 이벤트 버스 토큰입니다.
- `CQRS_EVENT_BUS` - 동일 토큰에 대한 호환 별칭입니다.
- `ICommand`, `IQuery<TResult>`, `IEvent` - CQRS 메시지 마커 인터페이스입니다.
- `ICommandHandler<TCommand, TResult>`, `IQueryHandler<TQuery, TResult>`, `IEventHandler<TEvent>` - 핸들러 계약 인터페이스입니다.
- `@CommandHandler(CommandClass)` - 클래스에 command handler 메타데이터를 기록합니다.
- `@QueryHandler(QueryClass)` - 클래스에 query handler 메타데이터를 기록합니다.
- `@EventHandler(EventClass)` - 클래스에 CQRS event handler 메타데이터를 기록합니다.

### 모듈 옵션 동작

- `commandHandlers`, `queryHandlers`, `eventHandlers`는 선택적 편의 등록 배열입니다.
- 배열 항목은 생성되는 CQRS 모듈의 provider로 추가됩니다.
- 실제 핸들러 탐색은 부트스트랩 시점 decorator/compiled module 스캔을 계속 사용하므로, 이 배열은 데코레이터를 대체하는 방식이 아니라 명시적 등록 경로입니다.
- `eventBus`는 `createEventBusModule(eventBus)`로 그대로 전달됩니다.

## 런타임 동작

- command/query 핸들러 탐색은 `onApplicationBootstrap()`에서 `COMPILED_MODULES`를 기준으로 수행됩니다.
- 핸들러 인스턴스는 부트스트랩 시점에 `RUNTIME_CONTAINER`에서 미리 resolve됩니다.
- command type과 query type마다 정확히 하나의 핸들러만 허용됩니다.
- 중복 command/query 핸들러는 typed framework error로 즉시 실패합니다.
- 등록되지 않은 command/query는 `execute(...)` 호출 시 typed not-found error를 발생시킵니다.
- `CqrsEventBus.publish()`는 내부 `EVENT_BUS.publish()`로 위임됩니다.
- `CqrsEventBus.publish()`는 부트스트랩 시점에 발견된 클래스 기반 `@EventHandler()` 핸들러도 함께 디스패치합니다.
- `CqrsEventBus.publishAll()`은 각 이벤트에 대해 순차적으로 `publish()`를 호출합니다.

## 요구 사항 및 경계

- 표준 TC39 데코레이터만 사용합니다(legacy decorator 모드 비사용).
- command/query 핸들러 클래스는 singleton 스코프여야 합니다.
- command/query 핸들러 클래스는 `execute(...)`를 구현해야 합니다.
- event handler 클래스는 `handle(...)`를 구현해야 합니다.
- `@EventHandler()` 클래스 핸들러는 `@konekti/event-bus`의 메서드 레벨 `@OnEvent()`와 함께 사용할 수 있습니다.
