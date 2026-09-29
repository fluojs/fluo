# fluo의 React 개념

<p><a href="./react-user-concepts.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 React, Remix/React Router, Next.js 사용자에게 익숙한 용어를 현재 fluo 모델로
번역합니다. 기능 동등성을 주장하는 문서가 아니라 탐색을 돕는 문서입니다. 안정 모델은 HTTP-first
React SSR입니다. `@fluojs/http`가 route와 request lifecycle을 소유하고, 애플리케이션이 page
composition을 소유하며, `@fluojs/react`를 사용해 React document를 stream하고 hydrate합니다.

추가 풀스택 제품 목표는 [HTTP-first React 제품 계약](../contracts/react-fullstack-product.ko.md)을
참고하세요. 운영 CRUD와 장기 주크박스 사용자 여정의 현재 근거, 격차, 담당 이슈, 실제 browser
수용 기준을 연결합니다. 아래의 shipped 기능은 미래 제품 게이트 통과를 뜻하지 않으며, 닫힌
#2489 roadmap은 이전 API 마일스톤입니다.

## 소유권부터 이해하기

안정 request path는 다음과 같습니다.

1. `@fluojs/http`가 명시적 route를 match하고 DTO binding, validation, middleware, guard,
   interceptor, versioning, request-scope 생성을 실행합니다.
2. `@Path(...)` handler는 일반 HTTP 값을 반환할 수 있으며, 이 값은 React rendering을 우회하고
   기존 HTTP response path를 유지합니다. React로 렌더링할 page라면 `ReactElement` 하나를
   반환하거나, route별 option에는 `createReactServerEntry(...)`를 명시적으로 반환하거나,
   협상 가능한 destination에는 `ReactNavigationPage.create(page, { module, props })`를 사용합니다.
3. 반환된 값이 `ReactElement`이면 애플리케이션 `ReactPageRenderer`가 page를 document shell에
   compose하고 `ReactServerEntry`를 반환합니다.
4. 기존 HTTP response writer가 일반 값을 쓰거나 React entry를 stream하며 status, header, error,
   abort, not-found response의 소유권을 유지합니다.
5. 애플리케이션이 로드한 build asset과 browser code가 document를 hydrate하고 progressive
   navigation이나 local interaction을 추가할 수 있습니다.

React는 두 번째 matcher나 route lifecycle을 만들지 않습니다. URL matching, DTO binding,
validation, guard, interceptor, middleware, versioning, request scope, not-found ownership은
`@fluojs/http`에 남습니다.

`@Path()`와 `@Path(undefined)`는 `@Path('')`와 같습니다. Router prefix에서 GET을 처리하며
`@Router()` 아래에서는 `/`입니다. `@Path('/')`는 catalog path가 같지만 raw path는 다릅니다.
생략한 options는 React metadata에 만들지 않고, 중복 및 잘못된 route는 HTTP에서 계속
거부합니다. Layout, fallback, metadata factory에는 계속 명시적 값이 필요합니다.

## 개념 번역

