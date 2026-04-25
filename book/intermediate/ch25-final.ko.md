<!-- packages: @fluojs/core, @fluojs/runtime, @fluojs/microservices -->
<!-- project-state: FluoShop v3.0.0 -->

# Chapter 25. FluoShop Completed — Service Mesh Strategy

이 장은 Intermediate 볼륨 전체에서 확장해 온 FluoShop 아키텍처를 마무리하며 서비스 메시 전략까지 한 번에 정리합니다. Chapter 24가 엣지 배포까지 이식성을 밀어붙였다면, 이 장은 여러 런타임과 서비스를 함께 운영하는 최종 그림을 회고하고 다음 단계로 연결합니다.

## Learning Objectives
- FluoShop의 최종 멀티 런타임 아키텍처를 서비스별로 설명합니다.
- 분산 시스템이 커질수록 왜 서비스 메시가 필요한지 이해합니다.
- fluo의 전송 계층과 서비스 메시가 서로 다른 책임을 나누는 방식을 정리합니다.
- OpenTelemetry 기반 관측 가능성을 최종 운영 구조와 연결해 살펴봅니다.
- Intermediate 볼륨 전반에서 배운 이식성, 계약, 명시성 원칙을 회고합니다.
- FluoShop을 실제 운영 환경으로 확장할 때 점검할 후속 과제를 확인합니다.

## Prerequisites
- Chapter 21, Chapter 22, Chapter 23, Chapter 24 완료.
- Intermediate 볼륨 전반의 마이크로서비스, 이벤트, 실시간 통신 흐름 복습.
- 서비스 디스커버리, 트레이싱, 운영 자동화 같은 분산 시스템 기본 개념 이해.

## 25.1 The Final FluoShop Architecture

완성된 FluoShop 시스템은 각 도메인의 요구에 맞는 런타임에서 실행되는 서비스들의 집합입니다. 중요한 기준은 유행하는 플랫폼을 고르는 것이 아니라, 서비스 책임과 운영 제약을 맞추는 것입니다.

- **Core API Gateway**: 들어오는 HTTP/GraphQL 요청을 처리하고 적절한 서비스로 라우팅합니다. 사용자와 가까운 위치에서 응답해야 하므로 **Cloudflare Workers**에서 실행합니다.
- **Product Service**: MongoDB를 사용하여 카탈로그 데이터를 관리하고 WebSockets를 통해 실시간 업데이트를 제공합니다. 고성능 데이터 서빙과 네이티브 WebSocket 지원을 위해 **Bun**에서 실행됩니다.
- **Order Service**: Drizzle과 PostgreSQL을 사용하여 트랜잭션과 영속성을 처리합니다. 데이터베이스 드라이버 호환성과 운영 예측 가능성을 위해 **Express와 함께 Node.js**에서 실행합니다.
- **Notification Service**: 도메인 이벤트를 기반으로 이메일, Slack 알림, 푸시 알림을 오케스트레이션합니다.
- **Background Worker**: RabbitMQ/Kafka를 통해 무거운 작업, 이미지 처리, 보고서 생성을 관리합니다.

이런 멀티 런타임 접근 방식은 fluo의 이식성 원칙을 운영 구조로 옮긴 결과입니다. 코드는 특정 실행 환경에 묶이지 않지만, 각 서비스의 운영 조건은 명확히 문서화되어야 합니다.

## 25.2 The Challenge of Distributed Systems

서비스 수가 늘어나고 Node, Bun, Workers가 섞이면 다음 운영 문제가 전면에 등장합니다.
- **Service Discovery**: 한 서비스가 다른 서비스의 동적으로 할당된 IP나 내부 URL을 어떻게 찾는가?
- **Load Balancing**: 동일한 서비스의 여러 인스턴스에 트래픽을 어떻게 분산하는가?
- **Resiliency**: 부분적인 실패, 네트워크 지터, 타임아웃을 어떻게 예측 가능하게 처리하는가?
- **Observability**: 5개의 서로 다른 서비스와 3개의 서로 다른 런타임을 거치는 단일 요청을 어떻게 추적하는가?
- **Security**: 인증서를 수동으로 관리하지 않고 모든 서비스 간의 암호화된 통신(mTLS)을 어떻게 보장하는가?

## 25.3 fluo and the Service Mesh

