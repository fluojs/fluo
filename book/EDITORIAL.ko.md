# 3권 시리즈 집필 기준

## 확정된 방향

이 책의 원본 언어는 한국어다. 최초 집필은 한국어 72장 전체를 완성하고 통합 검토한 뒤 영어로 번역한다. 기존 Book의 정정은 의존 장을 포함한 영향받는 한국어 묶음 전체를 검토·확정하고 동결한 뒤 영어로 옮긴다. 한국어 집필 단계에서 영문 본문을 병행 작성하지 않는다. 확정 목차와 파일 식별자는 [series.json](./series.json)에 있다. 1권은 24장, 2권은 28장, 3권은 20장이다.

Book이 중심 학습 경로다. 사이트의 짧은 FluoBlog 실습은 초기 HTTP/DI 학습을 보조하는 실행 예제다. 새 원고는 book/01-fluoblog, book/02-fluoshop, book/03-internals에 두고, 기존 beginner/intermediate/advanced 파일은 이전 판의 안정 링크와 계약 근거로 유지한다. 새 본문은 이전 판의 project-state나 장별 스냅샷 주장을 이어받지 않는다.

프레임워크 사실의 규범적 기준은 [Docs 권위 정책](../docs/contracts/documentation-authority.ko.md)에 따른 Docs 계층이며, 패키지 API의 원본은 그 계층에서 위임된 패키지 README다. Book은 같은 계약을 사람이 이해하도록 제품 요구, 설계 이유, 실행 과정과 실패 사례로 풀어쓴다. Docs 기준 확정 → 근거 검증 → Book 한국어 적용 → 영어 대응 → 인계 순서를 따른다. 계약·구현·테스트가 충돌하면 먼저 담당 Docs에서 문서 오류인지 구현 회귀인지 판정하며, 구현에 맞춰 기존 보장을 조용히 낮추지 않는다.

## 서사와 제품의 연속성

1권의 운영자는 개발 경험을 공유하는 FluoBlog를 만든다. 글 작성, 발행, 독자 계정, 구독과 운영이 차례로 필요해진다. 1권 마지막에는 독자들이 로고 티셔츠와 스티커를 요청한다.

2권은 1권의 같은 애플리케이션, 사용자 ID, 인증, 설정, 배포와 관측 기반에서 시작한다. accounts와 content를 다시 만들지 않는다. catalog, inventory, cart, orders, payments, fulfillment, notifications 모듈을 필요한 시점에 추가한다. 먼저 모듈형 모놀리스로 개발하고 23장에서 배송 처리만 별도 프로세스로 분리한다. 비교 실습인 24~26장은 모든 브로커와 ORM을 본문에 동시에 도입하지 않는다.

3권은 같은 게시글·주문 요청이 실제 Fluo 소스를 통과하는 과정을 추적한다. 패키지 나열이나 낡은 줄 번호 목록 대신 질문, 작은 실행 실험, 구현 근거, 실패 조건, 확장 방법을 연결한다.

## 공통 이름과 데이터 계약

이 절의 제품 모델, KRW 선택, 게시글·주문 상태와 앱 주소는 애플리케이션 소유 정책이다. Fluo가 자동으로 제공하는 프레임워크 보장으로 설명하지 않는다. 프레임워크의 기본값·순서·실패·자원 소유권은 담당 Docs 계약을 따르며, 의도적으로 실패하는 중간 구현이나 비교 실험은 최종 권장 구현과 구분한다.

