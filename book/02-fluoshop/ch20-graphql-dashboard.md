# Building a Query API for the Operations Dashboard

<!-- book:volume=02-fluoshop;chapter=20 -->

[Previous: Showing Order Status in Real Time](./ch19-realtime-orders.md) | [Table of Contents](./toc.md) | [Next: Cache Products, but Do Not Trust the Cache Alone for Inventory Decisions](./ch21-commerce-caching.md)

## One Operations Screen Generates Dozens of Requests

In the morning, the FluoShop operator reviews paid orders together with packing candidates and customer inquiries. Initially, the screen fetched a list through `GET /orders`, then looked up the customer name for each row separately. Twenty orders meant twenty customer requests. Even when the same reader placed several orders, the same account information was requested again. Chapter 19's real-time status updates improve the freshness of a row, but they do not solve the problem of efficiently assembling the different data needed to render the screen initially.

There is no reason to abandon REST here. If there is only one operations screen, a dedicated HTTP query response assembled on the server is simpler. We choose GraphQL in this chapter because the order list, customer inquiry screen, and simple aggregate views require different combinations of fields. Screens can select the fields they need, while the server continues to control which data and costs are allowed.

Changing the query API's shape does not change order write rules. Payments and inventory, cancellations and refunds retain the command boundaries established earlier. This chapter's GraphQL API has no payment mutation or arbitrary state-change mutation. We add only an operational read boundary that combines queries from `OrdersModule` with account display information from the existing `AccountsModule`. The reader in Volume 1 and the customer in Volume 2 have the same user ID.

The dashboard's `paid` is not a string converted directly from a payment provider's success response. It is the order state confirmed by `OrderInventoryService.confirmPayment` after passing through the `PaymentLedger.prepare/record` boundary in `src/payments/payment-ledger.ts` and applying the result. State, version, and the `OrderTransition` audit are recorded together through `OrderTransitionsService.apply`, and reservations become `consumed`. Query resolvers read these facts; they do not deduct inventory again or use a dashboard query as the trigger to confirm payment.

## TypeScript Types and the GraphQL Schema Are Different Contracts

`@fluojs/graphql` is based on GraphQL Yoga. Register it with `GraphqlModule.forRoot` and declare public operations with `@Resolver`, `@Query`, and `@FieldResolver`. Writing a TypeScript return type does not automatically generate a GraphQL object type. A root operation without `outputType` defaults to `String`. Objects require an explicit `GraphQLObjectType`, and lists need an output declaration such as `listOf(...)`.

Argument binding with standard decorators also needs care. A root resolver receives `(input, context)`, and `@Arg` goes on DTO fields. For object field resolvers, `@Parent`, `@Context`, and `@Args` are **method decorators**. Do not place them before parameters as TypeScript parameter decorators. `@Parent(0)` and `@Context(1)` declare that values should be placed at indexes 0 and 1, respectively. This explicitness is part of Fluo's authoring model, which does not depend on `experimentalDecorators` or `emitDecoratorMetadata`.

Do not expose every stored column in the schema. The internal `customerId` needed to locate an order can exist in the parent object without being declared as a GraphQL field. Password hashes, payment provider tokens, and internal notes must not be serialized automatically just because they exist in a stored object. The implementation below exposes only the order identifier, status, currency, amount, version, and account display name.

The amount's output type is `String`. GraphQL `Int` is a signed 32-bit integer, and JavaScript `number` cannot represent every large integer exactly either. Convert `totalMinor`, calculated as an integer in the database and TypeScript, into a decimal string at the API boundary. Since the currency is `KRW`, the example's `"29000"` means 29,000 won. Do not use `Float` to work around the amount's range. Keep the version a nonnegative integer within the PostgreSQL integer column range. A new order's version 0 is a valid `pending_payment` response and is also valid for GraphQL's non-null `Int`. Do not apply posts' initial version 1 to order responses.

## Express the Screen's Query Needs as Small Ports

The following `src/orders/dashboard/contracts.ts` is a **complete application contract file**. Instead of creating a generic repository, it separates only the two queries the dashboard needs. `OrderDashboardRead` reads the existing order ledger; `AccountLabelsRead` reads display information from the existing `User`. We also wire the Prisma implementations of both ports below. They receive the `PrismaService` shared globally by `BlogDatabaseModule` in the root application's `src/database/blog-database.module.ts`, retaining the `PrismaModule.forRootAsync` registration that receives `AppSettings`. Do not create a new database wrapper in a resolver or the dashboard module.