| 익숙한 개념 | 현재 fluo 동등 개념 | 경계 |
| --- | --- | --- |
| **Page** | `@Router(...)`와 `@Path(...)`로 표시한 `GET` handler입니다. React rendering을 우회하는 일반 HTTP 값, configured application renderer가 처리할 `ReactElement` 하나, 또는 명시적인 `createReactServerEntry(...)`를 반환할 수 있습니다. | **Shipped.** Page는 file 또는 route-module convention이 아니라 여전히 HTTP handler입니다. |
| **Route** | 일반 fluo module/controller metadata에서 compile된 effective route입니다. `@Path(...)`는 `@fluojs/http`와 같은 `GET` metadata를 기록하고, `@fluojs/react/typegen`은 compiled page catalog를 path-only href builder로 project할 수 있습니다. | **Shipped, intentionally different.** HTTP가 matching, grammar, conflict, param, versioning, dispatch를 소유합니다. Typegen은 route tree를 만들지 않고 versioned route를 표현하지 않습니다. |
| **Layout** | 애플리케이션 `ReactPageRenderer`가 document shell과 shared provider를 소유합니다. `@PageLayout(...)`은 같은 renderer가 compose하는 optional class/method component-reference metadata를 추가합니다. | **Shipped.** File ancestry나 framework-owned layout router는 없습니다. |
| **Loading UI** | Application tree의 일반 React `Suspense`를 사용하고, 필요하면 `@SuspenseFallback(...)`으로 page fallback을 선택합니다. | **Shipped with a narrow boundary.** Fallback은 SSR 중 suspend하는 descendant를 다루며 handler `await`, form, effect, navigation은 관찰하지 않습니다. |
| **Data read / loader** | HTTP DTO binding과 validation 이후 `@Path(...)` handler에서 명시적인 application provider를 통해 data를 읽고 React element에 전달합니다. | **Shipped, intentionally different.** Loader runtime, loader cache, client revalidation contract는 없습니다. |
| **Mutation / action** | Native form을 일반 `@Post(...)` handler로 제출하고, `@RequestDto(...)`로 bind/validate하며, 일반 guard/interceptor를 적용하고, application state를 변경한 뒤 필요하면 `303 See Other`로 redirect합니다. Auth/data mutation 후 같은 문서에서 다시 이동하기 전에 `router.invalidate()`를 호출하거나 `prefetchScope`를 바꿉니다. | **Shipped, intentionally different.** Compiled action, fetcher, optimistic-state, 자동 cache revalidation은 없습니다. |
| **Navigation** | 실제 `<a>` 또는 `@fluojs/react/client`의 `Link`와 `router.push(...)`, `router.replace(...)`, `router.back()`, `router.refresh()`를 사용합니다. Build-produced importer를 `ReactClientRouterProvider`에 전달하고 승인된 destination을 application-owned page slot에 렌더링합니다. Public speculation에는 `Link prefetch="hover"` 또는 `"viewport"`와 provider `prefetchScope`를 사용합니다. | **Shipped, intentionally different.** 호환 page는 server-confirmed URL/params로 history를 갱신하면서 soft navigation하고 나머지는 document navigation을 사용합니다. Client route matcher와 일반 document/data cache는 없습니다. Prefetch는 기본 off이고 명시적인 public grant가 있는 navigation JSON만 한 번 재사용합니다. |
| **Pending state** | `useNavigation()`이 client navigation lifecycle을 보고합니다. React `Suspense`는 component tree를 통해 rendering fallback을 보고합니다. 애플리케이션은 native form action을 제거하지 않는 범위에서 local form pending UI를 추가할 수 있습니다. | **Shipped with separate phases.** Stable submit-state helper나 공유 loader/action pending model은 없습니다. |
| **Error UI** | HTTP pipeline failure는 기존 HTTP error path를 유지합니다. Stable React SSR diagnostic은 HTTP-pipeline, pre-commit shell, request-abort, post-shell recoverable phase를 구분합니다. Application React error boundary는 일반 React code로 남습니다. | **Shipped, intentionally different.** Segment `error` file이나 React-owned HTTP error router는 없습니다. |
| **Not found** | 명시적 route가 없으면 일반 `@fluojs/http` not-found response가 되고, application lookup이 실패하면 handler가 shipped HTTP not-found exception을 throw할 수 있습니다. | **Shipped, intentionally different.** React `notFound()` helper나 catch-all requirement는 없습니다. |
| **Metadata / head** | Application document에 `<title>`, `<meta>`, `<link>`를 렌더링합니다. Status와 header에는 기존 HTTP decorator와 response API를 사용합니다. | **Shipped as application-owned composition.** Automatic metadata function이나 route-segment merge contract는 없습니다. |
| **Hydration** | 공식 starter가 HTTP 선택 초기 destination을 escaped JSON(64 KiB 제한)으로 전송하고 build importer에서 찾아 동일한 request URL, params, props, 공통 provider를 hydrate합니다. Custom low-level renderer는 `createReactServerEntry(...)`에 명시적 asset을 계속 전달할 수 있습니다. | **Starter에 shipped.** Application은 JSON-only props를 선택하고 secret/DI를 제외하며 low-level custom document는 자체 composition을 소유합니다. |
| **Build assets** | 애플리케이션이 Vite manifest를 로드해 `@fluojs/react/vite`의 `createReactViteAssetManifest(...)`에 전달하고, application document가 반환된 CSS와 hydration option을 emit합니다. | **Shipped.** fluo는 manifest discovery, Vite 실행, bundle generation, static-file/CDN hosting 선택을 수행하지 않습니다. |

