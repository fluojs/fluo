# CQRS 계약

<p><a href="./cqrs.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/cqrs`와 `@fluojs/event-bus`가 현재 구현하는 CQRS 계약을 정의합니다.

## 메시지 분리 규칙

| 메시지 유형 | 디스패치 표면 | 해석 모델 | 현재 계약 |
| --- | --- | --- | --- |
| Command | `CommandBusLifecycleService.execute(...)` 또는 `COMMAND_BUS.execute(...)` | 하나의 Command 타입에 하나의 singleton 핸들러 | Command는 생성자 식별자로 해석됩니다. 핸들러가 없으면 `CommandHandlerNotFoundException`이 발생합니다. 같은 Command에 대한 singleton 핸들러가 둘 이상이면 탐색 단계에서 `DuplicateCommandHandlerError`가 발생합니다. |
| Query | `QueryBusLifecycleService.execute(...)` 또는 `QUERY_BUS.execute(...)` | 하나의 Query 타입에 하나의 singleton 핸들러 | Query는 생성자 식별자로 해석됩니다. 핸들러가 없으면 `QueryHandlerNotFoundException`이 발생합니다. 같은 Query에 대한 singleton 핸들러가 둘 이상이면 탐색 단계에서 `DuplicateQueryHandlerError`가 발생합니다. |
| Event | `CqrsEventBusService.publish(...)` 또는 `EVENT_BUS.publish(...)` | 하나의 Event 타입에 0개 이상의 singleton 핸들러 | Event 핸들러는 게시된 이벤트 타입에 대해 `instanceof`로 매칭됩니다. 같은 Event에 대한 중복 `@EventHandler(...)` provider는 유효하며 discovery 순서대로 fan-out됩니다. 로컬 핸들러가 먼저 실행되고, 그다음 saga 디스패치가 수행되며, 마지막으로 `@fluojs/event-bus`를 통한 위임 게시가 수행됩니다. |
| Saga 트리거 | `@Saga(Event)` 또는 `@Saga([EventA, EventB])` | 하나의 saga 클래스에 하나 이상의 이벤트 타입 | Saga 메타데이터는 singleton 프로바이더에 부착되어 부트스트랩 시 탐색됩니다. 하나의 saga는 여러 이벤트 생성자를 수신할 수 있습니다. |

## 핸들러 등록 규칙

| 규칙 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 모듈 진입점 | 애플리케이션은 `CqrsModule.forRoot(...)`로 CQRS를 등록합니다. 이 모듈은 global이며 lifecycle service와 `COMMAND_BUS`, `QUERY_BUS`, `EVENT_BUS` 호환 토큰을 export합니다. | `packages/cqrs/src/module.ts` |
| 데코레이터 메타데이터 | `@CommandHandler(...)`, `@QueryHandler(...)`, `@EventHandler(...)`, `@Saga(...)`는 표준 데코레이터 메타데이터를 대상 클래스에 저장합니다. | `packages/cqrs/src/decorators.ts`, `packages/cqrs/src/metadata.ts` |
| 선택적 eager 등록 | `CqrsModule.forRoot({ commandHandlers, queryHandlers, eventHandlers, sagas })`는 해당 클래스를 프로바이더 목록에 추가하지만, 탐색은 동일한 핸들러 메타데이터를 읽습니다. | `packages/cqrs/src/module.ts` |
| singleton 전용 탐색 | Command 핸들러, Query 핸들러, Event 핸들러, saga는 프로바이더 스코프가 `singleton`일 때만 등록됩니다. singleton이 아닌 후보는 logger 경고와 함께 건너뜁니다. | `packages/cqrs/src/buses/command-bus.ts`, `packages/cqrs/src/buses/query-bus.ts`, `packages/cqrs/src/buses/event-bus.ts`, `packages/cqrs/src/buses/saga-bus.ts` |
| 핸들러 형태 | Command/Query 핸들러는 `execute(...)`를 구현해야 합니다. Event 핸들러와 saga는 `handle(...)`을 구현해야 합니다. 이를 위반하면 디스패치 시 `InvariantError`가 발생합니다. | `packages/cqrs/src/buses/command-bus.ts`, `packages/cqrs/src/buses/query-bus.ts`, `packages/cqrs/src/buses/event-bus.ts`, `packages/cqrs/src/buses/saga-bus.ts` |
| 중복 등록 | 중복 singleton Command/Query 핸들러는 해당 bus가 point-to-point이므로 discovery error입니다. 중복 singleton Event 핸들러는 충돌이 아니며, 일치하는 모든 `@EventHandler(...)` provider가 유지되고 discovery 순서대로 한 번씩 호출됩니다. | `packages/cqrs/src/buses/command-bus.ts`, `packages/cqrs/src/buses/query-bus.ts`, `packages/cqrs/src/buses/event-bus.ts`, `packages/cqrs/src/errors.ts` |
| saga 이벤트 목록 | `@Saga()`는 최소 하나의 이벤트 생성자를 요구하며, 클래스가 아닌 이벤트 값은 거부합니다. 하나의 데코레이터 호출 안에서 중복된 이벤트 생성자는 제거됩니다. | `packages/cqrs/src/decorators.ts` |

