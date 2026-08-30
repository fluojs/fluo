# @fluojs/graphql

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 데코레이터 기반 GraphQL 통합 패키지입니다. **GraphQL Yoga**를 기반으로 설계되었으며, 깊은 DI 통합과 퍼스트 파티 DataLoader 지원을 통해 고성능의 명세 준수 GraphQL 실행 파이프라인을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [핵심 기능](#핵심-기능)
- [Resolver Lifecycle 계약](#resolver-lifecycle-계약)
- [운영 가드레일](#운영-가드레일)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/graphql graphql graphql-yoga
```

`@fluojs/graphql`은 선택적 GraphQL-over-WebSocket subscription을 위해 `ws@^8.21.0`을 포함합니다. 업그레이드할 때 application lockfile을 갱신해 패치된 package-owned WebSocket runtime이 설치되도록 하세요. 애플리케이션이 `ws`를 직접 import하지 않는 한 별도로 추가할 필요는 없습니다.

`@fluojs/graphql`은 Node.js `>=20.19.3 <21 || >=22.2.0 <27`을 지원하며, 이 정확한 범위를 `engines.node`로 선언합니다. 필수 dependency graph는 Node 21, Node 22.2.0 미만, 검증되지 않은 Node 27 이상을 제외하는 RFC `QUERY` 계약의 Node listener-capable `@fluojs/runtime`에 도달하며, `@fluojs/config`는 독립적인 더 낮은 Node.js `>=20.16.0` 하한을 유지합니다. HTTP query/mutation과 기본 SSE subscription 경로는 내부적으로 Web-standard request/response primitive를 사용하지만, 이 구현 세부 사항이 Bun, Deno, Cloudflare Workers에 대한 package 지원을 의미하지는 않습니다. 전체 dependency metadata와 native runtime suite가 완전한 GraphQL 계약을 입증하기 전까지 해당 runtime은 지원하지 않습니다. 선택적 WebSocket subscription에는 server-backed Node HTTP/S upgrade 표면을 노출하는 adapter도 필요합니다.

## 사용 시점

- TypeScript 데코레이터를 사용하여 타입 안전한 GraphQL API를 구축할 때 (**Code-first**).
- 기존의 executable `GraphQLSchema` 객체를 fluo 애플리케이션에 통합할 때.
- GraphQL resolver 내에서 request-scoped provider를 포함한 원활한 의존성 주입이 필요할 때.
- GraphQL operation 범위 **DataLoader** 패턴을 사용하여 효율적인 데이터 페칭을 수행할 때.

## 빠른 시작

`GraphqlModule.forRoot(...)`를 등록하고 표준 데코레이터를 사용하여 resolver를 정의합니다. 현재 `@fluojs/graphql`는 동기 모듈 엔트리포인트만 제공하며 `GraphqlModule.forRootAsync(...)` 계약은 없습니다.

Code-first resolver discovery 대신 schema-first 통합을 원하면 executable `GraphQLSchema`를 `schema`로 전달할 수도 있습니다.

```typescript
import { Module } from '@fluojs/core';
import { bootstrapNodeApplication } from '@fluojs/runtime/node';
import { GraphqlModule, Query, Resolver, Arg } from '@fluojs/graphql';

class HelloInput {
  @Arg('name')
  name = '';
}

@Resolver()
class HelloResolver {
  @Query({ input: HelloInput })
  hello(input: HelloInput): string {
    return `Hello, ${input.name}!`;
  }
}

@Module({
  imports: [
    GraphqlModule.forRoot({
      resolvers: [HelloResolver]
    })
  ],
  providers: [HelloResolver]
})
class AppModule {}

const app = await bootstrapNodeApplication(AppModule);
await app.listen(3000);
// curl -X POST http://localhost:3000/graphql \
//   -H "Content-Type: application/json" \
//   -d '{"query": "{ hello(name: \"fluo\") }"}'
```

## 핵심 기능

### Code-first Resolvers
fluo는 표준 데코레이터를 사용하여 GraphQL 스키마를 정의합니다. `@Resolver`, `@Query`, `@Mutation`, `@Subscription`을 사용하여 클래스 메서드를 GraphQL 작업에 매핑합니다. GraphQL 인자는 input DTO 필드에 `@Arg(...)`로 선언하고, resolver 메서드는 작업의 `input` 옵션을 통해 해당 DTO를 받습니다. Object field resolver는 `@Resolver('TypeName')`, `@FieldResolver(...)`, 명시적 `@Parent()` / `@Context()` method binding을 사용합니다.

Resolver 반환 타입은 TypeScript metadata에서 추론되지 않습니다. `outputType`이 없는 operation은 GraphQL `String`을 사용합니다. Object 결과에는 GraphQL output type을 전달해야 하고, array 결과에는 item type을 `listOf(...)`로 감싸야 합니다.

```typescript
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { listOf, Query, Resolver } from '@fluojs/graphql';

const UserType = new GraphQLObjectType({
  name: 'User',
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString },
  },
});

@Resolver()
class UserResolver {
  @Query({ outputType: UserType })
  async user() {
    return userService.findCurrent();
  }

  @Query({ outputType: listOf(UserType) })
  async users() {
    return userService.findAll();
  }
}
```

### Object Field Resolver

`@FieldResolver(...)`는 provider method를 `@Resolver('TypeName')`이 소유하는 named object type의 field에 연결합니다. 대상 object type은 code-first root operation output에서 도달 가능해야 합니다. 해당 field가 `GraphQLObjectType`에 이미 존재하거나, schema builder가 field를 추가할 수 있도록 field resolver가 `type`을 선언해야 합니다.

`@FieldResolver({ input })`은 root resolver DTO argument pipeline을 그대로 재사용합니다. `@Arg(...)` field가 GraphQL argument를 정의하고, 값은 DTO로 materialize되며, validation error는 계속 GraphQL `BAD_USER_INPUT` error로 반환됩니다. list argument type은 root operation과 동일하게 `argTypes`로 지정하세요.

TC39 표준 데코레이터는 parameter decorator를 지원하지 않습니다. fluo의 standard-decorator 계약을 지키기 위해 `@Args()`, `@Parent()`, `@Context()`는 zero-based parameter index를 바인딩하는 method decorator입니다. `@Args()`와 `@Parent()`의 기본값은 모두 `0`이므로 둘을 함께 사용할 때는 서로 다른 명시적 index를 지정해야 합니다. `@Context()`의 기본값은 `1`입니다. 같은 index를 두 번 바인딩하면 decorator evaluation 중 실패합니다. `@FieldResolver({ input })`에는 `@Args()`가 필요하고, `@Args()`에는 `input`이 필요합니다.

```typescript
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { Arg, Args, Context, FieldResolver, Parent, Query, Resolver, type GraphQLContext } from '@fluojs/graphql';

const AuthorType = new GraphQLObjectType({
  name: 'Author',
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString },
  },
});

