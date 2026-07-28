# react-vite-ssr example

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Hydration 및 client-navigation phase를 위한 최소 Vite-backed `@fluojs/react` 애플리케이션입니다.
두 번째 routing model을 만들지 않고 HTTP-owned page route, DTO-bound parameter, streamed React
SSR, Vite manifest asset, hydrated browser runtime, progressively enhanced native mutation form을
연결합니다.

## 이 예제가 보여주는 것

- fluo HTTP module graph가 발견하는 `@Router('/products')` 및 `@Path('/:sku')` page route.
- `@RequestDto(...)`, `@FromPath('sku')`, `@FromQuery('preview')`를 통한 typed path/search input.
- Application `renderPage` callback이 manifest-derived hydration option과 compose하는 직접적인
  `ReactElement` page return.
- Web Streams SSR이 fallback과 resolve된 recommendation content를 emit하는 `Suspense` boundary.
- `dist/client/.vite/manifest.json`을 생성하는 Vite client build와, 이미 로드한 manifest를 ordered
  CSS 및 hydration module asset으로 바꾸는 `@fluojs/react/vite`.
- React DOM `hydrateRoot(...)`를 통해 interactive 상태가 되는 server-rendered counter.
- Server-owned DTO validation boundary에 계속 도달하는 `@fluojs/react/client` route snapshot,
  URL-state hook, progressive `Link`, full-document `push` navigation.
- 일반 guarded/intercepted `@Post(...)` route에 도달해 application state를 mutate하고 HTTP-matched
  destination으로 `303 See Other`를 반환하는 native `multipart/form-data` form.
- JavaScript disabled 상태에서 해당 form을 submit하는 production browser coverage.
- 생성된 Vite client asset까지 Fastify adapter로 제공하는 production build.

## 레포 루트에서 실행하기

```sh
pnpm install
pnpm build
pnpm --filter @fluojs/example-react-vite-ssr build
pnpm --filter @fluojs/example-react-vite-ssr start
```

`http://127.0.0.1:3000/products/sku-42?preview=true`를 열고 `Count: 0`을 활성화하세요.
Vite-generated client entry가 server HTML을 hydrate한 뒤에만 label이 `Count: 1`로 바뀝니다.
`Open sku-84` 또는 `Push sku-126`을 사용하면 same-origin full-document navigation을 수행하고,
각 destination은 fluo HTTP route에서 다시 match, bind, validate됩니다.

반복 가능한 SSR 및 hydration 검증은 다음 명령으로 실행합니다.

```sh
pnpm vitest run examples/react-vite-ssr
pnpm --filter @fluojs/example-react-vite-ssr test:browser
```

Browser 명령은 workspace package와 예제를 다시 build하고, build된 server를 시작한 뒤 production
client entry 및 JavaScript-disabled context를 Chrome에서 실행합니다. Bootstrap/style asset 누락 또는
non-200 response, hydration warning/error, identifier-prefix mismatch, hydrate되지 않는 counter,
URL과 server-rendered route state가 일치하지 않는 client navigation, `POST` → `303` → `GET` flow를
완료하지 못하는 native form이 있으면 실패합니다.

## native form mutation workflow

`ProductDocument`는 label, required input, submit button, 일반 route action, 명시적인 multipart encoding을
가진 실제 form을 렌더링합니다.

```html
<form action="/products/sku-42" enctype="multipart/form-data" method="post">
  <label for="product-name">Product name</label>
  <input id="product-name" minlength="3" name="name" required />
  <button type="submit">Save product</button>
</form>
```

Receiving method는 같은 HTTP-owned router의 일반 `@Post('/:sku')` handler입니다. Path와 body field를
`@RequestDto(...)`로 bind하고, `CatalogMutationGuard`와 request-scoped
`CatalogMutationInterceptor`를 실행하며, singleton example catalog를 mutate한 뒤
`context.response.redirect(303, ...)`를 호출합니다. `CatalogRequestMiddleware`는 module middleware
chain에 그대로 남습니다. Focused authorization fixture는 `x-example-user: catalog-editor`를 사용합니다.
실제 애플리케이션에서는 나머지 route와 같은 session/cookie 및 CSRF policy로 교체하세요.

