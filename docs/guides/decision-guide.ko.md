# fluo Decision Guide

<p><a href="./decision-guide.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Platform Adapter Selection

| 조건 | 결정 | 패키지 |
| --- | --- | --- |
| 기본 Node.js HTTP 애플리케이션 | 권장 고성능 Node.js 어댑터를 선택 | `@fluojs/platform-fastify` |
| Node.js 애플리케이션에서 HTTP 리스너를 직접 제어해야 함 | 로우 Node 어댑터를 선택 | `@fluojs/platform-nodejs` |
| Node.js 애플리케이션이 Express를 host/platform HTTP engine으로 사용하되 application middleware는 fluo `Middleware` 계약에 남겨야 함 | Express 어댑터를 선택 | `@fluojs/platform-express` |
| Bun 네이티브 fetch 스타일 런타임 대상 | Bun 어댑터를 선택 | `@fluojs/platform-bun` |
| Deno `serve()` 런타임 대상 | Deno 어댑터를 선택 | `@fluojs/platform-deno` |
| Cloudflare Workers isolate 대상 | Workers 어댑터를 선택 | `@fluojs/platform-cloudflare-workers` |

## Database Adapter Selection

| 조건 | 결정 | 패키지 |
| --- | --- | --- |
| Prisma 워크플로와 ORM 라이프사이클 통합이 필요한 관계형 데이터베이스 | Prisma 어댑터를 선택 | `@fluojs/prisma` |
| Drizzle 워크플로와 ALS 기반 트랜잭션 컨텍스트가 필요한 관계형 데이터베이스 | Drizzle 어댑터를 선택 | `@fluojs/drizzle` |
| Mongoose 모델을 사용하는 문서 데이터베이스 | Mongoose 어댑터를 선택 | `@fluojs/mongoose` |
| 공유 Redis 서비스 또는 이름 있는 Redis 클라이언트가 필요함 | Redis 패키지를 선택 | `@fluojs/redis` |
| 애플리케이션 데이터 접근 위에 캐시 추상화가 필요함 | cache manager 패키지를 선택 | `@fluojs/cache-manager` |

## Transport Selection

| 조건 | 결정 | 명령 또는 패키지 |
| --- | --- | --- |
| 기본 전송을 사용하는 실행 가능한 마이크로서비스 스타터 | TCP를 선택 | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` |
| Redis Streams 기반 메시지 스트림 전송 | Redis Streams를 선택 | `fluo new my-service --shape microservice --transport redis-streams --runtime node --platform none` |
| NATS 기반 마이크로서비스 토폴로지 | NATS를 선택 | `fluo new my-service --shape microservice --transport nats --runtime node --platform none` |
| Kafka 기반 이벤트 전송 | Kafka를 선택 | `fluo new my-service --shape microservice --transport kafka --runtime node --platform none` |
| RabbitMQ 큐 토폴로지 | RabbitMQ를 선택 | `fluo new my-service --shape microservice --transport rabbitmq --runtime node --platform none` |
| MQTT 브로커 통합 | MQTT를 선택 | `fluo new my-service --shape microservice --transport mqtt --runtime node --platform none` |
| gRPC 서비스 계약 | gRPC를 선택 | `fluo new my-service --shape microservice --transport grpc --runtime node --platform none` |

## Package Stability Tier

| 조건 | 결정 | 계약 신호 |
| --- | --- | --- |
| 패키지가 canonical runtime matrix 또는 generated-app baseline에 있고, package surface가 안정된 책임을 설명함 | Official로 취급 | `docs/reference/package-surface.md` 또는 `docs/reference/toolchain-contract-matrix.md`가 근거 |
| 패키지가 first-party이고 package chooser 또는 package surface에 문서화되어 있지만, starter baseline이나 canonical runtime matrix에는 없음 | Preview로 취급 | 사용은 가능하지만 더 좁은 작업별 선택 기준이 필요함 |
| 패키지 또는 통합이 문서화된 package-surface 소유권, runtime matrix 존재, release-governance 기대치를 갖지 않음 | Experimental로 취급 | 명시적 문서 없이 안정 계약을 가정하지 않음 |
