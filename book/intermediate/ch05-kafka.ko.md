<!-- packages: @fluojs/microservices, kafkajs -->
<!-- project-state: FluoShop v1.4.0 -->

# Chapter 5. Kafka

이 장에서는 FluoShop에 durable shared history를 추가하기 위해 Kafka를 도입하고, 작업 큐와 이벤트 로그가 어떤 지점에서 다른 선택지가 되는지 정리합니다. Chapter 4가 fulfillment 작업 소유권을 다뤘다면, 여기서는 replay와 다중 consumer group이 필요한 order timeline 설계로 초점을 옮깁니다.

## Learning Objectives
- Kafka가 RabbitMQ와 다른 아키텍처적 선택인 이유를 이해합니다.
- producer와 consumer collaborator를 명시적으로 연결해 Kafka 트랜스포트를 구성하는 방법을 익힙니다.
- topic 기반 요청 응답과 이벤트 로그 흐름을 구분해 설계합니다.
- partition key, ordering, replay가 Kafka 운영에 미치는 영향을 분석합니다.
- FluoShop order timeline에 Kafka를 적용할 때 analytics와 support 흐름이 어떻게 달라지는지 설명합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4 완료.
- 이벤트 로그, consumer group, replay 개념에 대한 기초 이해.
- 분산 시스템에서 ordering과 비동기 projection이 왜 중요한지에 대한 기본 감각.

## 5.1 Why Kafka after RabbitMQ

RabbitMQ가 창고 작업 할당에 맞는 도구라면, Kafka는 비즈니스 히스토리를 오래 보존하는 쪽에 가깝습니다. 상품 기획자가 플래시 세일 동안 checkout이 얼마나 지연되었는지 묻는 순간, 주문 생명주기 이벤트가 로그로 남아 있는지는 운영 품질의 문제가 됩니다.

구체적인 요구사항은 이렇습니다:
1. 지원 팀은 버그 수정 후 고객 타임라인을 다시 구성하기 위해 재생(replay) 기능이 필요합니다.
2. 분석 팀은 동일한 데이터를 바탕으로 여러 하위 프로젝션(projection)을 만들어야 하므로 소비자 그룹(consumer group)이 필요합니다.

FluoShop이 Kafka를 선택하는 이유가 여기에 있습니다.

v1.4.0에서는 durable `order-timeline` stream을 추가합니다.

Order Service, Payment Service, Fulfillment Service가 모두 이 stream에 milestone을 발행합니다.

그 뒤 별도의 consumer가 analytics와 operations용 projection을 만듭니다. 이 로그가 주문 실체에 대한 **단일 진실 공급원(Single Source of Truth)** 역할을 합니다. 개별 서비스가 각자의 DB를 가지고 있더라도, Kafka 로그는 서비스 경계를 넘어 실제로 어떤 일이 일어났는지 맞춰 보는 공식 감사 추적(audit trail)입니다.

## 5.2 Bootstrapping Kafka with explicit producer and consumer wiring

패키지 README는 Kafka 경계를 명확히 둡니다. `@fluojs/microservices`는 숨겨진 Kafka client를 대신 띄우지 않습니다. 애플리케이션이 caller-owned producer와 consumer collaborator를 `KafkaMicroserviceTransport`에 전달하며, 그 결과 브로커 소유권이 코드에서 드러납니다.

group ID, retry 설정, connection bootstrap, partition strategy도 애플리케이션의 결정으로 남습니다. Kafka는 설정 하나가 처리 의미를 바꿀 수 있는 시스템입니다. `groupId` 하나로 두 서비스 인스턴스가 작업을 나눌지, 같은 이벤트를 각각 받을지가 결정되며, fluo는 이런 결정을 프레임워크 내부로 숨기지 않습니다.

### 5.2.1 Topic topology

이 transport는 세 가지 topic 수준 옵션을 지원합니다.

- `eventTopic`
- `messageTopic`
- `responseTopic`

기본값은 범용성을 우선합니다.

