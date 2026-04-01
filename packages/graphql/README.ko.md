# @konekti/graphql

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션을 위한 데코레이터 기반 GraphQL 통합 패키지입니다. `/graphql` 엔드포인트에 GraphQL Yoga를 마운트하며, 코드 우선(`@Resolver`, `@Query`, `@Mutation`, `@Subscription`)과 스키마 우선 방식을 모두 지원합니다.

## 설치

```bash
pnpm add @konekti/graphql
```

## 빠른 시작 (코드 우선)

```typescript
import { Module } from '@konekti/core';
import { MinLength } from '@konekti/validation';
import { bootstrapNodeApplication } from '@konekti/runtime';
import { Arg, createGraphqlModule, Mutation, Query, Resolver } from '@konekti/graphql';

class EchoInput {
  @Arg('value')
  @MinLength(3)
  value = '';
}

@Resolver('AppResolver')
class AppResolver {
  private latest = 'init';

  @Query({ input: EchoInput })
  echo(input: EchoInput): string {
    return input.value;
  }

  @Mutation({ input: EchoInput })
  setValue(input: EchoInput): string {
    this.latest = input.value;
    return this.latest;
  }
}

@Module({
  imports: [
    createGraphqlModule({
      resolvers: [AppResolver],
    }),
  ],
  providers: [AppResolver],
})
class AppModule {}

const app = await bootstrapNodeApplication(AppModule, {
  port: 3000,
});

await app.listen();
// POST /graphql
// { "query": "{ echo(value: \"hello\") }" }
```

## 핵심 API

### `createGraphqlModule(options?)`

GraphQL 라이프사이클 배선과 엔드포인트 컨트롤러를 등록합니다.

```typescript
interface GraphqlModuleOptions {
  schema?: GraphQLSchema | string;
  resolvers?: Function[];
  context?: (ctx: GraphqlRequestContext) => Record<string, unknown>;
  graphiql?: boolean;
  plugins?: unknown[];
  subscriptions?: {
    websocket?: {
      connectionInitWaitTimeoutMs?: number;
      enabled?: boolean;
      keepAliveMs?: number;
    };
  };
}

interface GraphqlRequestContext {
  request: FrameworkRequest;
  connectionParams?: Record<string, unknown>;
  principal?: Principal;
  socket?: unknown;
}

interface GraphQLContext {
  request: FrameworkRequest;
  connectionParams?: Record<string, unknown>;
  principal?: Principal;
  [key: string]: unknown;
  socket?: unknown;
}
```

- `schema`: 스키마 우선 입력입니다. `GraphQLSchema` 인스턴스 또는 SDL 문자열을 받을 수 있습니다.
- `resolvers`: 코드 우선 탐색 시 사용할 resolver allowlist입니다.
- `context`: 요청 단위 커스텀 GraphQL context 값을 추가합니다.
- `graphiql`: GraphiQL 표시 여부를 명시합니다. 기본값은 `false`입니다. 개발 환경에서 활성화하려면 `graphiql: true`를 전달하세요.
- `plugins`: `createYoga(...)`로 그대로 전달되는 Yoga/Envelop 플러그인 목록입니다.
- `subscriptions.websocket.enabled`: 공유 Node HTTP 서버에 `graphql-ws` 전송 계층을 활성화하며, `/graphql`의 SSE 지원은 그대로 유지합니다.
- `subscriptions.websocket.keepAliveMs`: `graphql-ws` keepalive용 websocket ping 간격을 조정합니다.
- `subscriptions.websocket.connectionInitWaitTimeoutMs`: 초기 `connection_init` 메시지 대기 시간을 조정합니다.

### 기타 export

- `createGraphqlProviders(options)`
- `GRAPHQL_MODULE_OPTIONS`, `GRAPHQL_LIFECYCLE_SERVICE`

## 데코레이터

### `@Resolver(typeName?)`

provider/controller 클래스를 GraphQL resolver로 표시합니다.

### `@Query(options?)`, `@Mutation(options?)`, `@Subscription(options?)`

`options`는 field name 문자열 또는 아래 객체입니다.

```typescript
interface ResolverMethodOptions {
  fieldName?: string;
  input?: Function;
  topics?: string | string[];
  argTypes?: Record<string, GraphqlArgType>; // scalar 또는 listOf(scalar)
  outputType?: GraphqlRootOutputType; // scalar/object/union 또는 listOf(...)
}
```

