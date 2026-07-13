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

### 완료 및 소유권 경계

애플리케이션 등록과 programmatic 호출은 root facade에 유지하세요. `MicroservicesModule.forRoot({ transport })`로 adapter를 등록하고 `MICROSERVICE`를 `Microservice`로 주입합니다. `MICROSERVICE`는 raw transport가 아닙니다. `@fluojs/microservices/nats`, `@fluojs/microservices/kafka`, `@fluojs/microservices/rabbitmq` 같은 transport-specific import는 adapter를 노출하지만 module과 facade 소유권은 root package에 남깁니다.

| 연산 | 완료 경계 |
| --- | --- |
| `await microservice.send(...)` | transport가 상관관계가 유지된 원격 응답을 반환할 때 settle하며, 원격 오류, abort, timeout, shutdown 시 reject합니다. |
| `await microservice.emit(...)` | transport의 publish 연산이 outbound event를 accept/complete할 때 settle합니다. 원격 event handler를 기다리거나 collaborator의 publish 계약을 넘어선 delivery/redelivery 보장을 추가하지는 않습니다. |
| `await microservice.close()` | transport-owned listener/subscription teardown과 pending-request cleanup을 기다립니다. Caller-owned NATS, Kafka, RabbitMQ collaborator의 경우 전달받은 broker resource를 close/disconnect하지 않습니다. |

Kafka와 RabbitMQ는 일치한 handler와 request response publication이 settle할 때까지 각 inbound consumer callback을 pending 상태로 유지합니다. 이 consumer-side completion boundary를 통해 broker adapter가 delivery를 acknowledge할지 retry할지 결정할 수 있지만, producer-side `emit()` promise가 end-to-end handler completion signal로 바뀌는 것은 아닙니다. 애플리케이션 shutdown에서는 먼저 `Microservice` facade를 닫아 transport callback을 detach한 다음, caller-owned client, producer, consumer, publisher, channel, connection을 application bootstrap layer에서 close 또는 drain하세요.

### 전달 안전 기본값

