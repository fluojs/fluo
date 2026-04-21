<!-- packages: @fluojs/microservices, @fluojs/redis -->
<!-- project-state: FluoShop v1.2.0 -->

# 3. Redis Transport

Redis는 다양한 통신 패턴을 지원하는 다재다능한 브로커입니다.

fluo에서 Redis 트랜스포트는 두 가지 뚜렷한 모드를 제공합니다. 가볍고 비지속적인 이벤트 브로드캐스트를 위한 **Pub/Sub**, 그리고 지속성 있는 at-least-once 메시지 및 이벤트 전달을 위한 **Streams**입니다.

이 장에서는 Redis가 **FluoShop**에서 처음으로 실제 브로커 역할을 맡게 되는 방식과, 그 선택이 아키텍처를 어떻게 바꾸는지 설명합니다.

TCP가 직접적인 요청 경로를 제공했다면, Redis는 중간 계층을 추가합니다. 그 중간 계층에는 분명한 비용이 있어 움직이는 부품이 늘어나고 운영 표면적도 넓어집니다. 하지만 동시에 디커플링, 재생 가능한 워크플로, 그리고 서비스 인스턴스 하나가 잘못된 순간에 내려가도 작업이 사라지지 않는 더 나은 복원력을 제공합니다.

## 3.1 Redis Pub/Sub for Events

Redis Pub/Sub은 고성능 fire-and-forget 메커니즘입니다. 모든 구독자가 메시지를 반드시 받아야 하는 상황보다, 알림 속도가 더 중요한 경우에 적합합니다. 다르게 말하면 Pub/Sub은 이벤트가 중요하지만 치명적이지는 않은 경우에 잘 맞습니다. 예를 들어 Order Service가 실시간 재고 현황판 UI를 위해 `inventory.updated` 신호를 보낸다면, 업데이트 하나를 놓쳐도 괜찮습니다. 곧 다음 업데이트가 도착해 정확한 상태를 제공할 것이기 때문입니다. 구독자가 잠시 오프라인이라면 몇몇 브로드캐스트를 놓쳐도 시스템이 이를 허용하며, 그런 트레이드오프는 실시간 대시보드, 일시적인 분석 신호, 캐시 워밍 이벤트에는 충분히 합리적일 수 있습니다. 반대로 청구, 정산, 주문 상태 전환에는 훨씬 덜 적합합니다.

### 3.1.1 Configuring Pub/Sub

Redis Pub/Sub을 사용하려면 `RedisPubSubMicroserviceTransport`에 발행자 클라이언트와 구독자 클라이언트를 제공합니다.

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, RedisPubSubMicroserviceTransport } from '@fluojs/microservices';
import Redis from 'ioredis';

const redisClient = new Redis({ host: 'localhost', port: 6379 });

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: new RedisPubSubMicroserviceTransport({
        publishClient: redisClient,
        subscribeClient: redisClient.duplicate(),
      }),
    }),
  ],
})
export class NotificationModule {}
```

Redis은 구독 모드에 전용 연결이 필요합니다. 그래서 구독자는 발행 클라이언트를 그대로 공유하기보다 보통 `duplicate()`로 분리합니다. Redis Pub/Sub은 확인 응답이나 응답 메시지를 지원하지 않기 때문에, 이 트랜스포트는 사실상 `emit()` 중심 워크플로에 적합합니다. 이 제약은 성가신 것이 아니라 오히려 도움이 되며, 의미론적 경계를 분명하게 보여 줍니다. 내구성 있는 요청-응답 계약이 필요하다면 Pub/Sub이 그 역할을 대신할 수 있다고 가장하면 안 됩니다.

## 3.2 Redis Streams for Durable Delivery

주문 처리나 결제 조율 같은 중요한 작업에는 지속성이 필수적입니다.

`RedisStreamsMicroserviceTransport`는 Redis Streams와 컨슈머 그룹을 사용하여 at-least-once 전달을 제공합니다. **FluoShop**에서 이는 Order→Payment 핸드오프를 위한 최적의 선택입니다. 주문이 발생했을 때, 우리는 단순히 빠른 응답을 원하는 것이 아니라 Payment Service가 현재 재시작 중이더라도 결국 해당 주문을 확인할 수 있다는 보장을 원합니다.

따라서 Streams는 즉각적인 응답 시간보다 결국 작업이 완료되는 것이 더 중요한 경우에 더 잘 맞습니다.

FluoShop은 돈이 개입되는 순간 바로 그 지점에 도달합니다.

주문 의도가 조용히 사라지는 상황은 받아들일 수 없습니다.

반면 결제 이벤트가 회수되고 재시도될 수 있다면 훨씬 안전합니다.

### 3.2.1 Consumer Groups and Acknowledgments

Pub/Sub과 달리 Redis Streams는 메시지를 저장합니다. 컨슈머 그룹은 각 메시지가 그룹의 적어도 한 멤버에 의해 처리되도록 보장합니다. 어떤 컨슈머가 메시지를 받은 뒤 확인 응답을 보내기 전에 실패하면, 해당 메시지는 Pending Entries List(PEL)에 남아 다른 컨슈머가 회수할 수 있습니다.

```typescript
import { RedisStreamsMicroserviceTransport } from '@fluojs/microservices';

