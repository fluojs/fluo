<!-- packages: @fluojs/microservices, @grpc/grpc-js, @grpc/proto-loader -->
<!-- project-state: FluoShop v1.7.0 -->

# Chapter 8. gRPC

이 장에서는 Part 1의 transport 선택을 gRPC까지 확장하고, FluoShop에 schema-first RPC와 스트리밍 계약을 도입하는 기준을 정리합니다. Chapter 7이 physical edge 입력을 다뤘다면, 여기서는 명시적 proto 계약과 저지연 스트리밍이 필요한 서비스 경계로 초점을 옮깁니다.

## Learning Objectives
- gRPC가 브로커 기반 transport와 다른 지점 간 계약을 제공하는 이유를 이해합니다.
- protoPath, packageName, services 같은 핵심 옵션으로 gRPC 트랜스포트를 구성하는 방법을 익힙니다.
- unary RPC와 event-style unary 호출을 fluo 패턴 모델에 연결하는 방식을 설명합니다.
- 서버, 클라이언트, 양방향 스트리밍 패턴이 FluoShop 시나리오에 어떻게 쓰이는지 분석합니다.
- timeout, cancellation, observability 관점에서 gRPC 운영 경계를 정리합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7 완료.
- request-response와 streaming 계약에 대한 기초 이해.
- protobuf 기반 스키마와 서비스 경계 설계에 대한 기본 개념.

## 8.1 Why gRPC in FluoShop

FluoShop은 브로커를 통한 디커플링보다 엄격한 계약(strict contract)과 스트리밍 의미론(streaming semantics)이 더 중요한 경계에서 gRPC를 사용합니다. 브로커가 비동기적 탄력성에 강하다면, gRPC는 지점 간(point-to-point) 정밀도에 강합니다. 대표적인 예시는 다음과 같습니다.

- Gateway와 Checkout 사이의 내부 가격 책정 및 견적(quote) API (Unary)
- 서버 스트리밍 방식의 주문 추적 업데이트 (한 번의 요청, 여러 번의 업데이트)
- 클라이언트 스트리밍 방식의 창고 스캔 배치 업로드 (여러 아이템, 한 번의 결과)
- 양방향(bidirectional) 택배 기사 세션 (독립적인 양방향 통신)

이 링크들은 protobuf 스키마, 생성된 클라이언트 기대치, 잘 정의된 스트리밍 모드의 이점을 얻습니다. 굳이 큐의 작업 항목(work item)으로 표현할 필요는 없습니다. `GrpcMicroserviceTransport`가 하부 HTTP/2 채널의 생명주기를 관리하는 정밀한 RPC 계약으로 표현하는 편이 더 적합합니다.

## 8.2 Proto-first transport setup

`GrpcMicroserviceTransport`는 패키지에서 기능 범위가 가장 넓은 transport입니다. 런타임에 `.proto` 파일을 로드하고, `@grpc/proto-loader`를 통해 서비스 생성자를 빌드하며, fluo의 패턴 기반 라우팅을 gRPC 메서드 정의에 매핑하는 작업을 처리합니다.

이 transport는 unary 호출과 세 가지 스트리밍 모드를 모두 지원합니다. 스트리밍 데코레이터들이 `@fluojs/microservices` 루트 배럴에서 직접 export된다는 사실은 스트리밍이 부가 기능이 아니라 1급 시민(first-class citizen) 기능임을 보여 줍니다.

### 8.2.1 Core options

이 transport는 런타임 패턴과 정적 스키마 사이의 간극을 메우기 위해 여러 설정값을 요구합니다.

- `protoPath`: `.proto` 파일의 경로.
- `packageName`: proto 패키지 이름 (예: `fluoshop.checkout`).
- `url`: 바인딩 주소 (예: `0.0.0.0:50051`).
- `services`: 등록 범위를 제한하고 싶을 때 사용하는 선택적 목록.
- `requestTimeoutMs`: 기본값은 3,000ms입니다.
- `loaderOptions`: `@grpc/proto-loader`용 옵션.
- `channelOptions`: `@grpc/grpc-js` 채널용 옵션.
- `kindMetadataKey`: 메시지와 이벤트를 구분하기 위한 메타데이터 키 (기본값 `x-fluo-kind`).

다른 transport보다 설정 목록이 긴 이유는 gRPC가 schema-first이기 때문입니다. 설정의 명시성이 높다는 것은 런타임 계약의 안전성을 확보하는 비용입니다.

### 8.2.2 Module wiring