FluoShop에서는 도메인과 운영 의도를 드러내는 이름이 더 낫습니다.

- `fluoshop.timeline.events`
- `fluoshop.domain.messages`
- `fluoshop.responses.<instance>`

응답 topic은 보통 클라이언트 인스턴스별로 분리합니다.

그래야 fluo가 동시 request-reply 흐름에서 응답 충돌을 피할 수 있습니다. 기본적으로 트랜스포트는 UUID 접미사가 붙은 `responseTopic`(예: `fluo.microservices.responses.uuid`)을 생성해 각 인스턴스에 응답 전용 수신 지점을 부여합니다.

### 5.2.2 Module wiring

transport bootstrap은 다음과 같습니다.

```typescript
import { Module } from '@fluojs/core';
import { KafkaMicroserviceTransport, MicroservicesModule } from '@fluojs/microservices';

const transport = new KafkaMicroserviceTransport({
  consumer: kafkaConsumer, // 부트스트랩의 kafkajs에서 제공
  producer: kafkaProducer, // 부트스트랩의 kafkajs에서 제공
  eventTopic: 'fluoshop.timeline.events',
  messageTopic: 'fluoshop.domain.messages',
  requestTimeoutMs: 5_000,
});

@Module({
  imports: [MicroservicesModule.forRoot({ transport })],
  providers: [TimelineHandler],
})
export class TimelineModule {}
```

이전 장들과 마찬가지로 모듈은 작게 유지됩니다.

프레임워크가 핸들러 구조를 다시 설계하라고 요구하지 않습니다.

대신 트랜스포트 계약을 명시적으로 드러내라고 요구합니다.

## 5.3 Request-reply on durable topics

Kafka는 이벤트 스트림으로 가장 널리 쓰입니다.

그럼에도 fluo는 durable broker routing이 필요한 경우를 위해 Kafka 위에서도 `send()`를 제공합니다.

이 방식은 TCP보다 느리고 비용도 큽니다.

그래도 broker-mediated decoupling이 필요하고 추가 지연을 받아들일 수 있다면 타당한 선택이 됩니다. FluoShop에서는 "주문 감사(Order Audit)" 요청에 이 경로를 사용합니다. 특정 답변이 필요하지만, 대상 서비스가 잠시 재시작 중이어도 요청 자체는 내구성 있게 남아 나중에 처리되어야 하기 때문입니다.

### 5.3.1 Per-client response topics

저장소의 transport 코드는 `responseTopic`을 지정하지 않으면 UUID 기반 기본값을 사용합니다.

이것은 단순한 구현 세부 사항이 아닙니다. 여러 인스턴스가 서로의 응답을 소비하지 않도록 막는 안전 장치입니다. 테스트도 동시 request flow가 섞이지 않는지 명시적으로 검증합니다. FluoShop에서는 Backoffice Service가 replay snapshot을 요청하더라도 Support Service의 응답을 가로채지 않습니다. 각 인스턴스가 자기 전용 response topic에서 기다리기 때문에 상관관계도 추적하기 쉽습니다.

### 5.3.2 Abort and timeout budgets

Kafka request-reply는 여러 방식으로 reject 될 수 있습니다.

- **타임아웃(Timeout)**: 호출자가 응답을 받기 위해 너무 오래(`requestTimeoutMs`) 기다렸습니다.
- **발행 전 중단(Abort before publish)**: 요청이 Kafka에 도달하기도 전에 취소되었습니다.
- **발행 후 중단(Abort after publish)**: 요청은 전송되었으나, 응답이 오기 전에 호출자가 기다리기를 멈췄습니다.
- **핸들러 오류(Handler error)**: 원격 서비스가 처리 중에 예외를 던졌습니다.

이 구분은 transport 테스트에도 나타나며 아키텍처 판단에도 반영되어야 합니다. Support 도구가 상담원이 화면을 떠났다는 이유로 replay 요청을 취소했다면 Timeline Service 실패와 다릅니다. 핸들러가 잘못된 날짜 범위를 거절했다면 도메인 오류입니다. topic 경로가 timeout이라면 의존성 오류입니다.