서비스 메시는 서비스 간 통신을 다루는 전용 인프라 계층입니다. fluo는 서비스 메시를 대체하지 않으며, 메시와 충돌하지 않도록 애플리케이션 계약을 명확히 유지합니다. 메시는 네트워크 경로를 맡고 fluo는 애플리케이션 로직과 데이터 계약을 맡습니다.

### 25.3.1 Sidecar Pattern

Istio와 같은 전형적인 서비스 메시 설정에서 각 fluo 서비스는 "사이드카(Sidecar)" 프록시(보통 Envoy)를 가집니다. 인바운드와 아웃바운드 네트워크 트래픽은 이 프록시를 통과합니다. 애플리케이션은 비즈니스 요청을 처리하고, 사이드카는 네트워크 보안과 라우팅 정책을 대신 적용합니다.

- **Outgoing**: 서비스 A가 `http://order-service/api`를 호출합니다. 사이드카가 이를 가로채서 서비스 디스커버리 레지스트리에서 대상을 찾고, 로드 밸런싱과 재시도를 처리합니다.
- **Incoming**: 사이드카가 요청을 수신하고, TLS 종료를 처리하며, 호출자의 신원을 확인한 후 `localhost`에 있는 fluo 애플리케이션으로 전달합니다.

### 25.3.2 fluo's Contribution to Resiliency

메시가 인프라 수준의 재시도와 서킷 브레이킹을 처리하는 동안, fluo는 애플리케이션 수준에서 **동작 계약(Behavioral Contract)**을 처리합니다.

```typescript
@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: new TcpMicroserviceTransport({
        host: 'order-service-mesh',
        port: 80,
        requestTimeoutMs: 1_000,
      }),
    })
  ]
})
export class GatewayModule {}
```

fluo의 `MicroservicesModule.forRoot(...)`와 `TcpMicroserviceTransport`를 사용하면 연결이 메시에 의해 가로채지든 직접 IP를 호출하든 애플리케이션 코드는 같은 전송 계약을 유지합니다. fluo는 송수신 데이터가 예상된 계약을 따르도록 돕고, 메시는 트래픽이 목적지까지 가는 네트워크 경로를 관리합니다.

## 25.4 Observability with fluo and OpenTelemetry

디버깅과 성능 튜닝을 위해 여러 런타임(Node, Bun, Workers)에 걸친 요청을 추적하는 것은 필수적입니다. fluo에서는 이런 관측 가능성을 단일 트레이싱 플래그보다, 실제 런타임에 붙는 메트릭과 헬스 구성을 명시적으로 유지하는 쪽이 더 정직한 문서화입니다.

```typescript
@Module({
  imports: [
    MetricsModule.forRoot(),
    TerminusModule.forRoot({
      indicators: [new MemoryHealthIndicator({ key: 'memory', rssThresholdBytes: Number.MAX_SAFE_INTEGER })],
    }),
  ],
})
export class ObservabilityModule {}
```

게이트웨이(Workers)가 주문 서비스(Node)를 호출할 때도, 각 서비스는 자신이 실제로 노출하는 `/metrics`, `/health`, `/ready` 같은 운영 표면을 통해 상태를 드러내야 합니다. 분산 추적을 추가하더라도 이런 런타임 계약이 먼저 명확해야 전체 요청 흐름을 안정적으로 읽을 수 있습니다.

## 25.5 Final Architecture Review: The "Fluo Way"

FluoShop의 성공은 이 책 전반에서 강조한 세 가지 기둥 위에 세워졌습니다. 이 기둥들은 특정 패키지 사용법보다 더 오래 남는 설계 기준이며, 새로운 런타임이나 메시징 도구를 선택할 때도 같은 판단 기준으로 작동합니다.

1. **Explicit Dependency Injection**: 숨겨진 마법을 줄이고 의존성의 출처를 코드에서 드러냅니다. 이 구조는 감사와 테스트를 쉽게 만듭니다.
2. **Behavioral Contracts**: 런타임이 달라져도 같은 의미로 동작해야 하는 패턴을 계약으로 고정합니다. 환경 변화가 곧 로직 변경이 되지 않게 합니다.
3. **Platform Agnosticism**: 플랫폼 선택을 애플리케이션 로직과 분리합니다. 로컬 서버, 컨테이너, 엣지 런타임을 같은 설계 원칙으로 비교할 수 있습니다.

## 25.6 Scaling to the Future