## 버스 및 라이프사이클 경계

| 표면 | 현재 동작 | 소스 기준 |
| --- | --- | --- |
| Command 버스 | 핸들러를 한 번 탐색하고, 핸들러 인스턴스를 preload한 뒤, 하나의 Command를 하나의 핸들러에 디스패치합니다. | `packages/cqrs/src/buses/command-bus.ts` |
| Query 버스 | 핸들러를 한 번 탐색하고, 핸들러 인스턴스를 preload한 뒤, 하나의 Query를 하나의 핸들러에 디스패치합니다. | `packages/cqrs/src/buses/query-bus.ts` |
| CQRS 이벤트 버스 | 매칭되는 로컬 Event 핸들러에 게시한 뒤, saga lifecycle service로 전달하고, 마지막으로 공유 `@fluojs/event-bus` 전송 계층으로 위임합니다. `publishAll(...)`은 다음 Event를 발행하기 전에 각 Event의 전체 CQRS pipeline을 기다리므로 입력 순서를 보존합니다. | `packages/cqrs/src/buses/event-bus.ts` |
| saga 런타임 | saga 토큰별 실행을 직렬화하고, `AsyncLocalStorage`로 활성 디스패치 문맥을 추적하며, 진단용 런타임 스냅샷 데이터를 제공합니다. | `packages/cqrs/src/buses/saga-bus.ts` |
| 종료 동작 | CQRS 이벤트 버스는 진행 중인 `publish(...)` pipeline과 `publishAll(...)` sequence가 settle될 때까지 기다린 뒤 stopped 상태로 전환합니다. saga 런타임도 종료 시 진행 중인 디스패치를 기다린 뒤 descriptor와 캐시된 핸들러 인스턴스를 정리합니다. | `packages/cqrs/src/buses/event-bus.ts`, `packages/cqrs/src/buses/saga-bus.ts` |

## 제약 사항

- Command와 Query 라우팅은 생성자 기반 point-to-point 모델입니다. 하나의 메시지 타입이 의도적으로 여러 singleton 핸들러로 해석될 수 없습니다.
- Event 처리는 기본적으로 in-process입니다. `CqrsEventBusService`는 최종 게시 단계를 `@fluojs/event-bus`에 위임하지만, CQRS 패키지 자체가 분산 브로커 계약을 제공하지는 않습니다.
- Shutdown drain은 CQRS 로컬 handler와 saga 작업, 그리고 위임 발행 호출을 포함합니다. `CqrsModule.forRoot({ eventBus: { publish: { waitForHandlers: false } } })`로 설정한 경우 위임된 `@OnEvent(...)` subscriber는 위임 발행이 resolve된 뒤에도 실행 중일 수 있으므로, 이 모드에서 `publish(...)`, `publishAll(...)`, CQRS shutdown drain 완료는 subscriber 완료를 보장하지 않습니다.
- Saga 오케스트레이션은 안전하지 않은 재진입을 방지합니다. 같은 saga 경로로 재진입하거나 중첩 깊이 제한 `32`를 초과하면 `SagaTopologyError`가 발생합니다.
- Saga가 FluoError가 아닌 예외를 던지면 `SagaExecutionError`로 래핑됩니다.
- CQRS 패키지는 TC39 표준 데코레이터와 명시적 메타데이터 저장에 의존합니다.