- `input`: 인자 매핑 및 검증에 사용할 DTO 클래스입니다.
- `argTypes`: 인자별 타입 추론 결과를 덮어씁니다. 스칼라 리터럴(예: `'string'`) 또는 리스트 입력을 위한 `listOf('string')`를 사용할 수 있습니다.
- `outputType`: resolver 반환 타입을 명시합니다(기본값: `string`). 스칼라 리터럴, named `GraphQLObjectType`, named `GraphQLUnionType`, 그리고 루트 operation payload용 `listOf(...)` 래퍼를 지원합니다. union payload는 스키마에서 `resolveType` 계약이 명시되어 있어야 합니다.

리스트 래퍼 helper:

```typescript
import { listOf } from '@konekti/graphql';

@Query({ input: SearchInput, argTypes: { terms: listOf('string') }, outputType: listOf('string') })
search(input: SearchInput): string[] {
  return input.terms;
}
```

### `@Arg(argName?)`

DTO 필드를 GraphQL 인자 이름과 매핑해 입력 바인딩에 사용합니다.

## 런타임 동작

- 엔드포인트 경로: GET/POST `/graphql` (`/graphql/` 포함)
- 전송 계층: Konekti request/response를 GraphQL Yoga Fetch API로 브리지하며, 활성화 시 공유 Node HTTP 서버 위에서 `graphql-ws` subscription transport도 함께 제공합니다.
- 컨텍스트: 각 resolver는 `request`와 optional `principal`을 받고, 여기에 custom context가 병합됩니다.
- reserved internal context key는 보호되며, custom context로 operation 단위 DI 컨테이너 symbol을 덮어쓸 수 없습니다.
- 탐색: 부트스트랩 시 compiled module에서 resolver를 탐색합니다.
- 스코프 모델: GraphQL resolver에서 singleton, request, transient 스코프를 모두 지원합니다.
- 등록 규칙: 클래스 provider, controller, `useValue` provider(인스턴스 constructor 기준), `useFactory` provider(`resolverClass` 명시)가 모두 탐색 대상입니다.
- 종료: 애플리케이션 종료 시 Yoga 상태와 활성화된 GraphQL websocket 리스너를 함께 정리합니다.

## Yoga / Envelop 플러그인 패스스루

`plugins`를 사용해 Yoga/Envelop 플러그인을 직접 연결할 수 있습니다.

```typescript
createGraphqlModule({
  resolvers: [AppResolver],
  plugins: [
    {
      onParse() {
        // plugin hook
      },
    },
  ],
});
```

`plugins`를 생략하거나 빈 배열을 주면 기존 기본 동작은 유지됩니다.

## Resolver의 Provider 스코프

GraphQL resolver는 HTTP provider와 동일한 `@Scope()` 시맨틱을 따릅니다.

- **Singleton** (기본값): 모든 operation에서 하나의 인스턴스를 공유합니다. 무상태 resolver 및 공유 서비스에 적합합니다.
- **Request**: GraphQL operation마다 새 인스턴스를 생성합니다. GraphQL 모듈은 operation별로 child DI 컨테이너를 만들고, 그 컨테이너에서 resolver를 resolve한 뒤 operation 완료 후 컨테이너를 dispose합니다.
- **Transient**: resolve할 때마다 새 인스턴스를 생성합니다. 각 GraphQL operation에서 별도의 child 컨테이너가 사용되므로 operation 경계에서는 request scope와 동일하게 동작합니다.

동시에 실행되는 operation도 서로 완전히 격리되므로 request-scoped resolver 상태와 request-scoped 의존성이 겹치는 요청 사이에서 공유되지 않습니다.

```typescript
import { Inject, Scope } from '@konekti/core';
import { Resolver, Query } from '@konekti/graphql';

@Inject([RequestIdService])
@Scope('request')
@Resolver('RequestScopedResolver')
class RequestScopedResolver {
  constructor(private readonly requestId: RequestIdService) {}

  @Query()
  currentRequestId(): string {
    return this.requestId.id;
  }
}
```

resolver를 `@Scope('request')`로 선언하면 GraphQL은 이를 operation별 child 컨테이너에서 resolve합니다. DI 컨테이너는 대응되는 안전 규칙을 부트스트랩 시 검증하며, singleton provider가 request-scoped provider에 의존하면 `ScopeMismatchError`를 발생시킵니다.

## Request-scoped DataLoader 패턴

Konekti는 DataLoader 전용 데코레이터/서브시스템을 내장하지 않습니다. 대신 request scope를 사용해 operation 단위 loader를 구성하세요.