FluoShop의 다음 단계는 운영 성숙도에 맞춰 선택할 수 있습니다. 이 책을 넘어서 다음 주제를 검토해 보세요. 중요한 것은 모든 기술을 한 번에 추가하는 것이 아니라, 현재 병목과 팀의 운영 역량에 맞춰 순서를 정하는 것입니다.
- **Global Data Replication**: 멀티 리전 데이터 영속성을 위해 D1 또는 Fly.io Postgres를 사용합니다.
- **Advanced CQRS**: 모든 주문 변경의 전체 감사 로그를 위해 불변의 이벤트 소싱으로 전환합니다.
- **AI Integration**: fluo의 모듈성을 활용하여 LLM 기반 제품 추천이나 자동화된 고객 지원 기능을 추가합니다.
- **Custom Adapters**: 특수 하드웨어나 신규 런타임을 위한 자체 fluo 어댑터를 구축합니다.

## 25.7 Conclusion

중수편의 마지막에 도달했습니다. 이제 fluo를 사용해 복잡한 TypeScript 백엔드를 구축하고, 확장하고, 이식하는 핵심 흐름을 다뤘습니다. 서로 다른 런타임의 차이와 표준 우선 아키텍처가 주는 운영상의 이점도 확인했습니다.

FluoShop은 단순한 예제를 넘어, 서비스가 커질 때 어떤 경계를 먼저 고정해야 하는지 보여주는 설계 연습입니다. 작게 시작한 애플리케이션이 제어력을 잃지 않고 여러 런타임과 배포 모델로 확장되는 과정을 확인했습니다.

---

*이후 섹션은 중수편 전체에서 얻은 설계 판단과 운영 체크포인트를 정리합니다.*

여정을 되돌아보면, 1장에서 단일 모듈과 몇 개의 컨트롤러로 시작했습니다. 그 후 2장에서 마이크로서비스와 TCP 전송을, 4장에서 메시징 패턴을, 9장에서 이벤트 기반 로직을 도입했습니다. 13장에서 WebSockets를 통한 실시간 기능을 추가하고, 마지막 6부에서는 여러 런타임으로 같은 로직을 옮기는 방법을 다뤘습니다.

이 과정 전반에서 fluo의 핵심 원칙인 '마법보다는 명시성'과 '표준 우선 설계'는 일관되게 유지되었습니다. `experimentalDecorators`나 레거시 리플렉션에 기대지 않고 TC39 표준을 따른 이유도 여기에 있습니다. 언어 표준에 가까운 코드는 장기 유지보수에서 더 예측 가능한 선택지가 됩니다.

이 접근 방식 덕분에 구현 세부 사항에 압도되지 않고 복잡한 시스템을 관리할 수 있었습니다. 로직을 플랫폼 및 전송 계층에서 분리하면 Kafka를 RabbitMQ로, Fastify를 Bun으로 교체할 때 변경 범위를 어댑터와 운영 설정에 묶어둘 수 있습니다.

앞으로 아키텍처는 계속 변합니다. FluoShop을 위해 내린 결정은 현재의 요구를 기준으로 하지만, fluo의 원칙은 환경이 바뀌어도 적응할 수 있는 여지를 남깁니다. 새로운 런타임, 데이터베이스, 통신 표준이 등장하더라도 기초가 표준과 명시적 계약 위에 있으면 변경 비용을 통제하기 쉽습니다.

## 25.8 Final Lessons Learned

이 책을 통해 우리는 몇 가지 중요한 교훈을 배웠습니다. 각각은 FluoShop 예제에만 머무르지 않고, 다른 백엔드 시스템을 설계할 때도 반복해서 확인해야 할 기준입니다.
- **Abstractions Matter**: fluo 어댑터처럼 적절한 수준의 추상화를 선택하면 런타임 교체 시 변경 범위를 줄일 수 있습니다.
- **Testing is Non-Negotiable**: 분산 시스템에서 통합 테스트와 계약 테스트는 안전망입니다. fluo의 테스트 유틸리티는 여러 서비스에 걸친 시나리오를 검증하는 데 도움이 됩니다.
- **Standards are your Friend**: TC39 데코레이터와 웹 API(fetch, Request, Response)를 따르면 코드가 표준 런타임으로 이동하기 쉬워집니다.
- **DI is for Scalability**: 의존성 주입은 테스트만을 위한 장치가 아닙니다. 컴포넌트 결합도를 낮게 유지하고 성장하는 코드베이스의 복잡성을 관리하기 위한 구조입니다.

## 25.9 FluoShop Repository Structure (Final)

