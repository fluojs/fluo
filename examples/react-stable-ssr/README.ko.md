# react-stable-ssr example

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

`0.1.0` package surface를 위한 안정 `@fluojs/react` SSR MVP 예제입니다. Routing과 request
lifecycle ownership은 `@fluojs/http`에 남겨 두고, React는 page 형태의 streamed HTML 렌더링에 사용합니다.

## 이 예제가 보여주는 것

- `@Router('/products')`와 `@Path('/:sku')`를 HTTP controller 및 `GET` route metadata 위의 lexical
  React facade로 사용하는 방식.
- `@RequestDto(...)`, `@FromPath('sku')`, `@FromQuery('preview')`를 통한 DTO-bound path/search param.
- HTTP-owned route grammar: literal segment와 full-segment `:param` placeholder만 지원합니다.
- React server entry가 HTML을 commit하기 전에 guard, interceptor, module middleware, route header,
  entry header가 실행되는 request lifecycle.
- `createReactServerEntry(...)`와 lazy `react-dom/server` rendering을 통한 Web Streams SSR.
- Stable root의 명시적 hydration asset option: `bootstrapModules`, 신뢰된 `bootstrapScriptContent`,
  `nonce`, `identifierPrefix`, 신뢰된 `assetMap` snapshot.

## 안정 경계

이 예제는 Next.js App Router, React Server Components, Server Functions, TanStack route tree,
Angular `Routes[]`, file route, React-owned `routes: []` table을 모델링하지 않습니다. Route는 fluo
module/controller graph를 통해 발견되고, URL matching은 `@fluojs/http`에 남으며, React package는
page 지향 naming과 SSR rendering helper만 추가합니다.

추가 phase boundary는 이 예제 밖에 남아 있습니다.

- `@fluojs/react/vite` — 이미 로드한 Vite build manifest를 deterministic hydration asset으로 파싱하는 현재
  subpath입니다. Filesystem에서 manifest를 발견하지 않습니다.
- `@fluojs/react/client` — HTTP-first browser navigation 및 client hydration helper.
- `@fluojs/react/experimental/rsc` — 불안정한 exact-version RSC manifest 및 HTTP Flight response
  prototype입니다. 이 stable SSR 예제 밖에 남으며 Server Functions를 포함하지 않습니다.

## 레포 루트에서 실행하기

```sh
pnpm install
pnpm vitest run examples/react-stable-ssr
pnpm typecheck
```

## 프로젝트 구조

```txt
examples/react-stable-ssr/
├── src/
│   ├── app.ts       # AppModule imports ReactModule.forRoot(...)
│   ├── main.ts      # 로컬 수동 실행용 optional Fastify startup
│   ├── pages.ts     # Router, DTO, guard, interceptor, middleware, SSR entry
│   └── app.test.ts  # createTestApp request-pipeline SSR assertion
├── README.md
└── README.ko.md
```

## 관련 문서

- `../../packages/react/README.ko.md` — 안정 React SSR package contract
- `../../docs/reference/package-surface.ko.md` — canonical package surface
- `../../docs/reference/package-chooser.ko.md` — task별 package 선택
- `../../docs/contracts/behavioral-contract-policy.ko.md` — behavior/docs/test alignment rule
