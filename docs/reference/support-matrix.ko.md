# 지원 매트릭스

<p><a href="./support-matrix.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 현재 지원 정책을 빠르게 확인할 수 있는 참조 표입니다.

## 지원 등급

- `official` -> 지원되며 적극적으로 검증됨
- `preview` -> 의도적으로 제공되지만 아직 완전한 동등성/커버리지를 약속하지 않음
- `experimental` -> 탐색용으로 제공되며, 안정적인 지원 약속은 아님

## ORM x DB 매트릭스

| ORM | DB | 등급 | 비고 |
| --- | --- | --- | --- |
| Prisma | PostgreSQL | official / recommended | callback 스타일 request transaction interceptor 지원; nested/savepoint 시맨틱은 보장하지 않음 |
| Prisma | MySQL | official | callback 스타일 request transaction interceptor 지원; nested/savepoint 시맨틱은 보장하지 않음 |
| Drizzle | PostgreSQL | official | callback 스타일 request transaction interceptor 지원; nested/savepoint 시맨틱은 driver/database 역량에 따라 달라짐 |
| Drizzle | MySQL | preview | 더 좁은 docs/examples/test 커버리지를 예상; nested/savepoint 시맨틱은 보장하지 않음 |

## runtime 매트릭스

| Runtime | 등급 | 비고 |
| --- | --- | --- |
| Node.js | official | 첫 번째 공식 runtime |
| Fastify adapter | preview | `@konekti/platform-fastify` adapter가 host/HTTPS/CORS/multipart/rawBody 옵션 형태 동등성을 제공 |
| Microservices transport | preview | `@konekti/microservices`가 TCP, Redis Pub/Sub, Kafka, NATS, RabbitMQ transport adapter와 `KonektiFactory.createMicroservice()`를 제공 |
| Bun | preview | core 계약이 이 runtime으로 승격 가능해야 함 |
| Fetch-style adapter | preview | 더 좁은 보장 범위를 가진 adapter가 존재할 수 있음 |
| Deno | experimental | 이후 후보 |

## 승격 게이트 요약

승격에는 다음이 모두 필요합니다.

- docs
- tests
- CI
- example coverage
- troubleshooting guidance

## 현재 boundary

- 현재 official matrix는 위에 나열된 조합으로 제한됩니다.
- 추가 ORM x DB 조합은 현재 승격하지 않습니다.
- 추가 public data-integration package도 현재 약속하지 않습니다.
- matrix 밖 후보는 동일한 promotion gate를 만족하기 전까지 issue 중심으로 다뤄야 합니다.

## 트랜잭션 지원 메모

- request-scoped 자동 트랜잭션은 기본 서비스 정책이 아니라 opt-in interceptor 통합임
- streaming/file/SSE/장시간 응답 경로는 stack-specific 가이드가 따로 없는 한 비트랜잭션으로 취급해야 함
- request abort rollback은 active adapter가 `FrameworkRequest.signal`을 어떻게 연결하는지에 달림
- nested/savepoint / `requires_new` 시맨틱은 현재 official 보장 범위에 포함되지 않음

## 관련 문서

- `./package-surface.ko.md`
- `./toolchain-contract-matrix.ko.md`
- `../concepts/transactions.md`
- `../operations/release-governance.md`