- TCP 프레임은 기본적으로 newline-delimited 메시지당 1 MiB로 제한되며, 한도를 넘는 프레임은 요청 버퍼를 무한히 키우는 대신 소켓을 종료합니다.
- Redis Streams는 요청/이벤트 엔트리를 핸들러 처리가 끝난 뒤에만 ACK합니다. 실패한 이벤트는 조기 ACK로 유실하지 않고 broker 복구/재전달 경로에 남겨 둡니다.
- Kafka와 RabbitMQ는 inbound event/request 처리와 response publish가 끝날 때까지 consumer delivery completion을 pending 상태로 유지합니다. Event-handler와 response-publish 실패는 consumer callback을 reject해 broker adapter가 ACK를 보류하거나 재시도할 수 있게 하며, request-handler 오류는 error response를 publish할 수 있으면 기존처럼 호출자에게 전달합니다.
- Redis Streams는 기본적으로 live request/event stream에 publish-time trimming을 적용하지 않으므로, pending 엔트리가 `xack` 또는 consumer-group 복구 경로가 끝나기 전에 잘리지 않습니다. ACK가 끝난 request/reply 엔트리는 정리되고, 인스턴스별 response stream은 기본적으로 bounded retention(`responseRetentionMaxLen: 1_000`)을 유지한 뒤 `close()` 중 삭제됩니다.
- Redis Streams는 `close()` 중 인스턴스별 response stream은 항상 삭제하지만, 활성 fleet 전체에서 ownership를 증명할 수 없으면 공유 request consumer group은 보수적으로 유지합니다. lease-capable listener는 coordination metadata만 정리하고, mixed/fallback fleet에서는 살아 있는 다른 listener가 여전히 필요로 할 수 있으므로 공유 request group을 제거하지 않습니다.
- `messageRetentionMaxLen`과 `eventRetentionMaxLen`은 고급 opt-in 설정으로 남아 있습니다. 이를 켜면 Redis가 ACK 전 pending live-stream 엔트리를 먼저 trim할 수 있으므로 broker-managed recovery 보장을 일부 포기하는 운영 판단이 됩니다.
- RabbitMQ 요청-응답은 기본적으로 인스턴스별 response queue를 사용합니다. 공유 reply topology를 의도적으로 운영할 때만 `responseQueue`를 명시적으로 지정하세요.
- caller-owned broker collaborator는 shutdown 중에도 caller-owned로 유지됩니다. NATS, Kafka, RabbitMQ transport는 subscription/consumer를 분리하고 in-flight 요청을 reject하지만, 애플리케이션이 넘긴 client, producer, consumer, publisher, 외부 connection 객체를 close/disconnect하지 않습니다.
- NATS subscription setup이 `listen()` 중 실패하면 transport는 해당 시도에서 이미 생성한 subscription을 setup의 역순으로 unsubscribe하고 caller-owned NATS client는 열어 둡니다.
- `AbortSignal`을 받는 요청-응답 transport는 이미 abort된 send를 publish 전에 reject하고, deferred broker/RPC dispatch 직전 cancellation을 다시 확인하며, 나중에 abort된 in-flight send도 reject합니다. `close()`가 시작된 뒤에는 shutdown 중인 lifecycle에 새 작업을 publish하지 않고 `send()`/`emit()`을 reject하며, 동시 `listen()` 호출은 아직 진행 중인 shutdown 상태를 reset할 수 없습니다.
- Programmatic `Microservice` facade는 런타임 shutdown hook이 종료를 시작한 signal을 전달할 수 있도록 `close(signal?: string)`을 받습니다. `MicroserviceLifecycleService.close(signal)`은 이 lifecycle-compatible facade 계약을 유지하면서도 현재 설정된 transport에는 기존 `close(): Promise<void>` 계약으로 호출합니다. 각 transport는 자체 문서가 signal-aware shutdown을 명시하지 않는 한 계속 인자를 받지 않는 shutdown adapter입니다.
- Root `@fluojs/microservices` barrel import와 `TcpMicroserviceTransport` 생성은 `node:net`을 load하지 않습니다. TCP는 `listen()`이 server를 시작하거나 outbound `send()`/`emit()`이 socket을 생성하는 경로에서만 Node networking을 lazy-load합니다. `close()`가 in-flight listen 시도를 기다리는 중 startup이 실패해도 microservice shutdown은 캡처한 listen error를 다시 surface하기 전에 transport cleanup을 시도합니다.
- TCP는 테스트와 ephemeral listener를 위해 `port: 0`을 허용하고, listen 중에는 OS가 할당한 포트로 outbound `send()`/`emit()`을 라우팅합니다.
- Platform status snapshot은 transport resource ownership을 보고합니다. TCP와 internally-created gRPC server는 framework-owned listener/client resource로 보고하고, MQTT는 client를 직접 생성한 경우에만 framework ownership을 보고하며, caller-supplied gRPC server와 caller-owned broker collaborator transport는 externally managed로 남습니다.
- gRPC shutdown은 transport가 server를 직접 생성한 경우 server-level `tryShutdown()`을 사용하고, graceful shutdown을 제공하지 않는 런타임에서만 `forceShutdown()`으로 fallback합니다. Caller-supplied `GrpcMicroserviceTransportOptions.server` 인스턴스는 `close()` 중에도 caller-owned로 유지되며, fluo는 cached outbound client만 닫고 해당 server는 shutdown하지 않습니다. Active unary/streaming call의 AbortSignal 취소는 call-level `cancel()` 또는 stream end 경로를 사용하며, stream이 end/error/early return으로 끝나면 abort listener를 제거합니다.
- MQTT는 `listen()` 중 subscription setup이 실패하거나 `close()`가 실패한 in-flight listen 시도를 unwinding할 때 internally-created client를 닫고, 호출자에게는 원래 startup error를 보존해 전달합니다. Caller-supplied MQTT client는 계속 caller-owned로 남습니다.
- transport logger를 통해 이벤트 핸들러 실패를 기록하는 경로(`RedisPubSubMicroserviceTransport`, `RedisStreamsMicroserviceTransport`, `NatsMicroserviceTransport`, `MqttMicroserviceTransport`, gRPC event emit)는 끝까지 logger-driven observability를 유지합니다. transport logger를 주입하지 않으면 fluo는 해당 실패를 raw `console.error` fallback으로 복제하지 않습니다.

## 공통 패턴

### 커스텀 모듈 등록

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
- Top-level `MicroservicesModule.forRoot({ global })`은 built-in module visibility를 제어하고, `module.global`은 module customization object를 사용할 때 같은 visibility 선택을 적용합니다.
- `module.providers`는 내장 런타임 wiring 뒤에 추가 provider를 붙이고, `module.additionalExports`는 기본 export 토큰을 교체하지 않고 확장합니다.
- `module.global`을 사용하면 등록 범위를 로컬로 제한할 수 있습니다.

### provider 배열 헬퍼

