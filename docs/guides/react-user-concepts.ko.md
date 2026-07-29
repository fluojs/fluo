# fluo의 React 개념

<p><a href="./react-user-concepts.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 React, Remix/React Router, Next.js 사용자에게 익숙한 용어를 현재 fluo 모델로
번역합니다. 기능 동등성을 주장하는 문서가 아니라 탐색을 돕는 문서입니다. 안정 모델은 HTTP-first
React SSR입니다. `@fluojs/http`가 route와 request lifecycle을 소유하고, 애플리케이션이 page
composition을 소유하며, `@fluojs/react`를 사용해 React document를 stream하고 hydrate합니다.

## 소유권부터 이해하기

안정 request path는 다음과 같습니다.

1. `@fluojs/http`가 명시적 route를 match하고 DTO binding, validation, middleware, guard,
   interceptor, versioning, request-scope 생성을 실행합니다.
2. `@Path(...)` handler는 일반 HTTP 값을 반환할 수 있으며, 이 값은 React rendering을 우회하고
   기존 HTTP response path를 유지합니다. React로 렌더링할 page라면 `ReactElement` 하나를 반환하거나,
   route별 entry option이 필요할 때 `createReactServerEntry(...)`를 명시적으로 반환합니다.
3. 반환된 값이 `ReactElement`이면 애플리케이션 `ReactPageRenderer`가 page를 document shell에
   compose하고 `ReactServerEntry`를 반환합니다.
4. 기존 HTTP response writer가 일반 값을 쓰거나 React entry를 stream하며 status, header, error,
   abort, not-found response의 소유권을 유지합니다.
5. 애플리케이션이 로드한 build asset과 browser code가 document를 hydrate하고 progressive
   navigation이나 local interaction을 추가할 수 있습니다.

React는 두 번째 matcher나 route lifecycle을 만들지 않습니다. URL matching, DTO binding,
validation, guard, interceptor, middleware, versioning, request scope, not-found ownership은
`@fluojs/http`에 남습니다.

## 개념 번역