`pnpm workspaces`를 기반으로 한 fluo 모노레포 구조는 다음처럼 잡을 수 있습니다.

```text
fluoshop-workspace/
├── apps/
│   ├── api-gateway/         (Cloudflare Workers - 엣지 게이트웨이)
│   ├── order-service/       (Node.js + Express - 트랜잭션 로직)
│   ├── product-service/     (Bun - 고성능 카탈로그)
│   └── background-worker/   (Node.js + Fastify - 배치 처리)
├── libs/
│   ├── shared-dto/          (공유 타입 정의 및 DTO)
│   ├── database-schema/     (공유 DB용 Drizzle 스키마)
│   └── common-utils/        (유틸리티, 로거 설정, 공유 데코레이터)
├── packages/                (커스텀 fluo 확장 또는 공유 플러그인)
├── infra/                   (Terraform, Wrangler 설정, K8s 매니페스트)
└── pnpm-workspace.yaml      (모노레포 설정)
```

이 구조는 서비스별 배포 주기를 분리하면서 공유 타입, 스키마, 유틸리티를 한 저장소 안에서 관리할 수 있게 합니다. 서비스 경계와 공유 패키지 경계가 함께 보이기 때문에, 변경 영향 범위도 더 쉽게 추적할 수 있습니다.

## 25.10 Closing Thoughts

백엔드 런타임의 경계는 계속 변하고 있습니다. 엣지는 더 이상 별도 실험 영역이 아니라 실제 서비스 선택지 중 하나가 되었습니다. fluo는 이런 변화 속에서 도메인 로직을 안정적으로 유지하고, 플랫폼 선택을 명시적으로 비교할 수 있게 돕는 프레임워크입니다.

## 25.11 Key Takeaways

- FluoShop은 이제 Node, Bun, Workers의 강점을 활용하는 완성된 분산 멀티 런타임 시스템입니다.
- 서비스 메시 전략(Istio/Linkerd)은 서비스 디스커버리와 보안의 인프라 수준 복잡성을 처리합니다.
- 사이드카 프록시(Envoy)는 네트워크 "배관"을 관리하고 fluo는 애플리케이션 "로직"을 관리합니다.
- OpenTelemetry 같은 분산 추적은 서로 다른 런타임을 지나는 요청을 이해하는 데 필요합니다.
- fluo의 명시적 DI와 동작 계약은 확장성과 장기 유지보수성의 기반입니다.
- 표준 우선 아키텍처는 fluo 코드에 대한 투자가 특정 런타임에 갇히지 않도록 돕습니다.
- 이제 커스텀 런타임 개발, 프레임워크 내부 구조, fluo 생태계 기여를 다루는 **고수편(Advanced level)**으로 넘어갈 준비가 되었습니다.
- 중수편은 프로덕션 수준 TypeScript 백엔드에 필요한 주요 설계 경계를 다뤘습니다.
- 아키텍처는 선택의 기록이며, fluo는 프로젝트에 맞는 선택을 명시적으로 남길 수 있게 합니다.

## 25.12 Final Checklist for FluoShop Deployment

FluoShop을 실제 서비스로 운영하기 전에 다음 운영 기반을 확인하세요. 이 항목들은 배포 직전의 형식적인 점검이 아니라, 장애가 났을 때 팀이 어떤 정보를 보고 어떤 결정을 내릴지 준비하는 기준입니다.

1. **Security Audit**: 모든 시스템 권한(Deno 플래그, Cloudflare 바인딩)이 가능한 한 제한적으로 설정되어 있습니까?
2. **Monitoring**: OpenTelemetry 트레이싱이 Node, Bun, Worker 노드 전반에 걸쳐 올바르게 전파되고 있습니까?
3. **Failover**: 주문 서비스의 일시적인 중단 시 API 게이트웨이가 어떻게 처리하는지 테스트해 보셨습니까?
4. **CI/CD**: 변경된 서비스만 배포되도록 모노레포가 구성되어 있습니까?

이 체크리스트를 완료하면 FluoShop은 예제 프로젝트에서 운영 가능한 서비스 구조로 한 단계 올라갑니다. 각 항목을 실제 환경에서 반복 확인하면 런타임이 섞인 분산 시스템도 더 예측 가능하게 운영할 수 있습니다.

## 25.13 A Final Message to the Reader

