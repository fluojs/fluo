# 운영 대시보드에 맞는 조회 API 만들기

<!-- book:volume=02-fluoshop;chapter=20 -->

[이전: 주문 상태를 실시간으로 보여주기](./ch19-realtime-orders.ko.md) · [목차](./toc.ko.md) · [다음: 상품은 캐시해도 재고 판단은 캐시만 믿지 않기](./ch21-commerce-caching.ko.md)

## 운영 화면 한 장이 요청 수십 개를 만든다

FluoShop 운영자는 아침에 결제 완료 주문을 확인하고 포장 대상과 고객 문의를 함께 살펴본다. 처음에는 `GET /orders`로 목록을 받은 뒤 각 행의 고객 이름을 별도 조회했다. 주문이 스무 개면 고객 요청도 스무 개 생긴다. 같은 독자가 주문을 여러 번 했어도 같은 계정 정보를 다시 요청한다. 19장의 실시간 상태 갱신은 한 행의 신선도를 높여 주지만, 화면을 처음 그릴 때 필요한 여러 데이터를 효율적으로 조합하는 문제까지 해결하지는 않는다.

여기서 REST를 버릴 이유는 없다. 운영 화면 하나만 있다면 전용 HTTP 조회 응답을 만들고 서버에서 한 번에 조합하는 편이 더 단순하다. 이 장에서 GraphQL을 선택하는 이유는 주문 목록, 고객 문의 화면, 간단한 집계 화면이 서로 다른 필드 조합을 요구하기 때문이다. 화면이 필요한 필드를 선택하게 하되, 어떤 데이터와 비용을 허용하는지는 서버가 계속 통제한다.

조회 API의 모양을 바꾼다고 주문 쓰기 규칙도 바꾸지는 않는다. 결제와 재고, 취소와 환불은 앞선 명령 경계를 유지한다. 이 장의 GraphQL에는 결제 mutation이나 임의 상태 변경 mutation을 만들지 않는다. `OrdersModule`의 조회와 기존 `AccountsModule`의 계정 표시 정보를 조합하는 운영용 읽기 경계만 추가한다. 1권의 독자와 2권의 고객은 같은 사용자 ID를 가진다.

대시보드의 `paid`는 결제사의 성공 응답을 직접 변환한 문자열이 아니다. `src/payments/payment-ledger.ts`의 `PaymentLedger.prepare/record` 경계와 결과 반영을 거쳐 `OrderInventoryService.confirmPayment`가 확정한 주문 상태다. 상태·버전·`OrderTransition` 감사는 `OrderTransitionsService.apply`로 함께 기록되고 예약은 `consumed`가 된다. 조회 resolver는 이를 읽으며 재고를 다시 차감하거나 대시보드 조회를 계기로 결제를 확정하지 않는다.

## TypeScript 타입과 GraphQL 스키마는 다른 계약이다

`@fluojs/graphql`은 GraphQL Yoga를 기반으로 한다. `GraphqlModule.forRoot`로 등록하고, `@Resolver`, `@Query`, `@FieldResolver`로 공개 작업을 선언한다. TypeScript 반환 타입을 적었다고 GraphQL 객체 타입이 자동 생성되지는 않는다. `outputType`이 없는 root operation은 기본 `String`을 사용한다. 객체에는 명시적인 `GraphQLObjectType`, 목록에는 `listOf(...)` 같은 출력 선언이 필요하다.

표준 데코레이터의 인자 바인딩도 구분한다. root resolver는 `(input, context)`를 받으며 DTO의 필드에 `@Arg`를 둔다. object field resolver의 `@Parent`, `@Context`, `@Args`는 **메서드 데코레이터**다. TypeScript의 parameter decorator처럼 매개변수 앞에 붙이지 않는다. `@Parent(0)`, `@Context(1)`은 각각 인덱스 0과 1에 값을 넣으라는 선언이다. 이 명시성이 `experimentalDecorators`나 `emitDecoratorMetadata`에 의존하지 않는 Fluo 작성 모델의 일부다.

스키마에는 저장된 모든 열을 노출하지 않는다. 주문을 찾는 데 필요한 내부 `customerId`는 parent 객체에는 있어도 GraphQL 필드로 선언하지 않을 수 있다. 비밀번호 해시, 결제사 토큰, 내부 메모가 저장 객체에 있다는 이유만으로 자동 직렬화되어서는 안 된다. 다음 구현은 주문 식별자·상태·통화·금액·버전, 그리고 계정 표시 이름만 공개한다.

금액의 출력 타입은 `String`이다. GraphQL `Int`는 부호 있는 32비트 정수이고 JavaScript `number`도 모든 큰 정수를 정확히 표현하지 못한다. DB와 TypeScript에서 정수로 계산한 `totalMinor`를 API 경계에서 십진 문자열로 변환한다. 통화가 `KRW`이므로 예제의 `"29000"`은 29,000원이다. `Float`를 사용해 금액 범위 문제를 우회하지 않는다. 버전은 PostgreSQL 정수 열 범위에 맞는 0 이상의 정수로 유지한다. 새 주문의 버전 0은 정상적인 `pending_payment` 응답이며 GraphQL의 non-null `Int`에도 유효하다. 게시글의 초기 버전 1을 주문 응답에 적용하지 않는다.

## 화면의 조회 요구를 작은 포트로 표현한다

다음 `src/orders/dashboard/contracts.ts`는 **완전한 애플리케이션 계약 파일**이다. 범용 repository를 만드는 대신 대시보드가 필요한 두 조회만 분리한다. `OrderDashboardRead`는 기존 주문 원장, `AccountLabelsRead`는 기존 `User`의 표시 정보를 읽는다. 아래에서 두 포트의 Prisma 구현까지 연결한다. 루트의 `src/database/blog-database.module.ts`에 있는 `BlogDatabaseModule`이 global로 공유하는 `PrismaService`를 주입받으며, `AppSettings`를 받는 `PrismaModule.forRootAsync` 등록은 그대로 둔다. resolver나 대시보드 모듈에서 새 DB wrapper를 만들지 않는다.

주문 조회는 저장된 `Order.totalMinor`와 주문 항목 스냅샷을 사용한다. 상품 화면의 현재 가격은 `ProductVariant.priceMinor`와 판매 가능 조건으로 판단하지만 그 값을 과거 주문에 다시 적용하지 않는다. 대시보드용 포트는 기존 원장의 읽기 모양을 좁힐 뿐 상품·재고·계정 데이터를 평행한 원장에 다시 채우는 계층이 아니다.

```ts
export type OrderStatus =
  | 'pending_payment' | 'paid' | 'fulfilling' | 'shipped'
  | 'cancelled' | 'refund_pending' | 'refunded';

export type DashboardOrder = Readonly<{
  id: string;
  customerId: string;
  status: OrderStatus;
  currency: 'KRW';
  totalMinor: string;
  version: number;
}>;

export type CustomerLabel = Readonly<{
  id: string;
  displayName: string;
}>;

export interface OrderDashboardRead {
  list(input: {
    status: OrderStatus;
    after: string | null;
    take: number;
  }): Promise<readonly DashboardOrder[]>;
}

export interface AccountLabelsRead {
  findMany(ids: readonly string[]): Promise<readonly CustomerLabel[]>;
}

export const ORDER_DASHBOARD_READ = Symbol('orders.dashboard.read');
export const ACCOUNT_LABELS_READ = Symbol('accounts.labels.read');
```

