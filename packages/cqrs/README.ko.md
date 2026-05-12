# @fluojs/cqrs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 CQRS 패키지입니다. 부트스트랩 시점 핸들러 탐색, Command/Query 디스패치, 그리고 `@fluojs/event-bus` 위임 기반 이벤트 발행 기능을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공통 패턴](#공통-패턴)
  - [Saga 프로세스 매니저](#saga-프로세스-매니저)
  - [Event 발행 계약](#event-발행-계약)
  - [심볼 토큰](#심볼-토큰)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/cqrs
```

## 사용 시점

- "의도"(Command/Query)와 "실행"(Handler)을 분리하고 싶을 때 사용합니다.
- 쓰기 모델과 읽기 모델의 명확한 분리가 필요한 복잡한 비즈니스 로직을 구현할 때 적합합니다.
- 도메인 이벤트에 의해 트리거되는 다단계 프로세스(Saga)를 오케스트레이션할 때 사용합니다.
- 단일 애플리케이션 내에서 Command, Query, Event를 위한 중앙 집중식 버스가 필요할 때 사용합니다.

## 빠른 시작

`CqrsModule`을 등록하고 첫 번째 Command와 Handler를 정의합니다.

`CqrsModule.forRoot(...)`를 사용해 CQRS 버스와 핸들러 탐색을 구성합니다.

```typescript
import { Inject, Module } from '@fluojs/core';
import {
  CqrsModule,
  CommandHandler,
  ICommand,
  ICommandHandler,
  CommandBusLifecycleService,
} from '@fluojs/cqrs';

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
@Inject(CommandBusLifecycleService)
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
import { Inject } from '@fluojs/core';
import { Saga, ISaga, IEvent, ICommand, CommandBusLifecycleService } from '@fluojs/cqrs';

class UserCreatedEvent implements IEvent {
  constructor(public readonly userId: string) {}
}

class SendWelcomeEmailCommand implements ICommand {
  constructor(public readonly userId: string) {}
}

@Inject(CommandBusLifecycleService)
@Saga(UserCreatedEvent)
class UserSaga implements ISaga<UserCreatedEvent> {
  constructor(private readonly commandBus: CommandBusLifecycleService) {}

  async handle(event: UserCreatedEvent): Promise<void> {
    await this.commandBus.execute(new SendWelcomeEmailCommand(event.userId));
  }
}
```

Saga 실행은 같은 프로세스 안에서 동일 saga route로 순환 재진입하거나 중첩 hop 수가 32를 넘으면 `SagaTopologyError`로 즉시 실패합니다. 서로 다른 이벤트 단계를 순차 처리하는 multi-stage saga는 계속 허용되지만, in-process saga graph 전체는 비순환(acyclic) 구조를 유지해야 하며, 의도적인 순환/피드백 루프나 더 긴 체인은 외부 transport, scheduler, 또는 다른 bounded boundary 뒤로 이동해야 합니다.

### Event 발행 계약

`CqrsEventBusService.publish(event)`는 CQRS event pipeline을 고정된 순서로 실행합니다. 먼저 일치하는 `@EventHandler(...)` provider를 실행하고, 그다음 일치하는 `@Saga(...)` provider를 실행한 뒤, 마지막으로 `@fluojs/event-bus`로 위임 발행합니다. `publishAll(events)`는 각 event의 CQRS handler, saga, 위임 발행 호출을 기다린 뒤 다음 event를 발행하므로 입력 순서를 보존합니다. 애플리케이션 shutdown 중에는 CQRS event bus가 진행 중인 `publish(...)` pipeline, `publishAll(...)` sequence, saga execution chain이 settle될 때까지 기다린 뒤 stopped 상태로 전환합니다. Shutdown drain은 기본값이 5000ms인 `CqrsModule.forRoot({ shutdown: { drainTimeoutMs } })`로 제한됩니다. CQRS handler, saga 또는 위임 publish chain이 이 bound 이후에도 멈춰 있으면 CQRS는 degraded status diagnostic을 기록하고 경고를 남긴 뒤 애플리케이션 close를 무기한 hang시키지 않고 계속 진행합니다. Shutdown이 시작된 뒤 새로 들어온 CQRS `publish(...)`와 `publishAll(...)` 호출은 lifecycle warning과 함께 무시됩니다. 직접 saga `dispatch(...)` 호출은 saga service가 stopped 또는 failed 상태가 되면 무시되므로 stopped application이 local handler나 saga를 실행하지 않습니다. `CqrsModule.forRoot({ eventBus: { publish: { waitForHandlers: false } } })`로 설정한 경우 위임 발행 호출은 일치하는 `@OnEvent(...)` subscriber가 완료되기 전에 resolve될 수 있으므로, 이 모드에서 `publish(...)`, `publishAll(...)`, shutdown drain 완료는 subscriber 완료를 의미하지 않습니다.

각 CQRS event handler와 saga는 매칭된 event prototype이 복원된 격리 event 복사본을 받습니다. 이 복사본을 mutate해도 변경은 현재 handler 또는 saga route 안에만 머물며, 다른 CQRS handler, saga, 원본 event 객체, 또는 위임된 `@fluojs/event-bus` subscriber에는 보이지 않습니다. 위임된 event-bus 발행은 CQRS side effect가 끝난 뒤 원본 event를 받으므로, `@OnEvent(...)` projection과 transport는 CQRS handler가 mutate한 복사본이 아니라 호출자가 소유한 payload를 관찰합니다.

Event class는 payload state를 clone 가능하고 enumerable하게 유지해야 합니다. 문자열 key와 symbol key를 가진 enumerable payload field는 shared core clone fallback으로 보존되지만, 열린 socket, function, process-local handle처럼 의도적으로 clone할 수 없는 resource는 발행 전에 ID나 다른 serializable boundary로 표현해야 합니다.

CQRS handler, event handler, saga는 singleton provider에서만 discovery됩니다. Non-singleton registration은 경고와 함께 건너뜁니다. Command와 query handler는 class뿐 아니라 provider alias 기준으로도 point-to-point 계약을 유지합니다. 같은 command 또는 query에 대해 동일 handler class를 사용하는 singleton provider가 둘 이상이면 discovery가 실패합니다. Event handler는 fan-out semantics를 유지하므로, 같은 event에 대한 여러 singleton provider는 동일 handler class alias를 포함해 discovery 순서대로 호출됩니다.

### 심볼 토큰

CQRS 버스에 명시적인 Symbol 토큰이 필요하면 다음 익스포트를 사용할 수 있습니다.

```typescript
import { Inject } from '@fluojs/core';
import { COMMAND_BUS, QUERY_BUS, EVENT_BUS } from '@fluojs/cqrs';

@Inject(COMMAND_BUS, QUERY_BUS, EVENT_BUS)
class TokenInjectedService {
  constructor(commandBus, queryBus, eventBus) {}
}
```

## 공개 API 개요

### 모듈 및 프로바이더
- `CqrsModule.forRoot(options)`: 메인 진입점입니다. 버스를 등록하고 탐색을 시작합니다.
- Module option은 명시적인 `commandHandlers`, `queryHandlers`, `eventHandlers`, `sagas`, 위임 `eventBus` option을 받을 수 있습니다.
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

### 오류
- `CommandHandlerNotFoundException`, `QueryHandlerNotFoundException`: bus에 일치하는 handler가 없을 때 발생합니다.
- `DuplicateCommandHandlerError`, `DuplicateQueryHandlerError`: 서로 다른 singleton provider가 같은 command 또는 query type을 claim할 때 발생합니다.
- `DuplicateEventHandlerError`: 충돌하는 event-handler discovery 실패를 위해 export됩니다. 일반적으로 같은 event에 여러 `@EventHandler(...)` provider를 등록하는 것은 유효하며 discovery 순서대로 fan-out됩니다.
- `SagaExecutionError`: 예상하지 못한 non-Fluo saga 실패를 감쌉니다.
- `SagaTopologyError`: 자기 트리거, 순환, 또는 과도하게 깊은 in-process saga graph를 감지했을 때 발생합니다.

### status와 metadata
- `createCqrsPlatformStatusSnapshot(...)`: diagnostics와 health surface를 위한 CQRS status snapshot을 생성합니다.
- command, query, event, saga registration을 검사해야 하는 framework package를 위해 metadata helper와 symbol이 export됩니다.

## 관련 패키지

- `@fluojs/event-bus`: `CqrsEventBusService`에서 사용하는 하위 이벤트 분산 패키지입니다.
- `@fluojs/core`: `@Module` 및 `@Inject` 데코레이터를 위해 필요합니다.

## 예제 소스

- `packages/cqrs/src/module.test.ts`: 모듈 등록 및 기본 버스 사용 예제.
- `packages/cqrs/src/public-api.test.ts`: 루트 배럴 공개 API 계약 검증 예제.
- `packages/cqrs/src/status.test.ts`: CQRS status snapshot 동작 테스트 예제.
- `packages/cqrs/src/event-clone.test.ts`: event clone fallback 동작 테스트 예제.