운영 가능한 시스템은 이런 결과를 분리해서 다룹니다. FluoShop은 메시지 프레임의 `requestId`를 사용해 들어오는 Kafka 응답을 해당 요청을 만든 로컬 `Promise`에 매핑합니다.

## 5.4 Event streams and consumer groups

Kafka의 가치는 여러 consumer가 같은 durable topic을 각자의 목적에 맞게 처리할 때 분명해집니다. FluoShop은 그 특성을 활용하며, 핵심 order timeline topic에는 다음 milestone이 들어갑니다.

- `order.created`
- `payment.authorized`
- `payment.settled`
- `fulfillment.wave-created`
- `shipment.dispatched`

이 이벤트들은 단순한 notification이 아니라 replay 가능한 history입니다.

### 5.4.1 Order timeline topic

하나의 핸들러는 다음처럼 단순할 수 있습니다.

```typescript
@EventPattern('order.timeline.append')
async appendTimelineEntry(event: {
  orderId: string;
  occurredAt: string;
  stage: string;
  source: string;
}) {
  // 이 마일스톤을 조회 가능한 DB에 저장하는 로직
  await this.timelineStore.append(event);
}
```

핵심은 Kafka가 특별한 핸들러 코드를 요구한다는 뜻이 아닙니다. 실제로 핸들러 모델은 그대로입니다. 중요한 점은 topic이 충분히 긴 시간 동안 history를 보존해, 다른 팀이 나중에 새로운 projection을 만들 수 있다는 데 있습니다.

이 지점이 RabbitMQ와의 전략적 차이입니다.

### 5.4.2 Analytics projection

FluoShop은 v1.4.0에서 Analytics Projection Service를 추가합니다. 이 서비스는 자체 consumer group으로 구독하고, Support Dashboard는 다른 group으로 구독할 수 있으며, Fraud review tooling은 세 번째 group으로 구독할 수 있습니다. 모두 같은 이벤트를 소비하지만 서로의 진행을 방해하지 않습니다. Kafka가 이 경계에 맞는 이유입니다.

비즈니스는 하나의 큐가 어느 부서에게 이벤트를 넘길지 결정하는 구조를 원하지 않습니다. 각 부서가 독립적으로 처리할 수 있는 shared durable history가 필요합니다. **소비자 오프셋(Consumer Offsets)**을 사용하면 각 그룹이 로그 안의 자기 위치를 기억하므로, 분석 팀이 지난달 이벤트를 재처리하는 동안 지원 팀은 오늘의 이벤트를 계속 볼 수 있습니다.

## 5.5 Partitioning, ordering, and replay

Kafka의 운영상 강점에는 설계 책임이 함께 따라옵니다.

ordering은 보통 하나의 partition 내부에서만 보장됩니다.

replay는 강력하지만 잘못 설계된 이벤트를 더 넓게 증폭시킬 수도 있습니다.

retention은 이벤트가 상태 재구성에 필요한 의미를 충분히 담고 있을 때만 가치가 있습니다.

### 5.5.1 Choosing keys in FluoShop

주문 생명주기 이벤트에는 보통 `orderId`가 적절한 partition key입니다. 그래야 하나의 주문에 대한 milestone이 같은 partition 안에서 안정적인 순서를 유지하고, consumer가 order timeline을 재구성할 때 일반적으로 추가적인 cross-partition sorting이 필요 없습니다. 이 설계가 모든 분석 질의에 맞는 것은 아니지만 가장 중요한 운영 질문에는 맞습니다. 이 주문에 무슨 일이 있었고, 어떤 순서로 일어났는가?

### 5.5.2 Replay after an incident