- 애플리케이션 디렉터리는 CLI로 만든 fluo-blog이며, 소스 경로는 src/app.ts, src/main.ts, `src/<feature>/...`를 사용한다. 기존 예제 저장소 경로를 독자가 생성한 파일과 혼동하지 않는다.
- 기능 모듈은 AccountsModule, PostsModule, CatalogModule, InventoryModule, OrdersModule, PaymentsModule, FulfillmentModule이다. 인터페이스 이름만으로 DI가 되지 않는다. class-level @Inject와 실제 토큰, imports/providers/exports 등록을 보여준다.
- 게시글은 id, authorId, title, content, slug, status, version, publishedAt를 필요해지는 시점에 추가한다. Post.id는 양의 정수(Prisma Int), authorId는 문자열 사용자 ID다. 새 초안의 version은 1이고 첫 수정 또는 발행 후 2가 된다. 초기 발행 seed도 version=2를 유지한다. status는 draft 또는 published이며 본문의 발행 전이는 draft → published다. 편집은 초안에만 허용하고 발행본은 불변으로 유지한다. 개정 기능은 별도로 도입할 제품 변경이며 인가 장에서 조용히 허용하지 않는다. 첫 HTTP 실습의 최소 seed는 id=1, title=Hello, Fluo!, content=My first post.이다.
- 1권의 사용자 식별자와 JWT subject를 2권에서 그대로 사용한다. 고객 정보는 기존 계정에 확장하며 계정 테이블을 다시 만들지 않는다. 비밀번호와 토큰 원문은 응답·로그에 노출하지 않는다.
- 주문은 id, customerId, status, currency, totalMinor, version을 갖는다. 상태 이름은 pending_payment, paid, fulfilling, shipped, cancelled, refund_pending, refunded를 기준으로 한다. 재고 예약은 주문 상태와 별도 수명주기를 갖는다. 임의의 상태 전이를 허용하지 않는다.
- 본문의 기본 통화는 KRW, 금액은 최소 화폐 단위의 정수다. TypeScript 내부 bigint를 사용할 때 JSON에는 십진 문자열로 변환한다. DB 정수 범위와 통화 일치, 수량 유효성을 경계에서 확인한다. float로 결제 금액을 계산하지 않는다.
- 주문 항목의 SKU, 단가, 수량, 할인은 주문 시점의 스냅샷이다. 이후 상품 변경이 과거 주문을 바꾸지 않는다. 클라이언트의 가격이나 customerId를 권위 있는 값으로 쓰지 않는다.
- HTTP는 /posts, /posts/:id, /auth/..., /products, /cart, /orders, /orders/:id, /payments/webhooks 경로를 사용한다. 없는 리소스는404, 검증 실패는400, 권한 없음은403, 미인증은401, 충돌은409로 설계하되 실제 프레임워크 예외 매핑을 확인한다.
- 데이터베이스 본문은 PostgreSQL + Prisma다. 2권25장의 Drizzle과26장의 Mongoose는 별도 비교 실습이다. 애플리케이션 소유 모델·테이블은 책에서 정의한 예제이며 Fluo 패키지가 생성해 주는 기능으로 설명하지 않는다.
- 비동기 본문은 Redis 기반 queue, 프로세스 내부 event-bus, 필요 시 RabbitMQ 기반 서비스 경계로 진행한다. 각 패키지의 실제 지원 계약을 확인하며 ACK, durability, 재시도 정책을 일반화하지 않는다.

## 장 사이에서 유지할 구현 경계

1권 10장의 단일 DB 등록은 `src/database/blog-database.module.ts`의 `BlogDatabaseModule`이다. `PrismaModule.forRootAsync`가 `AppSettings`를 주입받아 컨테이너별 클라이언트를 만들고 `global: true`로 공유한다. 2권에서 같은 객체를 재사용하며, 존재하지 않는 전역 `prisma` 변수를 가정하거나 새 `DatabaseModule`과 `forRoot`를 병렬로 만들지 않는다. 같은 raw client를 전달해도 서로 다른 PrismaService의 트랜잭션 문맥이 합쳐지는 것은 아니다.

게시글 초안은 빈 제목·본문·slug를 허용한다. UTF-16 길이 상한은 title 120, content 50,000, slug 80이며 발행 시 완성 조건을 추가로 확인한다. slug 유일성은 발행된 글에 적용한다. 인증 장이 다른 길이 단위나 더 느슨한 제한으로 도메인을 우회하지 않게 한다. 기존 익명 POST·PUT·발행 경로를 남긴 채 새로운 PATCH만 보호하지 않는다.

2권의 SKU 모델은 3장에서 만든 `ProductVariant`다. `priceMinor`, `active`, 부모 `Product`의 발행 상태를 가격·장바구니에서도 유지한다. 할인 필드가 필요하면 기존 모델에 명시적으로 추가하고 `PriceRow`로 변환한다. 별도의 `CatalogSku` 원장에 판매 데이터를 다시 채우도록 요구하지 않는다.

