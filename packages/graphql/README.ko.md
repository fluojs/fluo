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

## 사용 시점

- TypeScript 데코레이터를 사용하여 타입 안전한 GraphQL API를 구축할 때 (**Code-first**).
- 기존의 executable `GraphQLSchema` 객체를 fluo 애플리케이션에 통합할 때.
- GraphQL resolver 내에서 request-scoped provider를 포함한 원활한 의존성 주입이 필요할 때.
- Request-scoped **DataLoader** 패턴을 사용하여 효율적인 데이터 페칭을 수행할 때.

## 빠른 시작

`GraphqlModule.forRoot(...)`를 등록하고 표준 데코레이터를 사용하여 resolver를 정의합니다. 현재 `@fluojs/graphql`는 동기 모듈 엔트리포인트만 제공하며 `GraphqlModule.forRootAsync(...)` 계약은 없습니다.

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
fluo는 표준 데코레이터를 사용하여 GraphQL 스키마를 정의합니다. `@Resolver`, `@Query`, `@Mutation`, `@Subscription`을 사용하여 클래스 메서드를 GraphQL 작업에 매핑합니다. GraphQL 인자는 input DTO 필드에 `@Arg(...)`로 선언하고, resolver 메서드는 작업의 `input` 옵션을 통해 해당 DTO를 받습니다.

현재 `@fluojs/graphql` 런타임은 root operation resolver만 지원합니다. `author(book, context)` 같은 object field resolver 패턴은 아직 런타임 계약이 아니라 `packages/graphql/field-resolver-rfc.md`에 정리된 설계 초안입니다.

### Request-Scoped DataLoaders
내장된 DataLoader 통합을 통해 N+1 문제를 효율적으로 해결합니다. Loader는 각 GraphQL 작업마다 자동으로 격리됩니다.

```typescript
import { createDataLoader, type GraphQLContext } from '@fluojs/graphql';

const userLoader = createDataLoader(async (ids: string[]) => {
  const users = await userService.findByIds(ids);
  return ids.map(id => users.find(u => u.id === id));
});

class UserInput {
  @Arg('id')
  id = '';
}

@Resolver()
class UserResolver {
  @Query({ input: UserInput })
  async user(input: UserInput, context: GraphQLContext) {
    return userLoader(context).load(input.id);
  }
}
```

## Resolver Lifecycle 계약

- Singleton resolver가 기본값이며, 각 operation에서 애플리케이션 컨테이너를 통해 resolve됩니다.
- Request-scoped provider를 주입하는 resolver는 resolver 자체에도 `@Scope('request')`를 지정해야 합니다. 이렇게 해야 DI lifetime 규칙이 명시적으로 유지되고 singleton-to-request dependency mismatch를 피할 수 있습니다.
- `@fluojs/graphql`은 HTTP GraphQL 요청 또는 WebSocket subscription operation마다 operation-scoped DI 컨테이너를 하나 만들고, 해당 operation 안의 resolver 호출들이 이를 공유하며, operation 완료 또는 WebSocket operation 종료 시 dispose합니다.
- Request-scoped DataLoader helper는 같은 `GraphQLContext` operation 경계를 사용하므로 loader cache는 하나의 GraphQL operation 안에서만 공유됩니다.

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
- **WebSockets**: 실시간 구독을 위한 선택적 `graphql-ws` 지원.

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

## 운영 가드레일

- `graphiql`을 명시적으로 켜거나 `introspection: true`를 설정하지 않으면 스키마 introspection은 기본적으로 비활성화됩니다.
- 문서 depth, field complexity, aggregate query cost에 대한 request validation budget이 기본적으로 보수적인 값으로 활성화됩니다.
- WebSocket 구독 경로에는 별도의 전송 budget이 기본 적용됩니다: 동시 연결 `100`, 최대 payload 크기 `64 KiB`, 연결당 활성 operation `25`개입니다.
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
- `Resolver`, `Query`, `Mutation`, `Subscription`: 작업 데코레이터.
- `Arg`: Input DTO 필드를 GraphQL 인자로 매핑하는 데코레이터.
- `createDataLoader`, `createDataLoaderMap`: DataLoader 팩토리 헬퍼.
- `GraphQLContext`: GraphQL 실행 컨텍스트를 위한 타입 정의.

## 관련 패키지

- `@fluojs/core`: 핵심 DI 및 모듈 시스템.
- `@fluojs/http`: 기반 HTTP 추상화.
- `@fluojs/validation`: GraphQL 입력을 위한 통합 DTO 검증.

## 예제 소스

- `packages/graphql/src/module.test.ts`: 통합 테스트 및 사용 예제.
- `examples/graphql-yoga`: 전체 GraphQL 애플리케이션 예제.
