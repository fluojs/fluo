<!-- packages: @fluojs/microservices, mqtt -->
<!-- project-state: FluoShop v1.6.0 -->

# 7. MQTT

MQTT는 FluoShop이 서버 프로세스끼리만 통신하던 단계에서 벗어날 때 등장합니다. v1.6.0이 되면 시스템은 창고 디바이스, 스마트 락커, 배송 흐름에 연결된 냉장 센서의 신호도 듣기 시작합니다. 이 생산자들은 모두 완전한 백엔드 서비스가 아닙니다. 일부는 제약이 큰 디바이스이고, 일부는 불안정한 네트워크 위에서 연결되며, 일부는 풍부한 historical replay보다 retained last-known state가 더 중요합니다. 바로 이런 환경에서 MQTT가 유용해집니다. 이 장의 핵심은 단순합니다. FluoShop은 서비스 간 메시징을 넘어 physical edge까지 확장하면서도 같은 fluo handler model을 유지할 수 있습니다.

## 7.1 Why MQTT in FluoShop

MQTT는 topic 기반이며 가볍고, 간헐적 연결이나 자원 제약이 있는 클라이언트를 위해 설계되었습니다.

이 때문에 device 및 telemetry 시나리오에 잘 맞습니다.

FluoShop은 MQTT를 배송 및 창고 edge signal에 사용합니다.

예를 들면 다음과 같습니다.

- 신선식품 배송의 cold-chain temperature probe
- smart locker 상태 업데이트
- picker의 handheld scanner acknowledgment
- courier ETA beacon

이 신호들은 운영상 중요합니다.

하지만 모두 Kafka 수준의 replay가 필요하지는 않습니다.

대신 sensible QoS와 retained state 동작이 필요한 경우가 많습니다.

## 7.2 MQTT transport setup

NATS, Kafka, RabbitMQ처럼 완전히 caller-owned 브로커만 강제하지 않고, MQTT는 제공된 client를 쓰거나 `mqtt` 패키지를 통해 transport가 URL로 자체 연결을 해석하도록 둘 수도 있습니다.

이 유연성은 실제 배포 방식과 잘 맞습니다.

어떤 팀은 이미 shared MQTT client를 관리합니다.

어떤 팀은 transport-local ownership을 선호합니다.

### 7.2.1 Core options

`MqttMicroserviceTransport`는 다른 transport보다 더 많은 delivery-shape 옵션을 노출합니다.

- `namespace`
- `eventTopic`
- `messageTopic`
- `replyTopic`
- `requestTimeoutMs`
- `eventQos`, `messageQos`, `responseQos`
- `eventRetain`, `messageRetain`, `responseRetain`

namespace만 제공해도 transport가 그 아래에 topic 이름을 파생합니다.

이것은 FluoShop에 좋은 기본값입니다.

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

이 설정은 의도적으로 평범합니다.

늘 그렇듯 handler model은 안정적으로 유지됩니다.

transport는 메시지의 이동 방식을 바꾸지, provider가 비즈니스 로직을 표현하는 방식을 바꾸지 않습니다.

## 7.3 Request-reply over MQTT

많은 개발자가 MQTT를 event pub/sub 전용으로만 생각하지만, fluo는 `replyTopic`이 포함된 message frame을 발행하고 `requestId`로 응답을 상관관계시켜 request-reply를 지원합니다. 덕분에 FluoShop은 device command를 보내고 acknowledgment를 기다릴 수 있습니다.

### 7.3.1 Device command acknowledgments

예를 들어 smart locker가 pickup compartment를 실제로 열었다는 사실을 확인해야 한다고 가정합시다. API는 무기한 기다리고 싶지 않지만 bounded response path는 원합니다.

```typescript
@MessagePattern('locker.open-compartment')
async openCompartment(input: { lockerId: string; compartmentId: string }) {
  return await this.lockerGateway.open(input);
}
```

locker edge service는 이 명령을 처리하고 MQTT response topic으로 응답할 수 있습니다. 이 패턴은 디바이스가 MQTT-native이지만 애플리케이션은 여전히 request-style programming model을 원할 때 특히 유용합니다.

### 7.3.2 Reply topics and timeouts

transport는 기본적으로 인스턴스별 reply topic을 사용합니다. 테스트는 기본값 사용 시 생성된 topic이 `fluo.microservices.responses.<uuid>` 형태가 되는지 검증하며, 이는 RabbitMQ와 Kafka에서 본 reply-isolation 이야기와 같은 맥락입니다. 디바이스 환경에서는 timeout이 서버 프로세스보다 더 중요한데 연결 상태가 불안정할 수 있기 때문입니다. request budget 안에 응답하지 않는 락커는 hanging web request가 아니라 일시적 edge failure로 드러나야 합니다.

## 7.4 Event delivery for telemetry

