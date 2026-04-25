<!-- packages: @fluojs/microservices, nats -->
<!-- project-state: FluoShop v1.5.0 -->

# Chapter 6. NATS

이 장에서는 FluoShop의 빠른 내부 조율 경로에 NATS를 도입하고, durable 로그나 작업 큐와 다른 control-plane 메시징의 역할을 정리합니다. Chapter 5가 replay 가능한 shared history를 다뤘다면, 여기서는 낮은 지연과 subject 기반 라우팅이 중요한 inventory 및 cache coordination으로 초점을 옮깁니다.

## Learning Objectives
- NATS가 Kafka나 RabbitMQ와 다른 아키텍처적 위치를 차지하는 이유를 이해합니다.
- caller-owned client와 codec을 기준으로 NATS 트랜스포트를 구성하는 방법을 익힙니다.
- subject 설계와 request timeout이 빠른 내부 조율 흐름에 어떤 영향을 주는지 설명합니다.
- inventory preview와 cache invalidation 시나리오에 NATS를 적용하는 방법을 분석합니다.
- logger-driven failure 처리와 운영 신호를 기준으로 NATS 사용 경계를 정리합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5 완료.
- request-reply와 event fan-out 패턴에 대한 기초 이해.
- 분산 시스템에서 지연 시간과 durability 요구사항을 구분하는 기본 감각.

## 6.1 Why NATS in FluoShop

이 파트의 모든 transport 장은 같은 질문을 다룹니다. 이 transport가 아키텍처에서 어떤 의도를 더 명확히 표현하게 하는가? NATS의 답은 빠른 control-plane communication입니다. FluoShop은 이를 두 가지 능력에 사용합니다.

1. **빠른 요청-응답(request-reply) 체크**: 고객이 구매를 확정하기 전, Order와 Inventory 서비스 사이의 빠른 조율.
2. **가벼운 이벤트 팬아웃(fan-out)**: 전체 서버 플릿에 걸친 캐시 및 정책 갱신 신호의 즉각적인 전달.

이 상호작용들은 중요하지만 durable business history도 아니고 warehouse work queue도 아닙니다. 짧게 끝나는 내부 coordination step입니다. **Subject 기반 라우팅**(예: `fluoshop.inventory.*`)을 사용하면 서비스는 구체적인 데이터 하위 스트림을 구독하고, 로컬 상태 조율에 필요한 신호만 받을 수 있습니다.

## 6.2 Caller-owned client and codec setup

패키지 README는 중요한 경계를 짚습니다. NATS는 caller-owned입니다. `@fluojs/microservices`는 애플리케이션이 NATS client와 codec을 모두 제공하길 기대하며, README에서 언급한 generated starter도 `nats`와 `JSONCodec()`을 사용합니다.

이 세부 사항은 fluo가 실제 NATS 계약을 숨기지 않는다는 점을 보여 줍니다. NATS는 페이로드에 `Uint8Array`를 사용하므로, `codec` 브릿지는 프레임워크의 JSON 기반 프레임이 네트워크 전송 과정에서 올바르게 직렬화되고 역직렬화되도록 맞춥니다.

### 6.2.1 Subject design

`NatsMicroserviceTransport`는 다음 핵심 옵션을 노출합니다.

- `client`
- `codec`
- `eventSubject`
- `messageSubject`
- `requestTimeoutMs`

기본값은 `fluo.microservices.events`와 `fluo.microservices.messages`를 사용합니다. FluoShop에서는 도메인 의도를 드러내는 subject 이름을 사용합니다.

- `fluoshop.inventory.events`
- `fluoshop.inventory.messages`

transport는 여전히 JSON 프레임 패킷을 운반합니다. subject 이름은 브로커를 살펴볼 때 의도를 읽기 쉽게 만듭니다. `fluoshop.inventory.messages`와 같은 subject를 사용하면 운영자는 NATS의 와일드카드 구독(예: `fluoshop.inventory.>`)으로 단일 터미널 세션에서 모든 재고 관련 트래픽을 모니터링할 수 있습니다.