const BookType = new GraphQLObjectType({
  name: 'Book',
  fields: {
    id: { type: GraphQLString },
    title: { type: GraphQLString },
  },
});

class AuthorInput {
  @Arg('locale')
  locale = 'en';
}

@Resolver()
class BookQueryResolver {
  @Query({ outputType: BookType })
  book() {
    return { id: 'book-1', title: 'Standard GraphQL', authorId: 'author-1' };
  }
}

@Resolver('Book')
class BookFieldResolver {
  @FieldResolver({ fieldName: 'author', input: AuthorInput, type: AuthorType })
  @Args(0)
  @Parent(1)
  @Context(2)
  author(input: AuthorInput, book: { authorId: string }, context: GraphQLContext) {
    return authorLoader(context).load(book.authorId);
  }
}
```

두 resolver class를 module provider 또는 controller로 등록하고, `GraphqlModule.forRoot({ resolvers })`를 allowlist로 사용할 때는 둘 다 포함하세요. Field resolver DTO input은 root resolver와 같은 HTTP 및 subscription operation container scope를 따릅니다. 중복 `TypeName.fieldName` 등록, code-first root output에서 도달할 수 없는 field target, root operation method에 배치한 `@Args()` / `@Parent()` / `@Context()` binding은 bootstrap 중 실패합니다. Schema-first field-resolver attachment는 이 runtime 계약 범위 밖입니다. `nullable` option은 예약되어 있습니다. 기존 field nullability는 유지되며, `type`으로 추가한 field는 GraphQL의 nullable 기본값을 사용합니다.

### GraphQL Operation 범위 DataLoaders
내장된 DataLoader 통합을 통해 N+1 문제를 효율적으로 해결합니다. Loader는 각 GraphQL 작업마다 자동으로 격리됩니다.

```typescript
import { GraphQLObjectType, GraphQLString } from 'graphql';
import { createDataLoader, type GraphQLContext, Query, Resolver } from '@fluojs/graphql';

const UserType = new GraphQLObjectType({
  name: 'User',
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString },
  },
});

const userLoader = createDataLoader(async (ids: readonly string[]) => {
  const users = await userService.findByIds(ids);
  return ids.map(id => users.find(u => u.id === id));
});

class UserInput {
  @Arg('id')
  id = '';
}

