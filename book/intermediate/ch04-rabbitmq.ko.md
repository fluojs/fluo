<!-- packages: @fluojs/microservices, amqplib -->
<!-- project-state: FluoShop v1.3.0 -->

# 4. RabbitMQ

RabbitMQ는 이 파트에서 처음으로 노골적으로 큐 중심적이라는 느낌을 주는 브로커입니다. Redis Streams도 이미 FluoShop에 내구성 있는 전달을 제공했지만, RabbitMQ는 큐 토폴로지 자체를 주된 설계 도구로 끌어올립니다. 이 점은 한 서비스가 작업을 소유하고 다른 서비스가 재시도하며 세 번째 서비스는 브로커가 전달 준비가 되었다고 판단할 때까지 기다려야 하는 구조에서 중요합니다. FluoShop v1.3.0에서는 결제 이후의 fulfillment handoff를 RabbitMQ로 옮깁니다. Order Service는 여전히 이전 장들의 트랜스포트로 고객 트래픽을 받지만, 새로운 RabbitMQ 경로는 결제가 성공한 뒤에 시작됩니다. 이 시점의 비즈니스는 더 이상 즉각적인 사용자 지연 시간만을 요구하지 않고, 피킹·포장·후속 알림을 위한 안정적인 작업 큐를 요구합니다.

아키텍처 관점에서 이는 **스트림 로그**(모두가 모든 것을 보고 스스로 오프셋을 결정함)에서 **작업 큐**(작업이 소비자의 사서함으로 명시적으로 푸시됨)로의 전환을 의미합니다. 피커(packer)나 선반 공간 같은 물리적 자원이 한정된 창고 환경에서는 공유 브로드캐스트보다 작업 큐 모델이 자원 조율 측면에서 훨씬 안전합니다.

## 4.1 Why RabbitMQ in FluoShop

RabbitMQ는 토폴로지가 로그보다 큐에 가깝게 설계될 때 특히 잘 맞습니다. Fulfillment Service는 포장 작업을 직접 소유해야 하고, Notification Service는 fulfillment milestone을 들어야 하지만 주 작업자가 되어서는 안 됩니다. 운영자는 큐 깊이를 보고 지연이 실제 병목인지 일시적 현상인지 판단할 수 있어야 하며, 이런 스타일은 일반적인 요청 경로보다 RabbitMQ에서 더 자연스럽습니다.

FluoShop에서 4장은 세 가지 구체적인 목표를 추가합니다.

1. 이전 장에서 만든 고객 주문 흐름을 유지한다.
2. 결제 확인 이후의 창고 작업을 브로커 기반 큐로 밀어 넣는다.
3. 트랜스포트가 달라도 프로그래밍 모델은 동일하게 유지한다.

RabbitMQ가 TCP나 Redis를 모든 곳에서 대체하는 것은 아닙니다.

명시적인 큐 소유권이 더 큰 명확성을 주는 handoff만 맡는 것입니다.

패키지를 정확히 하나의 작업자가 포장해야 하는 순간, 큐는 fan-out topic보다 더 많은 정보를 줍니다. RabbitMQ의 **Competing Consumers** 패턴을 사용하면 Fulfillment Service를 10개 인스턴스로 확장하더라도 하나의 `payment.settled` 이벤트가 정확히 하나의 창고 "피킹" 작업으로 이어지게 하여, 인프라 수준에서 중복 배송 오류를 방지할 수 있습니다.

## 4.2 Bootstrapping RabbitMQ with caller-owned collaborators

fluo 트랜스포트는 RabbitMQ를 마법 같은 연결 관리자 뒤에 숨기지 않습니다. 패키지 README가 설명하듯 브로커 클라이언트는 caller-owned collaborator로 남으며, 즉 애플리케이션이 채널을 만들고 큐를 선언하고 publish 또는 consume 함수를 transport에 전달해야 합니다. 이것은 의도적인 설계입니다. 프레임워크는 메시지 라우팅을 소유하고 애플리케이션은 인프라 배선을 계속 소유합니다.

