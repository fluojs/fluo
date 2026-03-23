# @konekti/microservices

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

데코레이터 기반 핸들러 검색 기능을 갖춘 Konekti용 트랜스포트 기반 마이크로서비스 메시지 컨슈머입니다.

## 설치

```bash
npm install @konekti/microservices
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

const microservice = await KonektiFactory.createMicroservice(AppModule, { mode: 'prod' });
await microservice.listen();
```

## API

- `createMicroservicesModule(options)` - 글로벌 `MICROSERVICE` 생명주기 서비스를 등록합니다.
- `createMicroservicesProviders(options)` - 수동 구성을 위한 로우(raw) 프로바이더를 반환합니다.
- `MICROSERVICE` - 런타임 마이크로서비스 서비스를 위한 DI 토큰입니다.
- `@MessagePattern(pattern)` - 요청/응답 핸들러를 등록합니다.
- `@EventPattern(pattern)` - 이벤트 핸들러를 등록합니다.
- `TcpMicroserviceTransport` - TCP 트랜스포트 어댑터입니다.
- `RedisPubSubMicroserviceTransport` - Redis pub/sub 이벤트 트랜스포트 어댑터입니다.
- `NatsMicroserviceTransport` - NATS 트랜스포트 어댑터입니다 (요청/응답 + 이벤트).
- `KafkaMicroserviceTransport` - Kafka 트랜스포트 어댑터입니다 (이벤트, 인바운드 메시지 디스패치).
- `RabbitMqMicroserviceTransport` - RabbitMQ 트랜스포트 어댑터입니다 (이벤트, 인바운드 메시지 디스패치).

## 런타임 동작

- 컴파일된 모듈의 프로바이더와 컨트롤러에서 핸들러를 검색합니다.
- 싱글톤 스코프의 핸들러만 등록됩니다.
- `@MessagePattern`은 단일 핸들러와 매칭되며 해당 값을 호출자에게 반환합니다.
- 여러 `@MessagePattern` 핸들러가 동일한 패턴에 매칭되는 경우, 임의로 선택하지 않고 명시적으로 디스패치에 실패합니다.
- `@EventPattern`은 매칭되는 모든 핸들러로 디스패치합니다.
- 패턴은 정확한 문자열 또는 `RegExp` 매칭을 지원합니다.
- 트랜스포트 생명주기는 애플리케이션 시작 및 종료 시점에 관리됩니다.

## 트랜스포트 참고 사항

- `TcpMicroserviceTransport`는 `send()` (요청/응답)와 `emit()` (이벤트)를 모두 지원합니다.
- `RedisPubSubMicroserviceTransport`는 `emit()` 팬아웃(fan-out)만 지원합니다. 요청/응답 `send()` 시맨틱이 필요한 경우 TCP 트랜스포트를 사용하세요.
- `NatsMicroserviceTransport`는 NATS 요청/응답 및 pub/sub 주제를 통해 `send()`와 `emit()`을 모두 지원합니다.
- `KafkaMicroserviceTransport`와 `RabbitMqMicroserviceTransport`는 이벤트 전용 트랜스포트입니다. `emit()`과 인바운드 이벤트 디스패치를 지원합니다. 요청/응답 `send()`가 필요한 경우 TCP 또는 NATS 트랜스포트를 사용하세요.

### Kafka

- `KafkaMicroserviceTransport`는 현재 어댑터 계약에서 이벤트 전용입니다. `send()`는 항상 reject되므로 요청/응답 흐름은 TCP 또는 NATS를 사용해야 합니다.
- 인바운드 핸들러 실패는 트랜스포트 경계에서 격리되며 `emit()` 호출자에게 다시 전파되지 않습니다.
- 순서 보장, 오프셋 커밋 정책, 컨슈머 그룹 복구, 브로커별 재연결 의미론은 현재 Konekti가 보장하지 않습니다. 별도 가이드가 나오기 전까지는 브로커/클라이언트 책임으로 취급하세요.

### RabbitMQ

- `RabbitMqMicroserviceTransport`는 현재 어댑터 계약에서 이벤트 전용입니다. `send()`는 항상 reject되므로 요청/응답 흐름은 TCP 또는 NATS를 사용해야 합니다.
- 인바운드 핸들러 실패는 트랜스포트 경계에서 격리되며 `emit()` 호출자에게 다시 전파되지 않습니다.
- ack/nack, 재큐잉(requeue), dead-letter, 채널 복구 정책은 현재 이 어댑터가 구성하지 않습니다. 별도 가이드가 나오기 전까지는 브로커/클라이언트 책임으로 취급하세요.

### NATS

- `NatsMicroserviceTransport`는 별도의 요청/응답 subject와 이벤트 subject를 사용해 `send()`와 `emit()`을 모두 지원합니다.
- `send()`는 `requestTimeoutMs`를 적용하며, 트랜스포트가 에러 메시지로 직렬화해 되돌릴 수 있는 핸들러 실패만 호출자에게 전파합니다.
- 재연결, 버퍼링, responder 가용성은 여전히 클라이언트/서버 책임입니다. 운영상 요청/응답 보장이 중요하다면 선택한 NATS 클라이언트/runtime 조합에서 별도로 검증해야 합니다.

## 하이브리드 모드

런타임 앱 부트스트랩을 사용하고 동일한 컨테이너에서 마이크로서비스 런타임을 해결(resolve)합니다.

```typescript
const app = await KonektiFactory.create(AppModule, { mode: 'prod' });
const microservice = await app.container.resolve(MICROSERVICE);

await Promise.all([app.listen(), microservice.listen()]);
```

이 구성에서 앱과 마이크로서비스 런타임은 동일한 컨테이너에서 핸들러를 해결하므로, 싱글톤 프로바이더가 HTTP 및 마이크로서비스 흐름 전반에서 공유됩니다.
