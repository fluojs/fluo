<!-- packages: @fluojs/microservices -->
<!-- project-state: FluoShop v1.1.0 -->

# Chapter 2. TCP Transport

이 장은 FluoShop의 첫 실제 서비스 연결을 만들기 위해 TCP 트랜스포트를 설정하고 운영하는 방법을 설명합니다. Chapter 1에서 아키텍처 지도를 세웠다면, 이제 그 경계를 가장 단순한 요청 응답 링크로 구현해 이후 브로커 기반 장들과 비교할 기준선을 만듭니다.

## Learning Objectives
- `TcpMicroserviceTransport`로 TCP 마이크로서비스를 구성하는 방법을 익힙니다.
- `MICROSERVICE` 토큰과 `send()`를 사용해 서비스 간 요청 응답 흐름을 구현합니다.
- NDJSON 프레이밍이 TCP 기반 메시지 전달에 어떻게 쓰이는지 이해합니다.
- 프레임 크기 제한과 타임아웃이 TCP 운영 안전성에 왜 중요한지 분석합니다.
- FluoShop에서 Gateway와 Catalog 사이 연결에 TCP가 적합한 이유를 설명합니다.

## Prerequisites
- Chapter 1 완료.
- Node.js 소켓 통신과 요청 응답 패턴에 대한 기초 이해.
- TypeScript 비동기 처리와 `async`/`await` 문법에 익숙함.

## 2.1 Setting up a TCP Microservice

TCP로 마이크로서비스를 시작하는 절차는 단순합니다.

**FluoShop** 아키텍처에서 TCP는 내부적이고 지연 시간에 민감한 읽기 작업을 위한 기본 연결입니다. API Gateway는 페이지를 렌더링하기 전에 상품 상세 정보를 가져와야 하므로 Catalog Service와 직접적이고 빠른 통로가 필요합니다. TCP를 사용하면 이런 단순한 요청-응답 쌍에서 중간 브로커(middle-man broker)를 거치는 오버헤드를 피할 수 있습니다.

`MicroservicesModule` 내부에서 `TcpMicroserviceTransport`를 구성하면 됩니다.

이 트랜스포트는 호스트와 포트에 바인딩하고, 부트스트랩 중 서버 소켓을 열고, 클라이언트가 보내는 프레임 패킷을 받기 시작합니다.

FluoShop에서는 가장 먼저 Catalog Service를 TCP로 노출합니다. 카탈로그 조회는 빈도가 높고 지연에 민감하며, 요청-응답 모델을 설명하기에 가장 명확한 경로이기 때문입니다.

### 2.1.1 Server Configuration

서비스를 TCP로 접근 가능하게 만들려면 호스트와 포트에 바인딩합니다.

```typescript
import { Module } from '@fluojs/core';
import { MicroservicesModule, TcpMicroserviceTransport } from '@fluojs/microservices';
import { CatalogHandler } from './catalog.handler';

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: new TcpMicroserviceTransport({
        host: '0.0.0.0',
        port: 4000,
      }),
    }),
  ],
  providers: [CatalogHandler],
})
export class CatalogModule {}
```

이 설정에서 Catalog Service는 TCP 서버 역할을 합니다. fluo는 서버 수명 주기를 관리해 부트스트랩 중 포트를 열고 종료 시 안전하게 닫습니다. 이 통합은 개발과 운영 모두에서 중요합니다. 개발 단계에서는 별도의 소켓 부트 코드가 필요 없고, 운영 단계에서는 프레임워크가 정리 작업을 한 곳에서 조정할 수 있습니다. 헬스 체크, 배포, 롤링 재시작이 들어오면 이런 구조의 가치가 더 분명해집니다. 서비스 인스턴스가 시작될 때 트랜스포트는 단순히 포트만 여는 것이 아니라 fluo 런타임과 협력해 트래픽이 도착하기 전에 핸들러가 준비되었는지 확인합니다. 이 과정이 서비스 시작 직후 발생할 수 있는 "connection refused"나 "unhandled message" 오류를 줄입니다.