`list`의 계약은 지정 상태의 주문을 변경되지 않는 ID 오름차순으로 정렬하고, `after`가 있으면 그 ID보다 큰 행만 `take`개까지 반환하는 것이다. ID는 이 실험에서 ASCII 문자·숫자·밑줄·하이픈으로 제한한다. 운영 DB에서는 비교와 정렬의 collation을 같은 규칙으로 맞춘다. 시간순 화면을 원하면 생성 시각과 ID의 복합 cursor로 바꿔야 하며, 문자열 ID의 순서가 생성 시각 순서라고 설명해서는 안 된다.

이 포트는 한 번의 목록 요청에 `first + 1`행을 요구할 수 있다. 추가 행 하나로 다음 페이지 존재 여부를 판단하면 매 화면에서 전체 건수 집계를 하지 않아도 된다. 상태가 페이지 사이에 바뀌는 운영 목록은 시점 고정 스냅샷이 아니다. 이미 본 주문이 상태 필터에서 빠지거나 뒤 페이지에 새 주문이 나타날 수 있음을 UI에 반영한다. 회계 마감 보고서처럼 정확한 동일 시점 집계가 필요한 요구는 별도 트랜잭션·스냅샷 조회로 다뤄야 한다.

## 조회와 필드 조합을 실제 resolver로 만든다

다음 `src/orders/dashboard/resolvers.ts`는 **완전한 파일**이다. 데이터 저장 구현은 앞의 두 포트로 주입하지만 페이지 계산, 인자 검증, 권한 판정, field resolution과 배치는 여기서 모두 구현한다. `requireOperator`가 확인하는 `shop_operator`는 이 장에서 새로 정의하는 **요청 한정 대시보드 권한**이다. 기존 `AccountsService`가 이 역할을 부여하거나 로그인 JWT에 넣어 주지는 않는다. 뒤의 선행 미들웨어가 공유 인증을 마친 계정 ID와 서버 설정의 허용 목록을 대조한 경우에만 요청 principal에 붙인다. GraphQL 인자나 JWT의 역할 문자열만으로 이 권한을 얻을 수 없다.

```ts
import { Inject } from '@fluojs/core';
import {
  Arg, Context, FieldResolver, Parent, Query, Resolver,
  createDataLoader, type GraphQLContext,
} from '@fluojs/graphql';
import {
  GraphQLBoolean, GraphQLError, GraphQLID, GraphQLInt,
  GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLString,
} from 'graphql';
import {
  ACCOUNT_LABELS_READ, ORDER_DASHBOARD_READ,
  type AccountLabelsRead, type CustomerLabel, type DashboardOrder,
  type OrderDashboardRead, type OrderStatus,
} from './contracts.js';

const statuses = new Set<string>([
  'pending_payment', 'paid', 'fulfilling', 'shipped',
  'cancelled', 'refund_pending', 'refunded',
]);

export function requireOperator(context: GraphQLContext): void {
  if (!context.principal) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  if (!context.principal.roles?.includes('shop_operator')) {
    throw new GraphQLError('Operator role required', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

const CustomerType = new GraphQLObjectType({
  name: 'ShopCustomerLabel',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLID) },
    displayName: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const OrderType = new GraphQLObjectType({
  name: 'ShopDashboardOrder',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLID) },
    status: { type: new GraphQLNonNull(GraphQLString) },
    currency: { type: new GraphQLNonNull(GraphQLString) },
    totalMinor: { type: new GraphQLNonNull(GraphQLString) },
    version: { type: new GraphQLNonNull(GraphQLInt) },
    customer: { type: CustomerType },
  },
});

const PageType = new GraphQLObjectType({
  name: 'ShopOrderPage',
  fields: {
    nodes: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(OrderType))),
    },
    endCursor: { type: GraphQLID },
    hasNextPage: { type: new GraphQLNonNull(GraphQLBoolean) },
  },
});

export class OrdersInput {
  @Arg('status')
  status = 'paid';

  @Arg('first')
  first = 20;

  @Arg('after')
  after: string | null = null;
}

@Inject(ORDER_DASHBOARD_READ)
@Resolver()
export class DashboardQueries {
  constructor(private readonly orders: OrderDashboardRead) {}

  @Query({
    fieldName: 'orders',
    input: OrdersInput,
    argTypes: { first: 'int', status: 'string', after: 'id' },
    outputType: PageType,
  })
  async ordersPage(input: OrdersInput, context: GraphQLContext) {
    requireOperator(context);
    if (typeof input.status !== 'string' || !statuses.has(input.status)
      || !Number.isInteger(input.first) || input.first < 1 || input.first > 50
      || (input.after !== null
        && (typeof input.after !== 'string'
          || !/^[A-Za-z0-9_-]{1,80}$/.test(input.after)))) {
      throw new GraphQLError('Invalid order page arguments', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    const rows = await this.orders.list({
      status: input.status as OrderStatus,
      after: input.after,
      take: input.first + 1,
    });
    const nodes = rows.slice(0, input.first);
    return {
      nodes,
      endCursor: nodes.at(-1)?.id ?? null,
      hasNextPage: rows.length > input.first,
    };
  }
}

@Inject(ACCOUNT_LABELS_READ)
@Resolver('ShopDashboardOrder')
export class DashboardOrderFields {
  private readonly customerById;

  constructor(accounts: AccountLabelsRead) {
    this.customerById = createDataLoader<string, CustomerLabel | null>(
      async ids => {
        const rows = await accounts.findMany(ids);
        const byId = new Map(rows.map(row => [row.id, row]));
        return ids.map(id => byId.get(id) ?? null);
      },
      { maxBatchSize: 50 },
    );
  }

  @FieldResolver('customer')
  @Parent(0)
  @Context(1)
  customer(
    order: DashboardOrder,
    context: GraphQLContext,
  ): Promise<CustomerLabel | null> {
    requireOperator(context);
    return this.customerById(context).load(order.customerId);
  }
}
```

계정이 탈퇴했거나 표시 정보가 없을 때 `customer`는 `null`이다. 과거 주문을 삭제하거나 주문 목록 전체를 실패시키지 않는다. 반대로 주문의 `id`, 금액, 통화 같은 필수 필드가 없다면 정상 응답인 척 빈 문자열을 넣지 않는다. 명시적인 non-null 필드가 그 계약 위반을 드러낸다. GraphQL의 null 전파는 오류를 어느 범위까지 확산할지 결정하므로, 모든 필드에 기계적으로 non-null을 붙이는 것도 좋은 설계가 아니다.

입력 DTO의 기본값은 인자가 생략되었을 때 사용된다. `first: null`은 생략과 다르며 위 검증에서 거부된다. `@Arg`를 사용했다고 SDL의 인자가 자동으로 non-null이 되는 것도 아니다. 이 구현은 명시적 범위 검증과 `BAD_USER_INPUT`을 사용한다. 제품이 인자 자체의 non-null SDL을 요구한다면 현재 code-first 계약을 확인하고 schema-first 등 다른 조립 방법을 선택해야 한다. 지원하지 않는 데코레이터 옵션을 만들어 넣지 않는다.

`customerById`는 singleton resolver가 갖는 **접근 함수**이지 모든 요청이 공유하는 고객 캐시가 아니다. `createDataLoader`가 각 `GraphQLContext`의 operation 캐시에서 실제 loader를 얻는다. 같은 operation 안에서 여러 주문이 같은 고객을 요구하면 하나의 로드 결과를 공유하고, 다른 operation은 새 loader를 얻는다. 반면 생성자에서 일반 DataLoader 인스턴스를 하나 만들어 계속 재사용하면 사용자 간 데이터와 권한 결과가 섞일 수 있다.