현재 client의 `router.refresh()`는 data를 제자리에서 재검증하지 않고 **document**를 reload합니다.
`router.invalidate()`는 pending navigation과 public prefetch 상태만 비웁니다. 성공한
destination은 provider/layout을 유지하지만 soft load 실패의 기본값은 전체 document
fallback입니다. 같은 provider의 `failurePolicy`로 network/5xx에서 승인된 shell/page
보존을 opt-in하고 `useNavigation().failure`, 새 HTTP `router.retry()` 및 명시적인
`router.openDocument()`를 사용할 수 있습니다. Production Vite 예제는 이 opt-in을
검증합니다. 공식 생성 starter는 network/5xx 및 복구 가능한 매핑된 import 실패의 보존 정책과 셸 복구 control을
명시적으로 연결합니다. 소비자 migration을 수반하는
셸 보존 refresh(#3873)는 별도 목표이며 이미 배포된 loader cache가 아닙니다.
인증 거절은 일시적 재시도 대상이 아니고 명시적 reload/logout은 셸을 끝낼 수 있습니다.
여정별 성공, 실패, 취소, 검증 surface는 제품 계약을 참고하세요.

## 패키지 경계

| Import | 책임 | 상태 |
| --- | --- | --- |
| `@fluojs/react` | `ReactModule.forRoot(...)`, `@Router(...)`, `@Path(...)`, page rendering policy, Web Streams SSR, diagnostic, page catalog, 명시적 hydration option. | 안정적인 runtime-neutral root입니다. Browser, Vite, typegen, RSC code를 import하지 않습니다. |
| `@fluojs/react/client` | SSR-safe request-scoped route snapshot과 provider composition, 실제 anchor, HTTP-approved soft navigation 및 document fallback, 제한된 public navigation prefetch, URL/navigation hook. | 안정적인 SSR-and-browser subpath입니다. `createReactRouteSnapshot(...)`과 `ReactClientRouterProvider`는 SSR 및 hydration을 지원하고 browser navigation effect는 hydration 이후에만 연결됩니다. Matcher, route table, 일반 document cache는 없습니다. |
| `@fluojs/react/vite` | 이미 로드한 Vite manifest를 deterministic React CSS, JavaScript, asset-map, hydration option으로 파싱합니다. | 안정적인 build-integration subpath입니다. File을 읽거나 Vite를 실행하지 않습니다. |
| `@fluojs/react/typegen` | Compiled React page catalog에서 deterministic path-only declaration과 absolute href builder를 생성합니다. | 안정적인 tooling subpath입니다. Versioned route를 거부하고 query, fragment, relative-route, route-tree contract를 생성하지 않습니다. |
| `@fluojs/react/experimental/rsc` | Compatibility diagnostic, application-supplied RSC manifest seam, Flight response, 명시적 HTTP endpoint에 mount하는 signed Server Function transport. | **Experimental.** 모든 stable entrypoint와 격리되며 stable RSC 또는 action promise가 아닙니다. |

명시적 destination load의 자세한 동작은 [navigation payload contract](../contracts/react-navigation-payload.ko.md)와
[build된 Vite 예제](../../examples/react-vite-ssr/README.ko.md)를 참고하세요. Direct HTML request,
JavaScript-disabled anchor와 HTTP redirect/error는 server-owned로 유지됩니다. 기존 `Link`와 router
method는 승인된 destination을 document 교체 없이 렌더링합니다.
Opt-in Link는 server grant가 있는 identity-independent 결과를 한 번 재사용할 수 있지만
일반 navigation, back/forward, non-public response는 HTTP에 새로 승인받습니다. Credential을
생략한 speculative request, cache 한도, application auth/mutation 책임은 원본 계약을 참고하세요.

## 최소 end-to-end path

Canonical starter composition 이전에는 application author가 첫 hydrated page를 자신 있게 편집하기 전에
일곱 개 concept를 연결해야 했습니다. Vite manifest load, compatible server/client entry 선택, hydration
asset 생성, `ReactPageRenderer` 구현, `ReactServerEntry` 반환, hydration에서 request route snapshot 재현,
client entry와 server document 정렬입니다. 이 명시적 seam은 advanced contract로 유지되지만 첫 page에는
부수적인 작업입니다.

이제 지원되는 짧은 path는 다음과 같습니다.

1. `fluo new my-react-app --starter react-vite-ssr`를 실행하고 project로 이동한 뒤 `pnpm dev`를
   실행합니다.
2. `/products/sku-42?preview=true`를 열고 `/search?q=catalog` 링크로 이동한 뒤
   `src/page.tsx` 또는 `src/page-search.tsx`를 편집합니다. Page component는 UI와 hydrated
   interaction만 소유하며 shell은 유지되고 destination-local state는 slot에서 reset됩니다.
   공식 Node starter는 호환 가능한 component에 Fast Refresh, app origin의 CSS HMR을
   사용합니다. 직접 SSR 요청은 HTTP validation 후 최신 page를 로드합니다. 호환되지 않는
   export나 hook 구조는 remount/reload할 수 있습니다. 기존 앱은
   [개발 이전](../getting-started/migrate-react-dev-hmr.ko.md)을 참고하세요.
3. Route 추가 시 `src/app.ts`의 명시적인 `@Router(...)` / `@Path(...)` handler에서 DTO를
   검증하고 `ReactNavigationPage.create(createElement(Page, props),
   { module: './page-name.tsx', props })`를 선택합니다. 새 `src/page-name.tsx`는 build importer
   glob가 찾으므로 entry file, manifest plumbing, router store 수정이 필요하지 않습니다.
   HTTP matching, DTO validation, middleware, guard, interceptor, request scope,
   not-found behavior는 React rendering 전에 계속 실행됩니다.
4. Production path에는 `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm start`,
   `pnpm test:browser`를 실행합니다. Browser test는 console warning/error 없이 첫 response, emitted asset,
   hydration, interaction, HTTP 승인 두 page 이동 및 native document 동작을 검증합니다.

Generated application이 이 짧은 path 뒤의 composition을 소유합니다. `src/entry-server.tsx`는 교체 가능한
`ReactPageRenderer` 및 `ReactServerEntry` boundary입니다. `src/react-app.tsx`는 server/client에 하나의
`ReactClientRouterProvider`, route snapshot, document, stylesheet composition을 제공합니다.
`src/entry-client.tsx`는 같은 tree를 hydrate합니다. `src/main.ts`와 `src/load-manifest.ts`는 Vite
manifest I/O 및 actionable missing/malformed build diagnostic을 Node.js boundary에 유지합니다. Advanced
application은 이 file을 편집하거나 교체하면서 아래의 모든 명시적 API를 계속 사용할 수 있습니다.

실행 가능한 [`examples/react-vite-ssr`](../../examples/react-vite-ssr/README.ko.md)는 complete native-form
및 policy example로 남습니다. Generated client asset이나 hydration이 필요 없는 SSR에는
[`examples/react-stable-ssr`](../../examples/react-stable-ssr/README.ko.md)를 사용하세요.

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
- 임의 HTML document swapping, 일반 client document/data cache, 자동 navigation prefetch,
  optimistic mutation policy
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