@Resolver()
class UserResolver {
  @Query({ input: UserInput, outputType: UserType })
  async user(input: UserInput, context: GraphQLContext) {
    return userLoader(context).load(input.id);
  }
}
```

## Resolver Lifecycle 계약

- Singleton resolver가 기본값이며, 각 operation에서 애플리케이션 컨테이너를 통해 resolve됩니다.
- Request-scoped provider를 주입하는 resolver는 resolver 자체에도 `@Scope('request')`를 지정해야 합니다. 이렇게 해야 DI lifetime 규칙이 명시적으로 유지되고 singleton-to-request dependency mismatch를 피할 수 있습니다.
- `@fluojs/graphql`은 HTTP GraphQL 요청 또는 WebSocket subscription operation마다 operation-scoped DI 컨테이너를 하나 만들고, 해당 operation 안의 resolver 호출들이 이를 공유하며, operation 완료 또는 WebSocket operation 종료 시 dispose합니다.
- Resolver 메서드는 `GraphQLContext`를 받으며, 내장 필드에는 fluo `request`, middleware 또는 guard가 설정한 인증된 HTTP `principal`, WebSocket subscription의 `connectionParams`와 `socket`, 그리고 `GraphqlModule.forRoot({ context })`가 반환한 사용자 정의 필드가 포함됩니다.
- Object field resolver는 root resolver와 같은 provider scope 및 operation container를 사용합니다. `@Parent()`와 `@Context()`는 positional method argument만 제어합니다.
- GraphQL operation 범위 DataLoader helper는 같은 `GraphQLContext` operation 경계를 사용하므로 loader cache는 하나의 GraphQL operation 안에서만 공유됩니다.
- 애플리케이션 shutdown은 WebSocket transport를 등록 해제하고, 살아 있는 WebSocket client를 닫으며, 아직 활성 상태인 WebSocket operation container를 정상 operation 완료 때와 같은 request-scoped provider teardown 경로로 dispose합니다.

```typescript
import { Inject, Scope } from '@fluojs/core';
import { Query, Resolver } from '@fluojs/graphql';

@Scope('request')
class RequestState {
  private static nextId = 0;
  readonly requestId = `request-${++RequestState.nextId}`;
}

@Inject(RequestState)
@Scope('request')
@Resolver()
class RequestResolver {
  constructor(private readonly state: RequestState) {}

