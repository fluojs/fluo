# @fluojs/microservices

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo용 트랜스포트 기반 마이크로서비스 패키지입니다. TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, gRPC 같은 여러 프로토콜 위에서 동일한 데코레이터 기반 프로그래밍 모델을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 기능](#주요-기능)
- [공통 패턴](#공통-패턴)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/microservices
```

선택적 트랜스포트 의존성:

- `@fluojs/microservices`가 직접 로드하는 선택적 peer: `@grpc/grpc-js`, `@grpc/proto-loader`, `ioredis`, `mqtt`
- 애플리케이션이 transport에 명시적으로 넘겨야 하는 caller-owned broker client: `nats`, `kafkajs`, `amqplib`

## 사용 시점

- 서비스 간 통신을 메시지나 이벤트 중심으로 분리하고 싶을 때
- TCP, NATS, Kafka 같은 여러 트랜스포트 위에서 같은 핸들러 모델을 유지하고 싶을 때
- 요청-응답과 이벤트 fan-out을 같은 프레임워크 규약으로 다루고 싶을 때
- gRPC 스트리밍을 포함한 복수의 마이크로서비스 프로토콜을 fluo DI와 함께 사용하고 싶을 때

## 빠른 시작

```ts
import { MessagePattern, MicroservicesModule, TcpMicroserviceTransport } from '@fluojs/microservices';
import { Module } from '@fluojs/core';
import { fluoFactory } from '@fluojs/runtime';

class MathHandler {
  @MessagePattern('math.sum')
  sum(data: { a: number; b: number }) {
    return data.a + data.b;
  }
}

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: new TcpMicroserviceTransport({ port: 4000 }),
    }),
  ],
  providers: [MathHandler],
})
class AppModule {}

const microservice = await fluoFactory.createMicroservice(AppModule);
await microservice.listen();
```

`fluo new`는 NATS, Kafka, RabbitMQ를 숨겨진 내장 구현이 아니라 caller-owned bootstrap contract로 취급합니다. 생성된 스타터는 `src/app.ts`에서 `nats` + `JSONCodec()`, `kafkajs` producer/consumer collaborator, `amqplib` publisher/consumer collaborator를 직접 연결하고, 외부 broker 의존성은 `.env`와 생성된 README에 그대로 드러냅니다. 이 패키지 자체가 해당 런타임을 직접 로드하지 않으므로 `@fluojs/microservices`의 peer dependency로도 선언하지 않습니다.

## 주요 기능

### 다중 트랜스포트 지원

비즈니스 핸들러는 그대로 두고 TCP, Redis Pub/Sub, Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC 같은 트랜스포트만 바꿔 배치할 수 있습니다.

### 패턴 기반 라우팅

`@MessagePattern`은 요청-응답 흐름에, `@EventPattern`은 fire-and-forget 이벤트에 사용합니다. 문자열과 정규식 패턴 모두 지원합니다.

### gRPC 스트리밍

`@ServerStreamPattern`, `@ClientStreamPattern`, `@BidiStreamPattern`으로 unary 외의 스트리밍 패턴도 다룰 수 있습니다.

### 요청 단위 DI scope

마이크로서비스 핸들러도 fluo의 request/transient scope 모델을 그대로 따르므로, 메시지 또는 이벤트 단위로 격리된 상태를 안전하게 사용할 수 있습니다.

### 전달 안전 기본값

- TCP 프레임은 기본적으로 newline-delimited 메시지당 1 MiB로 제한되며, 한도를 넘는 프레임은 요청 버퍼를 무한히 키우는 대신 소켓을 종료합니다.
- Redis Streams는 요청/이벤트 엔트리를 핸들러 처리가 끝난 뒤에만 ACK합니다. 실패한 이벤트는 조기 ACK로 유실하지 않고 broker 복구/재전달 경로에 남겨 둡니다.
- Redis Streams는 기본적으로 live request/event stream에 publish-time trimming을 적용하지 않으므로, pending 엔트리가 `xack` 또는 consumer-group 복구 경로가 끝나기 전에 잘리지 않습니다. ACK가 끝난 request/reply 엔트리는 정리되고, 인스턴스별 response stream은 기본적으로 bounded retention(`responseRetentionMaxLen: 1_000`)을 유지한 뒤 `close()` 중 삭제됩니다.
- `messageRetentionMaxLen`과 `eventRetentionMaxLen`은 고급 opt-in 설정으로 남아 있습니다. 이를 켜면 Redis가 ACK 전 pending live-stream 엔트리를 먼저 trim할 수 있으므로 broker-managed recovery 보장을 일부 포기하는 운영 판단이 됩니다.
- RabbitMQ 요청-응답은 기본적으로 인스턴스별 response queue를 사용합니다. 공유 reply topology를 의도적으로 운영할 때만 `responseQueue`를 명시적으로 지정하세요.

## 공통 패턴

### module-first custom registration

custom provider/export/non-global 구성이 필요할 때도 raw provider array로 내려가지 말고 `MicroservicesModule.forRoot({ transport, module: { ... } })`를 우선 사용하세요.

```ts
import { Module } from '@fluojs/core';
import { MicroservicesModule } from '@fluojs/microservices';