몇 가지 설정값은 따로 주목할 필요가 있습니다.

- `host`는 어떤 네트워크 인터페이스에 노출할지 결정합니다. Docker나 Kubernetes 같은 컨테이너 환경에서는 `0.0.0.0`으로 바인딩하는 것이 일반적입니다.
- `port`는 호출자가 기대할 서비스 계약을 정의합니다. FluoShop에서는 Catalog의 내부 인터페이스로 `4000`번 포트를 일관되게 사용합니다.
- provider 목록은 어떤 핸들러를 발견할 수 있는지 결정합니다. 핸들러는 TCP 트래픽을 받기 위해 `@MessagePattern` 또는 `@EventPattern` 데코레이터를 사용해야 합니다.

트랜스포트 자체는 얇게 유지하는 편이 좋습니다.

비즈니스 검증은 소켓 부트 코드가 아니라 핸들러와 도메인 서비스에 있어야 합니다.

## 2.2 Communicating Between Services

API Gateway처럼 시스템의 다른 부분에서 TCP 기반 서비스를 호출하려면 fluo의 `Microservice` 클라이언트 인터페이스를 사용합니다. FluoShop에서 API Gateway는 진입점입니다. 공용 인터넷에서 HTTP 요청을 받아 내부 TCP 메시지로 번역하며, 이 번역 계층에서 서비스 디스커버리나 로드 밸런싱 핸드오프가 주로 발생합니다. 이 클라이언트는 의도적으로 작고 단순하며 네트워크 호출이라는 사실을 숨기지 않습니다. 대신 패턴과 payload를 보내고, 응답 또는 오류를 예측 가능한 방식으로 기다릴 수 있게 합니다.

### 2.2.1 Injecting the Client

`MICROSERVICE` 토큰은 모듈에 설정된 트랜스포트 인스턴스에 접근할 수 있게 합니다.

```typescript
import { Inject } from '@fluojs/core';
import { MICROSERVICE, type Microservice } from '@fluojs/microservices';

export class CatalogClient {
  constructor(
    @Inject(MICROSERVICE) private readonly client: Microservice
  ) {}

  async getProduct(productId: string) {
    return await this.client.send('catalog.get', { productId });
  }
}
```

`send()` 메서드는 요청-응답 상관관계를 처리합니다. 호출자는 request ID, 소켓 리스너, 대기 중인 프라미스 맵을 직접 관리할 필요가 없습니다. 프레임워크가 그 일을 맡기 때문에 호출 코드는 도메인 동작에 집중할 수 있습니다. 내부적으로 fluo는 고유한 `requestId`를 생성하고, payload를 NDJSON 프레임으로 직렬화하며, 해당 응답을 위해 소켓에 일회성 리스너를 설정합니다. 타임아웃 윈도우 안에 응답이 도착하지 않으면 프라미스는 자동으로 거절됩니다. 그렇다고 이 호출이 로컬 함수가 되는 것은 아닙니다. 여전히 네트워크 호출이며, 호출자는 타임아웃 예산, 폴백 동작, 원격 서비스 비가용 상황을 설계해야 합니다. FluoShop에서 Catalog Service가 느려지면 Gateway가 사용자의 브라우저 연결을 무기한 잡고 있어서는 안 됩니다. 그래서 빠른 실패를 보장하기 위해 클라이언트 측에 엄격한 `requestTimeoutMs`를 설정합니다.

FluoShop에서는 API Gateway가 이런 방식으로 읽기 중심의 카탈로그 조회를 수행합니다.

주문 경로 역시 시스템이 단순한 동안은 TCP로 시작할 수 있습니다.

하지만 이후에는 실패에 더 민감한 워크플로를 durable transport로 옮기게 됩니다.

## 2.3 Delivery Safety and Constraints

TCP는 신뢰할 수 있는 트랜스포트이지만 메시지 지속성을 제공하지는 않습니다.

대상 서비스가 내려가 있으면 메시지를 중간에 안전하게 저장해 두었다가 나중에 처리할 수 없습니다.

