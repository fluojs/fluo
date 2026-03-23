# 지원 매트릭스 (support matrix)

<p><a href="./support-matrix.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 현재 지원 정책에 대한 요약 참조 표입니다.

## 지원 티어 (support tiers)

- `official` -> 지원되며 적극적으로 검증됨
- `preview` -> 의도적으로 제공되지만, 아직 완전한 기능 동등성이나 커버리지를 보장하지 않음
- `experimental` -> 탐색용으로 제공되며, 안정적인 지원을 약속하지 않음

## ORM x DB 매트릭스

| ORM | DB | 티어 | 비고 |
| --- | --- | --- | --- |
| Prisma | PostgreSQL | official / 권장 | 콜백 스타일의 요청 트랜잭션 인터셉터 지원; 중첩/세이브포인트 의미론은 보장되지 않음 |
| Prisma | MySQL | official | 콜백 스타일의 요청 트랜잭션 인터셉터 지원; 중첩/세이브포인트 의미론은 보장되지 않음 |
| Drizzle | PostgreSQL | official | 콜백 스타일의 요청 트랜잭션 인터셉터 지원; 중첩/세이브포인트 의미론은 드라이버/데이터베이스 역량에 따라 다름 |
| Drizzle | MySQL | preview | 더 좁은 문서/예제/테스트 커버리지 예상; 중첩/세이브포인트 의미론은 보장되지 않음 |

## 런타임 매트릭스

| 런타임 | 티어 | 비고 |
| --- | --- | --- |
| Node.js | official | 첫 번째 공식 런타임 |
| Fastify 어댑터 | preview | host/HTTPS/CORS/multipart/rawBody에 대해 Node 런타임 옵션 동등성을 갖춘 `@konekti/platform-fastify` 어댑터이며, `getServer()`가 노출하는 공용 Node `upgrade` 리스너 경로를 통해 WebSocket 게이트웨이도 검증됨 |
| 마이크로서비스 트랜스포트 | preview | TCP, Redis Pub/Sub, Kafka, NATS, RabbitMQ 트랜스포트 어댑터 및 `KonektiFactory.createMicroservice()`를 포함한 `@konekti/microservices` |
| Bun | preview | 코어 계약이 이 런타임으로 승격 가능하도록 유지되어야 함 |
| Fetch 스타일 어댑터 | preview | 더 좁은 보장 범위를 가진 어댑터가 존재할 수 있음 |
| Deno | experimental | 향후 후보 |

## 승격 조건 요약 (promotion gate)

승격을 위해서는 다음 항목들이 모두 충족되어야 합니다:

- 문서화 (docs)
- 테스트 (tests)
- CI 연동
- 예제 커버리지
- 트러블슈팅 가이드

## 현재 경계

- 현재 공식 매트릭스는 위에 나열된 조합으로 제한됩니다.
- 현재 추가적인 ORM x DB 조합은 승격되지 않았습니다.
- 현재 추가적인 공개 데이터 통합 패키지는 약속되지 않았습니다.
- 매트릭스 외 후보들은 동일한 승격 조건을 만족하기 전까지 이슈(Issue) 기반으로 관리되어야 합니다.

## 트랜잭션 지원 참고 사항

- 요청 스코프 자동 트랜잭션은 기본 서비스 정책이 아닌 선택형(opt-in) 인터셉터 통합 기능입니다.
- 스트리밍/파일/SSE/장기 실행 응답 경로는 스택 전용 가이드에서 별도로 명시하지 않는 한 비트랜잭션으로 취급되어야 합니다.
- 요청 중단 시 롤백은 활성 어댑터가 `FrameworkRequest.signal`을 어떻게 연결하는지에 달려 있습니다.
- 중첩/세이브포인트 / `requires_new` 의미론은 현재 공식 보장 범위에 포함되지 않습니다.

## 관련 문서

- `./package-surface.ko.md`
- `./toolchain-contract-matrix.ko.md`
- `../concepts/transactions.ko.md`
- `../operations/release-governance.ko.md`