잘못된 input은 안전한 field/source/code/message detail을 가진 canonical `400` validation envelope를
반환합니다. 성공한 input은 `/products/:sku?updated=true`로 redirect되고, 해당 `GET` destination은 일반
dispatcher가 다시 match, bind, render합니다. Browser regression은 `javaScriptEnabled: false` Chrome
context를 만들고 rendered form을 제출한 뒤 `303`을 관찰하며 destination document가 mutate된 값을
포함하는지 확인합니다.

이 flow는 React Router action/fetcher, Astro Action, Next.js Server Action, experimental fluo Server
Function이 아닙니다. Action id를 compile하거나 route matching을 소유하거나 client cache를 revalidate하거나
optimistic state를 약속하지 않습니다. Native form이 이미 완전한 fallback을 제공하고 stable client package가
mutation route나 cache policy를 소유하지 않으므로 submit-state helper를 추가하지 않습니다.

## phase 경계와 제한 사항

- 안정 `0.1.0` root contract는 계속 HTTP-first React SSR을 소유합니다. 이 `0.2.0` 예제는 초기
  SSR 예제 이후 추가된 `@fluojs/react/vite` manifest parser와 그 contract를 조합합니다.
- Direct page return은 두 번째 response path를 만들지 않습니다. Application renderer는 계속
  `ReactServerEntry`를 반환하고 기존 HTTP writer가 status, header, error, streaming을 소유합니다.
- `src/entry-client.ts`가 browser-only boundary입니다. Server module은 `window`나 `document`에
  접근하지 않으며, server는 application boundary에서 Vite manifest를 명시적으로 로드합니다.
- `ReactClientRouterProvider`는 SSR과 hydration에서 같은 request URL과 HTTP-matched param을 받습니다.
  `Link`, `router.push(...)`, `router.replace(...)`는 full-document navigation을 사용하므로 redirect,
  not-found page, DTO validation failure, guard, interceptor, server error는 일반 HTTP response로 남습니다.
- 이 예제는 SPA document swapping, event replay, client route matching, navigation cache, RSC-aware
  data, prefetch behavior를 약속하지 않습니다.
- 이 예제는 Next.js App Router, file-based router, TanStack route tree, RSC, catch-all route,
  production starter-template 변경이 아닙니다.
- Asset controller는 의도적으로 최소 구현이며 이 예제의 Vite config가 emit하는 flat filename을
  제공합니다. Production deployment에서는 일반적으로 기존 static-file 또는 CDN boundary 뒤에
  build asset을 배치해야 합니다.

## 프로젝트 구조

```txt
examples/react-vite-ssr/
├── src/
│   ├── app.ts              # @Router page, native POST mutation, Vite asset serving module
│   ├── app.test.ts         # DTO, protected mutation, redirect, streamed SSR assertion
│   ├── entry-client.ts     # Browser-only hydrateRoot(...) entry
│   ├── entry-server.ts     # 명시적 Vite server-entry selector
│   ├── hydration.ts        # server/client 공유 identifierPrefix
│   ├── hydration.test.ts   # DOM-equivalent hydration interaction 및 warning 검증
│   ├── main.ts             # 생성된 manifest를 로드하고 Fastify 시작
│   ├── page.ts             # 공유 document, native form, client router, interactive counter
│   └── recommendations.ts  # Lazy Suspense content
├── tests/
│   └── production-hydration.spec.ts # Hydration 및 JavaScript-disabled form regression
├── playwright.config.ts
├── vite.client.config.ts
├── vite.server.config.ts
├── README.md
└── README.ko.md
```

## 관련 문서

- `../react-stable-ssr/README.ko.md` — explicit-asset `0.1.0` SSR baseline
- `../../packages/react/README.ko.md` — React package 및 Vite manifest contract
- `../../packages/vite/README.ko.md` — Vite build의 TC39 decorator transform boundary
- `../../docs/contracts/behavioral-contract-policy.ko.md` — behavior/docs/test alignment rule
