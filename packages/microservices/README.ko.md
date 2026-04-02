# @konekti/microservices

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

데코레이터 기반 핸들러 검색 기능을 갖춘 Konekti용 트랜스포트 기반 마이크로서비스 메시지 컨슈머입니다.

## 설치

```bash
npm install @konekti/microservices
```

선택적 트랜스포트 peer dependency:

```bash
# gRPC 트랜스포트
npm install @konekti/microservices @grpc/grpc-js @grpc/proto-loader

# MQTT 트랜스포트
npm install @konekti/microservices mqtt
```

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import { KonektiFactory } from '@konekti/runtime';
import { createMicroservicesModule, MessagePattern, TcpMicroserviceTransport } from '@konekti/microservices';

class MathHandler {
  @MessagePattern('math.sum')
  sum(input: { a: number; b: number }) {
    return input.a + input.b;
  }
}

@Module({
  imports: [createMicroservicesModule({ transport: new TcpMicroserviceTransport({ port: 4001 }) })],
  providers: [MathHandler],
})
class AppModule {}

const microservice = await KonektiFactory.createMicroservice(AppModule);
await microservice.listen();
```

## API

- `createMicroservicesModule(options)` - 글로벌 `MICROSERVICE` 생명주기 서비스를 등록합니다.
- `createMicroservicesProviders(options)` - 수동 구성을 위한 로우(raw) 프로바이더를 반환합니다.
- `MICROSERVICE` - 런타임 마이크로서비스 서비스를 위한 DI 토큰입니다.
- `@MessagePattern(pattern)` - 요청/응답 핸들러를 등록합니다.
- `@EventPattern(pattern)` - 이벤트 핸들러를 등록합니다.
- `@ServerStreamPattern(pattern)` - gRPC 서버 스트리밍 핸들러를 등록합니다.
- `TcpMicroserviceTransport` - TCP 트랜스포트 어댑터입니다.
- `RedisPubSubMicroserviceTransport` - Redis pub/sub 이벤트 전용 트랜스포트 어댑터입니다.
- `NatsMicroserviceTransport` - NATS 트랜스포트 어댑터입니다 (요청/응답 + 이벤트).
- `KafkaMicroserviceTransport` - Kafka 트랜스포트 어댑터입니다 (요청/응답 + 이벤트).
- `RabbitMqMicroserviceTransport` - RabbitMQ 트랜스포트 어댑터입니다 (요청/응답 + 이벤트).
- `RedisStreamsMicroserviceTransport` - Redis Streams 트랜스포트 어댑터입니다 (요청/응답 + 이벤트).
- `GrpcMicroserviceTransport` - gRPC 트랜스포트 어댑터입니다 (unary 요청/응답 + unary 이벤트 규약 + 서버 스트리밍).
- `MqttMicroserviceTransport` - MQTT 트랜스포트 어댑터입니다 (요청/응답 + 이벤트).

## 런타임 동작

- 컴파일된 모듈의 프로바이더와 컨트롤러에서 핸들러를 검색합니다.
- `@MessagePattern`은 단일 핸들러와 매칭되며 해당 값을 호출자에게 반환합니다.
- `@MessagePattern`은 singleton, request, transient 핸들러를 지원합니다. request/transient 핸들러는 메시지별 child DI scope 안에서 실행되고, 핸들러 완료 후 해당 scope가 dispose됩니다.
- 여러 `@MessagePattern` 핸들러가 동일한 패턴에 매칭되는 경우, 임의로 선택하지 않고 명시적으로 디스패치에 실패합니다.
- `@EventPattern`은 매칭되는 모든 핸들러로 디스패치합니다.
- `@EventPattern`은 singleton, request, transient 핸들러를 지원합니다. request/transient 핸들러는 이벤트별 공유 child DI scope 안에서 실행되고, 매칭된 모든 핸들러가 완료된 뒤 해당 scope가 dispose됩니다.
- 여러 scoped 핸들러가 같은 이벤트에 매칭되면 동일한 per-event scope 인스턴스를 공유하므로, fan-out 이벤트 안에서 컨텍스트를 공유할 수 있습니다.
- 서로 다른 이벤트는 격리된 scope를 사용하므로 동시 처리 간 상태 누수가 없습니다.
- 패턴은 정확한 문자열 또는 `RegExp` 매칭을 지원합니다.
- 트랜스포트 생명주기는 애플리케이션 시작 및 종료 시점에 관리됩니다.

## 마이크로서비스 핸들러의 provider scope

- **Singleton** (기본값): 모든 인바운드 메시지와 이벤트에서 하나의 인스턴스를 공유합니다.
- **Request**: 각 핸들러 호출마다 새로운 child DI scope를 사용합니다. `@MessagePattern`에서는 메시지별 scope를, `@EventPattern`에서는 같은 이벤트에 매칭된 fan-out 핸들러 전체가 공유하는 per-event scope를 사용합니다.
- **Transient**: 같은 scope 경계 안에서 항상 새로운 인스턴스 그래프를 resolve합니다. `@MessagePattern`에서는 메시지별, `@EventPattern`에서는 이벤트별 공유 scope 경계를 사용합니다.

request/transient scope를 사용하는 핸들러의 의존성도 request 또는 transient scope여야 합니다. singleton이 request-scoped provider에 의존하면 DI 컨테이너는 `ScopeMismatchError`를 던집니다.

```typescript
import { Inject, Scope } from '@konekti/core';
import { MessagePattern } from '@konekti/microservices';