이 "collaborator" 패턴은 Node.js의 가장 흔한 RabbitMQ 드라이버인 `amqplib`이 프레임워크 코어의 강제 의존성이 되지 않도록 보장합니다. 또한 FluoShop이 프레임워크가 구체적인 RabbitMQ 구성을 알 필요 없이 클러스터 장애 조치(failover)나 사용자 정의 인증 같은 복잡한 연결 로직을 사용할 수 있게 해줍니다.

### 4.2.1 Publisher and consumer collaborators

`RabbitMqMicroserviceTransport`는 두 가지 collaborator를 기대합니다.

- `publisher.publish(queue, message)`는 직렬화된 프레임을 보냅니다.
- `consumer.consume(queue, handler)`와 `consumer.cancel(queue)`는 큐 리스너를 관리합니다.

이 transport는 책의 예제에서 중요한 큐 수준 옵션도 제공합니다.

- `eventQueue`
- `messageQueue`
- `responseQueue`
- `requestTimeoutMs`

이를 재정의하지 않으면 fluo는 이벤트, 메시지, 응답 큐에 대한 기본값을 사용합니다.

특히 응답 큐가 중요합니다.

기본적으로 인스턴스 범위이며 UUID가 포함됩니다.

덕분에 여러 서비스 인스턴스가 동시에 살아 있을 때도 응답 충돌을 막을 수 있습니다. 만약 Order Service 인스턴스 A가 요청을 보내면, 인스턴스 A의 고유한 `responseQueue`(예: `fluo.microservices.responses.uuid-a`)만이 응답을 받습니다. 인스턴스 B는 자신의 고유 큐를 듣고 있으므로 이 메시지를 아예 보지 못합니다.

### 4.2.2 Module wiring

FluoShop에서 Fulfillment Service는 RabbitMQ를 전용 마이크로서비스 경계로 부트합니다.

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, RabbitMqMicroserviceTransport } from '@fluojs/microservices';