Order queries use the saved `Order.totalMinor` and order item snapshots. The current price on a product screen is determined from `ProductVariant.priceMinor` and saleability conditions, but that value is not reapplied to past orders. Dashboard ports only narrow the read shape of the existing ledger; they are not a layer that repopulates product, inventory, or account data into parallel ledgers.

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

The `list` contract sorts orders with the specified status by their immutable ID in ascending order and, if `after` is present, returns at most `take` rows with IDs greater than it. IDs in this experiment are restricted to ASCII letters, digits, underscores, and hyphens. In a production database, align comparison and sorting collations to the same rule. A chronological screen would require a composite cursor of creation time and ID; do not describe string ID order as creation-time order.

This port can request `first + 1` rows for a single list request. Using one extra row to determine whether a next page exists avoids counting all records on every screen. An operational list whose statuses change between pages is not a point-in-time snapshot. Reflect in the UI that an already-viewed order may leave the status filter or a new order may appear on a later page. Requirements such as accounting close reports that need exact aggregation at one point in time should use separate transactional or snapshot queries.

## Implement Queries and Field Composition as Real Resolvers

The following `src/orders/dashboard/resolvers.ts` is a **complete file**. Storage implementations are injected through the two ports above, but page calculation, argument validation, authorization, field resolution, and batching are all implemented here. The `shop_operator` checked by `requireOperator` is a **request-scoped dashboard permission** newly defined in this chapter. The existing `AccountsService` neither grants this role nor puts it in the login JWT. The preceding middleware shown later adds it to the request principal only after comparing the account ID authenticated by the shared authenticator against the server-configured allowlist. GraphQL arguments or a JWT role string alone cannot grant this permission.

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

When an account has been deleted or display information is missing, `customer` is `null`. We do not delete historical orders or fail the entire order list. Conversely, if a required field such as the order's `id`, amount, or currency is missing, do not insert an empty string to pretend the response is valid. Explicit non-null fields expose those contract violations. GraphQL null propagation determines how far an error spreads, so mechanically marking every field non-null is not good design either.

Input DTO defaults apply when an argument is omitted. `first: null` is different from omission and is rejected by the validation above. Using `@Arg` does not automatically make the SDL argument non-null either. This implementation uses explicit range validation and `BAD_USER_INPUT`. If the product requires the argument itself to be non-null in the SDL, check the current code-first contract and choose another assembly method, such as schema-first. Do not invent unsupported decorator options.

`customerById` is an **accessor function** held by the singleton resolver, not a customer cache shared by all requests. `createDataLoader` obtains the actual loader from each `GraphQLContext`'s operation cache. When several orders need the same customer within one operation, they share one load result, while a different operation receives a new loader. In contrast, creating a regular DataLoader instance in the constructor and reusing it indefinitely can mix data and authorization results across users.

The reason the batch function does not simply return the database result array matters too. There is no guarantee that `WHERE id IN (...)` returns rows in the order of the requested IDs. Some accounts may also be missing. Reorder with a `Map` to return a result or `null` at the same position for each input key; otherwise, order A's row may acquire customer B's name. `maxBatchSize` limits one batch, not the total number of requests or database cost of an operation.

## Wire Both the Registration List and Authentication Middleware

First, connect the read ports to the actual ledgers. The following **complete `src/orders/dashboard/reads.ts`** reads Chapter 6's `Order` and Volume 1, Chapter 13's `User`. It creates no new account table or order projection. Because `currency` comes from the database as a string, it checks this chapter's KRW contract and converts only the `bigint` amount to a decimal string. Account display queries differ from authentication queries. Display information may remain on a disabled account's past orders, but that account cannot authenticate a new dashboard request.

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

Separate the sources of authentication and operational permission. `POST /auth/login` in [Volume 1, Chapter 14](../01-fluoblog/ch14-authentication.md) returns a `LoginResult` with `accessToken`, `tokenType: 'Bearer'`, `expiresIn: 900`, and `user: { id, displayName }`. The token contains `sub`, `authVersion`, and `scopes: ['posts:write']`, but no dashboard role. Configure `SHOP_OPERATOR_ACCOUNT_IDS` as a JSON array of strings containing only **already-existing active `User.id` values** verified by the server operator. For example, if you select `author-1` after completing Chapter 13's initialization, the development server environment value is as follows. If you select an account registered with a UUID, use the actual returned ID.

