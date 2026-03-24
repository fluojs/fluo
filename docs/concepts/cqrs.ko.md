# cqrs

이 문서는 Konekti의 CQRS 패키지 모델을 설명합니다.

### 관련 문서

- `./decorators-and-metadata.ko.md`
- `./di-and-modules.ko.md`
- `../../packages/cqrs/README.ko.md`

## `@konekti/cqrs`가 제공하는 것

`@konekti/cqrs`는 다음 세 가지 런타임 표면을 추가합니다.

- command 실행용 `CommandBus` (`COMMAND_BUS`)
- query 실행용 `QueryBus` (`QUERY_BUS`)
- `@konekti/event-bus`를 통한 이벤트 발행용 `CqrsEventBus` (`EVENT_BUS`, 별칭: `CQRS_EVENT_BUS`)

또한 이슈 기대치에 맞춘 기본 계약도 공개합니다.

- `ICommand`
- `IQuery<TResult = unknown>`
- `IEvent`
- `ICommandHandler<TCommand extends ICommand, TResult = void>`
- `IQueryHandler<TQuery extends IQuery<TResult>, TResult = unknown>`
- `IEventHandler<TEvent extends IEvent>`
- `ISaga<TEvent extends IEvent>` — 이벤트 기반 오케스트레이션을 위한 saga/process-manager 계약

`createCqrsModule({ commandHandlers?, queryHandlers?, eventHandlers?, sagas?, eventBus? })`는 위 토큰들을 글로벌로 등록하고 `createEventBusModule()`을 자동으로 import하므로, CQRS 이벤트 발행에 추가 모듈 연결이 필요하지 않습니다.

- `commandHandlers`, `queryHandlers`, `eventHandlers`, `sagas`: 생성되는 CQRS 모듈에 provider로 추가되는 선택적 편의 배열
- `eventBus`: `createEventBusModule(eventBus)`로 그대로 전달되는 옵션

## 핸들러 등록 모델

command/query 핸들러는 클래스 단위로 선언되며 부트스트랩 시점에 탐색됩니다.

```typescript
import {
  CommandHandler,
  ICommand,
  ICommandHandler,
  IQuery,
  IQueryHandler,
  QueryHandler,
} from '@konekti/cqrs';

class CreateUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

class GetUserQuery implements IQuery<{ id: string }> {
  readonly __queryResultType__?: { id: string };

  constructor(public readonly id: string) {}
}

@CommandHandler(CreateUserCommand)
class CreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
  execute(command: CreateUserCommand) {
    return command.name;
  }
}

@QueryHandler(GetUserQuery)
class GetUserHandler implements IQueryHandler<GetUserQuery, { id: string }> {
  execute(query: GetUserQuery) {
    return { id: query.id };
  }
}
```

- 데코레이터는 **표준 TC39 클래스 데코레이터**와 `ClassDecoratorContext.metadata`로 구현됩니다.
- 메타데이터 리더는 명시적 저장소와 표준 데코레이터 메타데이터를 안전하게 병합합니다.
- 핸들러 탐색은 `onApplicationBootstrap()`에서 `COMPILED_MODULES`와 `RUNTIME_CONTAINER`를 사용해 수행됩니다.

## command/query 불변 조건

- 각 command type마다 정확히 하나의 핸들러만 허용됩니다.
- 각 query type마다 정확히 하나의 핸들러만 허용됩니다.
- 중복 등록은 typed framework error로 부트스트랩 단계에서 실패합니다.
- 누락된 핸들러는 실행 시 typed framework error로 실패합니다.
- 핸들러는 singleton 스코프여야 하며 `execute(...)`를 구현해야 합니다.

## 이벤트 발행 모델

`CqrsEventBus`는 얇은 퍼사드이지만 빈 래퍼는 아닙니다.

- `publish(event)`는 `@konekti/event-bus`의 `EVENT_BUS.publish(event)`로 위임합니다.
- `publish(event)`는 동시에 `@konekti/cqrs`가 탐색한 클래스 레벨 `@EventHandler()` 핸들러도 디스패치합니다.
- `publishAll(events)`는 각 이벤트에 대해 순차적으로 `publish(event)`를 호출합니다.

즉, 같은 이벤트 타입에 대해 클래스 레벨 `@EventHandler()`와 메서드 레벨 `@OnEvent(...)`를 함께 사용할 수 있습니다.

## saga / process-manager 모델

`@Saga(EventClass | EventClass[])`는 하나 이상의 이벤트 타입에 반응하는 saga/process-manager 클래스를 지정합니다.

```typescript
import { Inject } from '@konekti/core';
import {
  CommandBus,
  COMMAND_BUS,
  createCqrsModule,
  IEvent,
  ISaga,
  Saga,
} from '@konekti/cqrs';

class OrderSubmittedEvent implements IEvent {
  constructor(public readonly orderId: string) {}
}

class StartPaymentCommand {
  constructor(public readonly orderId: string) {}
}

@Inject([COMMAND_BUS])
@Saga(OrderSubmittedEvent)
class OrderSaga implements ISaga<OrderSubmittedEvent> {
  constructor(private readonly commandBus: CommandBus) {}

  async handle(event: OrderSubmittedEvent): Promise<void> {
    await this.commandBus.execute(new StartPaymentCommand(event.orderId));
  }
}
```

- `@Saga()`는 단일 이벤트 클래스 또는 배열을 허용합니다.
- saga 클래스는 singleton 스코프여야 하며 `handle(event)`를 구현해야 합니다.
- 서로 다른 saga 클래스는 같은 이벤트 타입을 함께 구독할 수 있고, 같은 saga 클래스의 중복 등록은 자동으로 dedupe됩니다.
- saga 디스패치는 saga 인스턴스 단위 실행 체인으로 처리되어, 동시 `publish()` 상황에서도 saga별 처리 순서가 결정적으로 유지됩니다.
- saga 내부에서 예상치 못한 예외가 발생하면 `publish()`는 `SagaExecutionError`를 throw합니다.
- 애플리케이션 종료 시 진행 중인 saga 실행은 drain됩니다.
- saga는 `createCqrsModule({ sagas: [...] })`의 `sagas` 옵션으로 등록하거나, 부트스트랩 시점 데코레이터 탐색에 맡길 수 있습니다.

## 한 줄 모델

```text
@konekti/cqrs = command/query 디스패치 계약 + 클래스 레벨 event-handler 퍼사드
@konekti/event-bus = 메서드 레벨 event-handler 탐색 및 디스패치 런타임
```