그래서 TCP는 온라인 요청 경로에는 좋지만, 서비스 재시작을 견뎌야 하는 워크플로에는 약합니다.

fluo는 기본적인 TCP 통신이 운영상 무모해지지 않도록 안전 장치를 더합니다.

### 2.3.1 Frame Size Limits

기본적으로 fluo는 TCP 프레임 크기를 1 MiB로 제한합니다.

이 제한은 단일 악성 요청이나 과도하게 큰 요청이 서비스 메모리를 소진시키는 일을 막아 줍니다.

패킷이 이 한계를 넘으면 fluo는 프로세스를 보호하기 위해 즉시 소켓을 닫습니다.

이 제한은 단순한 보안 디테일이 아니라 아키텍처적 힌트이기도 합니다. 서비스가 자주 1 MiB 한계에 가까워진다면 문제는 대개 계약 설계에 있습니다. 잘못된 채널로 바이너리 데이터를 보내고 있을 수 있는데, TCP는 신호 전달과 작은 데이터 전송을 위한 것이므로 큰 이미지나 PDF는 오브젝트 스토리지(예: S3)를 통해 처리하고 TCP 메시지는 URI만 실어 날라야 합니다. 과도한 데이터를 한 번에 조회하고 있을 수도 있으며, 단일 TCP 프레임에 10,000개의 상품 목록을 담아 반환하는 것은 높은 지연 시간과 메모리 압박의 원인이 됩니다. 또는 동기 링크에 남아 있어야 할 계약보다 배치 성격의 동작을 억지로 밀어 넣고 있을 수도 있습니다. FluoShop의 카탈로그 조회는 작고 예측 가능해야 하며, 식별자, 상품 메타데이터, 재고 플래그는 프레임 경계 안에 자연스럽게 들어가지만 대용량 미디어 자산은 그렇지 않습니다.

### 2.3.2 Timeouts and Retries

TCP는 점대점 방식이므로 호출자는 수신자의 가용성에 의존합니다.

요청 타임아웃을 설정하면 게이트웨이가 무기한 대기하지 않도록 할 수 있습니다.

```typescript
new TcpMicroserviceTransport({
  port: 4000,
  requestTimeoutMs: 5000,
})
```

타임아웃은 기술적 설정이면서 비즈니스 결정입니다. 너무 짧으면 일시적인 지연 스파이크가 사용자 실패로 확대됩니다. 예를 들어 Catalog Service에서 50ms의 가비지 컬렉션 일시 중지가 발생했는데 Gateway의 타임아웃이 100ms라면 정상적인 변동도 실패로 보일 수 있습니다. 너무 길면 더 이상 의미 없는 응답을 기다리느라 리소스를 묶어 둡니다. 사용자가 2초 안에 페이지를 보길 기대하는데 TCP 타임아웃이 10초라면 사용자 관점에서는 사실상 장애와 다르지 않습니다. 재시도 역시 맥락 의존적입니다. `catalog.get` 같은 멱등적인 읽기에는 대개 재시도가 안전하므로 첫 번째 시도가 타임아웃되면 Gateway가 즉시 다시 시도할 수 있습니다. 반면 상태를 바꾸는 작업(예: `order.place`)은 멱등성 보호 없이 재시도하면 중복 실행이 발생해 고객에게 요금이 두 번 청구될 수도 있습니다. 그래서 이 장은 TCP를 주로 카탈로그 조회로 소개합니다. 이 트랜스포트가 가장 자연스럽게 맞는 경로이기 때문입니다.

## 2.4 Understanding NDJSON Framing

fluo의 TCP 트랜스포트는 프레이밍을 위해 NDJSON을 사용합니다.

각 JSON 객체 뒤에는 `\n` 문자가 붙습니다.

이 방식은 하나의 소켓 위로 여러 JSON 객체를 스트리밍하기 위한 표준적이고 가벼운 접근입니다.

```json
{"kind":"message","pattern":"catalog.get","payload":{"productId":"123"},"requestId":"abc-123"}\n
```

수신 측에서 fluo는 개행 문자를 만날 때까지 들어온 데이터를 버퍼링합니다.