```sh
export SHOP_OPERATOR_ACCOUNT_IDS='["author-1"]'
```

Only people authorized to change deployment configuration manage this setting. Do not read it from a request body, header, or cookie, and do not automatically choose the first signup or someone whose display name is `operator`. The string `author-1` does not carry permission in itself either. If only an inactive placeholder row exists and credentials have not been initialized, startup fails in the validation below. Registering a new user does not automatically add them to the allowlist.

The following **complete `src/orders/dashboard/operator-policy.ts`** parses the setting once and verifies existence and active status through `AccountsService.findActiveSubject`. IDs are limited to 1 to 128 ASCII letters, digits, underscores, and hyphens, covering the existing `author-1` and UUIDs; whitespace is not silently trimmed and IDs are not substituted. Empty entries, duplicates, invalid JSON, and nonexistent accounts are configuration errors. An unset value is interpreted as an empty list, denying dashboard access to every account. Database failures also propagate as startup failures.

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

`ShopOperatorPolicy` is an internal boundary that receives only a validated principal. Even if the token has other roles, this dashboard's role list is replaced by the policy result above. It neither stores `shop_operator` in the database nor extends the login response. Because the allowlist is a snapshot read at startup, merely changing a configuration file does not alter the permissions of a running process. Applying a change requires restarting or redeploying the server.

The following **complete `src/orders/dashboard/graphql-auth.ts`** is the sole request adapter. It extracts Bearer credentials with `getRequestHeader` and calls `BlogTokenAuthenticator.authenticateToken`, exported by `AuthModule`. This shared authenticator checks the signature, expiry, issuer and audience, active account, and current `authVersion`. Do not invent a request authentication method that the account service does not have or bypass authentication by simply decoding the JWT.

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

As with Chapter 14's Bearer strategy, only the first entry of a header array is used. Align duplicate Authorization handling rules at the proxy too. Both `/graphql` and `/graphql/` are checked, while other paths continue unchanged, so public `POST /auth/login` remains accessible. If CORS preflight is needed, keep the existing CORS handling ahead of this middleware so that it handles OPTIONS first.

This chapter determines HTTP status **before** GraphQL execution. Missing, malformed, forged, or expired credentials, a disabled account, or an authentication generation mismatch produce 401; an authenticated account outside the allowlist receives 403. Neither case reaches order or customer display queries. Database errors or JWT configuration errors from the shared authenticator are not known Passport authentication errors, so they propagate unchanged. `authorize` and `next` also remain outside the `try` that maps authentication errors, preventing downstream failures from becoming 401 responses. Let the final HTTP serializer turn underlying system errors into 5xx responses without secret values. After GraphQL execution begins, errors such as `BAD_USER_INPUT` remain distinguishable through `errors[].extensions.code`.

The following **complete `src/orders/dashboard/module.ts`** connects actual tokens, read implementations, and visibility of the shared authenticator. `resolvers` is a discovery allowlist, not a substitute for provider registration. Register both the root and field resolvers. The configuration factory validates the allowlist through the injected existing `AccountsService` and passes the result to the singleton policy.

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

The **small registration change to the existing `src/app.ts`** is to add the following import and append `DashboardModule` to `AppModule`'s existing `@Module({ imports: [...] })` array. This example does not replace the entire file. Retain the existing `AppSettingsModule`, global asynchronous `BlogDatabaseModule`, `AccountsModule`, `AuthModule`, `OrdersModule`, and all other feature registrations.

```ts
import { DashboardModule } from './orders/dashboard/module.js';
```

The **small startup change to the existing `src/main.ts`** is to add the following dynamic import after `ensureMetadataSymbol()` and before `FluoFactory.create()`. This keeps decorated classes from being evaluated before metadata is ready.

```ts
const { DashboardAuthentication } = await import('./orders/dashboard/graphql-auth.js');
```

In the same file, if the existing `FluoFactory.create()` options have no `middleware` array, add the following entry. If the array already exists, add the `DashboardAuthentication` class token exactly once after existing CORS and correlation handling but before middleware that consumes the request. Do not change `AppModule`, `blogConfig.PORT`, the host, logger, or `shutdownRegistration`. Thanks to `exports: [DashboardAuthentication]`, Factory application middleware can resolve this token from the application container.

```ts
middleware: [DashboardAuthentication],
```

