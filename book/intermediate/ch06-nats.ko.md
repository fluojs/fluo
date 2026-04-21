<!-- packages: @fluojs/microservices, nats -->
<!-- project-state: FluoShop v1.5.0 -->

# 6. NATS

NATS는 이 파트에서 fully brokered하다고 느껴지면서도 가장 가벼운 transport입니다. 기본적으로 거대한 durability 플랫폼이 되려 하지 않고, 낮은 지연, subject 기반 라우팅, 운영 단순성을 목표로 합니다. 이 때문에 FluoShop 내부의 control-plane 스타일 트래픽에 잘 맞습니다. "처리량과 로그 보존"을 위해 설계된 Kafka와 달리, NATS는 **"속도와 다이얼 톤 같은 신뢰성"**을 위해 설계되었습니다. 분주한 FluoShop 시스템에서 NATS는 빠르고 반응성이 좋으며 휘발성인 신경계 역할을 합니다. v1.5.0이 되면 회사에는 Kafka의 무거운 운영 감각이나 RabbitMQ의 queue-centric 의미론 없이도 빠른 서비스 간 조율이 필요한 흐름이 여럿 생기는데, 재고 예약 힌트, 캐시 무효화, 빠른 내부 정책 조회가 좋은 예시입니다. 이 링크에서는 historical replay보다 속도와 명확한 subject routing이 더 중요하므로 NATS가 잘 맞습니다.

## 6.1 Why NATS in FluoShop

이 파트의 모든 transport 장은 한 가지 질문에 답해야 합니다. 이 transport가 아키텍처에서 무엇을 더 명확하게 표현하게 해주는가? NATS의 답은 빠른 control-plane communication입니다. FluoShop은 이를 두 가지 능력에 사용합니다.

1. **빠른 요청-응답(request-reply) 체크**: 고객이 구매를 확정하기 전, Order와 Inventory 서비스 사이의 빠른 조율.
2. **가벼운 이벤트 팬아웃(fan-out)**: 전체 서버 플릿에 걸친 캐시 및 정책 갱신 신호의 즉각적인 전달.

이 상호작용들은 중요하지만 durable business history와는 다르고, warehouse work queue도 아닙니다. 짧게 끝나는 내부 coordination step입니다. **Subject 기반 라우팅**(예: `fluoshop.inventory.*`)을 활용하면 서비스는 매우 구체적인 데이터 하위 스트림을 구독할 수 있으며, 각 서비스가 자신의 로컬 상태를 조율하는 데 필요한 데이터만 정확히 받을 수 있습니다.

## 6.2 Caller-owned client and codec setup

패키지 README는 중요한 사실을 짚습니다. NATS는 caller-owned입니다. `@fluojs/microservices`는 애플리케이션이 NATS client와 codec을 모두 제공하길 기대하며, README에서 언급한 generated starter도 `nats`와 `JSONCodec()`을 사용합니다.

이 세부 사항은 fluo가 실제 NATS 계약을 숨기려 하지 않는다는 점을 보여 줍니다. NATS는 페이로드에 `Uint8Array`를 사용하므로, `codec` 브릿지는 프레임워크의 JSON 기반 프레임이 네트워크 전송을 위해 올바르게 직렬화 및 역직렬화되도록 보장합니다.

### 6.2.1 Subject design

`NatsMicroserviceTransport`는 다음 핵심 옵션을 노출합니다.

- `client`
- `codec`
- `eventSubject`
- `messageSubject`
- `requestTimeoutMs`

기본값은 `fluo.microservices.events`와 `fluo.microservices.messages`를 사용합니다.

FluoShop에서는 도메인 의도를 드러내는 subject 이름을 쓰는 편이 낫습니다.

- `fluoshop.inventory.events`
- `fluoshop.inventory.messages`

transport는 여전히 JSON 프레임 패킷을 운반합니다.