그 시점에 버퍼된 바이트를 JSON으로 파싱하고, 적절한 핸들러로 패킷을 디스패치합니다. 이 메커니즘은 `TcpMicroserviceTransport.bindSocketParser`에서 확인할 수 있는데, 여기서 버퍼는 각 `\n`을 기준으로 잘립니다. 단일 라인이 `maxFrameBytes`(1 MiB)를 초과하면 메모리 소진 공격을 방지하기 위해 소켓을 파괴합니다.

장점은 분명합니다.

- 프레이밍 포맷을 직접 확인하기 쉽습니다. `telnet`이나 `nc`(netcat) 같은 도구로 서비스를 디버깅할 수 있습니다.
- 표준 소켓 도구로 로컬 디버깅이 단순합니다.
- HTTP/1.1이나 무거운 SOAP 엔벨로프에 비해 프로토콜 오버헤드가 낮습니다.

트레이드오프도 분명합니다.

- payload는 텍스트 친화적인 JSON이어야 합니다.
- 개행 구분 프레이밍은 본문 직렬화가 깔끔하다는 가정을 둡니다.
- 이 트랜스포트는 임의의 인터넷 클라이언트보다 내부 서비스 트래픽에 최적화되어 있습니다.

FluoShop에서 NDJSON은 실용적인 선택입니다.

시스템의 초기 단계와 잘 맞기 때문입니다.

우리는 아직 브로커의 풍부한 기능보다 명확성과 낮은 운영 비용을 더 중요하게 봅니다.

## 2.5 Error Handling in TCP

원격 핸들러가 에러를 던지면 TCP 트랜스포트는 에러 메시지를 캡처해 에러 프레임으로 호출자에게 되돌려 보냅니다.

```json
{"requestId":"abc-123","error":"Product not found"}\n
```

그러면 `client.send()`는 해당 에러와 함께 프라미스를 거절하고, 덕분에 로컬 예외와 비슷한 제어 흐름 스타일로 원격 실패를 다룰 수 있습니다. 그래도 원격 에러는 같은 프로세스 안의 검증 에러와는 구분해서 생각해야 하며, 호출자는 최소한 세 가지를 질문해야 합니다.

- 원격 서비스가 의도적으로 요청을 거절한 것인가? (예: "잘못된 상품 ID")
- 요청 완료 전에 네트워크가 실패한 것인가? (예: "Connection reset by peer")
- 게이트웨이가 이 원시 메시지를 그대로 외부 클라이언트에 보여줘도 되는가?

FluoShop에서 게이트웨이는 트랜스포트 수준 실패를 안정적인 API 오류로 매핑해야 합니다.

그래야 경계가 깔끔하게 유지됩니다.

클라이언트는 상품 누락이 원격 TCP 핸들러에서 왔는지, 로컬 함수에서 왔는지 알 필요가 없습니다.

## 2.6 Scaling TCP Services

TCP는 점대점 프로토콜이므로 확장은 대개 로드 밸런서나 서비스 디스커버리 계층을 필요로 합니다.

현대적인 환경에서 API Gateway는 단일 IP 주소에 연결하지 않습니다. 인프라가 제공하는 안정적인 DNS 이름에 연결합니다.

- **Kubernetes Service**: `ClusterIP` 서비스는 여러 Catalog 파드(Pod)에 대해 부하 분산을 수행하는 단일 IP를 제공합니다.
- **Service Mesh**: Istio나 Linkerd 같은 도구는 사이드카 수준에서 재시도와 mTLS를 처리할 수 있습니다.
- **Classic Proxy**: NGINX나 HAProxy는 TCP 수준 프록시(Layer 4 로드 밸런싱) 역할을 할 수 있습니다.

클라이언트 측 로드 밸런싱도 가능하지만 애플리케이션 복잡도가 증가합니다.

운영 관점에서 TCP 확장은 보통 브로커가 대신 답해 주는 질문들을 다시 꺼내게 만듭니다.