Fastify's `middleware` is a `MiddlewareLike[]`, accepting provider class tokens like this as well as objects. Application middleware runs before the GraphQL module's middleware. Putting it only in the dashboard module's own `middleware`, or registering it as a route guard on `/graphql`, does not establish the same ordering. The actual flow is `POST /auth/login → LoginResult.accessToken → Bearer extraction → shared authenticator → allowed ID policy → requestContext.principal → GraphQLContext.principal → orders`.

The current type of `GraphqlModule.forRoot({ context })` is a **synchronous function**, `(ctx) => Record<string, unknown>`. Do not move database authentication to `context: async ...`. The service spreads the custom context and then sets the standard `principal` to the value from the preceding HTTP context. This chapter does not use the `context` option and follows the flow above.

Use this configuration on Node24 according to the package's current support contract. The use of Web-standard Request and Response objects inside HTTP does not extend the GraphQL support guarantee to Bun, Deno, or Workers. The endpoint is fixed at `/graphql`; do not add options such as `path: '/admin/graphql'`. A proxy can change the external path, but that is a deployment contract separate from package configuration.

## Test Authentication and Operational Permission Boundaries with Real Tokens

If tests directly construct a principal with `{ roles: ['shop_operator'] }`, they can pass even when the actual login path has no code granting operational permission. The two test files below share the following **complete `src/orders/dashboard/dashboard-test-fixture.ts`**. This fixture uses the real signer and verifier, Chapter 14's shared authenticator, and the configuration parser, policy, and middleware just built. Only account lookup is replaced with controllable state, and time is fixed. It therefore checks from middleware input through resolver context, but it does not yet integrate password verification, PostgreSQL, Fastify dispatch, or Yoga schema assembly.

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

The following **complete `src/orders/dashboard/graphql-auth.test.ts`** verifies failure classification and blocked reads. Instead of the HTTP serializer, it checks the actual `UnauthorizedException.status` and `ForbiddenException.status`. An unknown database error must reach the caller as the same error object. The case where even a server-signed token containing a role string fails when its ID is not allowed establishes the source of permission.

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

The barrier in the final test is an exact signal that execution has reached the read corresponding to SQL. Register the signal before changing state and await it within Vitest's five-second limit. There is no fixed sleep or request ordering left to chance. It tests the distinction that the next authentication observing the new `authVersion` fails, while a request that has already passed is not automatically cancelled.

## Observe Batch Counts Instead of Hiding N+1

The following `src/orders/dashboard/resolvers.test.ts` is a **complete unit and batching experiment file**. It calls resolvers directly with contexts that passed through the fixture's actual authentication adapter. It does not verify schema generation or network transport; it uses the real `createDataLoader` to check deduplication within an operation and isolation between operations. Customer mapping must remain correct even when the fake display information store returns values in the reverse of the input order.

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

The batching test creates the required `load` calls first, then awaits them with `Promise.all`. Using `await` on each call before requesting the next customer would remove the opportunity for DataLoader to put them in the same batch. Do not insert sleeps hoping that execution times happen to overlap. The expected result is one customer batch containing `reader-a` and `reader-b` in the first operation, followed by one new batch when `reader-a` is queried again in the next operation.

Success in this experiment alone does not mean N+1 has disappeared throughout the application. An HTTP experiment is needed to confirm the same result through actual field resolver discovery and GraphQL field execution. It requires development PostgreSQL with Volume 1's active accounts and credentials and Volume 2's order schema, a generated Prisma Client, the existing `JWT_SECRET`, the allowed ID setting, and a Node.js 24 application. Apply the files and registration changes above, start the server, and prepare the selected existing account's login email and password in the `OPERATOR_EMAIL` and `OPERATOR_PASSWORD` environment variables. The following procedure obtains `LoginResult.accessToken` from **the actual `POST /auth/login`**, rather than calling a signer separately. Do not print the entire login response or token to the terminal.

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

Use that token to send the query below. A valid response is HTTP 200 with `data.orders` and page information, and no `errors`. If there are no orders in the selected status, `nodes: []` is also valid. Check that login used a real account whose ID is allowed; do not manually add a role to the JWT to make the request succeed.

```sh
curl --fail-with-body http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${OPERATOR_TOKEN}" \
  --data '{"query":"query Dashboard($first: Int) { orders(status: \"paid\", first: $first) { nodes { id status totalMinor currency customer { id displayName } } endCursor hasNextPage } }","variables":{"first":20}}'
unset OPERATOR_TOKEN
```