재고는 `Stock.available`과 복합 키 `(orderId, sku)`의 `Reservation`을 기준으로 한다. 예약 시 판매 가능 수량을 줄이고, 결제 확정 때 예약을 `consumed`로 바꾸되 다시 차감하지 않는다. 결제 전 취소는 `released`로 바뀐 예약만 한 번 반환한다. 결제 후 환불은 별도의 영속 보상 기록과 함께 같은 재고 원장을 사용한다. `Inventory.onHand - reserved`라는 다른 계산법을 설명 없이 끼워 넣지 않는다.

주문 버전은 게시글과 달리 0에서 시작한다. `OrderTransitionsService.apply`는 상태·버전·`OrderTransition` 기록을 같은 트랜잭션에 저장한다. `OrderInventoryService.confirmPayment`는 상태 전이와 예약 확인을 묶는다. 웹훅·대사·환불·Outbox에서도 이 보장을 유지한다. Outbox는 모든 상태 전이의 감사 기록을 대체하지 않는다.

실제 결제 원장의 경로는 `src/payments/payment-ledger.ts`의 `PaymentLedger.prepare/record`다. 저장한 시도 ID와 금액을 사용해 트랜잭션 밖에서 청구하는 조율 코드를 제공한다. 이벤트 장은 이 실제 경계에 연결하며, 앞에서 구현하지 않은 `confirm-payment.service.ts`를 이미 존재하는 코드로 취급하지 않는다.

## 한 장의 완성 기준

장 제목은 확정 목차를 따른다. 본문은 개요나 집필 계획이 아니라 읽고 배울 수 있는 완성 원고여야 한다. 한 장은 다음을 갖춘다.

1. 제품에 생긴 구체적인 요구와 이전 장의 상태.
2. 기존 구현이 실패하는 구체적인 상황과 이유.
3. 처음에는 작은 구현, 요구가 생기면 필요한 패턴으로 바꾸는 과정.
4. 실제 Fluo API를 사용하는 코드와 그 코드가 들어갈 파일·모듈 경계.
5. 정상뿐 아니라 경합, 중복, 부분 실패, 종료 같은 해당 주제의 실패 사례.
6. 의미 있는 테스트 또는 실행 실험과 예상 결과. 실행하지 않은 명령을 통과했다고 쓰지 않는다.
7. 언제 이 패턴을 쓰지 않는지, 다른 선택의 비용, 다음 장으로 이어지는 상태.
8. 담당 Docs 계약과 위임된 패키지 README, 소스·테스트의 클릭 가능한 근거 링크.

분량 채우기와 같은 문장의 반복을 피한다. 특히 복잡한 정합성 장을 짧은 체크리스트나 설계 조언 몇 개로 끝내지 않는다. 설명, 코드의 이유, 실패 시나리오를 연결된 문단으로 발전시킨다. 각 장의 필수 절차를 외부 문서로 떠넘기지 않는다. 코드 블록만 길고 설명이 없는 원고도 완성이 아니다.

## 코드와 검증의 정직성

완전한 파일, 애플리케이션 부분 구현, 설명용 의사코드를 구분한다. 완전한 파일은 필요한 import와 타입을 포함하고, 부분 구현은 이미 존재해야 할 클래스·스키마·토큰과 위치를 정의한다. 핵심 처리를 TODO, 생략, 구현 예정, 주석 한 줄로 대체하지 않는다. 불필요한 범용 Repository, 모든 작업의 CQRS 전환, 근거 없는 마이크로서비스 분리는 좋은 패턴으로 권하지 않는다.

이 책의 확정 목차는 제품 개발 범위를 정하지만, 저장소에 72개 장의 완성 앱이 이미 존재한다고 주장하지 않는다. 실행 가능한 기존 examples/fluo-blog 체크포인트는 초기 HTTP/DI/검증 경로의 근거다. 데이터베이스·메일·브로커·결제사 실험은 필요 환경과 재현 절차를 명시하며, 실제 연결 검증과 단위/계약 검증을 구분한다.