```typescript
import { Module } from '@fluojs/core';
import { GrpcMicroserviceTransport, MicroservicesModule } from '@fluojs/microservices';

const transport = new GrpcMicroserviceTransport({
  protoPath: new URL('./proto/fluoshop.proto', import.meta.url).pathname,
  packageName: 'fluoshop.checkout',
  url: '0.0.0.0:50051',
  services: ['CheckoutService', 'TrackingService'],
  requestTimeoutMs: 2_500,
});

@Module({
  imports: [MicroservicesModule.forRoot({ transport })],
  providers: [CheckoutRpcHandler, TrackingRpcHandler],
})
export class CheckoutRpcModule {}
```

이것도 같은 fluo 모델 위에 있습니다. transport의 구현 세부 사항은 캡슐화되어 있지만, 모듈과 프로바이더 구조는 익숙하게 유지됩니다. 와이어 프로토콜은 바꾸면서도 애플리케이션 아키텍처는 흔들지 않는 방식입니다.

## 8.3 Unary RPC with typed contracts

Unary gRPC 호출은 이전의 request-response transport와 가장 가까운 대응물입니다. 가장 큰 차이점은 protobuf가 계약의 형태를 명시적으로 정의한다는 점입니다. transport는 unary와 이벤트 스타일 unary 호출 모두에 대해 `<Service>.<Method>` 형식(예: `CheckoutService.GetQuote`)의 패턴을 기대합니다.

### 8.3.1 Pricing and checkout quote requests

Checkout 서비스가 최종 확정 전에 strongly typed 가격 견적을 받아야 한다고 가정해 봅시다. 호출이 동기적이고, 스키마가 중요하며, 나중에 여러 언어로 구현된 클라이언트가 붙을 가능성이 있다면 gRPC 경계로 적합합니다.

```proto
service CheckoutService {
  rpc GetQuote (QuoteRequest) returns (QuoteReply);
}
```

```typescript
@MessagePattern('CheckoutService.GetQuote')
async getQuote(input: { orderId: string; loyaltyTier: string }) {
  // input은 proto 요청 객체로부터 자동 매핑됩니다.
  return await this.quoteService.calculate(input);
}
```

핸들러는 여전히 간결합니다. 계약의 정밀함은 `.proto` 파일에 있으며, `GrpcMicroserviceTransport`는 인바운드 객체가 핸들러를 호출하기 전에 예상된 형태와 맞는지 확인합니다.

### 8.3.2 Event-style unary with metadata kind

fluo의 gRPC는 이벤트 스타일의 unary 호출도 발행할 수 있습니다. transport는 기본적으로 `x-fluo-kind` 메타데이터를 사용해 `message`(request-response)와 `event`(one-way) 동작을 구분합니다.

이 기능은 어떤 RPC 호출이 데이터를 요청하는 전통적인 요청이라기보다 원격 확인만 필요한 이벤트 알림처럼 동작해야 할 때 유용합니다. 예를 들어 Compliance 서비스는 비즈니스 로직 응답 없이 전송 성공 여부만 확인하면 되는 `TrackingService.RecordCheckpoint` 호출을 보낼 수 있습니다. 이 방식은 모든 상호작용을 요청-응답의 틀에 억지로 가두지 않으면서도 강한 타입 안전성을 유지합니다.

## 8.4 Streaming patterns

스트리밍은 gRPC가 이 파트의 다른 transport와 분명히 달라지는 지점입니다. 루트 배럴은 이 기능 범위를 나타내는 세 가지 데코레이터를 export합니다.

- `@ServerStreamPattern`
- `@ClientStreamPattern`
- `@BidiStreamPattern`

fluo 저장소 테스트는 이 세 모드를 모두 다루며 스트림 에러 전파, 취소(cancellation), 백프레셔(backpressure)가 올바르게 처리되는지 검증합니다.

### 8.4.1 Server-streaming order tracking

서버 스트리밍은 하나의 요청이 업데이트 스트림을 열어야 할 때 잘 맞습니다. FluoShop에서 고객 지원 팀은 에스컬레이션이 시작된 뒤 실시간 주문 상태(order checkpoint)를 구독할 수 있습니다.

```typescript
@ServerStreamPattern('TrackingService.StreamOrder')
async streamOrder(
  input: { orderId: string },
  writer: ServerStreamWriter<{ stage: string; occurredAt: string }>,
) {
  // GrpcMicroserviceTransport는 gRPC writable stream을 ServerStreamWriter로 감쌉니다.
  for await (const checkpoint of this.trackingService.stream(input.orderId)) {
    writer.write(checkpoint);
  }

  writer.end();
}
```

이 모델은 HTTP 폴링을 반복하거나 큐 위에 스트림을 흉내 내는 것보다 자연스럽고 지연 시간이 짧습니다.

### 8.4.2 Client-streaming warehouse batch scans