Support Dashboard에 버그가 있어서 두 시간 동안 `shipment.dispatched`를 조용히 무시했다고 가정해 봅시다. Kafka가 있다면 복구를 위해 모든 producer 서비스가 history를 다시 발행할 필요가 없습니다. dashboard group이 offset을 되감고 projection을 다시 만들면 됩니다. FluoShop이 Kafka에서 얻으려는 실질적 이점이 이것입니다. replay는 consumer 쪽 버그 이후의 조율 비용을 낮추고, 장애를 관리 가능한 복구 작업으로 바꿉니다.

## 5.6 Operating Kafka in a mixed-transport system

Kafka가 반드시 플랫폼 전체의 중심축이어야 하는 것은 아닙니다.

FluoShop은 의도적으로 mixed transport 구성을 유지합니다.

- RabbitMQ는 여전히 warehouse work assignment를 소유합니다.
- Redis Streams는 여전히 일부 payment durability 경로를 보호합니다.
- TCP는 여전히 단순한 direct lookup을 제공할 수 있습니다.
- Kafka는 durable shared history와 multi-team projection을 소유합니다.

이런 분업은 각 transport를 가장 적합한 역할에 배치합니다.

운영 측면에서 팀은 다음을 관찰해야 합니다.

- **그룹별 소비자 지연(Consumer lag by group)**: 서비스가 최신 이벤트에서 얼마나 뒤처져 있는지.
- **토픽 보존 및 저장소(Topic retention and storage)**: 시간이나 크기 제한으로 이벤트가 삭제되는 시점.
- **파티션 스큐(Partition skew)**: 특정 파티션이 다른 파티션보다 현저히 많은 트래픽을 받고 있는지 여부.
- **재생 기간(Replay duration)**: 로그를 처음부터 다시 읽는 데 걸리는 시간.
- **타임아웃 비율(Timeout rates)**: 실패한 요청-응답 흐름의 빈도.

이 신호들은 Kafka가 의도한 역할에 맞게 쓰이고 있는지 보여 줍니다.

request-reply timeout이 지배적이라면 logged event에 더 적합한 transport에 동기 행위를 억지로 올리고 있을 수 있습니다.

replay 비용이 너무 크다면 snapshot 없이 raw history에 과도하게 의존하는 projection 구조일 가능성이 있습니다.

## 5.7 FluoShop v1.4.0 progression

이 장이 끝나면 FluoShop은 durable historical spine을 갖게 됩니다. 플랫폼은 이제 서로 다른 성격의 질문에 답할 수 있습니다.

- 현재 고객에게 보이는 상태는 무엇인가? (TCP/Redis)
- 어떤 warehouse queue가 밀려 있는가? (RabbitMQ)
- 이 주문의 전체 생명주기에서 정확히 무슨 일이 있었는가? (Kafka)

세 번째 질문은 Kafka가 들어온 뒤 훨씬 다루기 쉬워집니다. Kafka는 direct work에 최적화된 다른 transport를 대체하지 않습니다. 대신 조직 전체가 분석하고 replay하며 audit해야 하는 timeline을 보존합니다.

## 5.8 Summary

- Kafka는 durable shared history, consumer group, replay에서 가장 큰 가치를 발휘합니다.
- fluo는 caller-owned producer와 consumer collaborator를 통해 Kafka bootstrap을 명시적으로 유지합니다.
- per-client response topic은 동시 실행 중인 서비스 인스턴스에서도 Kafka request-reply를 안전하게 만듭니다.
- partition key는 편의가 아니라 비즈니스 ordering 요구를 따라야 합니다.
- 이제 FluoShop은 analytics, support, fraud tooling이 독립적으로 소비할 수 있는 replayable order timeline을 기록합니다.

RabbitMQ가 작업 할당의 경계를 보여 주었다면,

Kafka는 비즈니스 히스토리를 보존하고 재사용하는 경계를 보여 줍니다.

그래서 두 transport는 같은 시스템 안에 함께 존재할 가치가 있습니다. FluoShop에서 v1.3.0에서 v1.4.0으로 넘어가는 변화는 속도보다 **장기적인 책임(long-term accountability)**에 가깝습니다.