MQTT는 QoS와 retained state를 함께 생각할 때 특히 표현력이 커집니다.

FluoShop은 이 두 개념을 모두 사용해 실제 운영 신호를 모델링합니다.

### 7.4.1 Retained state snapshots

cold-chain sensor가 최신 트레일러 온도를 발행할 수 있습니다. 새 구독자는 대개 가장 최근 값을 즉시 보고 싶어 하며, 바로 이럴 때 retained message가 필요합니다. state snapshot topic에 retained event 채널을 구성하면 새 관찰자는 다음 자연 업데이트를 기다리지 않고도 현재 상태를 볼 수 있습니다. 이것은 historical replay와는 다르고, last-known-value 전략입니다. 이 차이를 분명히 이해해야 합니다.

### 7.4.2 QoS trade-offs

QoS 설정은 단순한 transport toggle이 아니라 비즈니스 결정입니다.

- QoS 0은 오버헤드를 낮추는 대신 유실을 허용합니다.
- QoS 1은 중복 가능성을 감수하고 at-least-once 전달을 선호합니다.
- QoS 2는 더 엄격하지만 비용도 더 큽니다.

FluoShop에서 자주 갱신되는 courier ETA beacon은 QoS 0에 어울릴 수 있습니다.

smart-locker open command는 아마 QoS 1이 더 적절합니다.

retained warehouse status snapshot도 늦게 붙는 subscriber가 brokered state를 안정적으로 받도록 QoS 1을 사용할 수 있습니다.

## 7.5 FluoShop delivery monitoring

MQTT는 플랫폼을 데이터센터 밖으로 확장합니다. 따라서 시스템이 말할 수 있는 이야기의 종류도 달라집니다.

### 7.5.1 Cold-chain alerts

냉장 배송이 온도 임계값을 넘으면 edge gateway가 `shipment.temperature-alert`를 발행할 수 있습니다. Notification Service가 반응할 수 있고, Operations Dashboard가 반응할 수 있으며, compliance recorder가 반응할 수 있습니다. 이들 모두가 센서의 직접 요청 경로에 들어갈 필요는 없습니다. 이것은 earlier transport에서 보았던 decoupling 원리가 physical-world telemetry에 적용된 모습입니다.

### 7.5.2 Order ETA updates

courier device는 ETA update도 발행할 수 있습니다.

Customer Experience Service는 이를 단순한 order-tracking status로 축약할 수 있습니다.

중요한 설계 포인트는 MQTT가 최종 customer-facing representation까지 소유할 필요는 없다는 점입니다.

edge-originated fact를 플랫폼 안으로 충분히 안정적으로 운반해 downstream system이 반응할 수 있게만 하면 됩니다.

## 7.6 Operations and security

MQTT는 순수 내부 서비스 메시보다 네트워크 변동성과 정체성 다양성이 더 큰 환경에 자주 배포됩니다.

따라서 FluoShop은 broker auth, topic namespace 설계, retained-message 범위를 보안에 민감한 아키텍처 선택으로 다뤄야 합니다.

운영 측면에서 팀은 다음을 관찰해야 합니다.

- edge client의 publish failure rate
- request-reply command의 timeout rate
- retained topic sprawl
- QoS 1 경로의 duplicate delivery pattern
- device gateway의 reconnect churn

이 신호들은 MQTT가 건강한 edge-ingestion layer인지, 아니면 조용히 delivery debt를 쌓고 있는지 보여 줍니다.

## 7.7 FluoShop v1.6.0 progression

이 장이 끝나면 FluoShop은 더 이상 서버 측 서비스 집합만이 아닙니다. device와 telemetry 입력을 흡수할 수 있는 플랫폼이 됩니다. 이 변화는 아키텍처를 더 현실적으로 만들며, 현대 커머스 시스템은 scanner, locker, courier app, sensor network에 자주 의존합니다. MQTT는 그런 연동의 환경을 존중하는 transport를 제공합니다.

## 7.8 Summary

- MQTT는 제약이 있거나 불안정한 연결 환경의 edge, device, telemetry 시나리오에 잘 맞습니다.
- fluo는 topic 및 reply-topic routing을 통해 MQTT에서도 event와 request-reply 패턴을 모두 지원합니다.
- QoS와 retain 설정은 generic default가 아니라 비즈니스 의미론을 따라야 합니다.
- 인스턴스별 reply topic은 동시 request flow를 분리합니다.
- 이제 FluoShop은 locker, courier, cold-chain signal을 플랫폼 안으로 가져오기 위해 MQTT를 사용합니다.

더 큰 교훈은 다시 아키텍처에 있습니다.

transport 선택은 네트워크의 형태와 그 위의 생산자 특성을 반영해야 합니다.

FluoShop에 MQTT가 필요한 이유는 시스템이 이제 physical edge까지 도달했기 때문입니다.