const transport = new RedisStreamsMicroserviceTransport({
  readerClient: redisClient,
  writerClient: redisClient,
  consumerGroup: 'payment-service-group',
});
```

fluo는 핸들러가 성공적으로 완료된 이후에만 스트림 엔트리를 확인 응답합니다. 이 타이밍은 이 트랜스포트에서 가장 중요한 안전 속성 중 하나입니다. 내부적으로 fluo는 `await handler()` 프라미스가 해결된(resolve) 뒤에만 `xack`를 호출합니다. 만약 핸들러가 에러를 던지면 `xack` 호출은 발생하지 않으며, 메시지는 PEL에 남게 됩니다. 확인을 너무 일찍 하면 중복 작업은 줄어들 수 있지만 조용한 유실 위험이 커집니다. 늦은 확인은 재전달 가능성을 받아들이는 대신 복구 가능성을 확보하며, 만약 결제 서비스가 트랜잭션 도중 중단되면 `payment-service-group`의 다른 인스턴스가 보류 중인(pending) 메시지를 이어받아 처리할 수 있습니다. 비즈니스적으로 중요한 워크플로에는 보통 이것이 맞는 선택입니다.

## 3.3 Request-Response over Streams

fluo의 더 고급스러운 기능 중 하나는 Redis Streams 위에서도 요청-응답 패턴을 지원한다는 점입니다.

덕분에 내구성 있는 전달 특성을 유지하면서 `send()`를 사용할 수 있습니다.

이렇게 구성된 시스템은 로우 TCP보다 느리고 운영 복잡도도 더 높습니다. TCP에서는 소켓 자체가 반환 경로가 되지만, Streams에서는 응답을 다시 돌려보내기 위해 별도의 "응답 스트림"을 생성해야 하기 때문입니다. 하지만 TCP가 잘 버티지 못하는 상황도 견딜 수 있습니다. 컨슈머가 지연되어도 요청은 나중에 처리될 수 있고, 인스턴스가 처리 도중 중단되어도 메시지는 pending 상태로 남아 회수될 수 있습니다. 이는 외부 API(예: Stripe, PayPal) 호출과 같은 오래 걸리는 결제 검증 작업이 서비스 재시작 중에도 살아남을 수 있으며, Gateway가 요청의 흐름을 놓치지 않음을 의미합니다. 그래서 stream 기반 요청-응답은 즉시성보다 완료 보장이 중요한 작업에 의미가 있습니다.

### 3.3.1 Per-Consumer Response Streams

응답 충돌을 피하기 위해 fluo는 각 컨슈머 인스턴스마다 임시 응답 스트림을 생성합니다.

이렇게 하면 모든 요청자가 상관관계가 보장된 전용 반환 경로를 가질 수 있으며, 스트림 이름은 `${namespace}:responses:${consumerId}` 패턴을 따릅니다. 이 격리가 없다면 여러 서비스 인스턴스가 서로의 응답을 방해할 수 있습니다. 즉, 인스턴스별 응답 스트림은 익숙한 `send()` 프로그래밍 모델을 유지하면서도 Redis Streams의 분산 특성을 존중하게 해줍니다. 핸들러 코드만 읽으면 이런 세부 사항은 쉽게 놓치기 쉽지만, 바로 이런 트랜스포트 수준의 관심사가 fluo가 캡슐화하려는 영역입니다. 애플리케이션 코드는 응답을 요청하고 트랜스포트는 그것을 안전하게 되돌리는 방법을 결정합니다. 기본적으로 fluo는 `close()` 시점에 `del`을 사용하여 이러한 응답 스트림을 정리하므로, Redis에 수천 개의 임시 키가 쌓이는 것을 방지합니다.

## 3.4 Deep Dive into Delivery Safety

fluo의 Redis 트랜스포트 구현은 몇 가지 핵심 원칙을 통해 안전을 우선시합니다.

- **Late Acknowledgment**: 핸들러 측 처리가 끝난 뒤에만 스트림 엔트리를 확인 응답합니다. 실행 중 서비스가 중단되면 메시지는 복구를 위해 pending 상태로 남습니다.
- **Conservative Trimming**: 기본적으로 fluo는 `messageRetentionMaxLen`과 `eventRetentionMaxLen`을 비활성화합니다. Redis는 스트림을 최대 길이로 트리밍하는 기능(예: `MAXLEN ~ 1000`)을 지원하지만, 발행 시점에 이를 적용하면 아직 처리되지 않은 보류 중인 메시지가 삭제될 수 있습니다. fluo는 수동 또는 정책 기반 정리가 발생하기 전까지 스트림이 커지도록 두어 데이터가 조기에 유실되지 않도록 합니다.
- **Bounded Response Retention**: 요청과 달리 응답 스트림은 `1,000`의 기본 `responseRetentionMaxLen`을 가집니다. 응답은 보통 기다리고 있는 `send()` 호출자에 의해 즉시 소비되므로, 메모리 압박을 막기 위해 보존량을 제한하는 것이 안전합니다.
- **Automatic Cleanup**: 요청-응답 흐름에 사용된 임시 응답 스트림은 `close()` 과정에서 제거되어 Redis 네임스페이스를 계속 오염시키지 않습니다.

이 선택들은 프레임워크가 분산 장애를 어떻게 바라보는지 보여 줍니다. 조용한 메시지 소실보다 중복 처리 위험을 선호하며, 그 선호는 애플리케이션이 멱등성을 염두에 두고 설계되어 있다면 대체로 올바른 선택입니다. FluoShop에서는 결제 처리가 하나의 메시지를 두 번 볼 수 있다고 가정해야 합니다. 즉 주문 ID, 결제 의도, 정산 로직 모두 재생을 흡수할 수 있을 만큼 안정적이어야 합니다. 만약 결제 서비스가 동일한 `order.placed` 이벤트를 두 번 받는다면, 다시 결제를 시도하기 전에 해당 주문 ID에 대한 트랜잭션이 이미 존재하는지 확인해야 합니다. 트랜스포트가 도와주지만, 최종 책임은 여전히 도메인에 남습니다.

## 3.5 Operational Considerations

Redis를 마이크로서비스 트랜스포트로 운영하는 일은 단지 코딩 문제만은 아닙니다. 운영상의 약속이기도 합니다. 팀은 스트림 길이, 컨슈머 지연, pending entry 수, reclaim 동작을 관찰해야 하며, Redis에서는 `XPENDING` 명령을 사용하여 전달되었으나 아직 확인 응답되지 않은 메시지를 확인할 수 있습니다. 이 지표들이 잘못된 방향으로 움직이면 트랜스포트는 기술적으로 살아 있어 보여도 비즈니스 지연은 조용히 악화될 수 있습니다. 유용한 운영 질문은 다음과 같습니다.

- 스트림 키가 끝없이 커지고 있지는 않은가? (`XLEN` 확인).
- 특정 컨슈머 그룹의 PEL이 비정상적으로 쌓이고 있지는 않은가? (`XPENDING` 확인).
- 배포 이후 reclaim 시도가 늘고 있지는 않은가?
- 종료 시 임시 응답 스트림이 실제로 정리되고 있는가?

fluo는 모니터링에 필요한 훅을 제공할 수 있지만, 경고 체계와 런북은 팀이 직접 준비해야 합니다.

Redis는 많은 브로커보다 가볍습니다.

그렇다고 유지보수가 필요 없다는 뜻은 아닙니다.

## 3.6 Choosing between Pub/Sub and Streams

Pub/Sub과 Streams 중 무엇을 쓸지는 더 화려해 보이는 기능을 고르는 문제가 아닙니다.

이벤트가 구독자 부재와 프로세스 실패를 견뎌야 하는지 여부를 묻는 문제입니다.

| Feature | Redis Pub/Sub | Redis Streams |
|---------|---------------|---------------|
| Durability | No | Yes |
| Delivery Guarantee | At most once | At least once |
| Patterns | Events only | Messages & Events |
| Complexity | Low | Medium |

간단한 규칙 하나면 충분합니다. 메시지를 놓쳐도 괜찮고 낮은 지연이 중요하다면 Pub/Sub을 사용합니다. 복구, 재생, 컨슈머 그룹 기반 분산 처리가 필요하다면 Streams를 사용합니다. FluoShop에서는 알림이나 일시적 분석 이벤트는 Pub/Sub에 어울릴 수 있지만, 주문 생성과 결제 조율은 Streams에 있어야 합니다.

## 3.7 FluoShop Implementation: Order and Payment

FluoShop에서는 Order Service와 Payment Service 사이의 중요한 연결에 Redis Streams를 사용합니다.

1. **Order Service**: 주문 요청을 검증한 뒤 Redis Streams를 통해 `order.placed` 이벤트를 발행합니다. 스트림 기반 마이크로서비스 클라이언트의 `emit()` 메서드를 사용합니다.
2. **Payment Service**: `payment-service-group`의 멤버가 이벤트를 소비하고, 결제를 시도한 뒤 결과에 따라 `payment.success` 또는 `payment.failed`를 발행합니다.

이 설계는 시스템을 중요한 방향으로 바꿉니다. Order Service는 더 이상 주문 생성 순간에 Payment Service가 동기적으로 반드시 살아 있어야 할 필요가 없습니다. 만약 Payment Service가 바쁘거나 내려가 있다면 `order.placed` 이벤트는 Redis Stream에서 대기하고, 필요한 것은 브로커 경로가 작업을 보존하는 일입니다. 즉시성은 줄지만 복원력은 커집니다. 고객 대상 흐름도 이제 어떤 작업이 이미 끝났다고 말하기보다 현재 진행 중이라고 전달할 수 있어야 하므로, Gateway는 주문 ID와 함께 `202 Accepted` 상태를 반환하고 클라이언트 UI는 최종 결제 결과를 위해 폴링하거나 WebSocket 알림을 기다리게 될 것입니다. 이 시점부터 intermediate 책의 FluoShop은 진짜 비동기 시스템처럼 움직이기 시작합니다. Notification Service는 나중에 결제 결과에 반응하면서도 핵심 주문 경로에 직접 들어오지 않아도 되며, 그 느슨한 결합이 Redis가 가져오는 아키텍처적 이점입니다.

## 3.8 Summary

- **Pub/Sub**: fire-and-forget이 허용되는, 중요하지 않은 고처리량 이벤트 브로드캐스트에 적합합니다.
- **Streams**: at-least-once 전달과 컨슈머 그룹 확장이 필요한 내구성 있고 신뢰성 있는 통신에 필수적입니다.
- **Consumer Groups**: 여러 서비스 인스턴스가 작업을 나누고 Pending Entries List(PEL)를 통해 실패를 복구할 수 있게 해줍니다.
- **Durability**: 유실이 허용되지 않는 주문과 결제 같은 중요한 서비스 간 흐름에는 Redis Streams를 사용합니다.
- **Decoupling**: TCP와 달리 Redis는 직접 네트워크 연결 없이도 서비스 간 상호작용을 가능하게 하며, 급증하는 트래픽과 다운타임에 대한 버퍼를 제공합니다.
- **Progression**: FluoShop에서 Redis Streams는 동기적인 요청-응답 카탈로그 조회에서 비동기적이고 신뢰할 수 있는 주문-결제 워크플로로의 전환을 가능하게 합니다.

더 깊은 교훈은 아키텍처에 있습니다.

Redis가 TCP를 모든 곳에서 대체하는 것은 아닙니다.

비즈니스가 지연된 완료, 재생, 느슨한 결합으로 이득을 보는 연결만 Redis가 맡는 것입니다.

분산 시스템은 각 연결이 자신의 실패 예산에 맞는 트랜스포트를 사용할 때 더 좋아집니다.

## 3.9 Next Part Preview

다음 파트에서는 RabbitMQ와 Kafka 같은 브로커를 살펴보며 더 무거운 메시징 요구 사항을 다룹니다.

그 트랜스포트들은 여기서 소개한 개념 위에 쌓입니다.

그 시점이 되면 FluoShop에는 이미 동기 요청 경로 하나와 durable event 경로 하나가 존재하게 됩니다.

그 대비가 있어야 더 무거운 브로커가 언제 정당화되고 언제 불필요한 복잡성인지 판단하기 쉬워집니다.