| 익숙한 개념 | 현재 fluo 동등 개념 | 경계 |
| --- | --- | --- |
| **Page** | `@Router(...)`와 `@Path(...)`로 표시한 `GET` handler입니다. React rendering을 우회하는 일반 HTTP 값, configured application renderer가 처리할 `ReactElement` 하나, 또는 명시적인 `createReactServerEntry(...)`를 반환할 수 있습니다. | **Shipped.** Page는 file 또는 route-module convention이 아니라 여전히 HTTP handler입니다. |
| **Route** | 일반 fluo module/controller metadata에서 compile된 effective route입니다. `@Path(...)`는 `@fluojs/http`와 같은 `GET` metadata를 기록하고, `@fluojs/react/typegen`은 compiled page catalog를 path-only href builder로 project할 수 있습니다. | **Shipped, intentionally different.** HTTP가 matching, grammar, conflict, param, versioning, dispatch를 소유합니다. Typegen은 route tree를 만들지 않고 versioned route를 표현하지 않습니다. |
| **Layout** | 애플리케이션 `ReactPageRenderer`가 document shell과 shared provider를 소유합니다. `@PageLayout(...)`은 같은 renderer가 compose하는 optional class/method component-reference metadata를 추가합니다. | **Shipped.** File ancestry나 framework-owned layout router는 없습니다. |
| **Loading UI** | Application tree의 일반 React `Suspense`를 사용하고, 필요하면 `@SuspenseFallback(...)`으로 page fallback을 선택합니다. | **Shipped with a narrow boundary.** Fallback은 SSR 중 suspend하는 descendant를 다루며 handler `await`, form, effect, navigation은 관찰하지 않습니다. |
| **Data read / loader** | HTTP DTO binding과 validation 이후 `@Path(...)` handler에서 명시적인 application provider를 통해 data를 읽고 React element에 전달합니다. | **Shipped, intentionally different.** Loader runtime, loader cache, client revalidation contract는 없습니다. |
| **Mutation / action** | Native form을 일반 `@Post(...)` handler로 제출하고, `@RequestDto(...)`로 bind/validate하며, 일반 guard/interceptor를 적용하고, application state를 변경한 뒤 필요하면 `303 See Other`로 redirect합니다. | **Shipped, intentionally different.** Stable surface에는 compiled action, fetcher, optimistic-state, cache-invalidation runtime이 없습니다. |
| **Navigation** | 실제 `<a>` 또는 `@fluojs/react/client`의 `Link`를 사용합니다. Control에는 `router.push(...)`, `router.replace(...)`, `router.back()`, `router.refresh()`를 사용합니다. | **Shipped, intentionally different.** Path/search 변경은 full-document navigation을 사용하므로 destination이 HTTP lifecycle을 다시 통과합니다. Fragment-only 변경은 same-document browser navigation으로 남습니다. |
| **Pending state** | `useNavigation()`이 client navigation lifecycle을 보고합니다. React `Suspense`는 component tree를 통해 rendering fallback을 보고합니다. 애플리케이션은 native form action을 제거하지 않는 범위에서 local form pending UI를 추가할 수 있습니다. | **Shipped with separate phases.** Stable submit-state helper나 공유 loader/action pending model은 없습니다. |
| **Error UI** | HTTP pipeline failure는 기존 HTTP error path를 유지합니다. Stable React SSR diagnostic은 HTTP-pipeline, pre-commit shell, request-abort, post-shell recoverable phase를 구분합니다. Application React error boundary는 일반 React code로 남습니다. | **Shipped, intentionally different.** Segment `error` file이나 React-owned HTTP error router는 없습니다. |
| **Not found** | 명시적 route가 없으면 일반 `@fluojs/http` not-found response가 되고, application lookup이 실패하면 handler가 shipped HTTP not-found exception을 throw할 수 있습니다. | **Shipped, intentionally different.** React `notFound()` helper나 catch-all requirement는 없습니다. |
| **Metadata / head** | Application document에 `<title>`, `<meta>`, `<link>`를 렌더링합니다. Status와 header에는 기존 HTTP decorator와 response API를 사용합니다. | **Shipped as application-owned composition.** Automatic metadata function이나 route-segment merge contract는 없습니다. |
| **Hydration** | `createReactServerEntry(...)`를 통해 명시적 hydration asset을 전달하고, 같은 request URL과 HTTP-matched param을 `ReactClientRouterProvider` snapshot에 렌더링한 뒤 browser entry에서 React DOM `hydrateRoot(...)`를 호출합니다. | **Shipped.** Server/client data transfer와 safe serialization은 application 책임입니다. |
| **Build assets** | 애플리케이션이 Vite manifest를 로드해 `@fluojs/react/vite`의 `createReactViteAssetManifest(...)`에 전달하고, application document가 반환된 CSS와 hydration option을 emit합니다. | **Shipped.** fluo는 manifest discovery, Vite 실행, bundle generation, static-file/CDN hosting 선택을 수행하지 않습니다. |

## 패키지 경계

| Import | 책임 | 상태 |
| --- | --- | --- |
| `@fluojs/react` | `ReactModule.forRoot(...)`, `@Router(...)`, `@Path(...)`, page rendering policy, Web Streams SSR, diagnostic, page catalog, 명시적 hydration option. | 안정적인 runtime-neutral root입니다. Browser, Vite, typegen, RSC code를 import하지 않습니다. |
| `@fluojs/react/client` | SSR-safe request-scoped route snapshot과 provider composition, 실제 anchor, hydration 이후 full-document navigation control, URL/navigation hook. | 안정적인 SSR-and-browser subpath입니다. `createReactRouteSnapshot(...)`과 `ReactClientRouterProvider`는 SSR 및 hydration을 지원하고 browser navigation effect는 hydration 이후에만 연결됩니다. Matcher, route table, document cache, prefetch layer는 없습니다. |
| `@fluojs/react/vite` | 이미 로드한 Vite manifest를 deterministic React CSS, JavaScript, asset-map, hydration option으로 파싱합니다. | 안정적인 build-integration subpath입니다. File을 읽거나 Vite를 실행하지 않습니다. |
| `@fluojs/react/typegen` | Compiled React page catalog에서 deterministic path-only declaration과 absolute href builder를 생성합니다. | 안정적인 tooling subpath입니다. Versioned route를 거부하고 query, fragment, relative-route, route-tree contract를 생성하지 않습니다. |
| `@fluojs/react/experimental/rsc` | Compatibility diagnostic, application-supplied RSC manifest seam, Flight response, 명시적 HTTP endpoint에 mount하는 signed Server Function transport. | **Experimental.** 모든 stable entrypoint와 격리되며 stable RSC 또는 action promise가 아닙니다. |