배치 함수가 DB 반환 배열을 그대로 돌려주지 않는 이유도 중요하다. `WHERE id IN (...)`의 결과 순서는 요청한 ID 순서와 같다는 보장이 없다. 빠진 계정도 있을 수 있다. `Map`으로 재배열하여 입력 key마다 같은 위치에 결과 또는 `null`을 돌려줘야 주문 A의 행에 고객 B의 이름이 붙지 않는다. `maxBatchSize`는 한 번의 배치를 제한할 뿐 operation 전체의 요청 수나 DB 비용을 제한하지 않는다.

## 등록 목록과 인증 미들웨어를 모두 연결한다

먼저 읽기 포트를 실제 원장에 연결한다. 다음 **`src/orders/dashboard/reads.ts` 전체**는 6장의 `Order`와 1권 13장의 `User`를 읽는다. 새 계정 테이블이나 주문 projection을 만들지 않는다. `currency`는 DB에서 문자열로 나오므로 이 장의 KRW 계약을 확인하고, `bigint` 금액만 십진 문자열로 변환한다. 계정 표시 조회는 인증 조회와 다르다. 정지된 계정의 과거 주문에도 표시 정보는 남을 수 있지만, 그 계정으로 새 대시보드 요청을 인증할 수는 없다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type {
  AccountLabelsRead, DashboardOrder, OrderDashboardRead,
} from './contracts.js';

@Inject(PrismaService)
export class PrismaOrderDashboardRead implements OrderDashboardRead {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async list(input: Parameters<OrderDashboardRead['list']>[0]): Promise<readonly DashboardOrder[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        status: input.status,
        ...(input.after === null ? {} : { id: { gt: input.after } }),
      },
      orderBy: { id: 'asc' },
      take: input.take,
      select: {
        id: true, customerId: true, status: true, currency: true,
        totalMinor: true, version: true,
      },
    });
    return rows.map(row => {
      if (row.currency !== 'KRW') throw new Error('Unexpected order currency.');
      return { ...row, currency: row.currency, totalMinor: row.totalMinor.toString() };
    });
  }
}

@Inject(PrismaService)
export class PrismaAccountLabelsRead implements AccountLabelsRead {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async findMany(ids: readonly string[]) {
    return this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, displayName: true },
    });
  }
}
```

인증과 운영 권한의 출처를 나눈다. [1권 14장](../01-fluoblog/ch14-authentication.ko.md)의 `POST /auth/login`은 `LoginResult`의 `accessToken`, `tokenType: 'Bearer'`, `expiresIn: 900`, `user: { id, displayName }`을 반환한다. 토큰에는 `sub`, `authVersion`, `scopes: ['posts:write']`가 들어가며 대시보드 역할은 없다. 서버 운영자가 확인한 **이미 존재하는 활성 `User.id`**만 `SHOP_OPERATOR_ACCOUNT_IDS`에 JSON 문자열 배열로 설정한다. 예를 들어 13장의 초기화를 마친 `author-1`을 선택했다면 개발 서버 환경 값은 다음과 같다. UUID로 가입한 계정을 선택했다면 실제 반환된 ID를 넣는다.

```sh
export SHOP_OPERATOR_ACCOUNT_IDS='["author-1"]'
```

이 설정은 배포 설정을 바꿀 권한이 있는 사람만 관리한다. 요청 body·헤더·쿠키에서 읽지 않고, 첫 가입자나 표시 이름이 `operator`인 사람을 자동 선택하지 않는다. `author-1`도 그 문자열 자체에 권한이 있는 것이 아니다. 비활성 임시 행만 있고 자격 증명 초기화를 하지 않았다면 아래 검증에서 시작이 실패한다. 새 사용자를 등록했다는 사실만으로 허용 목록에 추가되지도 않는다.

다음 **`src/orders/dashboard/operator-policy.ts` 전체**에서 설정을 한 번 파싱하고 `AccountsService.findActiveSubject`로 존재·활성을 검증한다. ID는 기존 `author-1`과 UUID를 포함하는 ASCII 문자·숫자·밑줄·하이픈, 길이 1~128로 제한하며 공백을 몰래 제거하거나 다른 ID로 치환하지 않는다. 빈 항목·중복·잘못된 JSON·없는 계정은 설정 오류다. 미설정은 빈 목록으로 해석하여 모든 계정의 대시보드 접근을 거부한다. DB 장애도 시작 실패로 전파한다.

```ts
import { Inject } from '@fluojs/core';
import { ForbiddenException, type Principal } from '@fluojs/http';
import type { AccountsService } from '../../accounts/accounts.service.js';

export const SHOP_OPERATOR_ACCOUNT_IDS = Symbol('shop.operator.account-ids');

export async function parseOperatorAccountIds(
  raw: string | undefined,
  accounts: Pick<AccountsService, 'findActiveSubject'>,
): Promise<ReadonlySet<string>> {
  const parsed: unknown = JSON.parse(raw ?? '[]');
  if (!Array.isArray(parsed)) throw new Error('Operator account IDs must be a JSON array.');
  const ids = new Set<string>();
  for (const id of parsed) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || ids.has(id)) {
      throw new Error('Operator account IDs must be unique valid IDs.');
    }
    ids.add(id);
  }
  for (const id of ids) {
    if (!await accounts.findActiveSubject(id)) {
      throw new Error('Every operator account ID must identify an existing active account.');
    }
  }
  return ids;
}

@Inject(SHOP_OPERATOR_ACCOUNT_IDS)
export class ShopOperatorPolicy {
  constructor(private readonly accountIds: ReadonlySet<string>) {}

  authorize(principal: Principal): Principal {
    if (!this.accountIds.has(principal.subject)) {
      throw new ForbiddenException('Dashboard access is not allowed.');
    }
    return { ...principal, roles: ['shop_operator'] };
  }
}
```

`ShopOperatorPolicy`는 검증된 principal만 받는 내부 경계다. 토큰에 다른 역할이 있더라도 이 대시보드의 역할 목록은 위 정책 결과로 교체한다. DB에 `shop_operator`를 저장하거나 로그인 응답을 확장하지 않는다. 허용 목록은 시작 시 읽은 스냅샷이므로 설정 파일을 바꾸는 것만으로 실행 중인 프로세스의 권한이 바뀌지는 않는다. 변경 적용에는 해당 서버의 재시작·재배포가 필요하다.

다음 **`src/orders/dashboard/graphql-auth.ts` 전체**가 유일한 요청 어댑터다. `getRequestHeader`로 Bearer를 꺼내고 `AuthModule`이 export한 `BlogTokenAuthenticator.authenticateToken`을 호출한다. 이 공유 인증기는 서명, 만료, issuer/audience, 활성 계정, 현재 `authVersion`을 모두 검사한다. 계정 서비스에 존재하지 않는 요청 인증 메서드를 만들거나 JWT를 단순 decode하여 우회하지 않는다.

```ts
import { Inject } from '@fluojs/core';
import {
  getRequestHeader, UnauthorizedException,
  type Middleware, type MiddlewareContext, type Next, type Principal,
} from '@fluojs/http';
import {
  AuthenticationExpiredError, AuthenticationFailedError,
} from '@fluojs/passport';
import { BlogTokenAuthenticator } from '../../auth/blog-token-authenticator.js';
import { ShopOperatorPolicy } from './operator-policy.js';