const EXTRA_MICROSERVICE_EXPORT = Symbol('extra-microservice-export');

@Module({
  imports: [
    MicroservicesModule.forRoot({
      transport: customTransport,
      module: {
        global: false,
        providers: [{ provide: EXTRA_MICROSERVICE_EXPORT, useValue: 'custom-module-value' }],
        additionalExports: [EXTRA_MICROSERVICE_EXPORT],
      },
    }),
  ],
})
class FeatureModule {}
```

Behavioral contract notes:

- 이 모듈 경로는 기본 `MicroservicesModule.forRoot(...)` 호출과 동일한 `MICROSERVICE_OPTIONS`, `MicroserviceLifecycleService`, `MICROSERVICE` wiring을 그대로 설치합니다.
- `module.providers`는 내장 런타임 wiring 뒤에 추가 provider를 붙이고, `module.additionalExports`는 기본 export 토큰을 교체하지 않고 확장합니다.
- `module.global`을 사용하면 raw provider graph를 다시 조립하지 않고도 고급 호출자가 등록 범위를 로컬로 제한할 수 있습니다.

### low-level helper for raw provider arrays

`createMicroservicesProviders(...)`는 실제로 low-level provider array 자체가 필요한 호출자에게만 남아 있습니다.

```ts
import { Module } from '@fluojs/core';
import { createMicroservicesProviders } from '@fluojs/microservices';

@Module({
  providers: [...createMicroservicesProviders({ transport: customTransport })],
})
class ManualMicroserviceProvidersModule {}
```

## 공개 API 개요

### 루트 배럴 (`@fluojs/microservices`)

- `MicroservicesModule`, `createMicroservicesProviders`: 모듈 등록 진입점입니다.
- `MicroservicesModule.forRoot(...)`는 여전히 표준 런타임 진입점입니다. 고급 호출자가 raw provider graph를 다시 조립하지 않고 모듈 경로에서 커스터마이즈해야 할 때는 `module: { global, providers, additionalExports }`를 함께 넘기세요.
- `createMicroservicesProviders(...)`는 low-level provider array 자체가 필요한 호출자를 위한 공개 helper로 유지합니다.
- `MessagePattern`, `EventPattern`, `ServerStreamPattern`, `ClientStreamPattern`, `BidiStreamPattern`: 라우팅/스트리밍 데코레이터입니다.
- `TcpMicroserviceTransport`, `RedisPubSubMicroserviceTransport`, `RedisStreamsMicroserviceTransport`, `NatsMicroserviceTransport`, `KafkaMicroserviceTransport`, `RabbitMqMicroserviceTransport`, `GrpcMicroserviceTransport`, `MqttMicroserviceTransport`: 루트 배럴에서 제공하는 트랜스포트 어댑터입니다.
- `MicroserviceLifecycleService`, `MICROSERVICE`: 런타임 접근용 서비스와 호환 토큰입니다.
- `createMicroservicePlatformStatusSnapshot`, `ServerStreamWriter`: 상태 스냅샷/TypeScript 계약 헬퍼입니다.

### 지원되는 트랜스포트 서브패스

- `@fluojs/microservices/tcp`
- `@fluojs/microservices/redis` (Redis Pub/Sub 트랜스포트)
- `@fluojs/microservices/nats`
- `@fluojs/microservices/kafka`
- `@fluojs/microservices/rabbitmq`
- `@fluojs/microservices/grpc`
- `@fluojs/microservices/mqtt`

`RedisStreamsMicroserviceTransport`는 현재 루트 배럴에서만 지원하며, `@fluojs/microservices/redis-streams` 전용 export는 없습니다.

## 관련 패키지

- `@fluojs/core`: 모듈과 DI 메타데이터의 기반 패키지입니다.
- `@fluojs/runtime`: 마이크로서비스 부트스트랩과 팩토리 API를 제공합니다.
- `@fluojs/di`: 핸들러와 provider를 resolve하는 DI 엔진입니다.

## 예제 소스

- `packages/microservices/src/module.test.ts`: 모든 트랜스포트 통합 계약을 검증합니다.
- `packages/microservices/src/public-api.test.ts`: module-first registration override와 `createMicroservicesProviders(...)` helper 계약을 포함한 루트 배럴 export 계약을 검증합니다.
- `packages/microservices/src/public-surface.test.ts`: 0.x 거버넌스 동안 helper를 유지하면서 module-first replacement path도 문서화되었는지 고정합니다.
- `packages/microservices/src/public-subpaths.test.ts`: 문서화된 트랜스포트 서브패스 export map 계약을 검증합니다.
- `examples/microservices-tcp`: 기본 TCP 마이크로서비스 예제입니다.
- `examples/microservices-kafka`: Kafka 기반 분산 아키텍처 예제입니다.
