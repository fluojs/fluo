<!-- packages: @fluojs/graphql, @fluojs/core, @fluojs/http -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 18. GraphQL API

이 장에서는 FluoShop에 REST와 다른 질의 계층을 추가하는 방식을 다룹니다. Chapter 17까지 알림과 실시간 흐름을 확장했다면, 여기서는 제품 카탈로그를 중심으로 GraphQL API와 실행 가드레일을 구성합니다.

## Learning Objectives
- fluo에서 GraphQL을 도입할 때 얻는 구조적 이점을 구분합니다.
- `GraphqlModule` 설정과 코드 우선 리졸버 등록 방식을 정리합니다.
- 요청 스코프 DataLoader로 N+1 문제를 줄이는 흐름을 구성합니다.
- SSE 기본 구독과 선택적 WebSocket 구독 설정을 확인합니다.
- 복잡도 제한과 인트로스펙션 제어 같은 운영 가드레일을 적용합니다.
- FluoShop 제품 카탈로그에 GraphQL을 연결하는 기준을 정리합니다.

## Prerequisites
- Chapter 13, Chapter 14, Chapter 15, Chapter 16, Chapter 17 완료.
- Resolver, 스키마, 구독 같은 GraphQL 핵심 용어에 대한 이해.
- API 보안과 성능 제한을 함께 설계해야 한다는 운영 경험.

## 18.1 Why GraphQL in fluo?

**명시성이 암시성보다 낫다(Explicit Over Implicit)**는 fluo의 철학은 GraphQL의 타입 스키마 모델과 잘 맞습니다. `@fluojs/graphql`을 사용하면 다음과 같은 이점을 얻을 수 있습니다.

- **통합된 DI**: 리졸버는 fluo 컨테이너 안의 최상위 프로바이더로 취급됩니다.
- **프로토콜 이식성**: 같은 GraphQL API를 Node.js, Bun, Deno, Edge Workers에서 코드 변경 없이 실행할 수 있습니다.
- **표준 데코레이터**: 레거시 `experimentalDecorators` 플래그에 의존하지 않습니다.
- **성능**: 런타임 퍼사드(facade)와 직접 통합해 불필요한 오버헤드를 줄입니다.

## 18.2 Installation and Setup

먼저 필요한 의존성을 설치합니다.

```bash
pnpm add @fluojs/graphql graphql graphql-yoga
```

통합의 중심은 `GraphqlModule`입니다. 현재 `GraphqlModule`은 여러 fluo 모듈과 달리 동기적인 `forRoot` 설정 방식을 사용합니다.

## 18.3 Building Code-first Resolvers

Fluo는 TypeScript 클래스가 GraphQL 스키마의 기준이 되는 **코드 우선(code-first)** 방식을 사용합니다.

### Defining the Resolver

```typescript
import { Resolver, Query, Mutation, Arg } from '@fluojs/graphql';
import { Inject } from '@fluojs/core';
import { ProductService } from './product.service';

class ProductInput {
  @Arg('id')
  id = '';
}

@Inject(ProductService)
@Resolver()
export class ProductResolver {
  constructor(private readonly productService: ProductService) {}

  @Query({ input: ProductInput })
  async product(input: ProductInput) {
    return this.productService.findById(input.id);
  }

  @Query()
  async products() {
    return this.productService.findAll();
  }
}
```

`@Arg(...)`는 resolver input DTO용 필드 데코레이터입니다. GraphQL 인자로 노출할 DTO 필드에 표시한 뒤, operation의 `input` 옵션으로 해당 DTO 클래스를 전달합니다.

### Registering the Module

```typescript
import { Module } from '@fluojs/core';
import { GraphqlModule } from '@fluojs/graphql';
import { ProductResolver } from './product.resolver';

@Module({
  imports: [
    GraphqlModule.forRoot({
      resolvers: [ProductResolver],
      graphiql: true, // 개발용 IDE 활성화
    }),
  ],
  providers: [ProductResolver],
})
export class AppModule {}
```

## 18.4 Solving N+1 with DataLoaders

N+1 문제는 GraphQL에서 가장 흔하게 나타나는 성능 병목입니다. Fluo는 요청 스코프 **DataLoader** 지원을 제공해 같은 요청 안의 반복 조회를 배치로 묶을 수 있게 합니다.

### Creating a DataLoader

```typescript
import { createDataLoader, type GraphQLContext } from '@fluojs/graphql';

const authorLoader = createDataLoader(async (ids: string[]) => {
  const authors = await authorService.findByIds(ids);
  // 반환되는 배열이 입력 ID의 순서와 일치하도록 보장해야 합니다.
  return ids.map(id => authors.find(a => a.id === id));
});
```

