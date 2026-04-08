# CQRS (명령 및 쿼리 책임 분리)

<p><a href="./cqrs.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

아키텍처의 본질은 복잡성을 관리하는 것입니다. Konekti는 **시스템 상태를 변경하는 작업(명령, Command)**과 **데이터를 조회하는 작업(쿼리, Query)**을 각각의 전용 버스로 분리하여, 확장 가능하고 유지보수가 용이한 백엔드 시스템을 구축할 수 있도록 강력한 CQRS 구현을 제공합니다.

## 왜 Konekti의 CQRS인가요?

- **의도와 실행의 분리**: 애플리케이션 서비스는 "의도"(Command 또는 Query 객체)만 알면 되며, 그것이 어떻게 처리되는지에 대한 구현 세부 사항은 알 필요가 없습니다.
- **명시적 도메인 모델링**: 상태 변경을 일급 객체인 `Command`로 다룸으로써 비즈니스 로직을 감사(Audit)하기 쉬워지고 추론하기 용이해집니다.
- **이벤트 기반 오케스트레이션**: 내장된 **Saga** 지원을 통해 서로 다른 도메인 간의 복잡한 다단계 워크플로우를 강한 결합 없이 관리할 수 있습니다.
- **설정이 필요 없는 탐색**: 표준 데코레이터를 사용하여 부트스트랩 시점에 핸들러가 자동으로 탐색되고 등록됩니다.

## 책임 분담

- **`@konekti/cqrs` (오케스트레이터)**: 핵심 `CommandBus`, `QueryBus`, `CqrsEventBus`를 제공합니다. 탐색 수명 주기를 관리하며 각 메시지가 지정된 핸들러에 도달하도록 보장합니다.
- **`@konekti/event-bus` (엔진)**: 이벤트 분배를 위한 기반 인프라입니다. CQRS 패키지는 고성능 전달을 위해 이벤트 발행을 이 패키지에 위임합니다.

## 일반적인 워크플로우

### 1. 명령 흐름 (Command Flow - 쓰기)
명령(Command)은 시스템 상태를 변경하려는 의도를 나타냅니다. 정확히 하나의 핸들러를 가지며, 종종 하나 이상의 이벤트를 발생시킵니다.

```typescript
// 1. 의도 발행 (Dispatch)
await commandBus.execute(new CreateUserCommand('John Doe'));

// 2. 처리 (Handled by)
@CommandHandler(CreateUserCommand)
class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  async execute(command: CreateUserCommand) {
    // 데이터베이스 저장 로직...
    // UserCreatedEvent 자동 발행...
  }
}
```

### 2. 쿼리 흐름 (Query Flow - 읽기)
쿼리(Query)는 데이터를 조회하려는 의도를 나타냅니다. 명령과 마찬가지로, 예측 가능한 읽기 모델을 보장하기 위해 단 하나의 전용 핸들러에 의해 처리됩니다.

```typescript
const user = await queryBus.execute(new GetUserQuery(userId));
```

### 3. Saga (도메인 간 오케스트레이션)
Saga는 이벤트를 수신하고 새로운 명령을 발행하여, 복잡한 워크플로우를 관리하는 "프로세스 관리자" 역할을 합니다.

```typescript
@Saga(UserCreatedEvent)
class WelcomeSaga implements ISaga<UserCreatedEvent> {
  async handle(event: UserCreatedEvent) {
    // 사용자가 생성되면, "환영 이메일 전송" 명령을 트리거함
    await this.commandBus.execute(new SendEmailCommand(event.userId));
  }
}
```

## 주요 경계

- **단일 핸들러 규칙**: 명령(Command)과 쿼리(Query)는 **일대일(Point-to-Point)** 방식입니다. 각 메시지는 반드시 하나의 핸들러만 가져야 합니다. 핸들러가 없거나 여러 개인 경우, Konekti는 부트스트랩 또는 실행 시점에 에러를 발생시킵니다.
- **이벤트 다대다**: 명령과 달리, 단일 `Event`는 동시에 여러 `EventHandler` 및 `Saga`에 의해 처리될 수 있습니다.
- **로컬 vs 분산**: 기본 CQRS 버스는 단일 프로세스 내에서 작동합니다. 분산 아키텍처의 경우, 커스텀 어댑터를 통해 이 버스들을 외부 브로커(Broker)와 연결할 수 있습니다.

## 다음 단계

- **심층 탐구**: [CQRS 패키지 README](../../packages/cqrs/README.ko.md)를 살펴보세요.
- **기반 인프라**: [이벤트 버스 패키지](../../packages/event-bus/README.ko.md)에 대해 알아보세요.
- **예제**: [예제 앱](../../examples/README.ko.md)에서 복잡한 Saga 워크플로우를 확인해 보세요.