@Scope('request')
class CorrelationState {
  readonly id = crypto.randomUUID();
}

@Inject([CorrelationState])
@Scope('request')
class PaymentsHandler {
  constructor(private readonly state: CorrelationState) {}

  @MessagePattern('payments.capture')
  capture() {
    return { correlationId: this.state.id };
  }
}
```

여러 scoped `@EventPattern` 핸들러가 같은 이벤트에 매칭되면 하나의 per-event scope를 공유합니다.

## 트랜스포트 참고 사항

- `TcpMicroserviceTransport`는 `send()` (요청/응답)와 `emit()` (이벤트)를 모두 지원합니다.
- `RedisPubSubMicroserviceTransport`는 `emit()`(이벤트)만 지원합니다. Redis Pub/Sub는 여러 인스턴스 사이에서 안전한 단일 소비자 RPC ownership을 보장하지 않으므로 `send()`는 의도적으로 지원하지 않습니다.
- `NatsMicroserviceTransport`는 NATS 요청/응답 및 pub/sub 주제를 통해 `send()`와 `emit()`을 모두 지원합니다.
- `KafkaMicroserviceTransport`는 메시지, 응답, 이벤트 토픽을 분리하고 correlation 기반 라우팅을 사용해 `send()`(요청/응답)와 `emit()`(이벤트)를 모두 지원합니다.
- `RabbitMqMicroserviceTransport`는 요청/응답 상관관계(request/reply correlation)와 전용 요청/응답 큐를 사용해 `send()`와 `emit()`을 모두 지원합니다.
- `RedisStreamsMicroserviceTransport`는 Redis Streams의 consumer group을 사용해 안전한 단일 소비자 요청/응답과 이벤트 fan-out을 지원합니다.
- `GrpcMicroserviceTransport`는 `<Service>.<Method>` 패턴과 metadata kind(`x-konekti-kind`)를 사용해 unary `send()`, unary `emit()`, 그리고 서버 스트리밍 `serverStream()`을 지원합니다.
- `MqttMicroserviceTransport`는 JSON envelope 기반 상관관계(`requestId`, `replyTopic`)와 인스턴스별 reply topic을 사용해 `send()`/`emit()`을 지원합니다.

### Kafka

- `KafkaMicroserviceTransport`는 요청/응답 `send()`와 이벤트 `emit()`을 모두 지원합니다.
- `send()`는 구성된 메시지 토픽으로 `{ kind: 'message', pattern, payload, requestId, replyTopic }` 프레임을 publish하고, 상관관계가 맞는 `{ kind: 'response', requestId, payload | error }` 응답을 기다립니다.
- 상관관계 식별자는 `requestId`(호출마다 생성)이며, 응답 라우팅은 `replyTopic`을 사용합니다 (`replyTopic` 기본값은 트랜스포트 인스턴스별 고유 토픽).
- `send()`는 `requestTimeoutMs`(기본값 3 000ms)를 적용하며, 타임아웃·abort·트랜스포트 종료·원격 핸들러 오류 직렬화 시 reject됩니다.
- 응답 구독이 활성화되어야 하므로 `send()` 전에 `listen()`을 호출해야 합니다.
- 인바운드 이벤트 핸들러 실패는 트랜스포트 경계에서 격리되며 `emit()` 호출자에게 다시 전파되지 않습니다.
- 요청/응답 운용 가정:
  - `responseTopic`을 여러 인스턴스가 공유하는 값으로 오버라이드하면, 인스턴스별 소비가 격리되도록(예: 전용 consumer-group 또는 토픽 전략) 구성해야 응답 오소비를 피할 수 있습니다.
  - 순서 보장, 오프셋 커밋 정책, 컨슈머 그룹 복구, 재연결 동작은 여전히 브로커/클라이언트 책임입니다.
- Kafka 요청/응답 vs TCP/NATS 선택 기준:
  - Kafka 중심 토폴로지를 이미 운영 중이고 해당 경계 안에서 요청/응답이 필요하면 Kafka 요청/응답이 적합합니다.
  - 더 낮은 지연시간과 단순한 운영을 우선하면 TCP/NATS가 권장 경로입니다.
- 트러블슈팅: Kafka 요청 타임아웃이 반복되면 패턴 responder 부재, 메시지/응답 토픽 설정 불일치, 인스턴스 간 response-topic/group 경합을 우선 점검하세요.

### RabbitMQ

- `RabbitMqMicroserviceTransport`는 전용 이벤트(`eventQueue`), 요청(`messageQueue`), 응답(`responseQueue`) 큐를 사용해 `send()`와 `emit()`을 모두 지원합니다.
- `send()`는 `{ kind: 'message', pattern, payload, requestId, replyTo }`를 `messageQueue`에 publish하고, `responseQueue`에서 `{ kind: 'response', requestId, payload | error }`를 기다립니다.
- 상관관계는 `requestId` 기준으로 처리되며, 요청이 종료된 뒤 도착한 알 수 없는/지연/중복 응답은 무시됩니다.
- `send()`는 `requestTimeoutMs`(기본 3 000ms)를 적용합니다. 타임아웃, abort, 트랜스포트 종료 시 대기 중인 요청 Promise는 결정적으로 reject됩니다.
- 핸들러 실패는 응답 `error` 문자열로 직렬화되어 호출자 쪽 `send()`에서 reject됩니다.
- 생명주기 동작: startup 시 이벤트/요청/응답 큐를 구독하고, reconnect는 `close()` 이후 `listen()`을 다시 호출해 지원하며, shutdown 시 큐 소비를 해제하고 진행 중 요청을 모두 reject합니다.
- ack/nack, 재큐잉(requeue), dead-letter, 브로커 관리 채널 복구는 별도 가이드가 나오기 전까지 브로커/클라이언트 책임입니다.
- 트러블슈팅: RabbitMQ 요청 타임아웃이 반복되면 `messageQueue` responder 부재, 서비스 간 `responseQueue` 이름 불일치, 브로커 재연결 이후 consumer 재구독 누락을 우선 확인하세요.

### NATS

- `NatsMicroserviceTransport`는 별도의 요청/응답 subject와 이벤트 subject를 사용해 `send()`와 `emit()`을 모두 지원합니다.
- `send()`는 `requestTimeoutMs`를 적용하며, 트랜스포트가 에러 메시지로 직렬화해 되돌릴 수 있는 핸들러 실패만 호출자에게 전파합니다.
- `close()`는 완료 전에 진행 중인 pending request를 결정적으로 reject합니다.
- 재연결, 버퍼링, responder 가용성은 여전히 클라이언트/서버 책임입니다. 운영상 요청/응답 보장이 중요하다면 선택한 NATS 클라이언트/runtime 조합에서 별도로 검증해야 합니다.

### Redis

- `RedisPubSubMicroserviceTransport`는 public 계약에서 **이벤트 전용**입니다.
- `emit()`은 구성된 namespace 이벤트 채널로 이벤트 프레임을 publish합니다.
- `send()`는 Redis Pub/Sub가 여러 subscriber 사이에서 안전한 단일 소비자 요청/응답 소유권을 제공하지 않기 때문에 즉시 throw됩니다.
- `close()` 시 이벤트 구독과 메시지 리스너를 정리합니다.
- Redis에서 요청/응답이 필요하면 `RedisStreamsMicroserviceTransport`를 사용하세요. 그 외 TCP, NATS, Kafka, RabbitMQ 트랜스포트도 요청/응답을 지원합니다.

### Redis Streams

- `RedisStreamsMicroserviceTransport`는 Redis Streams의 consumer group을 사용해 요청/응답 `send()`와 이벤트 `emit()`을 모두 지원합니다.
- Redis Pub/Sub와 달리 Redis Streams는 consumer group당 단일 소비자 전달을 보장하므로, 여러 인스턴스에서도 요청/응답이 안전합니다.
- 스트림 토폴로지는 namespace당 3개의 스트림을 사용합니다:
  - `{namespace}:messages` — 인스턴스 간 요청 부하 분산을 위한 공유 consumer group.
  - `{namespace}:events` — 모든 인스턴스로의 이벤트 fan-out을 위한 인스턴스별 consumer group.
  - `{namespace}:responses:{consumerId}` — 응답 격리를 위한 인스턴스별 스트림.
- `send()`는 메시지 스트림에 `{ kind: 'message', pattern, payload, requestId, replyStream }`을 publish하고, 인스턴스별 응답 스트림에서 상관 `{ kind: 'response', requestId, payload | error }` 프레임을 기다립니다.
- `send()`는 `requestTimeoutMs`(기본값 3 000ms)를 적용하며, 타임아웃·abort·트랜스포트 종료·원격 핸들러 오류 시 reject됩니다.
- `listen()`이 `send()` 전에 호출되어야 응답 consumer group이 활성화됩니다.
- 트랜스포트는 2개의 `RedisStreamClientLike` 클라이언트가 필요합니다: blocking `XREADGROUP` 폴링용 `readerClient`와 `XADD`/그룹 관리용 `writerClient`.
- 폴링 기반 소비: 트랜스포트가 내부 폴링 루프를 소유합니다 (`pollBlockMs`로 구성, 기본값 500ms).
- `close()` 시 폴링 루프를 중지하고, 인스턴스별 consumer group(이벤트·응답)을 삭제하며, 대기 중인 요청을 모두 reject합니다. 공유 메시지 consumer group은 shutdown/reconnect 주기에서 의도적으로 보존됩니다.
- 트러블슈팅: Redis Streams 요청 타임아웃이 반복되면 메시지 스트림의 responder 부재, namespace 설정 불일치, consumer group 경합을 우선 확인하세요.

### gRPC

- `GrpcMicroserviceTransport`는 `@grpc/grpc-js`, `@grpc/proto-loader`를 런타임에 지연 로드합니다. 이 의존성은 optional peer이며 gRPC 트랜스포트를 사용할 때만 필요합니다.
- 패턴 형식은 반드시 `<Service>.<Method>`여야 하며, 설정된 `packageName` 아래 proto 서비스/메서드 이름과 일치해야 합니다.
- `listen()`은 proto 패키지를 로드하고 unary 핸들러와 서버 스트리밍 핸들러를 등록합니다. 클라이언트 스트리밍 및 양방향 스트리밍 메서드는 등록하지 않습니다. bind 단계에서 실패하면 서버 shutdown으로 부분 시작 상태를 롤백합니다.
- 인바운드 패킷은 metadata 키 `x-konekti-kind`(`message`/`event`)를 사용해 payload 스키마 변경 없이 `TransportPacket.kind`로 매핑됩니다.
- `send()`는 unary 요청/응답, deadline 기반 timeout, cancel 기반 abort를 지원하며 `close()` 시 pending 요청을 결정적으로 reject합니다.
- `emit()`은 Konekti 규약으로 구현된 best-effort unary 호출입니다. 응답 payload는 버리지만, 호출 자체의 transport-level 실패는 여전히 표면화됩니다.
- `serverStream()`은 서버에서 전송하는 각 메시지를 yield하는 `AsyncIterable<unknown>`을 반환합니다. `AbortSignal`을 통한 abort를 지원하며, iterator의 `return()`은 하위 gRPC 호출을 cancel합니다.

#### 서버 스트리밍

서버 스트리밍은 하나의 요청에 대해 gRPC 메서드가 여러 개의 응답 메시지를 보낼 수 있게 합니다. `@ServerStreamPattern`으로 서버 스트리밍 핸들러를 등록하고, 클라이언트 쪽에서 `serverStream()`으로 스트림을 소비합니다.

**서버 측 핸들러:**

```typescript
import { Module } from '@konekti/core';
import { KonektiFactory } from '@konekti/runtime';
import {
  createMicroservicesModule,
  ServerStreamPattern,
  GrpcMicroserviceTransport,
} from '@konekti/microservices';
import type { ServerStreamWriter } from '@konekti/microservices';