@Inject(BlogTokenAuthenticator, ShopOperatorPolicy)
export class DashboardAuthentication implements Middleware {
  constructor(
    private readonly tokens: BlogTokenAuthenticator,
    private readonly operators: ShopOperatorPolicy,
  ) {}

  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    if (context.request.path !== '/graphql' && context.request.path !== '/graphql/') {
      await next();
      return;
    }
    delete context.requestContext.principal;
    context.response.setHeader('Cache-Control', 'no-store');
    const header = getRequestHeader(context.request, 'Authorization');
    const authorization = Array.isArray(header) ? header[0] : header;
    const token = typeof authorization === 'string'
      ? /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization)?.[1]
      : undefined;
    if (!token) {
      context.response.setHeader('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException('A Bearer access token is required.');
    }
    let principal: Principal;
    try {
      principal = await this.tokens.authenticateToken(token);
    } catch (error: unknown) {
      if (error instanceof AuthenticationExpiredError || error instanceof AuthenticationFailedError) {
        context.response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
        throw new UnauthorizedException('Invalid access token.', { cause: error });
      }
      throw error;
    }
    context.requestContext.principal = this.operators.authorize(principal);
    await next();
  }
}
```

헤더 배열은 14장의 Bearer 전략과 같이 첫 항목만 사용한다. 프록시에서도 중복 Authorization 처리 규칙을 일치시킨다. `/graphql`과 `/graphql/` 모두 검사하되 다른 경로는 그대로 진행하므로 공개 `POST /auth/login`을 막지 않는다. CORS preflight가 필요하면 기존 CORS 처리가 이 미들웨어보다 먼저 OPTIONS를 처리하도록 유지한다.

이 장은 GraphQL 실행 **전** HTTP 상태를 결정한다. 자격 증명 누락·형식 오류·위조·만료·정지·인증 세대 불일치는 401, 인증에는 성공했지만 허용 목록에 없는 계정은 403이다. 두 경우 모두 주문·고객 표시 조회에 도달하지 않는다. 공유 인증기의 DB 오류나 JWT 설정 오류는 알려진 Passport 인증 오류가 아니므로 그대로 전파한다. `authorize`와 `next`도 인증 오류를 매핑하는 `try` 밖에 있어 downstream 장애를 401로 바꾸지 않는다. 최종 HTTP serializer가 기반 시스템 오류를 비밀 값 없는 5xx 응답으로 처리하게 하며, GraphQL 실행 뒤의 `BAD_USER_INPUT` 등은 여전히 `errors[].extensions.code`로 구분한다.

다음 **`src/orders/dashboard/module.ts` 전체**는 실제 토큰, 조회 구현, 공유 인증기 가시성을 연결한다. `resolvers`는 탐색 대상 allowlist이며 provider 등록을 대신하지 않는다. root와 field resolver를 둘 다 등록한다. 설정 factory는 주입된 기존 `AccountsService`로 허용 목록을 검증하고 그 결과를 singleton 정책에 전달한다.

```ts
import { Module } from '@fluojs/core';
import { GraphqlModule } from '@fluojs/graphql';
import { AccountsModule } from '../../accounts/accounts.module.js';
import { AccountsService } from '../../accounts/accounts.service.js';
import { AuthModule } from '../../auth/auth.module.js';
import { ACCOUNT_LABELS_READ, ORDER_DASHBOARD_READ } from './contracts.js';
import { DashboardAuthentication } from './graphql-auth.js';
import {
  SHOP_OPERATOR_ACCOUNT_IDS, ShopOperatorPolicy, parseOperatorAccountIds,
} from './operator-policy.js';
import { PrismaAccountLabelsRead, PrismaOrderDashboardRead } from './reads.js';
import { DashboardOrderFields, DashboardQueries } from './resolvers.js';

@Module({
  imports: [
    AccountsModule,
    AuthModule,
    GraphqlModule.forRoot({
      resolvers: [DashboardQueries, DashboardOrderFields],
      graphiql: false,
      introspection: false,
      limits: { maxDepth: 6, maxComplexity: 100, maxCost: 200 },
    }),
  ],
  providers: [
    {
      provide: SHOP_OPERATOR_ACCOUNT_IDS,
      inject: [AccountsService],
      useFactory: (accounts: AccountsService) =>
        parseOperatorAccountIds(process.env.SHOP_OPERATOR_ACCOUNT_IDS, accounts),
    },
    { provide: ORDER_DASHBOARD_READ, useClass: PrismaOrderDashboardRead },
    { provide: ACCOUNT_LABELS_READ, useClass: PrismaAccountLabelsRead },
    ShopOperatorPolicy,
    DashboardAuthentication,
    DashboardQueries,
    DashboardOrderFields,
  ],
  exports: [DashboardAuthentication],
})
export class DashboardModule {}
```

**기존 `src/app.ts`의 작은 등록 변경**은 다음 import를 추가하고 `AppModule`의 기존 `@Module({ imports: [...] })` 배열 끝에 `DashboardModule`을 추가하는 것이다. 이것은 파일 전체를 대체하는 예제가 아니다. 기존 `AppSettingsModule`, 전역 비동기 `BlogDatabaseModule`, `AccountsModule`, `AuthModule`, `OrdersModule`과 나머지 기능 등록을 모두 유지한다.

```ts
import { DashboardModule } from './orders/dashboard/module.js';
```

**기존 `src/main.ts`의 작은 startup 변경**은 `ensureMetadataSymbol()` 호출 뒤, `FluoFactory.create()` 전에 아래 동적 import를 추가하는 것이다. 장식된 클래스가 메타데이터 준비보다 먼저 평가되지 않게 한다.

```ts
const { DashboardAuthentication } = await import('./orders/dashboard/graphql-auth.js');
```

같은 파일에서 기존 `FluoFactory.create()` options에 `middleware` 배열이 없다면 아래 항목을 추가한다. 배열이 이미 있다면 그 안에서 기존 CORS·상관관계 처리 뒤, 요청을 소비하는 미들웨어보다 앞에 `DashboardAuthentication` 클래스 토큰을 한 번만 추가한다. `AppModule`, `blogConfig.PORT`, host, logger와 `shutdownRegistration`은 바꾸지 않는다. `exports: [DashboardAuthentication]` 덕분에 Factory의 application middleware가 앱 컨테이너에서 이 토큰을 resolve할 수 있다.

```ts
middleware: [DashboardAuthentication],
```

Fastify의 `middleware`는 `MiddlewareLike[]`이며 객체뿐 아니라 이렇게 provider의 클래스 토큰도 받는다. application middleware는 GraphQL 모듈의 middleware보다 먼저 실행된다. 대시보드 모듈 자체의 `middleware`에만 넣거나 `/graphql`의 route guard로 등록하면 같은 순서를 보장하는 연결이 아니다. 실제 흐름은 `POST /auth/login → LoginResult.accessToken → Bearer 추출 → 공유 인증기 → 허용 ID 정책 → requestContext.principal → GraphQLContext.principal → orders`다.

현재 `GraphqlModule.forRoot({ context })`의 타입은 `(ctx) => Record<string, unknown>`인 **동기 함수**다. `context: async ...`로 DB 인증을 옮기지 않는다. 서비스는 custom context를 펼친 뒤 표준 `principal`을 선행 HTTP 문맥의 값으로 설정한다. 이 장은 `context` 옵션을 쓰지 않고 위 흐름을 따른다.

이 구성은 현재 package 지원 계약에 맞게 Node24에서 사용한다. HTTP 내부에 Web-standard Request와 Response를 사용한다는 사실을 Bun·Deno·Workers의 GraphQL 지원 보장으로 확대하지 않는다. endpoint는 `/graphql`로 고정되어 있고 `path: '/admin/graphql'` 같은 옵션을 추가하지 않는다. 프록시에서 외부 경로를 바꿀 수는 있지만 패키지 설정과 별도 배포 계약이다.

## 실제 토큰으로 인증과 운영 권한의 경계를 시험한다

테스트가 `{ roles: ['shop_operator'] }`인 principal을 직접 만들면 실제 로그인 경로에 운영 권한을 부여하는 코드가 없어도 통과한다. 아래 두 테스트 파일은 **`src/orders/dashboard/dashboard-test-fixture.ts` 전체**를 공유한다. 이 fixture는 실제 서명자·검증기와 14장의 공유 인증기, 방금 만든 설정 파서·정책·미들웨어를 사용한다. 계정 조회만 제어 가능한 상태로 대체하고, 시간은 고정한다. 따라서 미들웨어의 입력부터 resolver 문맥까지 검사하지만 비밀번호 검증, PostgreSQL, Fastify dispatch, Yoga 스키마 조립은 아직 통합 검증이 아니다.

```ts
import { afterEach, beforeEach, vi } from 'vitest';
import { Container } from '@fluojs/di';
import type { GraphQLContext } from '@fluojs/graphql';
import type { FrameworkResponse, MiddlewareContext, RequestContext } from '@fluojs/http';
import { DefaultJwtSigner, DefaultJwtVerifier, type JwtVerifierOptions } from '@fluojs/jwt';
import { BlogTokenAuthenticator } from '../../auth/blog-token-authenticator.js';
import { DashboardAuthentication } from './graphql-auth.js';
import { parseOperatorAccountIds, ShopOperatorPolicy } from './operator-policy.js';

