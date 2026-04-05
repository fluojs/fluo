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
  CqrsModule,
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
    CqrsModule.forRoot({
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

- `CqrsModule.forRoot({ commandHandlers?, queryHandlers?, eventHandlers?, sagas?, eventBus? })` - 글로벌 `COMMAND_BUS`, `QUERY_BUS`, CQRS `EVENT_BUS`를 등록하고 내부적으로 `EventBusModule.forRoot()`를 import합니다.
- `createCqrsProviders()` - 수동 조합을 위한 raw provider 목록을 반환합니다.
- `COMMAND_BUS` - `CommandBus`용 DI 토큰입니다.
- `QUERY_BUS` - `QueryBus`용 DI 토큰입니다.
- `EVENT_BUS` - `CqrsEventBus`용 정식 CQRS 이벤트 버스 토큰입니다.
- `ICommand`, `IQuery<TResult>`, `IEvent` - CQRS 메시지 마커 인터페이스입니다.
- `ICommandHandler<TCommand, TResult>`, `IQueryHandler<TQuery, TResult>`, `IEventHandler<TEvent>`, `ISaga<TEvent>` - 핸들러 계약 인터페이스입니다.
- `@CommandHandler(CommandClass)` - 클래스에 command handler 메타데이터를 기록합니다.
- `@QueryHandler(QueryClass)` - 클래스에 query handler 메타데이터를 기록합니다.
- `@EventHandler(EventClass)` - 클래스에 CQRS event handler 메타데이터를 기록합니다.
- `@Saga(EventClass | EventClass[])` - 하나 이상의 이벤트 타입에 반응하는 클래스 기반 saga/process-manager 메타데이터를 기록합니다.
- `createCqrsPlatformStatusSnapshot(input)` - CQRS event/saga lifecycle 의존성 및 drain 가시성을 공통 platform snapshot 필드로 매핑합니다.

### 루트 배럴 공개 표면 거버넌스 (0.x)

- **supported**: `CqrsModule.forRoot`, `createCqrsProviders`, `COMMAND_BUS`, `QUERY_BUS`, `EVENT_BUS`, CQRS 데코레이터(`@CommandHandler`, `@QueryHandler`, `@EventHandler`, `@Saga`), CQRS marker/handler 계약, status snapshot helper를 지원합니다.
- **compatibility-only**: 저수준 metadata helper/symbol(`define*Metadata`, `get*Metadata`, `*MetadataSymbol`)은 0.x 호환성을 위해 유지되지만, 신규 애플리케이션 코드의 기본 import 경로로는 권장하지 않습니다.
- **internal**: `CQRS_EVENT_BUS`는 공개 루트 배럴 계약에 포함되지 않습니다.

### 마이그레이션 노트 (0.x)

- `CQRS_EVENT_BUS`는 공개 패키지 표면에서 제거되었습니다.
- CQRS 이벤트 버스 DI 사용 코드는 `EVENT_BUS`로 마이그레이션하세요.
- `CommandHandlerNotFoundError`는 루트 배럴에서 제거되었습니다. 대신 `CommandHandlerNotFoundException`을 사용하세요.
- `QueryHandlerNotFoundError`는 루트 배럴에서 제거되었습니다. 대신 `QueryHandlerNotFoundException`을 사용하세요.

### 모듈 옵션 동작

- `commandHandlers`, `queryHandlers`, `eventHandlers`, `sagas`는 선택적 편의 등록 배열입니다.
- 배열 항목은 생성되는 CQRS 모듈의 provider로 추가됩니다.
- 실제 핸들러 탐색은 부트스트랩 시점 decorator/compiled module 스캔을 계속 사용하므로, 이 배열은 데코레이터를 대체하는 방식이 아니라 명시적 등록 경로입니다.
- `eventBus`는 `EventBusModule.forRoot(eventBus)`로 그대로 전달됩니다.

## Saga process-manager 예시

```typescript
import { Inject, Module } from '@konekti/core';
import {
  CommandBus,
  CommandHandler,
  COMMAND_BUS,
  CqrsEventBus,
  CqrsModule,
  EVENT_BUS,
  ICommand,
  ICommandHandler,
  IEvent,
  ISaga,
  Saga,
} from '@konekti/cqrs';

class OrderSubmittedEvent implements IEvent {
  constructor(public readonly orderId: string) {}
}

class PaymentAuthorizedEvent implements IEvent {
  constructor(public readonly orderId: string) {}
}

class InventoryReservedEvent implements IEvent {
  constructor(public readonly orderId: string) {}
}

class StartPaymentCommand implements ICommand {
  constructor(public readonly orderId: string) {}
}

class ReserveInventoryCommand implements ICommand {
  constructor(public readonly orderId: string) {}
}

class CompleteOrderCommand implements ICommand {
  constructor(public readonly orderId: string) {}
}

@Inject([EVENT_BUS])
@CommandHandler(StartPaymentCommand)
class StartPaymentHandler implements ICommandHandler<StartPaymentCommand> {
  constructor(private readonly eventBus: CqrsEventBus) {}

  async execute(command: StartPaymentCommand): Promise<void> {
    await this.eventBus.publish(new PaymentAuthorizedEvent(command.orderId));
  }
}

@Inject([EVENT_BUS])
@CommandHandler(ReserveInventoryCommand)
class ReserveInventoryHandler implements ICommandHandler<ReserveInventoryCommand> {
  constructor(private readonly eventBus: CqrsEventBus) {}

  async execute(command: ReserveInventoryCommand): Promise<void> {
    await this.eventBus.publish(new InventoryReservedEvent(command.orderId));
  }
}

@CommandHandler(CompleteOrderCommand)
class CompleteOrderHandler implements ICommandHandler<CompleteOrderCommand> {
  execute(command: CompleteOrderCommand): void {
    console.log(`order completed: ${command.orderId}`);
  }
}

@Inject([COMMAND_BUS])
@Saga([OrderSubmittedEvent, PaymentAuthorizedEvent, InventoryReservedEvent])
class OrderFulfillmentSaga implements ISaga<IEvent> {
  constructor(private readonly commandBus: CommandBus) {}

  async handle(event: IEvent): Promise<void> {
    if (event instanceof OrderSubmittedEvent) {
      await this.commandBus.execute(new StartPaymentCommand(event.orderId));
      return;
    }

    if (event instanceof PaymentAuthorizedEvent) {
      await this.commandBus.execute(new ReserveInventoryCommand(event.orderId));
      return;
    }

    if (event instanceof InventoryReservedEvent) {
      await this.commandBus.execute(new CompleteOrderCommand(event.orderId));
    }
  }
}

@Module({
  imports: [CqrsModule.forRoot()],
  providers: [StartPaymentHandler, ReserveInventoryHandler, CompleteOrderHandler, OrderFulfillmentSaga],
})
export class AppModule {}
```

## 런타임 동작

- command/query 핸들러 탐색은 `onApplicationBootstrap()`에서 `COMPILED_MODULES`를 기준으로 수행됩니다.
- 핸들러 인스턴스는 부트스트랩 시점에 `RUNTIME_CONTAINER`에서 미리 resolve됩니다.
- command type과 query type마다 정확히 하나의 핸들러만 허용됩니다.
- 중복 command/query 핸들러는 typed framework error로 즉시 실패합니다.
- 등록되지 않은 command/query는 `execute(...)` 호출 시 typed not-found error를 발생시킵니다.
- `CqrsEventBus.publish()`는 내부 `EVENT_BUS.publish()`로 위임됩니다.
- `CqrsEventBus.publish()`는 부트스트랩 시점에 발견된 클래스 기반 `@EventHandler()` 핸들러도 함께 디스패치합니다.
- saga 탐색은 부트스트랩 시점에 수행되며 singleton `@Saga()` 클래스만 등록됩니다.
- 서로 다른 saga 클래스는 같은 이벤트 타입을 함께 구독할 수 있고, 같은 saga 클래스의 중복 등록은 자동으로 dedupe됩니다.
- saga 디스패치는 saga 인스턴스 단위 실행 체인으로 처리되어, 동시 `publish()` 상황에서도 saga별 처리 순서가 결정적으로 유지됩니다.
- saga 내부에서 예상치 못한 예외가 발생하면 `publish()`는 `SagaExecutionError`를 throw합니다. 기존 `KonektiError`는 그대로 전달됩니다.
- 애플리케이션 종료 시 진행 중인 saga 실행은 drain됩니다.
- `CqrsEventBus.publishAll()`은 각 이벤트에 대해 순차적으로 `publish()`를 호출합니다.

## 요구 사항 및 경계

- 표준 TC39 데코레이터만 사용합니다(legacy decorator 모드 비사용).
- command/query 핸들러 클래스는 singleton 스코프여야 합니다.
- command/query 핸들러 클래스는 `execute(...)`를 구현해야 합니다.
- event handler 클래스는 `handle(...)`를 구현해야 합니다.
- saga 클래스는 singleton 스코프여야 합니다.
- saga 클래스는 `handle(...)`를 구현해야 합니다.
- `@EventHandler()` 클래스 핸들러는 `@konekti/event-bus`의 메서드 레벨 `@OnEvent()`와 함께 사용할 수 있습니다.

## 플랫폼 상태 스냅샷 시맨틱

`createCqrsPlatformStatusSnapshot(...)`(또는 `CqrsEventBusService#createPlatformStatusSnapshot()`)으로 CQRS event/saga lifecycle 상태를 공통 platform snapshot 형태로 노출할 수 있습니다.

- `dependencies`: `event-bus.default` 의존성 엣지를 명시적으로 노출합니다.
- `readiness`: discovery/startup 및 shutdown drain 상태를 명시적으로 표면화합니다.
- `health`: event/saga 파이프라인 비가용 상태를 무음 no-op 대신 unhealthy로 보고합니다.
- `details`: 탐색된 CQRS event-handler/saga 수와 drain 구간의 in-flight saga 실행 수를 포함합니다.
