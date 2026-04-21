<!-- packages: @fluojs/microservices -->
<!-- project-state: FluoShop v1.0.0 -->

# 1. Microservice Architecture and fluo Strategy

마이크로서비스는 크고 복잡한 애플리케이션을 네트워크를 통해 통신하는 작고 독립적인 서비스들로 분해합니다. 마이크로서비스가 주는 확장성과 독립적 배포의 이점은 잘 알려져 있지만, 그 결과로 발생하는 네트워크 복잡성을 관리하는 비용은 종종 과소평가되곤 합니다.

fluo는 비즈니스 로직을 한 번 작성하면 다양한 트랜스포트 프로토콜에 걸쳐 배포할 수 있는 통일된 프로그래밍 모델을 제공합니다. 이 장에서는 fluo 마이크로서비스 전략의 핵심 철학을 소개하고, 이 책 전반에 걸쳐 구축할 **FluoShop** 프로젝트의 기반을 마련합니다. FluoShop은 장을 거듭하며 진화하는 이커머스 백엔드 프로젝트입니다.

이 첫 장의 목표는 마이크로서비스를 장밋빛으로 포장하는 것이 아닙니다. 마이크로서비스가 어디에서 도움이 되고 어디에서 비용이 발생하는지 정의하고, fluo가 모듈형 모놀리스에서 네트워크 서비스로 이동할 때 발생하는 "분산 시스템 세금(distributed systems tax)"을 어떻게 낮추는지 설명하는 것이 목표입니다. 이 장을 마칠 때쯤이면 여러분은 FluoShop의 토폴로지를 이해하고, 왜 트랜스포트 독립성이 장기적인 진화를 위한 전략적 요구 사항인지 이해하게 될 것입니다.

## 1.1 The FluoShop Topology

이 책을 통해 우리는 실무 마이크로서비스 패턴을 보여주기 위해 설계된 단계적 이커머스 프로젝트인 **FluoShop**을 구축할 것입니다. 우리의 아키텍처는 각기 특정 도메인을 담당하는 다섯 개의 핵심 서비스로 구성됩니다.

1. **API Gateway**: 모든 클라이언트 요청의 진입점입니다. 라우팅, 인증, 요청 집계를 담당합니다.
2. **Catalog Service**: 상품 정보, 카테고리, 재고 수준을 관리하며 높은 조회 성능을 강조합니다.
3. **Order Service**: 아키텍처의 조정 중심이 됩니다. 주문 생성, 상태 전환, 서비스 간 조율을 담당합니다.
4. **Payment Service**: 결제 트랜잭션과 외부 업체 연동을 관리합니다. 엄격한 실패 규칙이 필요한 고위험 도메인입니다.
5. **Notification Service**: 이메일과 알림을 발송합니다. 메인 요청 경로와 분리되어야 하는 다운스트림 소비자를 대표합니다.

이 토폴로지는 빠르게 이해할 수 있을 만큼 작으면서도, 실제 운영 환경에서 중요한 경계들을 드러낼 만큼 충분히 풍부합니다. 게이트웨이는 클라이언트 지향 프로토콜 문제를 맡고, 주문 서비스는 복잡한 비즈니스 워크플로를 관리합니다.

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

이것은 도메인 관계를 보여주는 지도입니다. 어떤 상호작용은 즉각적인 데이터를 위한 직접 요청이고, 어떤 상호작용은 백그라운드 처리를 위한 fire-and-forget 이벤트입니다. 나중에 우리는 신뢰성이 지연 시간보다 중요해질 때 이러한 연결이 어떻게 지속성 있는 브로커 기반 흐름으로 진화하는지 보게 될 것입니다.

## 1.2 Unified Programming Model

fluo에서 마이크로서비스의 비즈니스 로직은 기본 네트워크 프로토콜과 분리되어 있습니다. 핸들러 내부에 트랜스포트 전용 코드를 작성하지 않습니다. 대신 데코레이터로 메시지 패턴을 정의하고, 트랜스포트 어댑터가 프레이밍, 직렬화, 전달 메커니즘을 처리하게 합니다.

