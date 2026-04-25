<!-- packages: @fluojs/microservices -->
<!-- project-state: FluoShop v1.0.0 -->

# Chapter 1. Microservice Architecture and fluo Strategy

이 장은 intermediate 볼륨 전체의 기준선이 되는 FluoShop 아키텍처와 fluo의 마이크로서비스 전략을 정리합니다. Beginner 볼륨에서 다룬 단일 애플리케이션 모델을 바탕으로, 이제 서비스 경계와 트랜스포트 선택이 시스템 품질에 어떤 영향을 주는지까지 범위를 넓힙니다.

## Learning Objectives
- FluoShop을 구성하는 핵심 서비스 경계와 역할을 이해합니다.
- fluo가 트랜스포트 독립적인 마이크로서비스 모델을 어떻게 제공하는지 배웁니다.
- `@MessagePattern`과 `@EventPattern`이 요청과 이벤트 흐름을 어떻게 나누는지 살펴봅니다.
- `MicroservicesModule`이 분산 애플리케이션의 기본 배선을 어떻게 구성하는지 확인합니다.
- 마이크로서비스가 주는 이점과 분산 시스템 비용을 함께 분석합니다.

## Prerequisites
- Beginner 볼륨 완료 또는 이에 준하는 fluo 기초 경험.
- TypeScript와 의존성 주입, 모듈 구조에 대한 기본 이해.
- 서비스 간 동기 요청과 비동기 이벤트의 차이에 대한 기초 개념.

## 1.1 The FluoShop Topology

이 책에서는 실무 마이크로서비스 패턴을 설명하기 위해 단계적으로 확장되는 이커머스 프로젝트인 **FluoShop**을 구축합니다. 아키텍처는 각기 특정 도메인을 담당하는 다섯 개의 핵심 서비스로 구성됩니다.

1. **API Gateway**: 모든 클라이언트 요청의 진입점입니다. 라우팅, 인증, 요청 집계를 담당합니다.
2. **Catalog Service**: 상품 정보, 카테고리, 재고 수준을 관리하며 높은 조회 성능을 강조합니다.
3. **Order Service**: 아키텍처의 조정 중심이 됩니다. 주문 생성, 상태 전환, 서비스 간 조율을 담당합니다.
4. **Payment Service**: 결제 트랜잭션과 외부 업체 연동을 관리합니다. 엄격한 실패 규칙이 필요한 고위험 도메인입니다.
5. **Notification Service**: 이메일과 알림을 발송합니다. 메인 요청 경로와 분리되어야 하는 다운스트림 소비자를 대표합니다.

이 토폴로지는 빠르게 이해할 수 있을 만큼 작지만, 실제 운영 환경에서 중요한 경계를 드러낼 만큼 충분히 복잡합니다. 게이트웨이는 클라이언트 지향 프로토콜 문제를 맡고, 주문 서비스는 복잡한 비즈니스 워크플로를 관리합니다.

### 1.1.1 Architecture Diagram

시스템은 저지연과 높은 신뢰성 사이의 균형을 맞추기 위해 하이브리드 통신 모델을 따릅니다.

- **Requests (Synchronous)**: API Gateway는 요청-응답 패턴을 사용해 Catalog 및 Order 서비스와 통신합니다. Order 서비스는 결제 승인을 위해 Payment 서비스를 호출합니다.
- **Events (Asynchronous)**: 서비스는 상태 변화를 알리기 위해 이벤트를 발행합니다. 예를 들어 Payment 서비스가 결제 성공 이벤트를 발행하면 Notification 서비스가 이를 독립적으로 소비합니다.

```text
Client
  -> API Gateway (요청)
      -> Catalog Service (요청)
      -> Order Service (요청)
          -> Payment Service (요청/이벤트)
              -> Notification Service (이벤트)
```

이 다이어그램은 도메인 관계를 보여주는 지도입니다. 어떤 상호작용은 즉각적인 데이터를 위한 직접 요청이고, 어떤 상호작용은 백그라운드 처리를 위한 fire-and-forget 이벤트입니다. 뒤의 장에서는 신뢰성이 지연 시간보다 중요해질 때 이런 연결이 어떻게 지속성 있는 브로커 기반 흐름으로 바뀌는지 살펴봅니다.