```typescript
import DataLoader from 'dataloader';
import { Inject, Scope } from '@konekti/core';
import { Query, Resolver } from '@konekti/graphql';

@Inject([UserRepository])
@Scope('request')
class UserLoaderFactory {
  constructor(private readonly repo: UserRepository) {}

  readonly byId = new DataLoader<string, User | null>(async (ids) => {
    const users = await this.repo.findManyByIds(ids);
    const map = new Map(users.map((user) => [user.id, user]));
    return ids.map((id) => map.get(id) ?? null);
  });
}

@Inject([UserLoaderFactory])
@Scope('request')
@Resolver('UserResolver')
class UserResolver {
  constructor(private readonly loaders: UserLoaderFactory) {}

  @Query()
  async userName(id: string): Promise<string> {
    const user = await this.loaders.byId.load(id);
    return user?.name ?? 'unknown';
  }
}
```

resolver와 loader factory가 모두 request scope이므로 GraphQL operation마다 DataLoader 캐시가 분리됩니다.

## 플러그인 기반 complexity/depth 제한

complexity/depth 제한은 `plugins`를 통한 Yoga/Envelop 플러그인 조합 방식으로 지원합니다.

```typescript
import { useDepthLimit } from '@graphile/depth-limit';

createGraphqlModule({
  resolvers: [AppResolver],
  plugins: [
    useDepthLimit({ maxDepth: 8 }),
  ],
});
```

GraphQL 패키지는 Konekti 전용 complexity API를 추가하지 않으며, 플러그인 합성이 공식 경로입니다.

## 명시적 범위 제외

- 자동 GraphQL 타입 시스템 재작성은 계속 범위 밖입니다. 루트 operation union output은 union 멤버와 `resolveType`이 명시적으로 정의된 경우에만 지원합니다.
- `@FieldResolver`
- Federation
- 내장 DataLoader abstraction/decorator

## 대체 Provider 등록

일반 클래스 provider와 `useClass` 등록 외에도 GraphQL resolver 탐색은 `useValue`와 `useFactory` provider를 지원합니다.

### useValue

`useValue` provider는 이미 생성된 resolver 인스턴스를 등록합니다. 탐색 단계에서는 그 인스턴스의 constructor를 읽어 resolver decorator 메타데이터를 찾습니다.

### useFactory

`useFactory` provider는 factory 함수로 resolver를 생성합니다. 탐색 시점에는 factory가 어떤 클래스를 반환하는지 알 수 없으므로 `resolverClass`를 반드시 명시해야 합니다.

`provider.scope`를 생략하면 GraphQL의 resolver 탐색과 runtime scope 처리 모두 `resolverClass`에 선언된 `@Scope()` 메타데이터를 fallback으로 사용합니다.

## 검증과 에러

- resolver 호출 전에 DTO 입력 검증이 실행됩니다.
- DTO 검증 실패는 아래 형태의 `GraphQLError`로 변환됩니다.
  - `message: "Validation failed."`
  - `extensions.code: "BAD_USER_INPUT"`
  - `extensions.issues`: 검증 이슈 목록

## Subscription

- Subscription은 GraphQL Yoga를 통해 지원됩니다(기본 SSE).
- `createGraphqlModule({ subscriptions: { websocket: { enabled: true } } })`를 설정하면 공유 Node HTTP 어댑터에서 `graphql-ws` 프로토콜을 사용할 수 있습니다.
- websocket subscription도 GraphQL operation 단위 컨텍스트를 사용하므로 request-scoped resolver와 의존성은 동시 구독 간에 섞이지 않습니다.
- `@Subscription()` resolver는 반드시 `AsyncIterable`을 반환해야 하며, 아니면 에러가 발생합니다.

## 스키마 모드

### 스키마 우선

```typescript
createGraphqlModule({
  schema: `type Query { hello: String! }`,
});
```

미리 생성한 `GraphQLSchema` 객체도 전달할 수 있습니다.

### 코드 우선

`schema`를 생략하면 데코레이터 기반으로 스키마를 생성합니다. `schema`도 없고 탐색된 resolver도 없으면 부트스트랩에서 예외가 발생합니다.

## 의존성

| 패키지 | 역할 |
|--------|------|
| `graphql` | GraphQL 스키마/타입 |
| `graphql-ws` | websocket subscription protocol runtime |
| `graphql-yoga` | HTTP transport/runtime |
| `@konekti/runtime` | 모듈 라이프사이클, 컨테이너, compiled modules |
| `@konekti/http` | request/response 브리지 |
| `@konekti/validation` 패키지 | 입력 검증 파이프라인 |