이 분리는 트랜스포트 변경이 흔하기 때문에 중요합니다. 팀은 종종 직접적인 서비스 간 네트워킹(TCP/gRPC)으로 시작했다가, 나중에 재시도, 지속성, fan-out이 필요하다는 사실을 깨닫고 브로커(Kafka/RabbitMQ)를 도입합니다. 애플리케이션 코드가 특정 클라이언트 라이브러리에 묶여 있다면 마이그레이션은 재작성이 됩니다. 하지만 트랜스포트가 교체 가능한 어댑터라면 마이그레이션은 설정 변경이 됩니다.

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

fluo의 마이크로서비스 모듈을 사용하면 다음과 같은 전략적 이점을 얻을 수 있습니다.

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

이 구성은 앱을 트랜스포트에 바인딩합니다. fluo는 프로바이더에서 `@MessagePattern` 메서드를 찾아 트랜스포트 리스너에 연결합니다. 숨겨진 "리플렉션 마법"은 없습니다. 명시적인 프로바이더 조합을 통해 마이크로서비스를 fluo 생태계의 다른 요소들과 동일한 철학 위에 올려놓습니다.

## 1.5 The Philosophy of "No Magic"

편의성에도 불구하고 fluo는 "no magic" 철학을 고수합니다. 모든 컴포넌트는 명시적인 프로바이더입니다. 예를 들어 `MICROSERVICE` 토큰은 클라이언트 프록시를 주입할 때 사용됩니다.

분산 시스템에서 모호함은 비싼 대가를 치르게 합니다. 재시도 동작이나 의존성 생명주기가 프레임워크 마법 뒤에 숨어 있으면 프로세스 간 디버깅은 악몽이 됩니다. fluo의 명시적 설정은 패턴 해석이 멈추거나 클라이언트 타임아웃이 발생했을 때 유지보수자가 정확히 어디를 봐야 하는지 보장합니다.

## 1.6 Why Microservices with fluo?

전통적인 프레임워크는 프로토콜 세부 사항을 비즈니스 로직에 노출하곤 합니다. REST로 시작했다가 나중에 브로커가 필요해지면 핸들러를 다시 써야 하는 경우가 많습니다. fluo는 트랜스포트를 교체 가능한 드라이버로 다루어 이 마찰을 크게 줄여줍니다.

멱등성, 전달 의미론, 관측 가능성 같은 운영상의 트레이드오프는 여전히 고려해야 하지만, 인프라가 바뀌었다고 해서 핸들러 시그니처를 다시 설계할 필요는 없습니다. FluoShop에서는 이 덕분에 학습 경로가 누적형이 됩니다. 2장은 TCP를, 3장은 Redis를 다루며 각 장은 이전 장의 기초 위에 쌓입니다.

## 1.7 Summary

- **Scalability**: 마이크로서비스는 독립적 확장을 가능하게 하지만 견고한 통신을 요구합니다.
- **FluoShop**: 다섯 서비스 토폴로지는 고급 패턴을 위한 현실적인 실습 환경을 제공합니다.
- **Abstraction**: fluo의 통일된 모델은 트랜스포트를 교체 가능한 드라이버로 다룹니다.
- **Patterns**: 요청에는 `@MessagePattern`, 이벤트에는 `@EventPattern`을 사용합니다.
- **Progression**: Part 1은 이 추상 아키텍처를 구체적이고 고성능인 트랜스포트 선택으로 바꿉니다.

우리는 서비스 지도를 먼저 정의하고 나서 배관을 최적화하기 위해 경계와 통신 방식을 먼저 골랐습니다. 이것이 올바른 순서입니다.

## 1.8 Next Chapter Preview

다음 장에서는 TCP 트랜스포트를 사용해 FluoShop의 첫 두 서비스를 구축해 봅니다. fluo는 로우 소켓 위에서 데이터를 어떻게 프레이밍할까요? 호출자는 응답을 어떻게 상관관계로 묶을까요? 실제 브로커를 도입하기 전에 어떤 안전 경계가 존재할까요? 이 기초가 분명해지면 Redis나 Kafka로의 업그레이드는 막연한 의존성이 아니라 의도적인 전략적 선택이 됩니다.