subject 이름은 브로커를 살펴볼 때 의도를 더 읽기 쉽게 만들 뿐입니다. `fluoshop.inventory.messages`와 같은 subject를 사용하면 운영자는 NATS의 와일드카드 구독(예: `fluoshop.inventory.>`)을 사용하여 단일 터미널 세션에서 모든 재고 관련 트래픽을 모니터링할 수 있습니다.

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

정확한 codec wrapper 구현은 달라질 수 있습니다.

하지만 아키텍처적 요점은 바뀌지 않습니다.

애플리케이션이 NATS 연결과 codec 선택을 명시적으로 소유한다는 점입니다.

## 6.3 Fast request-reply for inventory control

NATS는 request-reply를 자연스럽게 지원합니다.

fluo transport는 `send()`를 timeout이 있는 `client.request(...)`에 매핑합니다.

덕분에 경로는 직접 호출처럼 빠르게 느껴지면서도 마이크로서비스 추상화는 유지됩니다. NATS가 **Inbox** 생성과 reply-to 상관관계(correlation)를 자동으로 처리해주므로, 개발자는 Kafka 장에서 보았던 고유 응답 토픽에 대해 걱정할 필요가 없습니다.

### 6.3.1 Inventory reservation lookups

FluoShop에서 Order Service는 checkout 확정 전에 빠른 답이 필요할 때가 있습니다. 예를 들어 flash-sale SKU가 특정 zone에 reserve stock을 아직 보유하고 있는지 Inventory Service에 물을 수 있습니다. 이것은 최종 durable reservation이 아니라 빠른 coordination check이며, 바로 이런 경우에 NATS가 잘 맞습니다.

```typescript
@MessagePattern('inventory.reserve-preview')
async previewReservation(input: { sku: string; zoneId: string; quantity: number }) {
  // 신속한 선행 확인(look-ahead check)
  return await this.inventoryPolicy.preview(input);
}
```

Order Service는 빠른 답을 얻습니다.

나중에 진짜 durable business record가 필요하면 다른 transport가 그 단계를 맡을 수 있습니다.

NATS가 모든 책임을 혼자 지지 않아도 됩니다.

### 6.3.2 Timeout budgets

transport는 기본적으로 3초 request timeout을 사용하며 재정의할 수 있습니다. FluoShop에서는 control-plane check에 대해 이 값을 더 짧게 잡는 편이 낫습니다. inventory preview가 빨리 오지 않는다면 게이트웨이는 고객 여정을 오래 멈추게 하기보다 우아하게 degrade 해야 합니다. 빠른 실패는 종종 길고 불확실한 대기보다 더 정직하며, 특히 advisory lookup에서는 더욱 그렇습니다. v1.5.0에서는 부하가 높은 상황에서도 사용자 경험이 기민하게 유지되도록 `requestTimeoutMs`를 1,500ms로 설정합니다.

## 6.4 Event fan-out and logger-driven failures

NATS는 가벼운 event delivery를 위한 `emit()`도 지원합니다. 이는 cache invalidation이나 policy refresh notice에 딱 맞습니다. 예를 들어 Catalog가 restricted-item rule을 업데이트하면 여러 서비스가 로컬 read model을 갱신해야 할 수 있고, 그 신호는 빨라야 합니다. 모든 환경에서 Kafka 수준의 historical replay까지 필요하지는 않습니다.

### 6.4.1 Cache invalidation in FluoShop

간단한 예는 inventory read cache 무효화입니다.

```typescript
@EventPattern('inventory.cache.invalidate')
async invalidateCache(event: { sku: string }) {
  // 모든 서비스 인스턴스에서 즉시 오래된 데이터를 삭제합니다.
  await this.inventoryCache.evict(event.sku);
}
```

핸들러는 여전히 평범합니다.

subject routing과 NATS publish 메커니즘은 transport 안에 남아 있습니다.

이 일관성 덕분에 한 팀이 transport가 달라도 매번 새로운 핸들러 모델을 배울 필요가 없습니다.