const transport = new RabbitMqMicroserviceTransport({
  consumer: rabbitConsumer, // 메인 부트스트랩에서 전달됨
  publisher: rabbitPublisher, // 메인 부트스트랩에서 전달됨
  eventQueue: 'fluoshop.fulfillment.events',
  messageQueue: 'fluoshop.fulfillment.messages',
  requestTimeoutMs: 8_000,
});

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport,
    }),
  ],
  providers: [FulfillmentHandler],
})
export class FulfillmentModule {}
```

이 코드는 이제 매우 익숙하게 보여야 합니다.

핸들러 모델은 그대로 유지됩니다.

바뀌는 것은 트랜스포트 부트스트랩뿐입니다.

바로 이 연속성이 intermediate 책을 반복이 아닌 누적형 학습으로 만들어 줍니다. 2장의 `TcpMicroserviceTransport`를 쓰든 이 RabbitMQ 트랜스포트를 쓰든, 여러분의 `@MessagePattern` 핸들러는 데이터를 받기 위해 코드를 단 한 줄도 수정할 필요가 없습니다.

## 4.3 Queue topology for request and event traffic

RabbitMQ는 큐 이름을 명시적으로 설계하도록 유도합니다. 큐가 단순한 파이프가 아니기 때문입니다. 큐는 운영 객체이며, 팀이 직접 보고 재전송도 하며 누가 소유하는지도 정의합니다.

FluoShop에서는 command 성격의 message와 event 성격의 broadcast를 위한 큐를 분리합니다. 이 구분은 **SLA 관리** 측면에서 중요합니다. 중요한 고객 요청인 "message" 큐에 백그라운드 알림인 "event" 큐보다 더 높은 우선순위나 더 많은 워커를 할당할 수 있기 때문입니다.

### 4.3.1 Message, event, and response queues

이 transport는 내부적으로 세 가지 프레임 종류를 모델링합니다.

- `message`: 요청-응답(커맨드)에 사용됩니다.
- `event`: 화이어-앤-포겟(브로드캐스트)에 사용됩니다.
- `response`: 상관관계가 유지된 응답에 사용됩니다.

이것이 RabbitMQ 토폴로지로 이어집니다.

- `fluoshop.fulfillment.messages`는 `fulfillment.reserve-packers` 같은 request-reply command를 운반합니다.
- `fluoshop.fulfillment.events`는 `payment.settled` 같은 fire-and-forget signal을 운반합니다.
- `fluoshop.fulfillment.responses.<instance>`는 발신자에게 응답을 돌려줍니다.

이 분리는 의도를 읽기 쉽게 만듭니다.

운영자가 message 큐의 backlog를 보면 요청형 작업이 밀린다는 사실을 바로 알 수 있습니다.

event 큐의 볼륨을 보면 broadcast 성격의 side effect가 얼마나 활발한지도 볼 수 있습니다. 또한 이 토폴로지는 보안을 단순화합니다. Order Service는 Fulfillment의 event/message 큐에 대해서는 "쓰기" 권한만 필요하고, 자신의 고유 response 큐에 대해서만 "읽기" 권한을 가지면 되기 때문입니다.

### 4.3.2 Instance-scoped response queues

저장소의 RabbitMQ 테스트는 중요한 안전 속성을 검증합니다. 동시 실행 중인 인스턴스가 서로의 응답을 가로채면 안 됩니다. 그래서 기본 `responseQueue`에 `crypto.randomUUID()`가 포함됩니다. FluoShop에서는 이 덕분에 Order Service를 수평 확장하더라도 각 인스턴스가 자신이 기다리는 fulfillment reply를 안전하게 받을 수 있습니다. 이는 요청 헤더의 `replyTo` 필드가 소비자에게 정확히 어디로 결과를 보내야 할지 알려주는 **Direct Reply-to** 개념(또는 임시 큐)을 사용하여 구현됩니다. `responseQueue`를 직접 재정의한다는 것은 공유 reply topology를 직접 소유하겠다는 뜻입니다. 그 선택이 틀린 것은 아니지만, 상관관계와 수명 주기 정책도 직접 책임져야 합니다. 안전한 기본값은 인스턴스 범위 응답 큐를 그대로 두는 것입니다.

## 4.4 Request-response workflows on RabbitMQ

RabbitMQ는 흔히 백그라운드 잡 전용으로만 소개됩니다.

fluo는 그보다 더 넓은 모델을 지원합니다.

`send()`를 사용하고 상관관계가 보장된 응답을 받을 수 있습니다.

transport는 요청 프레임을 직렬화하고, `requestId`와 `replyTo`를 담아 전송한 뒤, 응답 프레임이 도착하면 호출자를 resolve 또는 reject 합니다. 내부적으로 transport는 `requestId`를 키로 하는 보류 중인 요청의 `Map`을 유지하여, 같은 분에 수천 개의 응답이 오더라도 정확한 `async/await` 호출자에게 전달되도록 보장합니다.

### 4.4.1 FluoShop packer reservation

FluoShop에서 Order Service는 때때로 broker-backed quick answer를 Fulfillment로부터 받아야 합니다. 예를 들어 같은 날 출고를 약속하기 전에 창고 wave에 충분한 packer capacity가 있는지 물을 수 있습니다.

```typescript
import { Inject } from '@fluojs/core';
import { MICROSERVICE, type Microservice } from '@fluojs/microservices';

export class FulfillmentClient {
  constructor(@Inject(MICROSERVICE) private readonly microservice: Microservice) {}