- 클라이언트는 건강한 인스턴스를 어떻게 발견할까?
- 배포 중 트래픽을 어떻게 비울까? Catalog 파드가 종료될 때, 새로운 TCP 연결 수락은 중단하되 기존 연결은 처리를 마쳐야 합니다.
- 재연결 폭주를 어떻게 막을까? Catalog 클러스터가 재시작되면 수천 개의 Gateway 연결이 동시에 재연결을 시도할 수 있습니다.

이 문제들은 해결 가능합니다. 다만 핵심 트랜스포트 추상화 바깥에 있다는 점이 중요합니다. FluoShop의 초기 단계에서는 이것으로 충분한데, 첫 번째 분산 링크를 이해 가능하게 유지하는 것이 우선이기 때문입니다. 시스템이 커지면 이런 조정 일부를 인프라가 맡아 주는 트랜스포트를 도입하게 됩니다.

## 2.7 FluoShop Implementation: Gateway and Catalog

FluoShop에서는 API Gateway와 Catalog Service 사이의 트래픽이 많은 연결에 TCP를 사용합니다.

1. **Catalog Service**: 상품 메타데이터를 반환하는 `catalog.get` 패턴을 구현합니다. 4000번 포트에서 리스닝합니다.
2. **API Gateway**: 들어오는 `/products/:id` HTTP 요청을 TCP 트랜스포트를 통해 Catalog Service로 전달합니다.

이 구성은 시스템에서 가장 빈번한 작업 중 하나인 상품 조회에 대해 낮은 실용적 오버헤드를 제공합니다. 동시에 요청-응답 마이크로서비스 통신의 명확한 예제가 됩니다. 고객이 상품 페이지를 열 때 게이트웨이에는 durable event delivery가 필요하지 않고 빠른 응답이 필요합니다. 카탈로그 서비스가 내려가 있다면 요청은 빠르고 분명하게 실패해야 하며, TCP는 바로 그런 상호작용을 잘 모델링합니다. 그래서 이 장은 FluoShop을 아키텍처 설명 단계에서 실제 서비스 연결 단계로 전진시킵니다. 다음 장은 이 기준선 위에 느슨하게 결합되고 신뢰성 지향적인 통신을 추가합니다.

## 2.8 Summary

- **Simplicity**: TCP는 설정이 쉽고 외부 브로커가 필요 없습니다.
- **Low Latency**: 로우 소켓 위 NDJSON은 내부 통신 오버헤드를 최소화합니다.
- **Synchronous Logic**: 즉시 결과가 필요한 요청-응답 흐름에는 `send()`를 사용합니다.
- **Safety Boundaries**: fluo의 1 MiB 프레임 제한은 오버플로 발생 시 소켓을 닫아 메모리 기반 남용을 방지합니다.
- **Point-to-Point**: TCP는 대상 서비스가 알려진 주소에서 도달 가능하거나 로드 밸런서를 통해 접근 가능해야 합니다.
- **Progression**: FluoShop에서는 TCP가 게이트웨이와 카탈로그 도메인 사이의 첫 실제 연결을 만듭니다.

가장 중요한 교훈은 TCP가 언제나 최고라는 점이 아닙니다.

오히려 TCP의 한계가 문제와 잘 맞을 때 가장 좋다는 점입니다.

우리는 직접 도달 가능성, 빠른 실패, 낮은 지연이 중요한 곳에서 TCP를 사용합니다.

반대로 지속성과 비동기 복구가 더 중요해질 영역에는 아직 사용하지 않습니다.

## 2.9 Next Chapter Preview

다음 장에서는 비동기 이벤트와 durable communication을 위해 Redis를 메시지 브로커로 도입합니다.

그 시점부터 시스템의 성격이 달라집니다.

이제는 "서비스 A가 지금 당장 서비스 B에 도달할 수 있는가?"만이 아니라,

"이 워크플로가 지연, 재생, 컨슈머 실패를 견딜 수 있는가?"도 함께 묻게 됩니다.

그 변화가 FluoShop을 단순한 서비스 호출 모음에서 더 회복력 있는 분산 애플리케이션으로 바꿔 줍니다.
