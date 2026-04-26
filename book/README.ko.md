# fluo 3권 시리즈

[English](./README.md) &nbsp;&middot;&nbsp; [한국어](./README.ko.md)

이 3권 시리즈는 fluo를 단계적으로 익히기 위한 공식 학습 경로입니다. 현재 경험 수준에 맞는 권부터 시작한 뒤, 단일 HTTP 앱에서 분산 시스템, 프레임워크 내부 구조, 확장 지점까지 자연스럽게 이어서 읽을 수 있습니다.

## 개요

- **초보편**은 **FluoBlog**를 만들면서 fluo의 멘탈 모델, 표준 데코레이터, CLI 설정부터 동작하는 HTTP 애플리케이션까지의 흐름을 다룹니다.
- **중수편**은 그 기반을 **FluoShop**으로 확장해 분산 아키텍처, 전송 계층, 이벤트, 실시간 시스템, 알림, GraphQL, ORM 선택지, 크로스 런타임 이식성을 다룹니다.
- **고수편**은 fluo의 내부 동작을 설명하며, DI와 런타임 아키텍처부터 어댑터 설계, 이식성 테스트, Studio, 커스텀 패키지, 기여 경로까지 다룹니다.

## 어떤 권부터 읽으면 좋은가

- fluo가 처음이거나 가장 명확한 처음부터 끝까지의 학습 경로가 필요하다면 **[초보를 위한 fluo](./beginner/toc.ko.md)**부터 시작하세요.
- 기본 개념은 이미 익혔고 멀티 서비스, 이벤트 기반, 실시간 시스템 설계로 넓히고 싶다면 **[중수를 위한 fluo](./intermediate/toc.ko.md)**부터 시작하세요.
- 내부 구현, 플랫폼 경계, 확장 포인트, 기여자 수준의 이해가 필요하다면 **[고수를 위한 fluo](./advanced/toc.ko.md)**로 바로 가세요.

## 권별 구성

### [초보를 위한 fluo](./beginner/toc.ko.md)

**FluoBlog**를 만들면서 fluo의 핵심 모델을 익히는 책입니다. 모듈, 프로바이더, 컨트롤러, TC39 표준 데코레이터, 라우팅, DTO 검증, 직렬화, 예외 처리, 가드, 인터셉터, OpenAPI, 설정 관리, Prisma, 트랜잭션, 인증, 스로틀링, 캐싱, 헬스 체크, 메트릭, 테스트를 다룹니다.

### [중수를 위한 fluo](./intermediate/toc.ko.md)

**FluoShop**를 분산 애플리케이션으로 발전시키는 책입니다. 마이크로서비스 아키텍처, TCP, Redis, RabbitMQ, Kafka, NATS, MQTT, gRPC, 도메인 이벤트, CQRS, 사가, 큐, 스케줄링, 분산 락, WebSocket, Socket.IO, 알림, 이메일, Slack 및 Discord 연동, GraphQL, Mongoose, Drizzle, 어댑터 간 런타임 이식성을 다룹니다.

### [고수를 위한 fluo](./advanced/toc.ko.md)

프레임워크 내부와 확장을 중심으로 설명하는 책입니다. 데코레이터 역사와 메타데이터, 커스텀 데코레이터, 프로바이더 해석, 스코프, 순환 의존성 처리, 동적 모듈, 모듈 그래프 컴파일, 애플리케이션 컨텍스트와 어댑터 계약, 런타임 분기, HTTP 파이프라인 내부, 커스텀 어댑터, 이식성 테스트, Studio, 커스텀 패키지 작성, fluo 기여 과정을 다룹니다.

## 읽는 순서

기본 권장 순서는 다음과 같습니다.

1. [초보를 위한 fluo](./beginner/toc.ko.md)
2. [중수를 위한 fluo](./intermediate/toc.ko.md)
3. [고수를 위한 fluo](./advanced/toc.ko.md)

이 허브는 선택용 안내 페이지로도 쓸 수 있습니다. 한 권의 목차를 끝까지 읽은 뒤 다시 돌아와 다음 권을 고르면 됩니다.

## 길찾기

- 시리즈를 처음 시작한다면 **[초보편 목차](./beginner/toc.ko.md)**로 가세요.
- 전체 챕터 목록으로 들어가기 전에 방향을 잡고 싶다면 **[초보편 챕터 0](./beginner/ch00-introduction.ko.md)**, **[중수편 챕터 0](./intermediate/ch00-introduction.ko.md)**, **[고수편 챕터 0](./advanced/ch00-introduction.ko.md)**부터 읽어도 좋습니다.
- 초보편을 마쳤다면 **[중수편 목차](./intermediate/toc.ko.md)**로 이어서 읽으세요.
- 내부 구조나 기여 맥락이 필요하다면 **[고수편 목차](./advanced/toc.ko.md)**로 이동하세요.
- AI 도구이거나 학습 경로 대신 계약 레퍼런스가 필요하다면 **[AI Context Hub](../docs/CONTEXT.ko.md)**를 참고하세요.