`createMicroservicesProviders(...)`는 커스텀 모듈 조합에 low-level provider array 자체가 필요할 때만 사용하세요. Custom provider/export/non-global registration에는 built-in lifecycle wiring과 export token을 그대로 유지하는 `MicroservicesModule.forRoot({ transport, module: { ... } })` 경로를 우선 사용하세요.

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
- `MicroservicesModule.forRoot(...)`: `module: { global, providers, additionalExports }`와 함께 트랜스포트와 모듈 구성을 설정합니다.
- `createMicroservicesProviders(...)`: 커스텀 모듈 조합용 provider 배열을 생성합니다.
- `MessagePattern`, `EventPattern`, `ServerStreamPattern`, `ClientStreamPattern`, `BidiStreamPattern`: 라우팅/스트리밍 데코레이터입니다.
- `TcpMicroserviceTransport`, `RedisPubSubMicroserviceTransport`, `RedisStreamsMicroserviceTransport`, `NatsMicroserviceTransport`, `KafkaMicroserviceTransport`, `RabbitMqMicroserviceTransport`, `GrpcMicroserviceTransport`, `MqttMicroserviceTransport`: 루트 배럴에서 제공하는 트랜스포트 어댑터입니다.
- `MicroserviceLifecycleService`, `MICROSERVICE`: 런타임 접근용 서비스와 토큰입니다.
- `createMicroservicePlatformStatusSnapshot`, `ServerStreamWriter`: 상태 스냅샷/TypeScript 계약 헬퍼입니다.

### Programmatic runtime

`MicroserviceLifecycleService`는 programmatic runtime access를 위해 `listen()`, `close(signal?: string)`, `send()`, `emit()`, `serverStream()`, `clientStream()`, `bidiStream()`, `createPlatformStatusSnapshot()`을 제공합니다. `MICROSERVICE` 토큰은 raw transport instance가 아니라 같은 programmatic `Microservice` facade로 resolve됩니다.

### Type export

Root barrel은 `Microservice`, `MicroserviceLifecycleState`, `MicroserviceHandlerCounts`, `MicroserviceModuleOptions`, `MicroserviceModuleRegistrationOptions`, `MicroservicePlatformStatusSnapshot`, `MicroserviceStatusAdapterInput`, `MicroserviceTransport`, `MicroserviceTransportCapabilities`, `Pattern`, `ServerStreamWriter`와 `GrpcMicroserviceTransportOptions`, `KafkaMicroserviceTransportOptions`, `MqttMicroserviceTransportOptions`, `NatsMicroserviceTransportOptions`, `RabbitMqMicroserviceTransportOptions`, `RedisPubSubMicroserviceTransportOptions`, `RedisStreamsMicroserviceTransportOptions`, `RedisStreamClientLike`, `TcpMicroserviceTransportOptions` 같은 transport option type을 export합니다.

### 동작 계약

Payload는 dispatch 전에 clone되고, 동시 `listen()` 호출은 dedupe되며, request-scoped provider는 성공/실패 후 dispose됩니다. Event fan-out은 event dispatch마다 하나의 scope를 공유하고, duplicate message match는 결정적으로 실패합니다.

### 지원되는 트랜스포트 서브패스

- `@fluojs/microservices/tcp`
- `@fluojs/microservices/redis` (Redis Pub/Sub 트랜스포트)
- `@fluojs/microservices/nats`
- `@fluojs/microservices/kafka`
- `@fluojs/microservices/rabbitmq`
- `@fluojs/microservices/grpc`
- `@fluojs/microservices/mqtt`

`RedisStreamsMicroserviceTransport`는 현재 루트 배럴에서만 지원하며, `@fluojs/microservices/redis-streams` 전용 export는 없습니다.

정식 transport 학습 자료는 [TCP](../../book/intermediate/ch02-tcp.ko.md), [RabbitMQ](../../book/intermediate/ch04-rabbitmq.ko.md), [gRPC](../../book/intermediate/ch08-grpc.ko.md) 책 장에 있으며, 이 README는 패키지 수준 동작 계약 기준으로 남습니다.

## 관련 패키지

- `@fluojs/core`: 모듈과 DI 메타데이터의 기반 패키지입니다.
- `@fluojs/core/internal`: 이 패키지가 데코레이터 메타데이터와 clone helper를 위해 사용하는 first-party package-integration seam입니다. 애플리케이션-facing import surface가 아닙니다.
- `@fluojs/runtime`: 마이크로서비스 부트스트랩과 팩토리 API를 제공합니다.
- `@fluojs/di`: 핸들러와 provider를 resolve하는 DI 엔진입니다.

## 예제 소스

- `packages/microservices/src/module.test.ts`: 모든 트랜스포트 통합 계약을 검증합니다.
- `packages/microservices/src/public-api.test.ts`: 모듈 등록 override와 `createMicroservicesProviders(...)`를 포함한 루트 배럴 export 계약을 검증합니다.
- `packages/microservices/src/public-surface.test.ts`: 문서화된 공개 surface를 검증합니다.
- `packages/microservices/src/public-subpaths.test.ts`: 문서화된 트랜스포트 서브패스 export map 계약을 검증합니다.
- 실행 가능한 스타터 예제는 지원되는 TCP, Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC 트랜스포트 변형에 대해 `fluo new --shape microservice --transport <transport> --runtime node --platform none`로 생성합니다.