### 지원되는 Root Resolver에서 Loader 사용하기

```typescript
class BookInput {
  @Arg('id')
  id = '';
}

@Resolver()
export class BookResolver {
  @Query({ input: BookInput })
  async book(input: BookInput, context: GraphQLContext) {
    const book = await bookService.findById(input.id);
    const author = await authorLoader(context).load(book.authorId);

    return {
      ...book,
      author,
    };
  }
}
```

`authorLoader(context)`는 특정 GraphQL 실행 컨텍스트에 묶인 로더 인스턴스를 반환합니다. 따라서 배치와 캐시는 단일 요청 안에서만 공유됩니다. 이 범위를 지키면 한 사용자의 조회 결과가 다른 요청으로 새어 나가지 않으면서도 N+1 문제를 줄일 수 있습니다. 현재 `@fluojs/graphql`은 `context: GraphQLContext`를 명시적으로 받는 root operation 안에서 DataLoader를 사용하는 패턴만 문서화하며, 런타임 field resolver 부착은 지원하지 않습니다.

## 18.5 Real-time with Subscriptions

Fluo는 기본적으로 **SSE(Server-Sent Events)** 기반 GraphQL 구독을 지원하고, 필요할 때 WebSocket도 활성화할 수 있습니다.

### SSE Subscriptions (Default)

```typescript
import { Subscription } from '@fluojs/graphql';

@Resolver()
export class NotificationResolver {
  @Subscription()
  async onNewNotification() {
    return pubsub.subscribe('NEW_NOTIFICATION');
  }
}
```

### Enabling WebSockets

양방향 실시간 통신이 필요하거나 클라이언트 환경이 WebSocket 중심일 때는 WebSocket 트랜스포트를 활성화합니다. 기본 SSE 경로로 충분한지 먼저 판단하고, 실제로 양방향 메시징이 필요한 경우에만 WebSocket을 선택하는 편이 운영 경계를 단순하게 유지합니다. WebSocket 트랜스포트는 Node HTTP adapter처럼 upgrade listener를 지원하는 Node HTTP/S 서버를 노출하는 adapter가 필요합니다. 해당 서버 표면이 없는 런타임에서는 기본 SSE 구독 경로를 유지해야 합니다.

```typescript
GraphqlModule.forRoot({
  subscriptions: {
    websocket: {
      enabled: true,
      limits: {
        maxConnections: 100,
      },
    },
  },
})
```

## 18.6 Operational Guardrails

GraphQL API는 깊게 중첩되거나 비용이 큰 쿼리에 취약할 수 있습니다. Fluo는 이런 위험을 줄이기 위해 **운영 가드레일**을 기본 설정에 포함합니다.

- **인트로스펙션(Introspection)**: 프로덕션 환경에서는 기본적으로 비활성화됩니다.
- **복잡도 제한**: `maxDepth`, `maxComplexity`, `maxCost`로 과도한 쿼리 비용과 서비스 거부(DoS) 공격 가능성을 줄입니다.

```typescript
GraphqlModule.forRoot({
  limits: {
    maxDepth: 8,      // 쿼리 중첩 깊이 제한
    maxComplexity: 120, // 전체 필드 가중치 제한
    maxCost: 240,     // 예상 계산 비용 제한
  },
})
```

## 18.7 FluoShop Context: The Product Catalog

FluoShop에서는 제품 카탈로그 조회 경험을 세밀하게 제공하기 위해 GraphQL을 사용합니다. 카테고리 조회에는 DataLoader를 적용하고, 검색 엔드포인트에는 복잡도 제한을 둬 성능과 안전성을 함께 관리합니다. 이 조합은 클라이언트가 필요한 필드를 유연하게 고르면서도, 서버가 감당하기 어려운 쿼리를 미리 제한하게 해줍니다.

```typescript
class CatalogSearchInput {
  @Arg('query')
  query = '';
}

@Resolver()
export class CatalogResolver {
  @Query({ input: CatalogSearchInput })
  async search(input: CatalogSearchInput) {
    // 복잡도는 결과 세트 크기에 따라 자동으로 계산됩니다.
    return this.catalogService.search(input.query);
  }
}
```

## 18.8 Conclusion

Fluo에서 GraphQL은 주변 기능이 아니라 DI, 런타임 퍼사드, 표준 데코레이터와 맞물린 API 계층입니다. 이 구조를 사용하면 클라이언트에는 유연한 질의 모델을 제공하고, 서버 쪽에는 유지보수 가능한 리졸버 경계를 남길 수 있습니다.

다음 장에서는 이 API를 구동하는 데이터를 **MongoDB와 Mongoose**로 영속화하는 방법을 다룹니다.