코드를 작성하는 일과 오래 지속되는 시스템을 구축하는 일은 다릅니다. fluo는 그 간극을 줄이기 위해 표준, 명시성, 이식성에 집중합니다. 목표는 오늘만 동작하는 코드가 아니라, 런타임과 플랫폼이 바뀌어도 판단 근거가 남아 있는 소프트웨어입니다.

이 책을 마친 뒤에는 FluoShop 설계를 직접 수정해 보세요. 런타임을 바꾸고, 전송 계층을 교체하고, 일부러 장애 조건을 만들어 보면서 어떤 계약이 시스템을 지탱하는지 확인하는 것이 가장 좋은 학습 방법입니다. 실패 사례는 더 탄력적인 구조를 만드는 데 필요한 자료가 됩니다.

### 25.13.1 Embracing Continuous Evolution

소프트웨어 엔지니어링에서 변화는 피할 수 없습니다. 오늘의 적절한 선택이 내일은 교체 대상이 될 수 있습니다. fluo의 아키텍처는 핵심 비즈니스 로직을 하부 인프라에서 분리해, 애플리케이션이 생태계 변화에 맞춰 진화할 수 있게 설계되었습니다.

전통적인 클라우드 제공업체에서 엣지로 이동하는 상황을 생각해 보세요. 예전에는 네트워킹과 스토리지 로직을 크게 다시 작성해야 했습니다. fluo에서는 어댑터와 프로바이더 경계를 교체하는 방식으로 변경 범위를 줄일 수 있습니다. 이런 유연성은 우연이 아니라, 코드 수명을 길게 가져가기 위한 설계 선택입니다.

### 25.13.2 The Community and Beyond

fluo 학습은 이 책에서 끝나지 않습니다. 생태계는 계속 성장하고 있으며, 버그 보고, 기능 제안, 커스텀 어댑터 같은 기여는 프레임워크의 방향을 구체화하는 데 도움이 됩니다. FluoShop 구현을 공유하고, 다른 팀이 TypeScript 백엔드에서 어떤 경계를 선택하는지 비교해 보세요.

실무에서는 여기서 배운 CQRS, 이벤트 기반 아키텍처, 서비스 메시 통합이 fluo 밖에서도 쓰입니다. 이 패턴들은 현대 분산 시스템의 구성 요소이며, 중요한 것은 이름을 외우는 것이 아니라 어떤 문제를 해결하는지 이해하는 것입니다. 그 이해가 복잡한 애플리케이션을 설계하고 유지 관리하는 힘이 됩니다.

## 25.14 Final Thoughts on Technical Excellence

백엔드 개발에서 기술적 우수성은 깔끔한 코드만으로 결정되지 않습니다. 성능, 보안, 유지보수성 사이의 균형을 근거 있게 선택하는 능력이 필요합니다. 중수편은 fluo가 구조화된 프레임워크이면서도 런타임 선택의 여지를 남기는 방식으로 이 균형을 돕는다는 점을 보여줬습니다.

이 패턴을 충분히 익히면 특정 프레임워크 사용법을 넘어, 서로 다른 런타임과 환경에서 확장 가능한 시스템을 설계하는 관점을 갖게 됩니다. 여기서 얻은 기술은 이후 어떤 백엔드 스택을 선택하더라도 재사용할 수 있습니다.

이제 고급(Advanced) 패턴으로 넘어가 내부 구조와 확장 지점을 더 깊게 살펴볼 차례입니다.

## 25.15 Further Reading and Resources

학습을 이어가려면 다음 리소스를 참고하세요. 여기의 자료들은 중수편에서 다룬 운영 판단을 더 깊은 프레임워크 내부 구조와 생태계 확장으로 이어 줍니다.
- **fluo Advanced Patterns**: 이 시리즈의 다음 책으로, 내부 구조에 초점을 맞춥니다.
- **Microservices Patterns** (Chris Richardson 저): 분산 시스템 로직에 대한 깊은 탐구.
- **The Twelve-Factor App**: 클라우드 네이티브 애플리케이션 설계에 대한 복습.
- **OpenTelemetry Documentation**: 분산 추적과 메트릭 설계를 더 깊게 이해하기 위해.

분산 시스템의 범위는 넓지만, 이제 중수 수준에서 필요한 주요 지점을 통과했습니다. 다음 단계에서는 이 지식을 바탕으로 더 작은 내부 구조와 확장 지점을 직접 다루게 됩니다. 지금까지 만든 판단 기준을 유지하면 고급 주제도 단순한 기능 목록이 아니라 설계 선택의 연장선으로 읽을 수 있습니다.
