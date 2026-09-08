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

# @fluojs/event-bus/redis 사용 시 optional peer도 함께 설치
npm install @fluojs/event-bus ioredis
```

`@fluojs/event-bus`는 패키지 자체의 지원 계약으로 Node.js `>=24.0.0 <27`을 지원합니다.

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

인프로세스 이벤트 버스 등록은 `EventBusModule.forRoot(...)`로 구성합니다. Event-bus provider는 기본적으로 global(`global: true`)이므로 root graph를 import하는 모듈에서 `EventBusLifecycleService`와 `EVENT_BUS` 호환성 토큰을 사용할 수 있습니다. 모듈-local visibility가 필요하면 `EventBusModule.forRoot({ global: false })`를 전달하세요.

```typescript
import { Module, Inject } from '@fluojs/core';
import { EventBusModule, EventBusLifecycleService } from '@fluojs/event-bus';

@Inject(EventBusLifecycleService)
export class UserService {
  constructor(private readonly eventBus: EventBusLifecycleService) {}

  async signUp(email: string) {
    // 사용자 저장 로직...
    await this.eventBus.publish(new UserSignedUpEvent(email));
  }
}

@Module({
  imports: [EventBusModule.forRoot()],
  providers: [NotificationService, UserService],
})
export class AppModule {}
```

`EventPublishOptions`는 일치하는 로컬 핸들러 작업과 선택적 트랜스포트 발행을 모두 제한합니다. `publish(event, options?)`는 `signal`, `timeoutMs`, `waitForHandlers`를 지원합니다. `waitForHandlers`의 기본값은 `true`이며, 기다리는 로컬 핸들러와 기다리는 트랜스포트 publish는 동일한 timeout 및 cancellation bound를 공유합니다. 이러한 bound가 실제 handler 또는 transport 작업이 끝나기 전에 호출자에게 반환되는 publish promise를 settle하더라도, shutdown은 해당 underlying awaited work가 settle되거나 shutdown drain bound가 만료될 때까지 계속 추적합니다. `waitForHandlers`를 `false`로 설정하면 publish가 즉시 반환되고 timeout bound를 적용하지 않지만, handler와 transport 작업은 background에서 계속 실행되며 shutdown drain 추적 대상에 남습니다. Shutdown 중에는 이벤트 버스가 진행 중인 awaited/background publish 및 inbound transport handler 작업을 drain한 뒤 트랜스포트를 닫고, lifecycle이 stopping에 진입한 뒤의 새 publish 호출과 shutdown 시작 뒤 도착한 inbound transport callback은 무시합니다. Drain은 하나의 absolute deadline 아래에서 settle된 snapshot마다 live work set을 다시 확인해 quiescence에 도달하므로, 이미 active인 publish가 늦게 등록한 handler 또는 transport 작업을 transport close 전에 건너뛰지 않습니다. Shutdown drain은 기본값이 5000ms인 `EventBusModule.forRoot({ shutdown: { drainTimeoutMs } })`로 제한됩니다. 활성 dispatch 작업이 이 bound 이후에도 멈춰 있으면 bus는 degraded status diagnostic을 기록하고 경고를 남긴 뒤, 애플리케이션 close를 무기한 hang시키지 않고 transport cleanup을 계속합니다.

Handler failure isolation은 publish completion보다 좁은 계약입니다. 일치하는 local listener 실패는 log되고 격리되며, 다른 matching listener는 계속 실행됩니다. Local listener 실패만으로 `publish(...)`를 reject하지 않습니다. Inbound transport listener에는 같은 isolation 규칙이 적용되므로 inbound callback completion은 격리된 listener 실패를 외부로 드러내지 않습니다. Publisher completion은 모든 listener가 성공했음을 증명하지 않습니다. Timeout, cancellation, transport publication, bootstrap 및 그 밖의 publisher 실패는 이 listener-failure 계약의 범위 밖에 있습니다. 해당 실패는 각각 별도로 문서화된 동작을 유지합니다.

**마이그레이션 참고:** `waitForHandlers: false`를 사용하는 애플리케이션은 이제 background handler 및 transport 작업을 위해 `app.close()`가 최대 `shutdown.drainTimeoutMs`까지 기다린 뒤 transport cleanup을 계속할 수 있음을 shutdown budget에 반영해야 합니다. 해당 작업을 bounded하게 유지하거나 애플리케이션에 적절한 drain budget을 구성하세요.

### 결과가 필요한 발행

`publish(...)`는 기존 best-effort API이며 반환형 `Promise<void>`, 실패 격리, raw error를 포함하는 기존 로깅을 바꾸지 않습니다. 반응 결과를 호출자 정책으로 판단해야 할 때만 `EventBusLifecycleService.publishWithResult(event, options?)`를 선택하세요. 이 API는 같은 모듈 등록, effective singleton handler discovery, 수신자별 payload 복제를 사용하며 `Promise<EventPublishResult>`를 반환합니다. `EVENT_BUS` 런타임 facade도 이를 지원합니다. Facade를 주입하는 소비자는 루트 `@fluojs/event-bus`의 additive type `EventBusWithResults`를 사용하세요. 기존 `EventBus` 인터페이스에는 메서드를 추가하지 않으므로 기존 구현은 그대로 유효합니다.

`EVENT_BUS` 토큰의 타입은 `Token<EventBusWithResults>`이므로 `container.resolve(EVENT_BUS)`가 결과형 facade를 추론합니다. 기존 소비자의 명시적 `container.resolve<EventBus>(EVENT_BUS)`도 유효하며 이 경우에는 기존 `publish` 계약만 보입니다.

| 입력과 기본값 | 계약 |
| --- | --- |
| `event` | 이벤트 클래스의 인스턴스. Payload 검증과 민감 정보 제외는 애플리케이션 책임입니다. |
| `waitForHandlers` | 호출 옵션, 모듈 `publish` 기본값 순으로 선택하며 최종 기본값은 `true`입니다. |
| `timeoutMs` | 같은 순서로 선택하며 생략 시 제한이 없습니다. 양의 유한 값을 정수 밀리초로 내림하고, 0 이하 또는 유한하지 않은 값은 제한을 비활성화합니다. `waitForHandlers: false`에서는 무시합니다. |
| `signal` | 호출별 선택적 `AbortSignal`. 이미 abort되었다면 아직 시작하지 않은 작업을 건너뜁니다. |

| 결과 `status` | 의미 |
| --- | --- |
| `settled` | `outcomes`에 선택된 로컬 핸들러와 outbound transport channel 관측값이 있습니다. 모든 반응의 성공을 뜻하지 않습니다. |
| `no-recipients` | 일치하는 로컬 핸들러도 구성된 transport도 없으며 `outcomes`는 빈 배열입니다. |
| `rejected` | 발행을 수락하지 않은 lifecycle 상태가 `reason: 'stopping' \| 'stopped' \| 'failed'`로 반환됩니다. |
| `background` | `waitForHandlers: false`로 예약했으며 `completion: Promise<EventPublishSettlement>`로 실제 작업 결과를 관찰합니다. |

`EventPublishSettlement`는 `settled` 또는 `no-recipients`입니다. 각 `EventDeliveryOutcome`은 `target`과 다음 상태 중 하나만 포함하며 payload, handler 반환값, raw error를 담지 않습니다.

| Outcome `status` | 추가 필드 |
| --- | --- |
| `succeeded` | 없음 |
| `failed` | `reason: 'handler' \| 'transport' \| 'not-callable'` |
| `timed-out` | `timeoutMs` |
| `cancelled` | `started`: 시작 전 건너뜀은 `false`, 시작 후 대기 취소는 `true` |

결과 배열은 완료 순서가 아닙니다. 일치하는 effective 로컬 핸들러를 discovery 순서로 먼저 나열하고, outbound channel을 channel 순서로 이어 붙입니다. 핸들러 target은 `kind: 'handler'`, 해당 발행 안에서만 유효한 0부터 시작하는 `index`, `moduleName`, `targetName`, `methodName`을 가집니다. 이 index는 영속 ID가 아닙니다. Transport target은 `kind: 'transport'`, `channel`을 가집니다. Channel은 이벤트의 구체 클래스에서 base class로 이어지는 순서 뒤에 matching descriptor의 channel을 더하고 중복은 처음 등장한 위치만 유지합니다. 배열 순서는 실행 직렬화를 보장하지 않습니다.

Transport `succeeded`는 adapter의 해당 channel 발행 성공만 뜻합니다. 원격 핸들러나 subscriber의 존재·처리 결과·내구성을 보고하지 않습니다. Subscriber가 0이어도 adapter가 성공하면 transport 성공이며 `no-recipients`로 바뀌지 않습니다.

Awaited `timed-out`/`cancelled`는 호출자의 관측 결과일 뿐입니다. 시작된 작업은 계속 실행될 수 있고 shutdown drain 추적에 남습니다. Background completion은 timeout과 시작 후 cancellation을 무시하고 실제 작업이 settle될 때까지 기다리므로 bounded shutdown 뒤에도 pending일 수 있고 process exit 시 사라질 수 있습니다. 시작 전 abort에 의한 건너뜀은 background에서도 적용됩니다. 버스는 저장, 재시도, 원격 acknowledgement를 추가하지 않습니다.

Discovery와 payload preparation 오류는 여전히 promise를 reject합니다. 별도의 aggregate-reject API는 없으며 호출자가 `status`와 모든 outcome을 검사해 반응 실패 정책을 결정합니다. 아래는 이미 `EventBusModule.forRoot()`와 필요한 핸들러를 등록한 애플리케이션에서 주입받은 서비스를 사용하는 **범위가 한정된 소비자 함수**입니다. 필수 반응이 하나 이상 있고 모두 성공했을 때만 성공으로 취급합니다.

```typescript
import { EventBusLifecycleService } from '@fluojs/event-bus';