### 6.2.2 Module wiring

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, NatsMicroserviceTransport } from '@fluojs/microservices';
import { JSONCodec, connect } from 'nats';

// NATS 연결 로직은 부트스트랩/메인 파일에 유지됩니다.
const client = await connect({ servers: process.env.NATS_URL });
const codec = JSONCodec();

const transport = new NatsMicroserviceTransport({
  client,
  codec: {
    encode(value) {
      return codec.encode(value);
    },
    decode(data) {
      return codec.decode(data) as string;
    },
  },
  eventSubject: 'fluoshop.inventory.events',
  messageSubject: 'fluoshop.inventory.messages',
  requestTimeoutMs: 1_500, // 빠른 조율을 위한 공격적인 타임아웃
});

@Module({
  imports: [MicroservicesModule.forRoot({ transport })],
  providers: [InventoryCoordinationHandler],
})
export class InventoryCoordinationModule {}
```

정확한 codec wrapper 구현은 팀마다 달라질 수 있습니다. 하지만 아키텍처상의 요점은 바뀌지 않습니다. 애플리케이션이 NATS 연결과 codec 선택을 명시적으로 소유합니다.

## 6.3 Fast request-reply for inventory control

NATS는 request-reply를 자연스럽게 지원합니다. fluo transport는 `send()`를 timeout이 있는 `client.request(...)`에 매핑합니다. 이 덕분에 경로는 직접 호출처럼 빠르게 동작하면서도 마이크로서비스 추상화는 유지됩니다. NATS가 **Inbox** 생성과 reply-to 상관관계(correlation)를 처리하므로, 개발자는 Kafka 장에서 보았던 고유 응답 토픽을 직접 관리할 필요가 없습니다.

### 6.3.1 Inventory reservation lookups

FluoShop에서 Order Service는 checkout 확정 전에 빠른 답이 필요할 때가 있습니다. 예를 들어 flash-sale SKU가 특정 zone에 reserve stock을 아직 보유하고 있는지 Inventory Service에 물을 수 있습니다. 이것은 최종 durable reservation이 아니라 빠른 coordination check이며, 이런 경우 NATS가 잘 맞습니다.

```typescript
@MessagePattern('inventory.reserve-preview')
async previewReservation(input: { sku: string; zoneId: string; quantity: number }) {
  // 신속한 선행 확인(look-ahead check)
  return await this.inventoryPolicy.preview(input);
}
```

Order Service는 짧은 지연 안에서 답을 얻습니다. 나중에 durable business record가 필요하면 다른 transport가 그 단계를 맡을 수 있습니다. NATS가 모든 책임을 떠안을 필요는 없습니다.

### 6.3.2 Timeout budgets

transport는 기본적으로 3초 request timeout을 사용하며 이 값은 재정의할 수 있습니다. FluoShop에서는 control-plane check에 대해 더 짧은 예산을 둡니다. inventory preview가 빨리 오지 않는다면 게이트웨이는 고객 여정을 오래 멈추기보다 우아하게 degrade 해야 합니다. advisory lookup에서는 빠른 실패가 길고 불확실한 대기보다 운영적으로 낫습니다. v1.5.0에서는 부하가 높은 상황에서도 사용자 경험이 민첩하게 유지되도록 `requestTimeoutMs`를 1,500ms로 설정합니다.

## 6.4 Event fan-out and logger-driven failures

NATS는 가벼운 event delivery를 위한 `emit()`도 지원합니다. 이 경로는 cache invalidation이나 policy refresh notice에 잘 맞습니다. 예를 들어 Catalog가 restricted-item rule을 업데이트하면 여러 서비스가 로컬 read model을 갱신해야 할 수 있고, 그 신호는 빨라야 합니다. 모든 환경에서 Kafka 수준의 historical replay가 필요한 것은 아닙니다.

### 6.4.1 Cache invalidation in FluoShop

대표적인 예는 inventory read cache 무효화입니다.

```typescript
@EventPattern('inventory.cache.invalidate')
async invalidateCache(event: { sku: string }) {
  // 모든 서비스 인스턴스에서 즉시 오래된 데이터를 삭제합니다.
  await this.inventoryCache.evict(event.sku);
}
```

핸들러는 여전히 단순합니다. subject routing과 NATS publish 메커니즘은 transport 안에 남아 있습니다. 이 일관성 덕분에 팀은 transport가 달라질 때마다 새로운 핸들러 모델을 다시 배울 필요가 없습니다.

### 6.4.2 No console fallback for event failures

저장소 테스트는 미묘하지만 중요한 동작을 검증합니다. event handler failure는 logger-driven이며, transport logger를 설정하면 그 경로로 오류가 기록됩니다. 설정하지 않으면 fluo는 raw `console.error` fallback으로 이를 복제하지 않습니다. 이 동작은 production hygiene에 중요합니다. 중복 잡음을 피하고 observability policy를 명시적으로 유지하게 해줍니다.

FluoShop에서는 NATS event path가 운영상 중요하다면 플랫폼 팀이 structured logger를 반드시 연결해야 합니다. 트랜스포트는 `logTransportEventHandlerFailure` 유틸리티를 사용해 캐시 무효화 실패가 서비스 텔레메트리에 기록되도록 합니다.

## 6.5 Operations and trade-offs

NATS가 단순해 보이는 이유는 많은 팀이 원하는 방식으로 실제로 단순하기 때문입니다. 그 단순함은 장점이지만, 더 풍부한 durability나 replay 의미론이 필요한 역할에 억지로 밀어 넣지 말라는 경고이기도 합니다. FluoShop은 NATS를 canonical timeline이나 main queueing system으로 쓰지 않고 빠른 coordination에 사용합니다.

운영 측면에서 팀은 다음을 관찰해야 합니다.

- **타임아웃 비율(Timeout rates)**: 높은 타임아웃 비율은 대상 서비스가 과부하 상태임을 시사합니다.
- **버스트 볼륨(Burst volume)**: 갑작스러운 팬아웃 볼륨 증가는 내부 네트워크 지연 시간에 영향을 줄 수 있습니다.
- **연결 변동(Connection churn)**: 빈번한 재연결은 불안정한 NATS 서버 구성이나 네트워크 문제를 나타낼 수 있습니다.
- **핸들러 오류 로그(Handler error logs)**: 실패한 정책 업데이트나 캐시 삭제를 모니터링합니다.

이 신호들이 안정적이면 NATS는 명확한 내부 coordination layer로 남습니다. 비즈니스가 replay나 장기 retention을 요구하기 시작하면 다른 transport가 그 책임을 맡아야 합니다.

## 6.6 FluoShop v1.5.0 progression

이 장이 끝나면 FluoShop은 빠른 control plane을 갖게 됩니다. 아키텍처의 역할 분담도 선명해집니다.

- Kafka는 durable shared history용입니다.
- RabbitMQ는 queue-owned warehouse work용입니다.
- Redis Streams는 여전히 일부 durable workflow를 담당합니다.
- NATS는 low-latency internal coordination용입니다.

이것은 과도한 엔지니어링이 아니라 명시적인 역할 배정입니다. 각 transport가 하나의 주된 책임을 맡을 때 시스템은 더 읽기 쉬워집니다.

## 6.7 Summary

- NATS는 low-latency control-plane messaging과 가벼운 event fan-out에 잘 맞습니다.
- fluo는 caller-owned NATS client와 codec을 기대하며, 인프라 배선을 명시적으로 유지합니다.
- `send()`는 빠른 coordination check를 위한 NATS request-reply에 자연스럽게 매핑됩니다.
- event-handler failure는 logger-driven으로 처리되며, logger가 없을 때 raw `console.error` fallback을 사용하지 않습니다.
- 이제 FluoShop은 replay보다 속도가 더 중요한 inventory 및 cache coordination 경로에 NATS를 사용합니다.

NATS는 모든 transport 경쟁에서 이기려는 도구가 아닙니다. 빠르고 이해하기 쉬운 coordination이라는 한 가지 역할에서 강합니다. 그것이 FluoShop에 NATS가 필요한 이유입니다. 내부 신호를 위한 고속 차선을 추가하면서 통신 선택지의 빈칸을 채웁니다.