Attach a query-count recorder to the read adapters to verify one order query and batch queries for the selected customer fields. A request that does not select customer fields must make zero **customer display information batch queries**. The shared authenticator's `findActiveSubject` account check occurs separately once per request, and startup allowlist validation is separate too. Do not combine either of those with customer display queries when counting N+1. If one customer is missing from the page, only that order's `customer` should be `null`, and the remaining rows must be preserved.

Next, omitting the token must produce 401; a reader token from a successful real login but outside the allowlist must produce 403. Both order and customer display query counts must be 0 in either case. An incorrect login password produces 401 at the existing `/auth/login`. A request with a database failure injected into account lookup must produce a server error, not 401. Verify that the same policy applies to `/graphql/` and GET queries. Do not determine GraphQL operation success from `curl` exiting successfully alone. Even HTTP 200 can contain execution `errors`.

During this revision, the chapter's code blocks were transformed in memory, and 11 authentication, authorization, and batching cases were executed using the actual packages' signer, verifier, and DataLoader, the shared authenticator, and the new adapter and policy. These results came from connecting test registration and clock control to an in-memory execution harness; they do not mean the `pnpm exec vitest run` command above was run. The actual Fastify listener, the HTTP round trip from `/auth/login` through Yoga, and PostgreSQL and generated Prisma Client connections were not exercised.

The existing repository's `examples/graphql` is a separate runnable example that actually covers module registration, field resolvers, operation DataLoader, and SSE. It is not a completed version of this shop dashboard or the entire 72-chapter application. Examples and package tests provide API evidence; distinguish them from verification of this application's actual listener and database integration, which readers perform in their own environment.

## Revocation Applies at the Next Authentication; In-Flight Queries May Continue

This dashboard authenticates one finite HTTP query. JWT signature and expiry checks happen on entry to the shared authenticator, followed by a lookup of the current account and `authVersion`. Those checks are not one atomic database snapshot. A token may expire while waiting for account lookup after token verification, or account suspension may commit immediately after authentication finishes. This chapter does not extend Chapter 14's authenticator to keep rechecking until just before the response. A query that is already authorized and executing, along with its operation's DataLoader, may finish its response.

After committing an account suspension or an increased `authVersion` in the development database, sending the same token in the next request that can observe the new value must produce 401. By placing a barrier where an existing request enters the read port and then committing the change, you can observe the boundary: the new request is rejected, while the existing request completes when its barrier is released. Replacing account lookup with a stale replica or TTL cache increases the delay before changes are observed. This example adds neither such a cache nor distributed revocation propagation.

Increasing `authVersion` revokes previous tokens but does not remove operational permission itself. If the same active account logs in again and receives a token for the new generation, it can query again while it remains in the allowlist. To remove operational permission, remove the ID from the server allowlist and apply the configuration to running servers. Conversely, an account that remains on the allowlist still cannot pass shared authentication if it is disabled. Logout that merely deletes the browser token differs from server-side revocation of an already-copied token.

Do not reuse this limited policy unchanged for long-lived GraphQL subscriptions or socket connections. Long-lived observation requires separate revalidation and shutdown policies. This chapter registers no subscription resolver and does not enable WebSocket subscriptions. Query timeouts and cancellation propagation are separate operational responsibilities too; neither `first` nor document budgets guarantee request duration.

## Query Limits Are Not a SQL Cost Model

The registered `maxDepth`, `maxComplexity`, and `maxCost` are budgets that analyze the GraphQL document and selected operation. The current implementation calculates field depth, field count, and a depth-weighted total. It does not predict actual table row counts or SQL execution plans. Even `orders(first: 1000000)` at depth 2 can be expensive for the database. That is why the implementation limits `first` to 50 and requires the read port to apply `take` as an actual SQL limit.

Operational load tests should include not only deep nesting but also documents that call the same list repeatedly through aliases. An over-budget request must stop before resolver execution and make zero store calls. However, multiple list requests within the allowed budget can still produce multiple SQL queries. Observe response time by operation name, order query counts, customer batch sizes, and rows read together to determine whether one request hides expensive server work behind fewer network round trips.

GraphiQL and introspection are disabled by default, and this chapter explicitly disables them too. Enable them only when local schema inspection is needed. Disabling them does not replace authentication or authorization checks: a user who knows the schema can still send queries. Request size limits, per-account request rates, and database timeouts are also boundaries separate from document budgets. Do not confuse Chapter 19's message payload limit with a GraphQL HTTP body limit.