async function requireReactions(eventBus: EventBusLifecycleService, event: object): Promise<void> {
  const result = await eventBus.publishWithResult(event, { waitForHandlers: true });
  if (
    result.status !== 'settled' ||
    result.outcomes.length === 0 ||
    !result.outcomes.every(outcome => outcome.status === 'succeeded')
  ) {
    throw new Error('Required event reactions did not succeed.');
  }
}
```

이 정책도 구성되지 않은 필수 핸들러의 존재를 증명하지는 못합니다. 필요한 로컬 핸들러의 등록을 애플리케이션 테스트로 검증하고, 원격 처리 완료가 필요하면 별도 acknowledgement 계약을 설계하세요. [메시징 가이드의 두 소비자 예제](../../apps/docs/content/docs/guides/messaging-workflows.ko.mdx)는 인증이 이미 성공한 뒤 token record ID만 담는 last-used bookkeeping에는 기존 best-effort `publish`를, 결과가 필요한 반응에는 명시적 검사를 사용하는 차이를 보여 줍니다.

`publishWithResult`가 보고하는 handler/transport 실패 로그는 기존의 안전한 target/status 메시지를 유지하지만 raw handler/transport error 인자를 logger에 전달하지 않습니다. 이는 raw error와 handler 반환값을 제외한 결과 계약과 같습니다. 핸들러나 adapter가 직접 쓰는 애플리케이션 로그는 애플리케이션 책임이며, 기존 `publish`와 inbound delivery의 로그까지 정제하는 전역 정책이 아닙니다.

## 일반적인 패턴

### 분산 팬아웃 (Redis)

트랜스포트 어댑터를 연결하여 이벤트 버스를 다른 프로세스로 확장할 수 있습니다. Redis 서브패스는 optional `ioredis` peer를 사용하므로 transport를 생성하는 애플리케이션에 이를 설치해야 합니다.

```typescript
import { EventBusModule } from '@fluojs/event-bus';
import { RedisEventBusTransport } from '@fluojs/event-bus/redis';
import Redis from 'ioredis';

