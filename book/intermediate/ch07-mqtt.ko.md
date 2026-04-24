<!-- packages: @fluojs/microservices, mqtt -->
<!-- project-state: FluoShop v1.6.0 -->

# Chapter 7. MQTT

이 장에서는 FluoShop의 메시징 범위를 서버 간 통신에서 edge device와 telemetry 입력까지 확장하며 MQTT가 필요한 지점을 정리합니다. Chapter 6이 빠른 내부 coordination을 다뤘다면, 여기서는 불안정한 연결과 retained state가 있는 physical edge 환경으로 흐름을 넓힙니다.

## Learning Objectives
- MQTT가 device 및 telemetry 시나리오에 적합한 이유를 이해합니다.
- namespace, QoS, retain 설정을 기준으로 MQTT 트랜스포트를 구성하는 방법을 익힙니다.
- reply topic과 timeout budget을 사용해 MQTT request-reply 흐름을 설계합니다.
- retained snapshot과 telemetry 이벤트를 FluoShop delivery monitoring에 연결하는 방법을 설명합니다.
- edge 환경에서 MQTT 운영 지표와 보안 고려사항을 정리합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6 완료.
- topic 기반 메시징과 request-reply 패턴에 대한 기초 이해.
- edge device, telemetry, 네트워크 변동성에 대한 기본 개념.

## 7.1 Why MQTT in FluoShop

MQTT는 topic 기반이고 가볍습니다. 간헐적 연결이나 자원 제약이 있는 클라이언트를 전제로 설계되었습니다.

그래서 device 및 telemetry 시나리오에 잘 맞습니다.

FluoShop은 MQTT를 배송 및 창고 edge signal에 사용합니다.

예를 들면 다음과 같습니다.

- 신선식품 배송의 cold-chain temperature probe
- smart locker 상태 업데이트
- picker의 handheld scanner acknowledgment
- courier ETA beacon

이 신호들은 운영상 중요합니다.

하지만 모든 신호에 Kafka 수준의 replay가 필요한 것은 아닙니다.

대신 적절한 QoS와 retained state 동작이 필요한 경우가 많습니다.

## 7.2 MQTT transport setup

NATS, Kafka, RabbitMQ처럼 완전한 caller-owned 브로커만 강제하지 않습니다. MQTT는 제공된 client를 쓰거나, `mqtt` 패키지를 통해 transport가 URL 기반 연결을 직접 구성하게 둘 수도 있습니다.

이 유연성은 실제 배포 방식과 잘 맞습니다.

어떤 팀은 이미 shared MQTT client를 관리합니다.

다른 팀은 transport-local ownership을 선호합니다.

### 7.2.1 Core options

`MqttMicroserviceTransport`는 다른 transport보다 delivery-shape 옵션을 더 많이 노출합니다.

- `namespace`
- `eventTopic`
- `messageTopic`
- `replyTopic`
- `requestTimeoutMs`
- `eventQos`, `messageQos`, `responseQos`
- `eventRetain`, `messageRetain`, `responseRetain`

namespace만 제공해도 transport가 그 아래에서 topic 이름을 파생합니다.

이 방식은 FluoShop에 실용적인 기본값입니다.

시스템은 `fluoshop.devices`를 namespace로 사용하고, 그 아래 event, message, response topic을 자동으로 만들 수 있습니다.

### 7.2.2 Module wiring

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, MqttMicroserviceTransport } from '@fluojs/microservices';

const transport = new MqttMicroserviceTransport({
  url: process.env.MQTT_URL,
  namespace: 'fluoshop.devices',
  eventQos: 1,
  messageQos: 1,
  responseQos: 1,
  eventRetain: false,
  responseRetain: false,
  requestTimeoutMs: 2_000,
});

