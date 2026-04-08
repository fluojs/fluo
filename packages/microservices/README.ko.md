# @konekti/microservices

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti용 트랜스포트 기반 마이크로서비스 패키지입니다. TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, gRPC 같은 여러 프로토콜 위에서 동일한 데코레이터 기반 프로그래밍 모델을 제공합니다.

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
pnpm add @konekti/microservices
```

선택적 트랜스포트 의존성:

- **gRPC**: `@grpc/grpc-js`, `@grpc/proto-loader`
- **Redis**: `ioredis`
- **MQTT**: `mqtt`

## 사용 시점

- 서비스 간 통신을 메시지나 이벤트 중심으로 분리하고 싶을 때
- TCP, NATS, Kafka 같은 여러 트랜스포트 위에서 같은 핸들러 모델을 유지하고 싶을 때
- 요청-응답과 이벤트 fan-out을 같은 프레임워크 규약으로 다루고 싶을 때
- gRPC 스트리밍을 포함한 복수의 마이크로서비스 프로토콜을 Konekti DI와 함께 사용하고 싶을 때

## 빠른 시작

```ts
import { MessagePattern, MicroservicesModule, TcpMicroserviceTransport } from '@konekti/microservices';
import { Module } from '@konekti/core';
import { KonektiFactory } from '@konekti/runtime';

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

const microservice = await KonektiFactory.createMicroservice(AppModule);
await microservice.listen();
```

## 주요 기능

### 다중 트랜스포트 지원

비즈니스 핸들러는 그대로 두고 TCP, Redis Pub/Sub, Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC 같은 트랜스포트만 바꿔 배치할 수 있습니다.

### 패턴 기반 라우팅

`@MessagePattern`은 요청-응답 흐름에, `@EventPattern`은 fire-and-forget 이벤트에 사용합니다. 문자열과 정규식 패턴 모두 지원합니다.

### gRPC 스트리밍

`@ServerStreamPattern`, `@ClientStreamPattern`, `@BidiStreamPattern`으로 unary 외의 스트리밍 패턴도 다룰 수 있습니다.

### 요청 단위 DI scope

마이크로서비스 핸들러도 Konekti의 request/transient scope 모델을 그대로 따르므로, 메시지 또는 이벤트 단위로 격리된 상태를 안전하게 사용할 수 있습니다.

## 공개 API 개요

- `MicroservicesModule`
- `MessagePattern`, `EventPattern`
- `ServerStreamPattern`, `ClientStreamPattern`, `BidiStreamPattern`
- `TcpMicroserviceTransport`, `NatsMicroserviceTransport`, `KafkaMicroserviceTransport` 등 트랜스포트 어댑터
- `MicroserviceLifecycleService`
- `MICROSERVICE`
- `createMicroservicePlatformStatusSnapshot(...)`

## 관련 패키지

- `@konekti/core`: 모듈과 DI 메타데이터의 기반 패키지입니다.
- `@konekti/runtime`: 마이크로서비스 부트스트랩과 팩토리 API를 제공합니다.
- `@konekti/di`: 핸들러와 provider를 resolve하는 DI 엔진입니다.

## 예제 소스

- `packages/microservices/src/module.test.ts`
- `packages/microservices/src/public-surface.test.ts`