Outbox/Inbox, 영속 Saga 상태, webhook 서명 검증, 멱등성 저장소, 비밀번호 해시, 결제·파일 저장소 어댑터는 애플리케이션 소유 구현이다. 패키지 등록만으로 exactly-once, 재시작 복구, 결제 정합성이 생긴다고 쓰지 않는다. 돈·외부 시스템·시간을 다루는 코드는 실패와 재시도의 책임을 명시한다.

Node.js 지원 범위는 >=24.0.0 <27, 본문 실행 기준은 Node24와 pnpm10이다. 1권 1장에서 TypeScript `lib`를 ES2024, DOM, ESNext.Decorators로 맞추며, 이후 설정 변경에서도 이를 유지한다. CLI의 ES2022 target만으로는 Promise.withResolvers의 타입을 읽지 못한다. 표준 데코레이터를 사용하고 experimentalDecorators/emitDecoratorMetadata에 의존하지 않는다. TC39 단계와 네이티브 런타임 지원을 혼동하지 않는다. 현재 서버 recipe는 `AdapterClass.create(options)`, `FluoFactory.create(AppModule, { adapter, ... })`, `await app.listen()`이며, 실제 options와 수명주기 계약을 읽는다.

## 원본과 링크

공통 계약은 [Docs 허브의 원본 책임](../docs/README.ko.md#원본-책임)에서 담당 문서 쌍을 찾는다. 장의 프레임워크 설명을 그 Docs의 적용 범위, 전제, 공개 import, 입력·기본값·출력, 순서·실패·소유권·제약과 대조하고, 소스·테스트는 추가 근거로 유지한다. Docs 변경의 영향이 있는 장을 기록하되 의미가 바뀌지 않아 Book 수정이 불필요하면 그 이유를 인계한다. 원본 링크는 장의 필수 설명이나 실행 절차를 대신하지 않는다.

각 장에서 주장하는 API는 담당 `packages/<name>/README.ko.md`와 현재 src/ 공개 export를 확인한다. 원고 파일에서 저장소 루트 문서로 가는 링크는 ../../packages/... 또는 ../../docs/...이다. 새 시리즈 내부 링크는 확정 slug를 사용한다. 마지막 장을 제외한 모든 장에는 이전/다음/권별 목차 링크가 있어야 한다. 권 경계는 다음 권의 첫 장으로 연결한다.

장별 상단에 `<!-- book:volume=01-fluoblog;chapter=01 -->` 형태의 식별자를 둔다. packages는 series.json에서 관리한다. 코드와 명령은 영문 번역에서도 원문과 동일하게 유지한다. 자연어 설명을 테스트로 고정하지 않는다. 구조, 링크, 코드 블록 일치, 명시적인 실행 예제만 자동 검증한다.

## 한국어 확정 후 번역

최초 집필은 한국어 세 권 전체를, 정정은 영향받는 한국어 묶음 전체를 먼저 기술·서사 검토하고 동결한다. 그 결과를 기준으로 영어 .md 파일을 만들며, 장·절 순서, 예제, 명령, 결과, 기본값, 제약, 실패 조건을 누락하지 않는다. 번역은 축약본이나 새 집필이 아니다. 코드 블록 내부 주석도 먼저 동일하게 유지해 실행 예제의 차이를 만들지 않는다. 용어는 멱등성/idempotency, 대사/reconciliation, 보상/compensation, 가시성/visibility, 정리/disposal를 일관되게 사용한다.

한국어 집필 중에는 일시적으로 locale 대응이 불완전할 수 있지만, 병합 가능한 각 증분에는 확정한 한국어와 영어 대응을 함께 포함한다. 장 사이 의존성이 있으면 같이 검증 가능한 묶음으로 반영하고 미번역 초안은 섞지 않는다. `pnpm book:check:ko`는 작성 중 검사, `pnpm book:check`는 양언어 증분 검사다. 기존 구조·링크·코드 검사를 통과해도 번역 의미나 72개 장 전체의 Docs 정렬을 자동 증명하지는 않는다. 실제 검사 명령·결과와 미검증 범위를 receipt에 남긴다.
