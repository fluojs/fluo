# GraphQL 예제

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Module registration, resolver discovery, operation 범위 DataLoader 사용, 하나의 SSE subscription 경로를 작고 하나의 애플리케이션에서 함께 보여주는 실행 가능한 `@fluojs/graphql` 예제입니다.

## 이 예제가 보여주는 것

- 모든 resolver를 module provider로도 등록하는 `GraphqlModule.forRoot({ resolvers })` 구성
- compiled module graph에서 discovery되는 root `books` query와 `Book.author` field resolver
- request 경계를 넘지 않으면서 같은 author 조회가 하나의 loader를 공유하도록 GraphQL operation마다 범위가 정해지는 `createDataLoader(...)`
- `publishBook` mutation이 update를 emit하기 전에 활성화되는 기본 SSE `bookPublished` subscription

## 실행 방법

레포지토리 루트에서 실행합니다.

```sh
pnpm install
pnpm --filter @fluojs/example-graphql typecheck
pnpm vitest run examples/graphql
```

테스트는 실행 entry point와 같은 `AppModule`을 시작하고, 실제 GraphQL query를 수행하며, `publishBook`을 trigger하기 전에 subscription을 등록한 뒤 application과 SSE stream을 모두 닫습니다.

애플리케이션을 직접 실행하려면 다음을 사용합니다.

```sh
pnpm --filter @fluojs/example-graphql start
```

다른 터미널에서 `http://localhost:3000/graphql`을 query합니다.

```sh
curl -X POST http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ books { title author { name } } }"}'
```

## 프로젝트 구조

```text
examples/graphql/
├── src/
│   ├── app.ts       # Module registration, resolver, DataLoader, SSE update
│   ├── app.test.ts  # startup, query, subscription 검증
│   ├── main.ts      # Node runtime 진입점
│   └── test-helpers.ts # 제한 시간이 있는 GraphQL HTTP/SSE 테스트 헬퍼
├── package.json
├── README.md
├── README.ko.md
└── tsconfig.json
```

## 관련 문서

- `../README.ko.md` — 공식 examples catalog
- `../../packages/graphql/README.ko.md` — `@fluojs/graphql` 계약과 API
- `../../book/intermediate/ch18-graphql.ko.md` — GraphQL 학습 경로
- `../../docs/CONTEXT.ko.md` — package-surface discoverability