const redisOptions = { host: 'localhost', port: 6379 };
const publishClient = new Redis(redisOptions);
const subscribeClient = new Redis(redisOptions);

EventBusModule.forRoot({
  transport: new RedisEventBusTransport({
    publishClient,
    subscribeClient,
  }),
});
```

Transport 전용 `publishClient`와 `subscribeClient`를 서로 다른 instance로 생성하세요. Redis는 구독 연결을 Pub/Sub mode로 전환하므로 subscriber를 publish나 일반 command에도 사용하면 안 됩니다. 두 client는 모두 caller-owned입니다. `RedisEventBusTransport.close()`는 transport의 subscription과 listener를 제거하지만 어느 client도 disconnect하지 않습니다. Event bus teardown이 끝난 뒤 각 lifecycle owner가 해당 client를 닫아야 합니다.

Redis Pub/Sub은 durable work queue가 아니라 fan-out transport입니다. 여러 애플리케이션 인스턴스가 같은 이벤트 채널을 구독하면 각 인스턴스가 같은 published fact를 볼 수 있습니다. 따라서 상태를 변경하거나 알림을 보내거나 외부 시스템을 호출하는 handler는 idempotent해야 합니다. Payload에 안정적인 event identifier 또는 business key를 담고, 이미 적용한 reaction을 기록하며, 반복 전달이 side effect를 두 번 실행하는 대신 같은 결과로 수렴하도록 만드세요.

`@OnEvent(...)` handler는 작고 bounded하게 유지하세요. 빠른 local projection, cache invalidation, 가벼운 notification처럼 publish timeout과 shutdown drain window 안에 끝낼 수 있는 reaction에 적합합니다. Reaction이 느리거나, failure-prone이거나, retry 가능하거나, operator-visible dead-letter handling이 필요하다면 해당 작업을 inline으로 수행하지 말고 event handler에서 `@fluojs/queue`의 durable job으로 hand off하세요. Handoff에는 애플리케이션이 소유한 unique claim을 사용하고, `queue.enqueue(...)`가 성공한 뒤에만 handoff를 enqueued로 표시하세요. Enqueue가 실패하면 pending claim을 해제해 이후 duplicate event가 안전하게 다시 시도할 수 있게 합니다.

아래 예제의 `this.reactions` helper는 `@fluojs/event-bus`나 `@fluojs/queue` API가 아니라 애플리케이션이 소유한 claim store를 나타냅니다. Business key를 atomic하게 claim하고 stale pending claim을 애플리케이션의 retry policy에 따라 복구할 수 있는 저장소로 구현하세요.

```typescript
import { Inject } from '@fluojs/core';
import { OnEvent } from '@fluojs/event-bus';
import { QueueLifecycleService } from '@fluojs/queue';