### 6.4.2 No console fallback for event failures

저장소 테스트는 미묘하지만 중요한 동작을 검증합니다. event handler failure는 logger-driven이며, transport logger를 설정하면 그쪽으로 오류가 기록됩니다. 설정하지 않으면 fluo는 raw `console.error` fallback으로 이를 복제하지 않습니다. 이 점은 production hygiene에 중요하고, 중복 잡음을 피하며 observability policy를 명시적으로 유지하게 해줍니다.

FluoShop에서는 NATS event path가 운영상 중요하다면 플랫폼 팀이 structured logger를 반드시 연결해야 한다는 뜻입니다. 트랜스포트는 `logTransportEventHandlerFailure` 유틸리티를 활용하여 캐시 무효화가 실패할 경우 서비스 텔레메트리에 올바르게 기록되도록 보장합니다.

## 6.5 Operations and trade-offs

NATS가 단순해 보이는 이유는 많은 팀이 원하는 방식으로 실제로 단순하기 때문입니다. 그 단순함은 장점이면서 동시에 더 풍부한 durability나 replay 의미론이 필요한 역할에 억지로 밀어 넣지 말라는 경고이기도 합니다. FluoShop은 NATS를 canonical timeline으로도, main queueing system으로도 사용하지 않고 빠른 coordination에 사용합니다.

운영 측면에서 팀은 다음을 관찰해야 합니다.

- **타임아웃 비율(Timeout rates)**: 높은 타임아웃 비율은 대상 서비스가 과부하 상태임을 시사합니다.
- **버스트 볼륨(Burst volume)**: 갑작스러운 팬아웃 볼륨 증가는 내부 네트워크 지연 시간에 영향을 줄 수 있습니다.
- **연결 변동(Connection churn)**: 빈번한 재연결은 불안정한 NATS 서버 구성이나 네트워크 문제를 나타낼 수 있습니다.
- **핸들러 오류 로그(Handler error logs)**: 실패한 정책 업데이트나 캐시 삭제를 모니터링합니다.

이 신호들이 건강하면 NATS는 깔끔한 내부 coordination layer로 남습니다.

비즈니스가 replay나 장기 retention을 요구하기 시작하면 다른 transport가 그 책임을 가져가야 합니다.

## 6.6 FluoShop v1.5.0 progression

이 장이 끝나면 FluoShop은 빠른 control plane을 얻게 됩니다. 아키텍처의 역할 분담도 선명해집니다.

- Kafka는 durable shared history용입니다.
- RabbitMQ는 queue-owned warehouse work용입니다.
- Redis Streams는 여전히 일부 durable workflow를 담당합니다.
- NATS는 low-latency internal coordination용입니다.

이것은 과도한 엔지니어링이 아니라 명시적인 역할 배정입니다. 각 transport가 하나의 주된 일을 맡을 때 시스템은 더 이해하기 쉬워집니다.

## 6.7 Summary

- NATS는 low-latency control-plane messaging과 가벼운 event fan-out에 잘 맞습니다.
- fluo는 caller-owned NATS client와 codec을 기대하며, 인프라 배선을 명시적으로 유지합니다.
- `send()`는 빠른 coordination check를 위한 NATS request-reply에 자연스럽게 매핑됩니다.
- event-handler failure는 logger-driven으로 처리되며, logger가 없을 때 raw `console.error` fallback을 사용하지 않습니다.
- 이제 FluoShop은 replay보다 속도가 더 중요한 inventory 및 cache coordination 경로에 NATS를 사용합니다.

NATS는 모든 transport 경쟁에서 이기려 하지 않습니다.

빠르고 이해하기 쉬운 coordination이라는 한 가지 경쟁에서 이깁니다.

그것이 바로 FluoShop에 NATS가 필요한 이유입니다. 이는 내부 신호를 위한 고속 차선을 추가함으로써 "통신의 스펙트럼"을 완성합니다.