  async reservePackers(orderId: string, warehouseId: string) {
    // RabbitMqMicroserviceTransport.send()를 사용합니다.
    return await this.microservice.send('fulfillment.reserve-packers', {
      orderId,
      warehouseId,
    });
  }
}
```

여기서 비즈니스 이점은 미묘하지만 분명합니다. Order Service는 창고 내부로 향하는 직접 TCP 소켓이 필요한 것이 아닙니다.

응답은 지원하되, 동시에 창고 팀이 이미 채택한 큐 중심 운영 모델에도 맞는 트랜스포트가 필요합니다.

RabbitMQ가 바로 그 다리를 제공합니다.

### 4.4.2 Timeouts, correlation, and handler failures

응답이 `requestTimeoutMs` 안에 도착하지 않으면 transport는 호출자를 reject 합니다.

핸들러 에러도 호출자에게 그대로 round-trip 됩니다.

따라서 FluoShop은 세 가지 상태를 구분할 수 있습니다.

1. Fulfillment가 요청을 받고 정상적으로 응답했다.
2. Fulfillment가 요청을 처리했지만 도메인 오류로 거절했다.
3. 타임아웃 예산 안에 응답이 오지 않았다.

이 상태들을 하나의 generic failure로 뭉개면 안 됩니다.

창고가 당일 출고를 정책적으로 거절했다면 API가 그 이유를 설명할 수 있어야 합니다.

반면 브로커 경로 자체가 timeout이라면 일시적 의존성 오류로 보여 주는 편이 맞습니다. 이 구분은 `RabbitMqTransportMessage` 프레임의 `error` 속성 덕분에 가능합니다. 핸들러가 에러를 던지면 transport가 이를 잡아 메시지를 직렬화하고, `kind: 'response'`와 `error: string`을 설정하여 `replyTo` 큐로 돌려보냅니다.

## 4.5 Event-driven workflows on RabbitMQ

RabbitMQ는 `emit()`을 통한 fire-and-forget event delivery도 지원합니다.

여기서 FluoShop v1.3.0이 더 현실적인 시스템으로 진화합니다.

Payment가 `payment.settled`를 발행하면 여러 반응이 이어질 수 있습니다. Fulfillment는 피킹을 스케줄하고, Notification은 고객 메시지를 준비하며, 리스크 시스템은 체크포인트를 남길 수 있습니다. 이제 결제 경로는 모든 downstream side effect를 기다릴 필요가 없습니다.

### 4.5.1 Payment settled to fulfillment requested

가장 단순한 handoff는 다음과 같습니다.

```typescript
@EventPattern('payment.settled')
async onPaymentSettled(event: { orderId: string; warehouseId: string }) {
  // 창고 피킹 wave를 준비하는 로직
  await this.fulfillmentPlanner.enqueuePickWave(event.orderId, event.warehouseId);
}
```

여기서 바뀌지 않는 것이 무엇인지 보아야 합니다. 핸들러는 여전히 단순한 provider method이고, transport는 큐 프레임을 맡으며, domain service는 비즈니스 결정을 맡습니다.

이것이 책 전반에 반복되는 fluo 패턴입니다. "배선"이 TCP 소켓에서 RabbitMQ 큐로 바뀌었음에도 불구하고, `@EventPattern` 덕분에 개발자는 오직 사이드 이펙트 로직에만 집중할 수 있습니다.

### 4.5.2 Dead-letter and redrive policy

transport는 의도적으로 프레임 라우팅에 집중합니다.

큐 선언 정책은 caller-owned RabbitMQ setup에 속합니다.

즉 dead-letter exchange, TTL, 최대 재전달 횟수, redrive tooling은 애플리케이션의 `amqplib` 채널 설정과 함께 정의해야 합니다.

FluoShop에서는 창고 이벤트가 바로 그런 정책을 두기 좋은 지점입니다.

`pickwave.created`가 반복해서 실패한다면 운영자는 원래 order context를 보존한 채 poison message를 격리할 수 있어야 합니다. 이는 "독약 알약(poison pill)" 안전망입니다. 소비자를 중단시키거나 메시지를 유실하는 대신, N번 실패 후 RabbitMQ가 메시지를 **Dead Letter Exchange (DLX)**로 옮기면 운영자가 이를 나중에 수동으로 확인하고 수정할 수 있습니다.

이런 복구 메커니즘이 명시적일수록 RabbitMQ의 장점이 살아납니다.

## 4.6 Delivery safety and operations

저장소 테스트는 운영 가이드로 옮겨 와야 할 몇 가지 동작을 문서화합니다.

- `send()`는 반드시 `listen()` 이후에 호출해야 합니다 (응답 큐가 생성되었음을 보장하기 위해).
- timeout은 호출자를 상세한 에러 문자열과 함께 명확하게 reject 합니다.
- 동시 요청도 `requestId` UUID로 안전하게 상관관계가 유지됩니다.
- 인스턴스 범위 response queue는 reply theft를 막아 줍니다.

덕분에 FluoShop에서 안정적인 mental model을 가질 수 있습니다.

RabbitMQ는 마법 같은 durability가 아닙니다.

토폴로지, 재시도, 큐 소유권이 책임 있게 정의될 때만 충분히 안전한 durability가 됩니다. fluo는 트랜스포트 프레임에 **JSON 직렬화**를 사용하므로 호환성도 뛰어납니다. 레거시 자바 서비스라도 `RabbitMqTransportMessage` 스키마만 따른다면 FluoShop의 RabbitMQ 큐로 메시지를 보낼 수 있습니다.

### 4.6.1 Operational signals to watch

fulfillment 큐에 대해서 팀은 다음 지표를 봐야 합니다.

- **Ready message count**: 처리를 기다리는 백로그 작업 수.
- **Unacked 또는 in-flight work**: 현재 워커에서 처리 중인 메시지 수.
- **배포 이후 redelivery 증가 여부**: 워커 충돌이나 타임아웃으로 인해 큐로 되돌아간 메시지 수.
- **인스턴스별 response queue churn**: 고유한 응답 큐가 생성/삭제되는 빈도.
- **dead-letter queue 증가**: 실패한 비즈니스 프로세스 수.

이 지표들은 서로 다른 이야기를 들려줍니다.

ready count가 오르면 worker 부족일 가능성이 큽니다.

redelivery count가 오르면 핸들러 안정성이 떨어지고 있을 수 있습니다.

response queue churn이 지나치게 빠르면 인스턴스 재시작 빈도가 너무 높다는 신호일 수 있습니다.

### 4.6.2 FluoShop rollout plan

v1.3.0에서는 fulfillment handoff만 RabbitMQ로 이동합니다.

FluoShop의 나머지 부분은 의도적으로 혼합 상태로 둡니다.

- API read는 최저 지연 시간을 위해 TCP에 남을 수 있습니다.
- payment durability는 추가 전용 로그 안전성을 위해 Redis Streams에 남을 수 있습니다.
- warehouse work만 태스크 기반 소유권을 위해 RabbitMQ queue로 이동합니다.

이런 하이브리드 상태는 건강합니다.

아키텍처는 보통 한 경계씩 진화합니다.

실무적인 교훈은 queue-owned operational model의 이점을 가장 크게 보는 링크부터 옮기라는 것입니다.

대칭성을 위해 모든 트랜스포트를 한꺼번에 옮길 필요는 없습니다. 대칭성은 개발자의 선호일 뿐이며, 안정성이 비즈니스의 요구사항입니다.

## 4.7 Summary

- RabbitMQ는 직접 요청 경로보다 queue-oriented ownership에 더 잘 맞습니다.
- fluo는 caller-owned publisher와 consumer collaborator를 통해 RabbitMQ bootstrap을 명시적으로 유지합니다.
- request-reply 흐름도 `requestId`와 `replyTo` 상관관계를 통해 계속 사용할 수 있습니다.
- 인스턴스 범위 response queue는 동시 실행 중인 서비스 인스턴스를 위한 안전한 기본값입니다.
- 이제 FluoShop은 결제 이후 fulfillment 작업을 RabbitMQ로 라우팅하며, 창고 운영에 더 명확한 큐 모델을 제공합니다.

이 시점에서 FluoShop은 세 가지 서로 다른 통신 스타일을 갖습니다. TCP는 단순한 직접 조회를 맡고, Redis Streams는 돈이 걸린 durability를 보호하며, RabbitMQ는 stream replay보다 work assignment가 중요한 창고 큐를 소유합니다.

이런 transport diversity는 혼란이 아니라 강점입니다. 이는 하나의 프레임워크가 서로 다른 운영상의 요구사항을 일관된 프로그래밍 인터페이스 아래 통합할 수 있음을 증명합니다.