## 최소 end-to-end path

실행 가능한 `react-vite-ssr` 예제가 canonical complete path입니다. 다음 순서로 읽으세요.

1. [`src/main.ts`](../../examples/react-vite-ssr/src/main.ts)는 application boundary에서 생성된 Vite
   manifest를 로드하고 일반 fluo HTTP application을 bootstrap합니다.
2. [`src/app.ts`](../../examples/react-vite-ssr/src/app.ts)는 그 값을
   `createReactViteAssetManifest(...)`에 전달하고, `createReactServerEntry(...)`로
   `ReactPageRenderer`를 만들며, `@Router('/products')`와 `@Path('/:sku')`를 선언하고,
   `ReactModule.forRoot(...)`를 통해 router를 등록합니다.
3. 같은 router의 `@Post('/:sku')` handler는 native form을 받고 일반 HTTP DTO, guard,
   interceptor, middleware, request-scope path를 사용한 뒤 `303`으로 명시적 `GET` route에
   redirect합니다.
4. [`src/page.ts`](../../examples/react-vite-ssr/src/page.ts)는 document metadata와 Vite CSS를
   렌더링하고, `createReactRouteSnapshot(...)`으로 request-scoped snapshot을 만들며, document를
   `ReactClientRouterProvider`로 감싸고, 실제 `Link`와 `useNavigation()`을 사용하며, mutation
   baseline으로 실제 `<form method="post">`를 유지합니다.
5. [`src/entry-client.ts`](../../examples/react-vite-ssr/src/entry-client.ts)는 server rendering과
   같은 URL, param, page data, stylesheet, identifier prefix로 React DOM `hydrateRoot(...)`를
   호출합니다.

더 작은 SSR-only 시작점은
[`examples/react-stable-ssr`](../../examples/react-stable-ssr/README.ko.md)를 사용하세요. 생성된 build
asset, hydration, client navigation, native form slice가 필요할 때만 Vite 예제를 추가하세요.

## Experimental surface

`@fluojs/react/experimental/rsc`가 현재 유일한 RSC 및 Server Function surface입니다. 문서화된 exact
React/renderer compatibility와 application-owned build/encoding input이 필요합니다. Flight response와
Server Function call도 명시적인 일반 fluo HTTP route에 mount합니다. 이 subpath를 stable Server
Component, server action, router, loader, cache contract로 해석하지 마세요. Stable subpath가 존재하기
전에 필요한 evidence는 [RSC graduation policy](../contracts/react-rsc-graduation.ko.md)를 확인하세요.

## 지원하지 않는 개념

현재 패키지는 다음을 제공하지 않습니다.

- file routing, React-owned matcher, nested route tree, catch-all route grammar
- route-module loader/action runtime, fetcher, automatic data revalidation
- SPA document swapping, client document/data cache, navigation prefetch, optimistic mutation policy
- automatic metadata merging 또는 segment-level `loading`, `error`, `not-found` convention
- automatic Vite manifest discovery, bundle generation, static-file hosting, arbitrary inline data
  serialization
- stable RSC subpath, built-in Flight renderer, automatic `"use server"` transform/export discovery

애플리케이션은 shipped seam 위에 자체 policy를 만들 수 있지만, 그 policy는 `@fluojs/react` contract가
아니며 route 또는 request-lifecycle ownership을 `@fluojs/http` 밖으로 옮겨서는 안 됩니다.

## 관련 문서

- [`@fluojs/react` package contract](../../packages/react/README.ko.md)
- [Stable SSR 실행 가능 예제](../../examples/react-stable-ssr/README.ko.md)
- [Vite SSR, hydration, navigation, native form 실행 가능 예제](../../examples/react-vite-ssr/README.ko.md)
- [`@fluojs/http` package contract](../../packages/http/README.ko.md)
- [React render policy 결정](../architecture/react-render-policy-decorators.ko.md)
- [React RSC graduation policy](../contracts/react-rsc-graduation.ko.md)