class MetricsHandler {
  @ServerStreamPattern('Metrics.StreamCpuUsage')
  async streamCpu(payload: { intervalMs: number }, writer: ServerStreamWriter) {
    for (let i = 0; i < 5; i++) {
      writer.write({ cpu: Math.random() * 100, tick: i });
    }
    writer.end();
  }
}

const transport = new GrpcMicroserviceTransport({
  url: '0.0.0.0:50051',
  packageName: 'monitoring',
  protoPath: './monitoring.proto',
});

@Module({
  imports: [createMicroservicesModule({ transport })],
  providers: [MetricsHandler],
})
class ServerModule {}

const microservice = await KonektiFactory.createMicroservice(ServerModule);
await microservice.listen();
```

**클라이언트 측 소비:**

```typescript
const transport = new GrpcMicroserviceTransport({
  url: 'localhost:50051',
  packageName: 'monitoring',
  protoPath: './monitoring.proto',
});
await transport.listen(async () => {});

for await (const message of transport.serverStream('Metrics.StreamCpuUsage', { intervalMs: 1000 })) {
  console.log('cpu sample:', message);
}
```

- 핸들러는 `(payload, writer)`를 받으며, `writer`는 `write(data)`, `end()`, `error(err)` 메서드를 제공합니다.
- `serverStream()`은 트랜스포트가 listening 상태여야 합니다. 트랜스포트가 종료되었거나 아직 시작되지 않았으면 reject합니다.
- 클라이언트 스트리밍 및 양방향 스트리밍은 향후 릴리스에서 추가됩니다 (issue #620 참조).

### MQTT

- `MqttMicroserviceTransport`는 내부 클라이언트를 생성해야 할 때(`options.client` 미제공) `mqtt`를 런타임 지연 로드합니다.
- 트랜스포트 계약은 JSON envelope를 사용합니다:
  `{ kind, pattern, payload, requestId?, replyTopic?, error? }`.
- `emit()`은 이벤트 envelope를 publish하는 fire-and-forget 경로입니다.
- `send()`는 메시지 envelope를 publish하고 인스턴스별 reply topic에서 상관관계 응답 envelope를 기다립니다.
- 기본 reply topic은 인스턴스별 `konekti.microservices.responses.<uuid>`이며 namespace/topic 옵션으로 오버라이드할 수 있습니다.
- 기본 QoS/retain 동작은 보수적으로 설정되며 구성 가능합니다: 요청/응답 QoS 1, 이벤트 QoS 0, retain 기본 비활성화.
- v1 상관관계의 정합성은 MQTT v5 전용 response-topic/correlationData가 아니라 JSON envelope(`requestId` + `replyTopic`)를 기준으로 합니다.
- 생명주기 보장:
  - `listen()`은 재진입 가드를 가지며, 중간 subscribe 실패 시 이미 구독된 토픽을 롤백합니다.
  - `close()`는 pending 요청을 항상 결정적으로 reject합니다.
  - 내부 생성 클라이언트는 `close()`에서 종료하고, 외부 주입 클라이언트는 구독/리스너만 정리하며 소유권은 호출자에게 남깁니다.

## 하이브리드 모드

런타임 앱 부트스트랩을 사용하고 동일한 컨테이너에서 마이크로서비스 런타임을 해결(resolve)합니다.

```typescript
const app = await KonektiFactory.create(AppModule);
const microservice = await app.container.resolve(MICROSERVICE);

await Promise.all([app.listen(), microservice.listen()]);
```

이 구성에서 앱과 마이크로서비스 런타임은 동일한 컨테이너에서 핸들러를 해결하므로, 싱글톤 프로바이더가 HTTP 및 마이크로서비스 흐름 전반에서 공유됩니다.