const options: JwtVerifierOptions = {
  algorithms: ['HS256'], secret: 'test-only-key-not-for-production',
  issuer: 'fluo-blog', audience: 'fluo-blog-web',
  accessTokenTtlSeconds: 900, requireExp: true, clockSkewSeconds: 0,
};
const verifiers: DefaultJwtVerifier[] = [];
const containers: Container[] = [];

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
});
afterEach(async () => {
  for (const verifier of verifiers.splice(0)) verifier.dispose();
  for (const container of containers.splice(0)) await container.dispose();
  vi.restoreAllMocks();
});

type AccountState = {
  id: string; displayName: string; authVersion: number;
  status: 'active' | 'disabled';
};

export async function createDashboardFixture(raw = '["author-1"]') {
  const rows = new Map<string, AccountState>([
    ['author-1', { id: 'author-1', displayName: 'Operator', authVersion: 1, status: 'active' }],
    ['reader-a', { id: 'reader-a', displayName: 'Reader', authVersion: 1, status: 'active' }],
  ]);
  const failure: { error?: Error } = {};
  const accounts = {
    async findActiveSubject(id: string) {
      if (failure.error) throw failure.error;
      const row = rows.get(id);
      return row?.status === 'active'
        ? { id: row.id, displayName: row.displayName, authVersion: row.authVersion }
        : null;
    },
  };
  const signer = new DefaultJwtSigner(options);
  const verifier = new DefaultJwtVerifier(options);
  verifiers.push(verifier);
  const ids = await parseOperatorAccountIds(raw, accounts);
  const tokens = new BlogTokenAuthenticator(verifier, accounts);
  const middleware = new DashboardAuthentication(tokens, new ShopOperatorPolicy(ids));
  const container = new Container();
  containers.push(container);

  function context(authorization?: string | string[], path = '/graphql'): MiddlewareContext {
    const response: FrameworkResponse = {
      headers: {}, committed: false,
      setStatus(code) { this.statusCode = code; },
      setHeader(name, value) { this.headers[name] = value; },
      redirect(code, location) {
        this.setStatus(code); this.setHeader('Location', location);
      },
      send() { this.committed = true; },
    };
    const requestContext: RequestContext = {
      request: {
        method: 'POST', path, url: path,
        headers: authorization === undefined ? {} : { Authorization: authorization },
        query: {}, cookies: {}, params: {}, raw: null,
      },
      response, metadata: {}, container,
    };
    return { request: requestContext.request, response, requestContext };
  }

  async function authenticate(authorization?: string | string[]): Promise<GraphQLContext> {
    const http = context(authorization);
    const graphql: GraphQLContext = { request: http.request };
    await middleware.handle(http, async () => {
      const principal = http.requestContext.principal;
      if (principal) graphql.principal = principal;
    });
    return graphql;
  }

  async function operatorContext(): Promise<GraphQLContext> {
    const token = await signer.signAccessToken({
      sub: 'author-1', authVersion: 1, scopes: ['posts:write'],
    });
    return authenticate(`Bearer ${token}`);
  }
  return { rows, failure, accounts, signer, tokens, middleware, context, authenticate, operatorContext };
}
```

다음 **`src/orders/dashboard/graphql-auth.test.ts` 전체**는 실패 분류와 조회 차단을 검증한다. HTTP serializer 대신 실제 `UnauthorizedException.status`와 `ForbiddenException.status`를 확인한다. 알 수 없는 DB 오류는 같은 오류 객체가 호출자까지 전달되어야 한다. 서버가 서명한 토큰에 역할 문자열까지 들어 있어도 허용 ID가 아니면 실패하는 사례가 권한 출처를 고정한다.

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDashboardFixture } from './dashboard-test-fixture.js';
import { parseOperatorAccountIds } from './operator-policy.js';
import { DashboardQueries, OrdersInput } from './resolvers.js';
import type { DashboardOrder } from './contracts.js';

describe('dashboard authentication boundary', () => {
  it('adds permission only after authenticating an allowed existing account', async () => {
    const fixture = await createDashboardFixture();
    const token = await fixture.signer.signAccessToken({
      sub: 'author-1', authVersion: 1, scopes: ['posts:write'],
    });
    expect((await fixture.tokens.authenticateToken(token)).roles).toBeUndefined();
    const context = await fixture.authenticate([`Bearer ${token}`, 'Basic ignored']);
    expect(context.principal).toMatchObject({ subject: 'author-1', roles: ['shop_operator'] });
    let reads = 0;
    const query = new DashboardQueries({ async list() { reads++; return []; } });
    await query.ordersPage(new OrdersInput(), context);
    expect(reads).toBe(1);
  });

  it('rejects missing and malformed credentials before downstream work', async () => {
    const fixture = await createDashboardFixture();
    let nextCalls = 0;
    for (const header of [undefined, '', 'Basic abc', 'Bearer ', 'Bearer broken']) {
      const context = fixture.context(header);
      await expect(fixture.middleware.handle(context, async () => { nextCalls++; }))
        .rejects.toMatchObject({ status: 401 });
      expect(context.response.headers['WWW-Authenticate']).toContain('Bearer');
    }
    expect(nextCalls).toBe(0);
  });

  it('checks issuer, audience, signature, and exact expiry through the adapter', async () => {
    const fixture = await createDashboardFixture();
    const claims = { sub: 'author-1', authVersion: 1, scopes: ['posts:write'] };
    for (const changed of [{ iss: 'another-issuer' }, { aud: 'another-audience' }]) {
      const token = await fixture.signer.signAccessToken({ ...claims, ...changed });
      await expect(fixture.authenticate(`Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
    }
    const token = await fixture.signer.signAccessToken(claims);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({
      ...claims, sub: 'reader-a', exp: 1_800_000_900,
    })).toString('base64url');
    await expect(fixture.authenticate(`Bearer ${header}.${forged}.${signature}`))
      .rejects.toMatchObject({ status: 401 });
    vi.mocked(Date.now).mockReturnValue(1_800_000_900_000);
    await expect(fixture.authenticate(`Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
  });

  it('returns 403 for a valid non-allowlisted token even with a role claim', async () => {
    const fixture = await createDashboardFixture();
    const token = await fixture.signer.signAccessToken({
      sub: 'reader-a', authVersion: 1, roles: ['shop_operator'],
    });
    let nextCalls = 0;
    await expect(fixture.middleware.handle(fixture.context(`Bearer ${token}`), async () => {
      nextCalls++;
    })).rejects.toMatchObject({ status: 403 });
    expect(nextCalls).toBe(0);
  });

  it('rejects disabled accounts and propagates database failures unchanged', async () => {
    const fixture = await createDashboardFixture();
    const token = await fixture.signer.signAccessToken({ sub: 'author-1', authVersion: 1 });
    fixture.rows.set('author-1', {
      id: 'author-1', displayName: 'Operator', authVersion: 1, status: 'disabled',
    });
    await expect(fixture.authenticate(`Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
    fixture.failure.error = new Error('Database unavailable');
    await expect(fixture.authenticate(`Bearer ${token}`)).rejects.toBe(fixture.failure.error);
  });

  it('validates configuration against existing accounts and defaults to deny', async () => {
    const fixture = await createDashboardFixture();
    for (const raw of ['not-json', '{}', '[""]', '["author-1","author-1"]', '["missing"]']) {
      await expect(parseOperatorAccountIds(raw, fixture.accounts)).rejects.toThrow();
    }
    expect((await parseOperatorAccountIds(undefined, fixture.accounts)).size).toBe(0);
    const denied = await createDashboardFixture('[]');
    await expect(denied.operatorContext()).rejects.toMatchObject({ status: 403 });
  });

  it('protects the trailing slash and leaves the existing login path reachable', async () => {
    const fixture = await createDashboardFixture();
    await expect(fixture.middleware.handle(fixture.context(undefined, '/graphql/'), async () => {}))
      .rejects.toMatchObject({ status: 401 });
    let nextCalls = 0;
    await fixture.middleware.handle(fixture.context(undefined, '/auth/login'), async () => { nextCalls++; });
    expect(nextCalls).toBe(1);
  });

  it('rejects the next authentication without cancelling an already authorized read', async () => {
    const fixture = await createDashboardFixture();
    const token = await fixture.signer.signAccessToken({ sub: 'author-1', authVersion: 1 });
    const context = await fixture.authenticate(`Bearer ${token}`);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<readonly DashboardOrder[]>();
    const query = new DashboardQueries({
      async list() { entered.resolve(); return release.promise; },
    });
    const pending = query.ordersPage(new OrdersInput(), context);
    try {
      await entered.promise;
      fixture.rows.set('author-1', {
        id: 'author-1', displayName: 'Operator', authVersion: 2, status: 'active',
      });
      await expect(fixture.authenticate(`Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
    } finally {
      release.resolve([]);
      await expect(pending).resolves.toMatchObject({ nodes: [] });
    }
  }, 5_000);
});
```

마지막 테스트의 장벽은 SQL에 해당하는 읽기에 도달했다는 정확한 신호다. 상태 변경 전에 신호를 등록하고 Vitest의 5초 제한 안에서 기다린다. 고정 sleep이나 운에 맡기는 요청 순서는 없다. 계정 조회가 새 `authVersion`을 관측하는 다음 인증은 실패하지만, 이미 통과한 요청을 자동 취소하지 않는다는 차이를 시험한다.

## N+1을 숨기는 대신 배치 횟수를 관찰한다

다음 `src/orders/dashboard/resolvers.test.ts`는 **완전한 단위·배치 실험 파일**이다. 위 fixture의 실제 인증 어댑터를 통과한 문맥으로 resolver를 직접 호출한다. 스키마 생성·네트워크 전송은 검증하지 않으며, 실제 `createDataLoader`를 사용하여 동일 operation에서의 중복 제거와 다른 operation의 격리를 확인한다. 가짜 표시 정보 저장소가 입력 순서와 반대 순서로 값을 돌려줘도 고객 매핑이 맞아야 한다.

```ts
import { describe, expect, it } from 'vitest';
import type { GraphQLContext } from '@fluojs/graphql';
import {
  DashboardOrderFields, DashboardQueries, OrdersInput,
} from './resolvers.js';
import type {
  AccountLabelsRead, DashboardOrder, OrderDashboardRead,
} from './contracts.js';
import { createDashboardFixture } from './dashboard-test-fixture.js';

function order(id: string, customerId: string): DashboardOrder {
  return {
    id, customerId, status: 'paid',
    currency: 'KRW', totalMinor: '29000', version: 1,
  };
}

describe('dashboard resolver boundaries', () => {
  it('preserves version zero for a pending order', async () => {
    const fixture = await createDashboardFixture();
    const pending: DashboardOrder = {
      ...order('order-0', 'reader-a'), status: 'pending_payment', version: 0,
    };
    const orders: OrderDashboardRead = {
      async list({ status }) {
        return status === 'pending_payment' ? [pending] : [];
      },
    };
    const input = new OrdersInput();
    input.status = 'pending_payment';
    const page = await new DashboardQueries(orders)
      .ordersPage(input, await fixture.operatorContext());
    expect(page.nodes).toEqual([pending]);
    expect(page.nodes[0]?.version).toBe(0);
    expect(page.hasNextPage).toBe(false);
  });

  it('batches customer fields and isolates the next operation', async () => {
    const fixture = await createDashboardFixture();
    const batches: string[][] = [];
    const accounts: AccountLabelsRead = {
      async findMany(ids) {
        batches.push([...ids]);
        return [...ids].reverse().map(id => ({ id, displayName: `Name ${id}` }));
      },
    };
    const fields = new DashboardOrderFields(accounts);
    const context = await fixture.operatorContext();
    const values = await Promise.all([
      fields.customer(order('order-1', 'reader-a'), context),
      fields.customer(order('order-2', 'reader-a'), context),
      fields.customer(order('order-3', 'reader-b'), context),
    ]);
    expect(batches).toEqual([['reader-a', 'reader-b']]);
    expect(values.map(value => value?.id))
      .toEqual(['reader-a', 'reader-a', 'reader-b']);

    await fields.customer(order('order-4', 'reader-a'), await fixture.operatorContext());
    expect(batches).toEqual([['reader-a', 'reader-b'], ['reader-a']]);
  });

  it('uses one lookahead row and blocks unauthorized reads', async () => {
    const fixture = await createDashboardFixture();
    const calls: number[] = [];
    const orders: OrderDashboardRead = {
      async list({ take }) {
        calls.push(take);
        return [order('order-1', 'reader-a'), order('order-2', 'reader-b')];
      },
    };
    const query = new DashboardQueries(orders);
    const input = new OrdersInput();
    input.first = 1;
    const page = await query.ordersPage(input, await fixture.operatorContext());
    expect(page.nodes.map(value => value.id)).toEqual(['order-1']);
    expect(page.endCursor).toBe('order-1');
    expect(page.hasNextPage).toBe(true);
    expect(calls).toEqual([2]);

    const anonymous: GraphQLContext = { request: fixture.context().request };
    await expect(query.ordersPage(input, anonymous)).rejects.toMatchObject({
      extensions: { code: 'UNAUTHENTICATED' },
    });
    input.first = 1000;
    await expect(query.ordersPage(input, await fixture.operatorContext())).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT' },
    });
    expect(calls).toEqual([2]);
  });
});
```

```sh
pnpm exec vitest run src/orders/dashboard/graphql-auth.test.ts src/orders/dashboard/resolvers.test.ts
```

배치 테스트는 필요한 `load` 호출을 먼저 만들고 `Promise.all`로 기다린다. 각 호출을 `await`한 뒤 다음 고객을 요청하면 DataLoader의 같은 배치 기회를 스스로 없앤다. 실행 시점이 운 좋게 겹치기를 바라며 sleep을 넣지 않는다. 첫 operation의 고객 배치는 `reader-a`, `reader-b` 한 번이고, 다음 operation에서 `reader-a`를 다시 조회하면 새 배치가 하나 생기는 것이 기대값이다.

이 실험의 성공만으로 N+1 문제가 앱 전체에서 없어졌다고 말할 수 없다. 실제 field resolver의 탐색과 GraphQL의 필드 실행을 거쳐도 같은 결과가 나오는지 HTTP 실험이 필요하다. 1권의 활성 계정·자격 증명과 2권의 주문 스키마를 적용한 개발 PostgreSQL, 생성된 Prisma Client, 기존 `JWT_SECRET`, 허용 ID 설정, Node.js 24 앱이 필요하다. 앞의 파일과 등록 변경을 적용해 서버를 시작하고, 선택한 기존 계정의 로그인 이메일·비밀번호를 `OPERATOR_EMAIL`, `OPERATOR_PASSWORD` 환경으로 준비한다. 다음은 서명자를 따로 호출하는 대신 **실제 `POST /auth/login`**의 `LoginResult.accessToken`을 받는 절차다. 로그인 응답 전체나 토큰을 터미널에 출력하지 않는다.

```sh
OPERATOR_TOKEN="$(node --input-type=module -e '
const response = await fetch("http://localhost:3000/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: process.env.OPERATOR_EMAIL,
    password: process.env.OPERATOR_PASSWORD,
  }),
});
if (response.status !== 200) throw new Error("Operator login failed.");
const result = await response.json();
if (result.tokenType !== "Bearer" || typeof result.accessToken !== "string") {
  throw new Error("Unexpected login response.");
}
process.stdout.write(result.accessToken);
')" || exit 1
```

그 토큰으로 아래 조회를 보낸다. 정상 응답은 HTTP 200, `data.orders`와 페이지 정보이며 `errors`가 없어야 한다. 선택 상태의 주문이 없으면 `nodes: []`도 정상이다. ID가 허용된 실제 계정으로 로그인한 것인지 확인하며, 성공시키려고 JWT에 역할을 수동으로 추가하지 않는다.

```sh
curl --fail-with-body http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${OPERATOR_TOKEN}" \
  --data '{"query":"query Dashboard($first: Int) { orders(status: \"paid\", first: $first) { nodes { id status totalMinor currency customer { id displayName } } endCursor hasNextPage } }","variables":{"first":20}}'
unset OPERATOR_TOKEN
```

읽기 adapter에 쿼리 횟수 recorder를 붙여 주문 조회 한 번과 선택된 고객 필드의 배치 조회를 확인한다. 고객 필드를 선택하지 않은 요청은 **고객 표시 정보 배치 조회**가 0회여야 한다. 공유 인증기의 `findActiveSubject` 계정 확인은 매 요청 별도로 한 번 발생하며, 시작 시 허용 목록 검증도 별도다. 이 둘을 고객 표시 조회와 합쳐 N+1 수치를 세지 않는다. 페이지에서 고객 하나가 없으면 그 주문의 `customer`만 `null`이며 나머지 행은 유지되어야 한다.

이어 토큰을 빼면 401, 실제 로그인에는 성공하지만 허용 목록에 없는 독자 토큰이면 403이며 주문·고객 표시 조회는 모두 0회여야 한다. 잘못된 로그인 비밀번호는 기존 `/auth/login`에서 401이다. 계정 조회에 DB 장애를 주입한 요청은 401이 아닌 서버 오류여야 한다. `/graphql/`과 GET 쿼리에도 같은 정책이 적용되는지 확인한다. `curl`의 성공 종료만으로 GraphQL 작업 성공을 판정하지 않는다. HTTP 200에도 실행 오류의 `errors`가 있을 수 있다.

이번 수정에서는 본문의 코드 블록을 메모리에서 변환하고 실제 패키지의 서명자·검증기·DataLoader, 공유 인증기, 새 어댑터·정책으로 11개 인증·권한·배치 사례를 실행했다. 테스트 등록과 시계 제어를 메모리 실행 harness로 연결한 결과이며, 위 `pnpm exec vitest run` 명령을 실행했다는 뜻은 아니다. 실제 Fastify listener, `/auth/login`부터 Yoga까지의 HTTP 왕복, PostgreSQL·생성된 Prisma Client 연결은 실행하지 않았다.

기존 저장소의 `examples/graphql`은 module 등록, field resolver, operation DataLoader, SSE를 실제로 다루는 별도 실행 예제다. 그것이 이 상점 대시보드나 72장 전체 앱의 완성본이라는 뜻은 아니다. 예제와 패키지 테스트는 API의 근거이고, 위 애플리케이션의 실제 listener·DB 통합 검증은 독자의 환경에서 구분해 수행한다.

## 폐기는 다음 인증부터 적용되고 진행 중인 조회는 남을 수 있다

이 대시보드는 끝나는 HTTP 조회 한 건을 인증하는 경계다. JWT 서명·만료 검사는 공유 인증기 진입 시 수행하고, 이어서 현재 계정과 `authVersion`을 조회한다. 두 검사가 하나의 원자적 DB 스냅샷인 것은 아니다. 토큰이 검증된 뒤 계정 조회를 기다리는 동안 만료될 수도 있고, 인증이 끝난 직후 계정 정지가 커밋될 수도 있다. 이 장은 14장의 인증기를 확장해 응답 직전까지 재검사하지 않는다. 이미 권한을 얻어 실행 중인 한 조회와 그 operation의 DataLoader는 응답을 마칠 수 있다.

개발 DB에서 계정을 정지하거나 `authVersion` 증가를 커밋한 뒤, 그 새 값을 볼 수 있는 다음 요청으로 같은 토큰을 보내면 401이어야 한다. 기존 요청이 읽기 포트에 진입한 시점에 장벽을 걸고 변경을 커밋하면, 새 요청은 거부되고 기존 요청은 장벽을 풀었을 때 완료되는 경계를 관찰할 수 있다. 계정 조회를 오래된 replica나 TTL 캐시로 바꾸면 변경 관측 지연이 늘어난다. 현재 예제는 그런 캐시나 분산 폐기 전파를 추가하지 않는다.

`authVersion` 증가는 이전 토큰을 폐기하지만 운영 허가 자체를 제거하지는 않는다. 같은 활성 계정이 다시 로그인하여 새 세대의 토큰을 받으면 허용 목록에 있는 동안 다시 조회할 수 있다. 운영 허가를 없애려면 서버 허용 목록에서 ID를 제거하고 실행 중인 서버들에 설정을 적용한다. 반대로 허용 목록에 남아 있어도 계정이 정지되면 공유 인증을 통과하지 못한다. 브라우저에서 토큰만 지우는 로그아웃은 이미 복사된 토큰의 서버 폐기와 다르다.

이 제한된 정책을 장기 GraphQL subscription이나 소켓 연결에 그대로 재사용하지 않는다. 오래 유지되는 관측에는 별도의 재검증·종료 정책이 필요하다. 이 장은 subscription resolver를 등록하지 않으며 WebSocket 구독도 켜지 않는다. 조회 timeout과 취소 전달 역시 별도 운영 책임이고, `first`나 문서 예산이 요청 시간을 보장하지는 않는다.

## 조회 제한은 SQL 비용 모델이 아니다

등록한 `maxDepth`, `maxComplexity`, `maxCost`는 GraphQL 문서와 선택 operation을 분석하는 예산이다. 현 구현은 필드 깊이, 필드 수, 깊이를 반영한 합계를 계산한다. 실제 테이블의 행 수나 SQL 실행 계획을 예측하지 않는다. 깊이 2인 `orders(first: 1000000)`도 DB에는 비쌀 수 있다. 위 구현에서 `first`를 50 이하로 제한하고 조회 포트가 `take`를 실제 SQL 제한으로 적용하도록 한 이유다.

운영 부하 테스트에는 깊은 중첩만 아니라 alias로 같은 목록을 여러 번 부르는 문서도 넣는다. 예산을 초과한 요청은 resolver 실행 전에 멈추고, 저장소 호출은 0회여야 한다. 다만 허용 예산 안의 여러 목록 요청은 여전히 여러 SQL을 만들 수 있다. operation 이름별 응답 시간, 주문 조회 수, 고객 배치 크기, 읽은 행 수를 함께 관측해야 한 요청이 적은 네트워크 왕복으로 비싼 서버 일을 숨기는지 알 수 있다.

기본적으로 GraphiQL과 introspection은 비활성화이며 이 장도 명시적으로 끈다. 로컬 스키마 확인이 필요할 때만 켠다. 이를 꺼도 인증·권한 검사가 대체되지는 않는다. 스키마를 아는 사용자는 계속 쿼리를 보낼 수 있다. 요청 크기 제한과 계정별 요청률, 데이터베이스 timeout 역시 문서 예산과 별도의 경계다. 19장의 메시지 payload 상한을 GraphQL HTTP 본문 제한으로 오해하지 않는다.

resolver의 수명도 비용과 권한에 영향을 준다. 기본 singleton resolver에 request-scoped provider를 직접 주입하면 수명 불일치가 생긴다. 요청별 의존성이 필요하면 resolver에도 `@Scope('request')`를 지정해야 한다. 여기서는 상태 없는 조회 포트와 operation별 DataLoader 접근 함수를 사용하므로 singleton으로 충분하다. operation container는 완료 또는 연결 종료 시 정리되지만, 애플리케이션이 여는 외부 stream의 정리까지 자동으로 완성되는 것은 아니다.

## 실시간 화면과 GraphQL을 역할에 따라 함께 둔다

대시보드는 GraphQL로 첫 페이지를 읽고, 새로고침이나 화면의 재조회 요청마다 같은 Bearer 인증과 운영 ID 정책을 다시 통과한다. 19장의 Socket.IO 관측은 공유 인증을 통과한 **고객 자신의 주문**에 한정된다. 이 장의 `shop_operator` 권한은 그 소켓의 관측 권한이 아니므로, 운영자가 전체 주문 이벤트를 이미 받고 있다고 가정하지 않는다. 전체 주문의 운영자 구독은 별도의 권한·재검증·종료 정책을 구현해야 하는 새 기능이며 여기서는 인가된 GraphQL 재조회로 화면을 갱신한다.

GraphQL subscription을 선택할 때에는 기본 SSE와 선택적 WebSocket 전송을 구분한다. WebSocket 구독은 `subscriptions.websocket.enabled`로 명시적으로 켜며 upgrade 가능한 Node HTTP/S adapter가 필요하다. Socket.IO 메시지는 GraphQL의 `graphql-ws` 프로토콜이 아니다. `@Subscription({ topics })`도 지원되는 API가 아니고 resolver가 `AsyncIterable`을 반환해야 한다. 구독 원천의 listener 등록과 iterator 종료 시 해제는 애플리케이션이 책임진다.

현재는 운영자의 조회 전용 GraphQL과 고객의 소유 주문 실시간 관측을 서로 다른 권한 경계로 유지한다. 운영자는 필요한 필드를 한 작업으로 요청하고, 서버는 페이지 크기와 허용 ID에서 얻은 권한을 검증하며, 고객 표시 조회는 operation 안에서 묶는다. 다음 장에서는 이 읽기 경계에 캐시를 적용한다. DataLoader의 operation 캐시는 이미 끝난 요청을 가속하지 않으므로 응답 캐시와 구분해야 한다. 상품 설명을 오래 보관하는 일과 재고 판단을 최신으로 유지하는 일에 같은 만료 시간을 적용할 수 없는 이유를 살펴본다.

## 근거와 검증 범위

- [공유 구현 경계](../EDITORIAL.ko.md): `BlogDatabaseModule`, 결제·재고 반영, 주문 초기 버전과 감사 기록.
- [기존 계정과 활성 상태](../01-fluoblog/ch13-accounts-and-credentials.ko.md), [공유 인증기·LoginResult·AuthModule](../01-fluoblog/ch14-authentication.ko.md): 기존 `User.id`, `findActiveSubject`, `authenticateToken`, export 경계.
- [JWT 서명](../../packages/jwt/src/signing/signer.ts), [서명·만료·발행자·대상 검증](../../packages/jwt/src/signing/verifier.ts), [Passport 인증 오류](../../packages/passport/src/errors.ts): 알려진 인증 실패와 기반 시스템 오류의 분리.
- [헤더 읽기](../../packages/http/src/header-helpers.ts), [HTTP 예외](../../packages/http/src/exceptions.ts), [미들웨어 타입](../../packages/http/src/types.ts), [application/module 실행 순서](../../packages/http/src/dispatch/dispatcher.ts), [Fastify bootstrap 옵션](../../packages/platform-fastify/src/adapter.ts): 선행 인증의 실제 등록 API.
- [Prisma facade 계약](../../packages/prisma/README.ko.md), [단일 client·트랜잭션 문맥 구현](../../packages/prisma/src/service.ts): 기존 원장 조회 adapter의 근거.
- [GraphQL 사용 계약](../../packages/graphql/README.ko.md), [공개 export](../../packages/graphql/src/index.ts), [옵션·문맥 타입](../../packages/graphql/src/types.ts): Node 지원, 고정 endpoint, scope, 등록 경계.
- [데코레이터 구현](../../packages/graphql/src/decorators.ts), [입력 파이프라인](../../packages/graphql/src/pipeline/input-pipeline.ts): 인자 기본값, 반환 타입, 표준 메서드 바인딩.
- [DataLoader 구현](../../packages/graphql/src/dataloader/dataloader.ts): operation 캐시와 접근 함수의 실제 동작.
- [GraphQL 서비스 구현](../../packages/graphql/src/service.ts), [가드레일 구현](../../packages/graphql/src/guardrails.ts): 선행 principal 전달과 문서 비용 계산.
- [필드 resolver 테스트](../../packages/graphql/src/field-resolver.test.ts), [필드 입력 테스트](../../packages/graphql/src/field-resolver-input.test.ts), [모듈 테스트](../../packages/graphql/src/module.test.ts): 탐색·nullability·인증 문맥의 근거.
- [공식 실행 예제 안내](../../examples/graphql/README.ko.md)와 [예제 소스](../../examples/graphql/src/app.ts): 별도의 실행 가능한 GraphQL 학습 표면이다. 이 장의 상점 통합이나 이번 집필에서 실행하지 않은 테스트의 통과 증거로 대신하지 않는다.