## 1.2 Unified Programming Model

fluo에서 마이크로서비스의 비즈니스 로직은 기본 네트워크 프로토콜과 분리되어 있습니다. 핸들러 내부에 트랜스포트 전용 코드를 작성하지 않습니다. 대신 데코레이터로 메시지 패턴을 정의하고, 트랜스포트 어댑터가 프레이밍, 직렬화, 전달 메커니즘을 처리하게 합니다.

이 분리는 트랜스포트 변경이 실제 프로젝트에서 자주 발생하기 때문에 중요합니다. 팀은 직접적인 서비스 간 네트워킹(TCP/gRPC)으로 시작했다가, 나중에 재시도, 지속성, fan-out이 필요하다는 사실을 확인하고 브로커(Kafka/RabbitMQ)를 도입하는 경우가 많습니다. 애플리케이션 코드가 특정 클라이언트 라이브러리에 묶여 있으면 마이그레이션은 재작성에 가까워집니다. 트랜스포트가 교체 가능한 어댑터라면 변경 범위는 설정과 배선에 머뭅니다.

### 1.2.1 Pattern-Based Routing

`@MessagePattern` 및 `@EventPattern`과 같은 데코레이터를 사용하면 fluo가 문자열 또는 정규식을 기반으로 들어오는 패킷을 올바른 핸들러로 라우팅할 수 있습니다.

```typescript
import { MessagePattern, EventPattern } from '@fluojs/microservices';

export class OrderHandler {
  @MessagePattern('orders.create')
  async createOrder(data: CreateOrderDto) {
    // fluo가 하부 소켓 프레이밍과 직렬화를 처리합니다.
    return { id: 'order-123', status: 'pending' };
  }

  @EventPattern('orders.completed')
  async handleOrderCompleted(data: OrderCompletedEvent) {
    // fire-and-forget 이벤트입니다. 발행자에게 응답을 보내지 않습니다.
  }
}
```

패턴 이름이 계약이고, 트랜스포트는 단지 전달 수단일 뿐입니다. 덕분에 라우팅 결정이 코드 안에서 읽기 쉽게 유지되며, 테스트는 네트워크 절차가 아닌 비즈니스 로직에 집중할 수 있습니다.

### 1.2.2 Protocol Independence

이 추상화 덕분에 모듈의 트랜스포트 설정만 바꿔 TCP에서 Kafka, NATS, gRPC로 전환할 수 있습니다. 이것이 모든 트랜스포트가 똑같이 동작한다는 뜻은 아닙니다. TCP는 지연 시간에 최적화되어 있고 Kafka는 지속성에 최적화되어 있지만, *핸들러 인터페이스*가 안정적으로 유지된다는 뜻입니다.

fluo의 가치는 비즈니스 핸들러, DTO, DI 구조를 일관되게 유지하면서 연결마다 적절한 트랜스포트를 고를 수 있게 해준다는 점에 있습니다. 애플리케이션을 다시 만들지 않고도 인프라를 최적화할 자유를 얻게 됩니다.

## 1.3 Strategic Advantages

fluo의 마이크로서비스 모듈을 사용하면 다음과 같은 전략적 이점을 얻을 수 있습니다. 이 장점들은 단순히 API가 편하다는 수준을 넘어서, 서비스 수가 늘어날 때 팀이 같은 규칙으로 설계하고 운영할 수 있게 해줍니다.

- **Developer Velocity**: 소켓 관리나 브로커 전용 API에 신경 쓰지 않고 비즈니스 로직에 집중할 수 있습니다.
- **Operational Flexibility**: 개발 시에는 단순한 TCP로 시작하고, 운영 시에는 핸들러 수정 없이 지속성 있는 브로커로 업그레이드할 수 있습니다.
- **Safety Defaults**: fluo는 거대 패킷 보호(1MiB TCP 제한), 안전한 리소스 정리, 전달 혼동 방지 등 즉흥적인 구현에서 흔히 발생하는 문제들에 대한 방어책을 포함하고 있습니다.
- **Team Consistency**: 공통된 관례는 팀 간 조율 비용을 낮춥니다. 모든 서비스가 같은 핸들러 스타일을 사용하면 개발자는 도메인을 매끄럽게 오갈 수 있습니다.