Resolver lifetime also affects cost and permissions. Injecting a request-scoped provider directly into a default singleton resolver creates a lifetime mismatch. If request-specific dependencies are needed, give the resolver `@Scope('request')` too. Here, stateless read ports and the per-operation DataLoader accessor are enough for a singleton. The operation container is disposed on completion or connection closure, but this does not automatically provide full disposal of external streams opened by the application.

## Keep Real-Time Screens and GraphQL Together with Distinct Roles

The dashboard reads its first page through GraphQL and passes through the same Bearer authentication and operator ID policy on every refresh or screen-triggered re-query. Socket.IO observation in Chapter 19 is limited to **the authenticated customer's own orders**. This chapter's `shop_operator` permission does not grant observation rights on that socket, so do not assume the operator already receives all order events. An operator subscription to all orders is a new feature requiring its own authorization, revalidation, and shutdown policy; here, the screen updates through authorized GraphQL re-queries.

When choosing GraphQL subscriptions, distinguish default SSE from optional WebSocket transport. WebSocket subscriptions must be explicitly enabled through `subscriptions.websocket.enabled` and require a Node HTTP/S adapter capable of upgrades. Socket.IO messages do not use GraphQL's `graphql-ws` protocol. `@Subscription({ topics })` is not a supported API either; the resolver must return an `AsyncIterable`. The application is responsible for registering listeners on the subscription source and removing them when the iterator closes.

For now, keep the operator's read-only GraphQL and the customer's real-time observation of owned orders as separate authorization boundaries. Operators request the needed fields in one operation, the server validates page size and permission derived from allowed IDs, and customer display queries are batched within the operation. In the next chapter, we apply caching to this read boundary. DataLoader's operation cache does not accelerate requests that have already ended, so distinguish it from response caching. We will examine why retaining product descriptions for a long time and keeping inventory decisions current cannot use the same expiry period.

## Evidence and Verification Scope

- [Shared implementation boundaries](../EDITORIAL.md): `BlogDatabaseModule`, payment and inventory updates, initial order versions, and audit records.
- [Existing accounts and active status](../01-fluoblog/ch13-accounts-and-credentials.md) and [shared authenticator, LoginResult, and AuthModule](../01-fluoblog/ch14-authentication.md): the existing `User.id`, `findActiveSubject`, `authenticateToken`, and export boundaries.
- [JWT signing](../../packages/jwt/src/signing/signer.ts), [signature, expiry, issuer, and audience verification](../../packages/jwt/src/signing/verifier.ts), and [Passport authentication errors](../../packages/passport/src/errors.ts): separation of known authentication failures from underlying system errors.
- [Header reading](../../packages/http/src/header-helpers.ts), [HTTP exceptions](../../packages/http/src/exceptions.ts), [middleware types](../../packages/http/src/types.ts), [application/module execution order](../../packages/http/src/dispatch/dispatcher.ts), and [Fastify bootstrap options](../../packages/platform-fastify/src/adapter.ts): the actual registration APIs for preceding authentication.
- [Prisma facade contract](../../packages/prisma/README.md) and [single-client and transaction context implementation](../../packages/prisma/src/service.ts): evidence for read adapters against the existing ledgers.
- [GraphQL usage contract](../../packages/graphql/README.md), [public exports](../../packages/graphql/src/index.ts), and [option and context types](../../packages/graphql/src/types.ts): Node support, fixed endpoint, scope, and registration boundaries.
- [Decorator implementation](../../packages/graphql/src/decorators.ts) and [input pipeline](../../packages/graphql/src/pipeline/input-pipeline.ts): argument defaults, return types, and standard method binding.
- [DataLoader implementation](../../packages/graphql/src/dataloader/dataloader.ts): actual behavior of the operation cache and accessor function.
- [GraphQL service implementation](../../packages/graphql/src/service.ts) and [guardrail implementation](../../packages/graphql/src/guardrails.ts): propagation of the preceding principal and document cost calculation.
- [Field resolver tests](../../packages/graphql/src/field-resolver.test.ts), [field input tests](../../packages/graphql/src/field-resolver-input.test.ts), and [module tests](../../packages/graphql/src/module.test.ts): evidence for discovery, nullability, and authentication context.
- [Official runnable example guide](../../examples/graphql/README.md) and [example source](../../examples/graphql/src/app.ts): a separate runnable GraphQL learning surface. Do not substitute it for evidence that this chapter's shop integration, or tests not run while writing it, passed.