@Module({
  imports: [MicroservicesModule.forRoot({ transport })],
  providers: [ShipmentTelemetryHandler],
})
export class ShipmentTelemetryModule {}
```

이 설정은 의도적으로 단순합니다.

handler model은 계속 안정적으로 유지됩니다.

transport는 메시지의 이동 방식을 바꿀 뿐, provider가 비즈니스 로직을 표현하는 방식은 바꾸지 않습니다.

## 7.3 Request-reply over MQTT

많은 개발자가 MQTT를 event pub/sub 전용으로 생각하지만, fluo는 `replyTopic`이 포함된 message frame을 발행하고 `requestId`로 응답을 상관관계시켜 request-reply를 지원합니다. 이 구조 덕분에 FluoShop은 device command를 보내고 acknowledgment를 기다릴 수 있습니다.

### 7.3.1 Device command acknowledgments

예를 들어 smart locker가 pickup compartment를 실제로 열었다는 사실을 확인해야 한다고 가정해 봅시다. API는 무기한 기다릴 수 없지만 bounded response path는 필요합니다.

```typescript
@MessagePattern('locker.open-compartment')
async openCompartment(input: { lockerId: string; compartmentId: string }) {
  return await this.lockerGateway.open(input);
}
```

locker edge service는 이 명령을 처리하고 MQTT response topic으로 응답할 수 있습니다. 이 패턴은 디바이스가 MQTT-native이지만 애플리케이션은 여전히 request-style programming model을 유지하고 싶을 때 유용합니다.

### 7.3.2 Reply topics and timeouts

transport는 기본적으로 인스턴스별 reply topic을 사용합니다. 테스트는 기본값 사용 시 생성된 topic이 `fluo.microservices.responses.<uuid>` 형태인지 검증하며, 이는 RabbitMQ와 Kafka에서 본 reply isolation과 같은 맥락입니다. 디바이스 환경에서는 연결 상태가 불안정할 수 있으므로 timeout이 서버 간 호출보다 더 중요해집니다. request budget 안에 응답하지 않는 락커는 hanging web request가 아니라 일시적 edge failure로 드러나야 합니다.

## 7.4 Event delivery for telemetry

MQTT는 QoS와 retained state를 함께 설계할 때 표현력이 커집니다.

FluoShop은 이 두 개념을 모두 사용해 실제 운영 신호를 모델링합니다.

### 7.4.1 Retained state snapshots

cold-chain sensor가 최신 트레일러 온도를 발행할 수 있습니다. 새 구독자는 대개 가장 최근 값을 즉시 확인해야 하며, 이런 경우 retained message가 필요합니다. state snapshot topic에 retained event 채널을 구성하면 새 관찰자는 다음 자연 업데이트를 기다리지 않고 현재 상태를 볼 수 있습니다. 이것은 historical replay가 아니라 last-known-value 전략입니다. 이 차이는 설계 단계에서 분명히 구분해야 합니다.

### 7.4.2 QoS trade-offs

QoS 설정은 단순한 transport toggle이 아니라 비즈니스 결정입니다.

- QoS 0은 오버헤드를 낮추는 대신 유실을 허용합니다.
- QoS 1은 중복 가능성을 감수하고 at-least-once 전달을 선호합니다.
- QoS 2는 더 엄격하지만 비용도 더 큽니다.

FluoShop에서 자주 갱신되는 courier ETA beacon은 QoS 0에 어울릴 수 있습니다.

smart-locker open command는 QoS 1이 더 적절할 가능성이 큽니다.

retained warehouse status snapshot도 늦게 붙는 subscriber가 brokered state를 안정적으로 받도록 QoS 1을 사용할 수 있습니다.

## 7.5 FluoShop delivery monitoring

MQTT는 플랫폼을 데이터센터 밖으로 확장합니다. 따라서 시스템이 표현할 수 있는 운영 사실도 달라집니다.

### 7.5.1 Cold-chain alerts

냉장 배송이 온도 임계값을 넘으면 edge gateway가 `shipment.temperature-alert`를 발행할 수 있습니다. Notification Service, Operations Dashboard, compliance recorder가 각각 반응할 수 있습니다. 이들 모두가 센서의 직접 요청 경로에 들어갈 필요는 없습니다. 앞선 transport에서 본 decoupling 원리가 physical-world telemetry에 적용된 모습입니다.

### 7.5.2 Order ETA updates

courier device는 ETA update도 발행할 수 있습니다.

Customer Experience Service는 이를 order-tracking status로 축약할 수 있습니다.

중요한 설계 포인트는 MQTT가 최종 customer-facing representation까지 소유할 필요는 없다는 점입니다.

edge-originated fact를 플랫폼 안으로 충분히 안정적으로 운반해 downstream system이 반응할 수 있게 하면 됩니다.

## 7.6 Operations and security

MQTT는 순수 내부 서비스 메시보다 네트워크 변동성과 identity 다양성이 큰 환경에 자주 배포됩니다.

따라서 FluoShop은 broker auth, topic namespace 설계, retained-message 범위를 보안에 민감한 아키텍처 선택으로 다뤄야 합니다.

운영 측면에서 팀은 다음을 관찰해야 합니다.

- edge client의 publish failure rate
- request-reply command의 timeout rate
- retained topic sprawl
- QoS 1 경로의 duplicate delivery pattern
- device gateway의 reconnect churn

이 신호들은 MQTT가 건강한 edge-ingestion layer로 작동하는지, 아니면 조용히 delivery debt를 쌓고 있는지 보여 줍니다.

## 7.7 FluoShop v1.6.0 progression

이 장이 끝나면 FluoShop은 더 이상 서버 측 서비스 집합에만 머물지 않습니다. device와 telemetry 입력을 흡수할 수 있는 플랫폼이 됩니다. 현대 커머스 시스템은 scanner, locker, courier app, sensor network에 자주 의존하므로 이 변화는 아키텍처를 더 현실적으로 만듭니다. MQTT는 그런 연동 환경을 전제로 한 transport를 제공합니다.

## 7.8 Summary

- MQTT는 제약이 있거나 불안정한 연결 환경의 edge, device, telemetry 시나리오에 잘 맞습니다.
- fluo는 topic 및 reply-topic routing을 통해 MQTT에서도 event와 request-reply 패턴을 모두 지원합니다.
- QoS와 retain 설정은 generic default가 아니라 비즈니스 의미론을 따라야 합니다.
- 인스턴스별 reply topic은 동시 request flow를 분리합니다.
- 이제 FluoShop은 locker, courier, cold-chain signal을 플랫폼 안으로 가져오기 위해 MQTT를 사용합니다.

더 큰 교훈은 다시 아키텍처 선택에 있습니다.

transport 선택은 네트워크의 형태와 그 위에서 이벤트를 만드는 producer의 특성을 반영해야 합니다.

FluoShop에 MQTT가 필요한 이유는 시스템 경계가 이제 physical edge까지 확장되었기 때문입니다.
