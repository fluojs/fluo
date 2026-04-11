# @fluojs/microservices

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo용 트랜스포트 기반 마이크로서비스 패키지입니다. TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, gRPC 같은 여러 프로토콜 위에서 동일한 데코레이터 기반 프로그래밍 모델을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 기능](#주요-기능)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/microservices
```

선택적 트랜스포트 의존성:

- **gRPC**: `@grpc/grpc-js`, `@grpc/proto-loader`
- **NATS**: `nats`
- **Kafka**: `kafkajs`
- **RabbitMQ**: `amqplib`
- **Redis**: `ioredis`
- **MQTT**: `mqtt`

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

`fluo new`는 NATS, Kafka, RabbitMQ를 숨겨진 내장 구현이 아니라 caller-owned bootstrap contract로 취급합니다. 생성된 스타터는 `src/app.ts`에서 `nats` + `JSONCodec()`, `kafkajs` producer/consumer collaborator, `amqplib` publisher/consumer collaborator를 직접 연결하고, 외부 broker 의존성은 `.env`와 생성된 README에 그대로 드러냅니다.

## 주요 기능

### 다중 트랜스포트 지원

비즈니스 핸들러는 그대로 두고 TCP, Redis Pub/Sub, Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC 같은 트랜스포트만 바꿔 배치할 수 있습니다.

### 패턴 기반 라우팅

`@MessagePattern`은 요청-응답 흐름에, `@EventPattern`은 fire-and-forget 이벤트에 사용합니다. 문자열과 정규식 패턴 모두 지원합니다.

### gRPC 스트리밍

`@ServerStreamPattern`, `@ClientStreamPattern`, `@BidiStreamPattern`으로 unary 외의 스트리밍 패턴도 다룰 수 있습니다.

### 요청 단위 DI scope

마이크로서비스 핸들러도 fluo의 request/transient scope 모델을 그대로 따르므로, 메시지 또는 이벤트 단위로 격리된 상태를 안전하게 사용할 수 있습니다.

## 공개 API 개요

### 루트 배럴 (`@fluojs/microservices`)

- `MicroservicesModule`, `createMicroservicesProviders`: 모듈 등록 진입점입니다.
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

- `packages/microservices/src/module.test.ts`
- `packages/microservices/src/public-api.test.ts`
- `packages/microservices/src/public-subpaths.test.ts`
- `packages/microservices/src/public-surface.test.ts`