  @Query('requestId')
  requestId(): string {
    return this.state.requestId;
  }
}
```

### 프로토콜 지원
- **HTTP**: 표준 GET/POST 쿼리 및 뮤테이션.
- **SSE**: Server-Sent Events를 통한 구독(기본값).
- **WebSockets**: 활성 adapter가 upgrade listener를 지원하는 Node HTTP/S 서버를 노출할 때(예: Node HTTP adapter) 사용할 수 있는 선택적 `graphql-ws` 실시간 구독 지원.

지원되는 Node.js `>=20.19.3 <21 || >=22.2.0 <27` runtime 범위에서 HTTP query/mutation과 기본 SSE subscription 경로는 fluo의 Web-standard HTTP 추상화를 통해 실행됩니다. 이 내부 transport seam은 Bun, Deno, Cloudflare Workers 지원 보장이 아닙니다. 선택적 WebSocket transport는 server-backed Node HTTP/S adapter 표면도 필요하므로 지원 범위가 더 좁습니다.

```typescript
GraphqlModule.forRoot({
  subscriptions: {
    websocket: {
      enabled: true,
      limits: {
        maxConnections: 100,
        maxPayloadBytes: 64 * 1024,
        maxOperationsPerConnection: 25,
      },
    }
  }
})
```

`@Subscription({ topics })`는 지원하지 않습니다. Subscription resolver는 `AsyncIterable`을 반환해야 합니다.

## 운영 가드레일

- `graphiql`을 명시적으로 켜거나 `introspection: true`를 설정하지 않으면 스키마 introspection은 기본적으로 비활성화됩니다.
- 문서 depth, field complexity, aggregate query cost에 대한 request validation budget이 기본적으로 보수적인 값으로 활성화됩니다.
- `graphiql` 기본값은 `false`입니다. `introspection`은 명시하지 않으면 `graphiql` 설정을 따르므로, production 앱은 기본적으로 비공개 상태를 유지하고 로컬 GraphiQL 세션만 opt in할 수 있습니다.
- `limits`에는 request validation budget을 전달하거나 `false`를 전달할 수 있습니다. `false`는 fluo 밖에서 동등한 제어를 적용할 때만 사용하세요.
- Streaming GraphQL 응답은 downstream response stream이 닫히거나 오류를 내면 upstream fetch body를 cancel하므로 SSE subscription 리소스를 즉시 해제합니다.
- Downstream streaming 실패와 upstream cancellation cleanup 실패가 동시에 발생하면 downstream 실패가 계속 관찰 가능하며 cancellation cleanup은 best-effort로 처리됩니다.
- GraphQL 스키마 해석 이후 bootstrap이 실패하면 원래 오류를 다시 던지기 전에 실패한 service의 cross-realm GraphQL object allowlist만 제거합니다. 다른 활성 GraphQL 애플리케이션이 하나도 남지 않은 경우에만 package의 process-wide `graphql/jsutils/instanceOf` 패치를 원복합니다.
- 각 활성 GraphQL 애플리케이션은 자체 cross-realm GraphQL object allowlist를 소유합니다. Shutdown도 같은 release 규칙을 따르므로, 다른 실행 중인 애플리케이션은 process-wide `instanceOf` 패치를 유지하고 자신의 object만 허용합니다.
- WebSocket 구독 경로에는 별도의 전송 budget이 기본 적용됩니다: 동시 연결 `100`, 최대 payload 크기 `64 KiB`, 연결당 활성 operation `25`개입니다.
- `subscriptions.websocket.enabled` 기본값은 `false`입니다. 활성화하려면 upgrade를 지원하는 Node HTTP/S adapter가 필요합니다. `connectionInitWaitTimeoutMs`는 연결 초기화를 위해 `graphql-ws`로 전달되고, `keepAliveMs`는 설정 시 WebSocket keepalive ping 주기를 제어합니다.
- 무제한 WebSocket 동작이 정말 필요할 때만 `subscriptions.websocket.limits = false`를 사용하고, 그 경우에도 동일한 수준의 외부 제어 수단을 마련해야 합니다.
- 무제한 동작이 꼭 필요할 때만 `limits: false`를 사용하고, 그 경우에는 외부 제어 수단을 함께 두어야 합니다.

```typescript
GraphqlModule.forRoot({
  graphiql: false,
  introspection: false,
  limits: {
    maxDepth: 8,
    maxComplexity: 120,
    maxCost: 240,
  },
  subscriptions: {
    websocket: {
      enabled: true,
      limits: {
        maxConnections: 100,
        maxPayloadBytes: 64 * 1024,
        maxOperationsPerConnection: 25,
      },
    },
  },
  resolvers: [HelloResolver],
})
```

## 공개 API

- `GraphqlModule.forRoot(options)`: GraphQL 통합을 위한 메인 엔트리 포인트.
- `Resolver`, `Query`, `Mutation`, `Subscription`: Resolver 및 root operation 데코레이터.
- `FieldResolver`, `Args`, `Parent`, `Context`: Code-first object field resolution과 명시적 DTO input, parent, context parameter-index binding.
- `Arg`: Input DTO 필드를 GraphQL 인자로 매핑하는 데코레이터.
- `createDataLoader`, `createDataLoaderMap`, `getRequestScopedDataLoader`, `createRequestScopedDataLoaderFactory`, `DataLoader`: DataLoader factory helper와 type.
- `listOf`, `isGraphqlListTypeRef`: list output type reference helper.
- `GraphQLContext` 및 export되는 option/metadata type: `subscriptions.websocket.limits`에 사용하는 `GraphqlWebSocketLimitsOptions`를 포함한 GraphQL 실행과 module 설정을 위한 타입 정의.

지원되는 module option에는 `schema`, `context`, `plugins`, `graphiql`, `introspection`, `limits`, `subscriptions.websocket.enabled`, `subscriptions.websocket.limits`, `subscriptions.websocket.connectionInitWaitTimeoutMs`, `subscriptions.websocket.keepAliveMs`가 포함됩니다.

## 관련 패키지

- `@fluojs/core`: 핵심 DI 및 모듈 시스템.
- `@fluojs/http`: 기반 HTTP 추상화.
- `@fluojs/validation`: GraphQL 입력을 위한 통합 DTO 검증.

## 예제 소스

- `packages/graphql/src/module.test.ts`: 모듈 등록, resolver 실행, request-scoped container, subscription, guardrail 기본값을 다루는 통합 테스트 및 사용 예제.
- `packages/graphql/src/field-resolver-input.test.ts`: Object field DTO input의 HTTP, request scope, validation, scalar/list argument, subscription, binding collision을 실행 가능한 형태로 검증하는 테스트.
- `packages/graphql/src/runtime-support.test.ts`: Package의 Node.js engine 하한이 필수 first-party dependency graph에서 가장 높은 하한 이상인지 검증하는 회귀 테스트.
- `packages/graphql/field-resolver-rfc.md`: Object field resolver의 구현된 계약과 후속 범위.