export class GenerateInvoiceJob {
  constructor(public readonly orderId: string) {}
}

@Inject(QueueLifecycleService)
export class BillingEventsHandler {
  constructor(private readonly queue: QueueLifecycleService) {}

  @OnEvent(OrderPlacedEvent)
  async enqueueInvoice(event: OrderPlacedEvent) {
    const handoffKey = `${event.orderId}:invoice`;

    if (!(await this.reactions.claimPending(handoffKey))) {
      return;
    }

    try {
      await this.queue.enqueue(new GenerateInvoiceJob(event.orderId));
      await this.reactions.markEnqueued(handoffKey);
    } catch (error) {
      await this.reactions.releasePending(handoffKey);
      throw error;
    }
  }
}
```

비즈니스 사실이 발생했음을 표현할 때는 event bus를 사용하세요. Reaction에 retry, backoff, workload isolation, dead-letter inspection이 필요하면 Queue를 사용하세요. Claim이 pending인 동안 프로세스가 종료될 수 있다면 애플리케이션의 retry policy에 맞게 stale pending record를 복구하도록 애플리케이션 소유 claim store를 설계하세요.

### 버전이 명시된 이벤트 키

`static eventKey`를 사용하여 클래스 이름 변경이나 코드 압축(minification)과 관계없이 안정적인 채널 이름을 유지할 수 있습니다.

```typescript
class UserRegisteredEvent {
  static readonly eventKey = 'user.registered.v1';
}
```

핸들러는 imported module의 singleton provider와 controller에서 발견됩니다. Discovery는 여러 provider가 같은 구현 class를 공유하더라도 서로 다른 singleton provider identity를 유지하며, 같은 provider token과 handler method가 중복 등록된 경우에는 한 번만 호출합니다. Event-bus bootstrap은 ready 상태를 보고하기 전에 발견된 모든 handler target을 resolve하며, 실제 handler target resolution이 실패하면 handler를 조용히 건너뛰고 ready를 보고하는 대신 bootstrap을 실패시킵니다. Discovery는 이미 handler metadata를 가진 singleton `useValue` instance와 provider token 자체가 `@OnEvent(...)` metadata를 가진 handler class인 singleton `useFactory` provider만 검사하므로, event-bus bootstrap 중 관련 없는 factory provider는 호출되지 않습니다. 각 핸들러는 격리된 clone payload를 받으며, class inheritance는 `instanceof` 매칭으로 지원됩니다. 외부 트랜스포트를 구성하면 subclass event publish는 publisher process에 해당 타입의 local handler가 없더라도 subclass channel과 prototype chain의 모든 inherited event channel로 fan-out됩니다. Subclass가 직접 `static eventKey`를 선언한 경우에만 그 값을 사용하며, 그렇지 않으면 subclass channel은 class name을 유지하고 base class는 자신의 stable key를 유지합니다.

## 공개 API 개요

### 핵심 구성 요소
- `EventBusModule.forRoot({ global?, publish?, shutdown?, transport? })`: 이벤트 버스 등록을 위한 기본 진입점입니다. `global`의 기본값은 `true`이며, event-bus provider를 event-bus 모듈을 import한 모듈을 통해서만 보이게 하려면 `global: false`를 설정하세요.
- `EventBusLifecycleService`: 기존 `publish(event, options?)`, opt-in `publishWithResult(event, options?)`, platform status snapshot 생성을 위한 기본 서비스입니다.
- `@OnEvent(EventClass)`: 특정 메서드를 이벤트 핸들러로 지정하는 데코레이터입니다.
- `EVENT_BUS`: 발행 facade를 위한 호환성 주입 토큰입니다.
- `createEventBusPlatformStatusSnapshot(...)`: diagnostics와 health surface에서 사용하는 상태 스냅샷 헬퍼입니다.

### 인터페이스
- `EventBusTransport`: 외부 트랜스포트 어댑터 구현을 위한 계약입니다.
- `EventBus`, `EventPublishOptions`, `EventBusModuleOptions`, `EventType`: 발행, 기본값, 트랜스포트, 안정적인 이벤트 키를 위한 타입 전용 계약입니다.
- `EventBusWithResults`: 기존 `EventBus`를 확장하는 결과형 facade 계약입니다. `EventDeliveryTarget`, `EventDeliveryStatus`, `EventDeliveryOutcome`, `EventPublishSettlement`, `EventPublishResult`도 루트에서 type-only export됩니다.
- `EventBusLifecycleState`, `EventBusStatusAdapterInput`, `EventBusPlatformStatusSnapshot`: status snapshot 계약입니다.

Transport bootstrap은 unique event channel마다 한 번만 subscribe합니다. `eventKey`가 있으면 transport channel 이름을 제어합니다. Bootstrap 중 이후 transport subscription이 실패하면 이벤트 버스는 이미 열린 channel을 rollback하기 위해 subscription error를 다시 던지기 전에 transport를 닫습니다. Shutdown 시작 뒤 도착한 inbound transport message는 local handler dispatch 전에 무시됩니다.

Handler discovery는 normalized effective singleton provider registration과 controller를 사용하므로, duplicate provider token의 DI winner만 발견되고 factory-provider scope도 canonical DI normalization을 따릅니다. `@OnEvent(...)`는 public instance 메서드에만 적용할 수 있습니다. Handler와 transport 실패는 기록되고 log되지만 `publish()`는 attempt가 settle되면 resolve하며, `waitForHandlers: false`에서는 shutdown-tracked background work를 scheduling한 뒤 resolve합니다.

## 런타임별 및 통합 서브패스

| 관심사 | 서브패스 | 내보내는 항목 |
| --- | --- | --- |
| Redis Pub/Sub 트랜스포트 | `@fluojs/event-bus/redis` | `RedisEventBusTransport`, `RedisEventBusTransportOptions` |

`RedisEventBusTransport`는 명시적인 `@fluojs/event-bus/redis` 서브패스에만 유지되어 루트 `@fluojs/event-bus` 진입점이 모듈 등록, 로컬 발행, 데코레이터, 타입 전용 계약에 집중하도록 합니다. 이 서브패스를 사용하는 애플리케이션은 optional `ioredis` peer를 설치하고 transport 전용 `publishClient`와 `subscribeClient`를 서로 다른 instance로 제공해야 합니다. 이 Redis adapter는 inbound Redis message를 JSON decode하고 잘못된 JSON은 handler dispatch 전에 버립니다. 이 parsing 규칙은 임의의 `EventBusTransport` 구현에는 적용되지 않습니다. Shutdown 중 adapter는 자신이 등록한 채널을 unsubscribe하고 message listener를 분리하지만, `close()`는 caller-owned client를 disconnect하지 않습니다. Unsubscribe가 실패하면 `close()`는 listener를 계속 분리하면서 등록된 채널을 유지하므로 이후 `close()`가 동일한 cleanup을 다시 시도합니다. 애플리케이션 또는 client-owning module이 event-bus teardown 후 해당 client를 별도로 닫아야 합니다.

## 관련 패키지

- `@fluojs/cqrs`: 더 정형화된 아키텍처 패턴을 위해 이벤트 버스 위에 구축된 패키지입니다.
- `@fluojs/redis`: `RedisEventBusTransport` 사용 시 필요한 클라이언트를 제공합니다.

## 예제 소스

- [실행 가능한 결과형 발행 예제](./examples/publish-results.ts): best-effort 소비자와 결과를 검사하는 소비자의 비교.
- [결과와 정제된 실패 관측 테스트](./src/publish-result.test.ts), [timeout/cancellation 테스트](./src/publish-result-bounds.test.ts), [lifecycle/background completion 테스트](./src/publish-result-lifecycle.test.ts).
- [결과형 공개 타입](./src/publish-result.ts), [발행 구현](./src/service.ts), [facade wiring](./src/module.ts).
- `packages/event-bus/src/module.test.ts`: 핸들러 탐색 및 발행/구독 테스트 예제.
- `packages/event-bus/src/public-surface.test.ts`: 공개 API 계약 검증 예제.
- `packages/event-bus/src/status.test.ts`: status snapshot semantic 테스트 예제.
- `packages/event-bus/src/shutdown-late-work.test.ts`: 늦은 handler 및 transport 등록 shutdown race 테스트 예제.
- `packages/event-bus/src/transports/redis-transport.test.ts`: Redis transport 동작 테스트 예제.

위 source evidence의 소유자 검증 명령은 저장소 루트에서 실행합니다. 이 문서의 예제는 workspace checkout을 대상으로 하며 최신 registry release 검증을 뜻하지 않습니다.

```bash
pnpm --dir packages/event-bus test
pnpm --filter '@fluojs/event-bus...' build
```

Build 뒤에는 저장소의 Babel decorator 설정으로 예제를 변환하고 지원되는 Node.js에서 실행할 수 있습니다. Git에서 무시하는 `dist/` 안에 출력하면 패키지 자체 import도 해석됩니다. 예제는 HTTP 서버나 Redis를 열지 않으며 `authenticated: true`, `projectionReady: false`, 성공·실패 outcome과 background completion을 출력합니다.

```bash
pnpm exec babel packages/event-bus/examples/publish-results.ts --out-file packages/event-bus/dist/publish-results.example.mjs --config-file ./tooling/babel/babel.config.cjs
node packages/event-bus/dist/publish-results.example.mjs
```