클라이언트 스트리밍은 많은 작은 메시지가 하나의 요약 응답으로 이어져야 할 때 유용합니다. 창고의 핸드헬드 기기가 좋은 예시입니다. 수집된 스캔 결과 배치를 업로드하면, 서버는 스트림을 받으면서 실시간으로 검증을 수행하고 스트림이 끝나면 최종 집계 응답을 반환합니다. 이 방식은 네트워크 오버헤드를 줄이면서도 전체 과정을 타입 안전하게 유지합니다.

### 8.4.3 Bidirectional courier sessions

양방향 스트리밍은 가장 표현력이 큰 패턴입니다. 양쪽이 하나의 논리적 세션 위에서 독립적으로 메시지를 보낼 수 있습니다. FluoShop은 이를 배송 기사용 관제 콘솔에 사용할 수 있습니다. 기사 앱은 위치 핑과 배송 상태 변화를 보내고, 백엔드는 동시에 경로 재탐색 힌트나 특별 지시 사항을 내려보낼 수 있습니다. gRPC는 이 복잡한 상호작용을 모호한 브로커 토픽 집합이 아니라 명시적이고 타입 안전한 세션 계약으로 만듭니다.

## 8.5 Timeouts, cancellation, and observability

transport는 unary 스타일 요청에 대해 `requestTimeoutMs`(기본값 3,000ms)를 지원합니다. 요청이 이 시간을 초과하면 transport는 `DEADLINE_EXCEEDED`에 해당하는 에러와 함께 프로미스를 거절합니다. 타입 안전한 계약이 있다고 해서 분산 환경의 실패(distributed failure)가 사라지는 것은 아니므로 이러한 세부 사항이 중요합니다. 팀은 여전히 다음을 결정해야 합니다.

- 어떤 unary 호출이 지연 시간에 민감하여 짧은 타임아웃이 필요한가
- 어떤 스트림이 몇 분 동안 열려 있을 수 있으며, 수동 하트비트 로직이 필요한가
- 클라이언트 측의 취소(HTTP/2 스트림 닫기)를 백엔드 정리 로직에 어떻게 매핑할 것인가
- 로거 기반의 이벤트 실패를 어떻게 관측할 것인가 (`GrpcMicroserviceTransport`는 `console.error` 폴백을 사용하지 않음)

gRPC는 계약의 정밀도를 높여 주지만, 운영상의 판단을 대신하지는 않습니다.

## 8.6 FluoShop v1.7.0 architecture

Part 1의 끝에 이르면 FluoShop은 링크마다 의도가 분명한 transport-diverse system이 됩니다.

- **TCP**는 단순하고 오버헤드가 적은 직접 읽기를 제공합니다.
- **Redis Streams**는 PEL/Ack 안전성을 통해 내구성 있는 비즈니스 워크플로우를 보호합니다.
- **RabbitMQ**는 분산 창고 큐와 복잡한 라우팅을 소유합니다.
- **Kafka**는 재생 가능한 기록과 대규모 이벤트 로그를 저장합니다.
- **NATS**는 영속성 없는 빠른 control-plane 조율을 담당합니다.
- **MQTT**는 엣지 디바이스와 IoT 센서로부터 텔레메트리를 수집합니다.
- **gRPC**는 서비스 간 로직을 위한 타입 안전한 RPC와 스트리밍 계약을 제공합니다.

이것이 이번 파트의 핵심 교훈입니다. 핸들러 구조가 안정적으로 유지될 때 transport의 다양성은 관리 가능한 선택지가 됩니다. gRPC는 어떤 경계는 익명의 토픽이나 큐보다 스키마와 세션으로 표현하는 편이 더 적절하다는 사실을 보여 주며 이 그림을 완성합니다.

## 8.7 Summary

- gRPC는 지점 간 계약 안전성과 네이티브 스트리밍을 제공하므로 transport 도구 상자에 반드시 포함되어야 합니다.
- fluo는 1급 데코레이터를 통해 unary와 서버, 클라이언트, 양방향 스트리밍을 모두 지원합니다.
- Protobuf 계약은 서비스 간 경계를 명시적으로 만들고 여러 언어에서 쉽게 공유할 수 있게 합니다.
- 메타데이터 기반의 이벤트 스타일 unary 호출은 강한 타입 안전성을 유지하면서도 단방향 상호작용을 가능하게 합니다.
- 이제 FluoShop은 가격 견적, 주문 추적 스트림, 기사 세션 계약 등에 gRPC를 사용합니다.

Part 1은 직접적인 transport 사고에서 시작했습니다. 그리고 더 넓은 원리로 끝납니다. 비즈니스 경계에 맞는 transport를 고르고, 시스템 전체를 갈아엎지 않고도 진화할 수 있도록 핸들러 모델을 안정적으로 유지하라는 원리입니다.