## 1.4 Deep Dive into the Microservice Module

`MicroservicesModule`은 fluo 분산 기능의 핵심입니다. 이 모듈을 등록하면 들어오는 패킷을 처리하고 프로바이더에 디스패치하기 위한 인프라가 구성됩니다.

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, TcpMicroserviceTransport } from '@fluojs/microservices';

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: new TcpMicroserviceTransport({ port: 4000 })
    })
  ]
})
export class AppModule {}
```

이 구성은 앱을 트랜스포트에 바인딩합니다. fluo는 프로바이더에서 `@MessagePattern` 메서드를 찾아 트랜스포트 리스너에 연결합니다. 숨겨진 "리플렉션 마법"은 없습니다. 명시적인 프로바이더 조합을 통해 마이크로서비스도 fluo 생태계의 다른 요소와 같은 철학 위에 놓입니다.

## 1.5 The Philosophy of "No Magic"

편의성에도 불구하고 fluo는 "no magic" 철학을 고수합니다. 모든 컴포넌트는 명시적인 프로바이더입니다. 예를 들어 `MICROSERVICE` 토큰은 클라이언트 프록시를 주입할 때 사용됩니다. 분산 시스템에서 모호함은 비싼 대가를 치르게 합니다. 재시도 동작이나 의존성 생명주기가 프레임워크 마법 뒤에 숨어 있으면 프로세스 간 디버깅은 급격히 어려워집니다. fluo의 명시적 설정은 패턴 해석이 멈추거나 클라이언트 타임아웃이 발생했을 때 유지보수자가 어디를 봐야 하는지 좁혀 줍니다.

## 1.6 Why Microservices with fluo?

전통적인 프레임워크는 프로토콜 세부 사항을 비즈니스 로직에 노출하는 경우가 많습니다. REST로 시작했다가 나중에 브로커가 필요해지면 핸들러를 다시 써야 할 수 있습니다. fluo는 트랜스포트를 교체 가능한 드라이버로 다루어 이 마찰을 줄입니다.

멱등성, 전달 의미론, 관측 가능성 같은 운영상의 트레이드오프는 여전히 고려해야 하지만, 인프라가 바뀌었다고 해서 핸들러 시그니처를 다시 설계할 필요는 없습니다. FluoShop에서는 이 덕분에 학습 경로가 누적형이 됩니다. 2장은 TCP를, 3장은 Redis를 다루며 각 장은 이전 장의 기초 위에 쌓입니다.

## 1.7 Summary

- **Scalability**: 마이크로서비스는 독립적 확장을 가능하게 하지만 견고한 통신을 요구합니다.
- **FluoShop**: 다섯 서비스 토폴로지는 고급 패턴을 위한 현실적인 실습 환경을 제공합니다.
- **Abstraction**: fluo의 통일된 모델은 트랜스포트를 교체 가능한 드라이버로 다룹니다.
- **Patterns**: 요청에는 `@MessagePattern`, 이벤트에는 `@EventPattern`을 사용합니다.
- **Progression**: Part 1은 이 추상 아키텍처를 구체적이고 고성능인 트랜스포트 선택으로 바꿉니다.

서비스 지도를 먼저 정의한 뒤 배관을 최적화하기 위해 경계와 통신 방식을 먼저 골랐습니다. 실무에서도 이 순서가 더 안전합니다. 어떤 브로커를 쓸지보다 어떤 책임을 분리할지가 먼저 정해져야 이후의 트랜스포트 선택도 흔들리지 않습니다.

## 1.8 Next Chapter Preview

다음 장에서는 TCP 트랜스포트를 사용해 FluoShop의 첫 두 서비스를 연결합니다. fluo가 로우 소켓 위에서 데이터를 어떻게 프레이밍하는지, 호출자가 응답을 어떻게 상관관계로 묶는지, 실제 브로커를 도입하기 전에 어떤 안전 경계가 필요한지 확인합니다. 이 기초가 분명해지면 Redis나 Kafka로의 전환은 막연한 의존성 추가가 아니라 의도적인 전략 선택이 됩니다.
