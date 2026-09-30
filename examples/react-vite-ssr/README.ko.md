# react-vite-ssr example

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Hydration 및 client-navigation phase를 위한 최소 Vite-backed `@fluojs/react` 애플리케이션입니다.
두 번째 routing model을 만들지 않고 HTTP-owned page route, DTO-bound parameter, streamed React
SSR, Vite manifest asset, hydrated browser runtime, progressively enhanced native mutation form을
연결합니다.

이 예제는 production manifest/hydration 경로를 설명하며 생성 starter의
`fluo dev` HMR host가 아닙니다. 지원되는 Node React Fast Refresh와 CSS HMR은
`fluo new --starter react-vite-ssr`로 생성하세요. 기존 생성 앱은 별도 Vite process를
추가하지 않고 [이전 가이드](../../docs/getting-started/migrate-react-dev-hmr.ko.md)를
따라 변경할 수 있습니다.

일반 둘째·셋째 page는 공식 generated `react-vite-ssr` composition에서 시작하세요.
`src/page*.tsx` importer glob와 HTTP handler가 크기 제한 및 escape를 적용한 초기
transfer를 이후 soft navigation과 공유합니다. 이 예제는 native POST, public prefetch,
CSP nonce, focus 정책을 검증하기 위해 application 소유 document와 navigation module의
lower-level 형태를 의도적으로 유지합니다. 별도의 권장 bootstrap 경로가 아니며
[starter composition migration](../../docs/getting-started/migrate-react-starter-composition.ko.md)이
custom document를 같은 handler 선택 transfer에 연결합니다.

이 예제는 현재의 SSR, hydration, native POST/303/GET, 승인된 navigation과 opt-in 일시적
실패 보존의 근거이지 완전한 운영 CRUD 또는 장기 주크박스 게이트가 아닙니다.
[HTTP-first React 제품 계약](../../docs/contracts/react-fullstack-product.ko.md)은 추가
사용자 여정과 담당자를 연결합니다. 예제는 network/5xx 및 복구 가능한 import 실패
`failurePolicy`를 선택하고 장기 자원의 operation/ack 및 mount/cleanup을 확인하면서
`retry()`와 `openDocument()`를 제공합니다. Opt-in하지 않은 low-level provider는
document fallback을 유지하며 공식 starter는 network/5xx 및 복구 가능한 매핑된 import 실패의 보존·복구 control을
명시적으로 연결합니다. `router.refresh()`는 공통 셸을 유지하면서 현재 HTTP page를
재검증하고 typed completion result를 반환합니다. 명시적 문서 reload에는
`window.location.reload()`를 사용하세요.
[소비자 migration](../../docs/getting-started/migrate-react-refresh.ko.md)을 참고하세요.

## 이 예제가 보여주는 것

- fluo HTTP module graph가 발견하는 `@Router('/products')` 및 `@Path('/:sku')` page route.
- `@RequestDto(...)`, `@FromPath('sku')`, `@FromQuery('preview')`를 통한 typed path/search input.
- Application `renderPage` callback이 manifest-derived hydration option과 compose하는
  opt-in `ReactNavigationPage`의 일반 document response.
- Web Streams SSR이 fallback과 resolve된 recommendation content를 emit하는 `Suspense` boundary.
- `dist/client/.vite/manifest.json`을 생성하는 Vite client build와, 이미 로드한 manifest를 ordered
  CSS 및 hydration module asset으로 바꾸는 `@fluojs/react/vite`.
- React DOM `hydrateRoot(...)`를 통해 interactive 상태가 되는 server-rendered counter.
- `/admin/qr`와 `/admin/songs`의 `@Router('/admin')` page와 공통 interactive shell 유지,
  destination-local state 초기화, `<main>` focus를 보장하는 HTTP 승인 기반 soft navigation.
- Server-owned DTO validation boundary에 계속 도달하는 `@fluojs/react/client` route snapshot,
  URL-state hook, progressive `Link`, `push/replace/back` 및 document fallback.
- `Link prefetch="hover"|"viewport"`와 provider `prefetchScope` 명시적 opt-in:
  server가 public으로 선언한 destination만 anonymous prefetch 후 한 번 소비합니다.
  private, no-store, Set-Cookie, Vary Cookie, redirect, missing, auth fixture는 재사용
  거절과 일반 credentialed navigation을 보여줍니다.
- 일반 guarded/intercepted `@Post(...)` route에 도달해 application state를 mutate하고 HTTP-matched
  destination으로 `303 See Other`를 반환하는 native `multipart/form-data` form.
- JavaScript disabled 상태에서 해당 form을 submit하는 production browser coverage.
- 생성된 Vite client asset까지 Fastify adapter로 제공하는 production build.
- Network/5xx 실패 주입, 새 HTTP 재시도, back/forward 복구, 자원 identity와 동작 확인을
  수행하는 production Chrome 테스트. 장기 실행 경계(#3886)의 fixture로
  `window.__reactResource`와 `window.__reactResourceStats`를 관찰할 수 있습니다.

## 레포 루트에서 실행하기

```sh
pnpm install
pnpm build
pnpm --filter @fluojs/example-react-vite-ssr build
pnpm --filter @fluojs/example-react-vite-ssr start
```

`http://127.0.0.1:3000/products/sku-42?preview=true`를 열고 `Count: 0`을 활성화하세요.
Vite-generated client entry가 server HTML을 hydrate한 뒤에만 label이 `Count: 1`로 바뀝니다.
`Open sku-84` 또는 `Push sku-126`은 HTTP 승인 뒤 문서 교체 없이 이동합니다. `/admin/qr`를
열어 두 counter를 증가시키고 `Open admin songs`, `Back`, browser forward를 순서대로
사용하세요. URL과 page는 HTTP가 확정한 목적지를 따르며 shell counter는 유지되고 page
counter는 초기화됩니다. Main landmark에 focus를 옮깁니다. 직접 요청과 JavaScript 비활성
요청은 계속 일반 server document를 렌더링합니다.
`Probe shell resource` button은 실제 `MessageChannel` operation을 보내 instance ID와
acknowledgement 순서를 표시합니다. 승인된 page render 오류와 local reset 뒤에도 같은
resource가 다음 operation에 응답합니다. `Open throwing destination`은 추가 HTTP request가
없는 page-local reset을, `Open throwing error view`는 안전한 외부 diagnostic/document exit를
검사합니다. 보류한 승인은 이전 page를 조작 가능한 상태로 유지하면서 pending을 알리고,
승인된 `@PageMetadata(...)`는 global icon/Vite stylesheet를 지우지 않고 title,
description, canonical link를 바꿉니다.

이 예제의 provider는 `network`, `server-error`, `import-failure`에 보존을 선택합니다. 승인 대상 load가
실패해도 마지막 page·URL·자원 instance와 `Use shell resource` 작업은 살아 있습니다.
`Retry navigation`은 새 HTTP 요청을 보내고 `Open full document`는 명시적인 문서 이동을
선택합니다. 인증·redirect·DTO·잘못된 payload를 포함한 다른 사유는 document fallback을
유지합니다. Production browser는 유료 음악 계정 없이 이를 검증하지만 실제 음악 재생,
logout 뒤 보존은 입증하지 않습니다. 생성 starter는 자신의 기본값을 별도로 검증합니다.
정책 없는 browser fixture는 `/admin/qr?defaultNavigation=1`로 시작합니다. 이동에는
여전히 HTTP 승인이 필요하지만 index 없는 back entry를 무효화하면 일반 문서를 불러옵니다.

`/admin/qr`에서 `Prefetch public sku-84`에 hover하거나 아래로 내려가
`Prefetch public on viewport`를 화면에 표시한 뒤 opt-in link를 활성화하세요.
첫 GET으로 받은 public navigation representation을 추가 GET 없이 한 번 소비합니다.
`Open public sku-84 without prefetch`는 계속 일반 요청을 합니다.
`Switch user and prefetch scope`는 다음 navigation 전에 session cookie와
application-managed `prefetchScope`를 변경합니다. `Rename without reload`는 guard가 있는
POST 성공 뒤 `router.invalidate()`를 호출합니다. `Refresh`로 새 서버 값을 같은 page에
history entry 없이 표시합니다. Pending과 보존된 실패에서는 마지막 승인 값을 유지합니다.
다른 fixture link는 거절된
anonymous prefetch가 private destination을 대신하지 못함을 보여줍니다.

반복 가능한 SSR 및 hydration 검증은 다음 명령으로 실행합니다.

```sh
pnpm vitest run examples/react-vite-ssr
pnpm --filter @fluojs/example-react-vite-ssr test:browser
```

Browser 명령은 workspace package와 예제를 다시 build하고, build된 server를 시작한 뒤 prefetch
요청 횟수와 렌더링 결과, production client entry, JavaScript-disabled context를 Chrome에서
검증합니다. Bootstrap/style asset 누락 또는
non-200 response, hydration warning/error, identifier-prefix mismatch, hydrate되지 않는 counter,
URL과 server-rendered route state가 일치하지 않는 client navigation, `POST` → `303` → `GET` flow를
완료하지 못하는 native form이 있으면 실패합니다.

## 협상된 destination workflow

`src/app.ts`는 application이 로드한 Vite manifest에 `src/navigation-product.ts`가 있는지
확인합니다. Matched product handler는
`ReactNavigationPage.create(ProductDocument, { module: './navigation-product.ts', props })`를
반환합니다. 일반 document GET은 HTML shell, hydration script, Suspense content와 request
URL을 계속 stream합니다. `Accept: application/vnd.fluo.react-navigation+json;v=2` GET은
같은 HTTP DTO/module pipeline을 실행한 뒤 server URL/param과 browser destination을
반환합니다. `src/entry-client.ts`는 Vite가 compile한 `import.meta.glob(...)` map을 hydrated
document의 `ReactClientRouterProvider`에 `navigationModules`로 전달하며 hydration 전에
escape된 inert initial transfer를 검증합니다. Shell의 `ReactNavigationExperience`는
opt-in render boundary, polite status, focus/scroll 기본값과 page-owned head를 제공합니다.
기존 `Link`와
`router.push/replace`는 client loader가 HTTP 결과를 검증한 뒤에만 history를 commit하고
page slot에 새 destination을 렌더링합니다. `src/admin-page.ts` 및 build-mapped
`src/navigation-admin.ts` entry는 두 admin page를 처리하며 공통 counter는 유지됩니다.
`popstate`와 forward는 새 결과를 요청합니다.
전체 Vite manifest와 동일 origin `/assets/` base의 `buildId`를
`ReactModule.forRoot({ navigationBuildId })`, inert 초기 transfer와 client provider에
전달합니다. A 탭이 B를 만나면 `incompatible-build`에서 마지막 승인 page/resource와
명시적 update/document action을 유지합니다. 매핑된 chunk 누락은 `import-failure`,
없는 key는 `unsupported-module`입니다.
[배포 recipe](../../docs/guides/react-production-deployment.ko.md)를 확인하세요.

일반 navigation은 same-origin cookie를 보내고 `Set-Cookie`는 browser 처리에 맡기며
`cache: 'no-store'`를 사용합니다. Prefetch는 `Link`가 `hover` 또는 `viewport`를 명시하고
provider에 `navigationModules`와 `prefetchScope`가 모두 있어야 활성화됩니다.
`PrefetchPageRouter`는 identity-independent fixture에만
`ReactNavigationPage.create(node, destination, { prefetch: 'public' })`를 사용합니다.
HTTP가 호환 가능한 `Cache-Control`, `Vary`와 함께
`X-Fluo-Navigation-Prefetch: public`을 승인한 경우에만 response를 재사용합니다.
Prefetch는 credential을 보내지 않으며 authenticated representation을 추론해서는
안 됩니다. 예제의 `public-*` content는 사용자와 무관합니다. Cookie, authorization,
identity header, IP에 따라 출력이 바뀌는 page에는 public을 선언하지 마세요.
Cache는 provider-local, single-use이고 유효 기간은 최대 15초이며 최대 32개 entry,
entry당 64 KiB, 동시 요청 4개로 제한됩니다. Scope 변경, `router.invalidate()`, 문서 종료는
이를 비웁니다. Redirect, error,
invalid/unsupported payload, 사용할 수 없는 module은 일반 document fallback을 실행하고
취소된 load는 실행하지 않습니다. Private/no-store, Set-Cookie, 지원되지 않는 Vary,
credential-bearing 또는 grant 없는 response는 재사용하지 않습니다. Auth 및 mutation
경계에서 invalidation은 application 책임이며 외부 HttpOnly cookie 변경을 자동으로
감지하지 않습니다. 이 예제는 streamed React bootstrap/Suspense script에
response별 CSP nonce를 부여해 production Fastify security policy 아래에서도 default
script policy를 완화하지 않고 hydration합니다. 자세한 계약은
[navigation payload contract](../../docs/contracts/react-navigation-payload.ko.md)를 참고하세요.

## canonical consumer test map

이 예제는 canonical React consumer loop의 바깥쪽 절반을 담당하고 package 및 CLI fixture는 더 작은 unit과
generated type을 검증합니다.

| layer | executable evidence |
| --- | --- |
| Render-policy unit | `packages/react/src/render-policy.test.ts`가 composition과 diagnostic을 직접 검증합니다. |
| Real request dispatch | `src/app.test.ts`가 `Test.createApp(...)`로 opt-in page, DTO failure, guard/interceptor behavior, native mutation response를 검증합니다. |
| Generated-route compile/check | `packages/cli/src/commands/typegen-navigation.test.ts`가 positive/negative route-id/params fixture를 compile하고 `typegen.test.ts`가 non-mutating stale check를 검증합니다. |
| Hydration | `src/hydration.test.ts`가 warning-free interaction과 `onRecoverableError` 기반 mismatch reporting을 모두 검증합니다. |
| Production 및 no JavaScript | `tests/production-hydration.spec.ts`가 build asset과 hydration을 검증한 뒤 `javaScriptEnabled: false`로 native form을 submit합니다. |

React-specific testing helper는 추가하지 않습니다. 일반 fixture가 반복 setup을 제거하는 동안
`Test.createApp(...)`, React DOM, TypeScript, Playwright가 real ownership boundary를 계속 실행합니다.

격리된 [동등 앱 성능 비교](../../docs/guides/react-performance-benchmarks.ko.md)는
더 큰 seeded workload와 별도의 정확성·timing gate를 사용합니다. 이 예제의
production hydration 검증만으로 네 프레임워크 성능을 측정했다고 볼 수 없습니다.

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
- Opt-in page return은 두 번째 response path를 만들지 않습니다. Application renderer는 계속
  `ReactServerEntry`를 반환하고 기존 HTTP writer가 status, header, error, streaming을 소유합니다.
- `src/entry-client.ts`가 browser-only boundary입니다. Server module은 `window`나 `document`에
  접근하지 않으며, server는 application boundary에서 Vite manifest를 명시적으로 로드합니다.
- `ReactClientRouterProvider`는 SSR과 hydration에서 같은 request URL과 HTTP-matched param을 받습니다.
  승인된 page는 soft navigation하고 redirect, not-found, DTO failure, error는 일반 HTTP
  document로 fallback합니다. Guard와 interceptor는 계속 server-owned입니다.
- 이 예제는 임의 HTML swapping, event replay, client route matching, 전역 navigation cache,
  RSC-aware data, opt-in하지 않은 link의 prefetch를 약속하지 않습니다.
- Network/5xx soft load 실패 시 현재 기본값은 주크박스 shell을 보존하지 않습니다.
  이 예제의 fallback test는 의도적으로 현재 full-document 경로를 관찰합니다.
  인증 거절, 명시적 reload, 앱 logout은 일시적 재시도와 다른 결과입니다.
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
│   ├── admin-page.ts       # 공유 admin page component와 destination-local state
│   ├── entry-client.ts     # Browser-only hydrateRoot(...) entry
│   ├── navigation-admin.ts # Build-mapped admin destination entry
│   ├── prefetch-page.ts    # public 및 제한된 HTTP prefetch fixture
│   ├── entry-server.ts     # 명시적 Vite server-entry selector
│   ├── hydration.ts        # server/client 공유 identifierPrefix
│   ├── hydration.test.ts   # Aligned interaction 및 recoverable mismatch reporting
│   ├── main.ts             # 생성된 manifest를 로드하고 Fastify 시작
│   ├── page.ts             # 공유 document, native form, client router, interactive counter
│   └── recommendations.ts  # Lazy Suspense content
├── tests/
│   ├── prefetch.spec.ts    # 빌드된 browser의 public prefetch 및 history 결과
│   ├── prefetch-boundaries.spec.ts # private, auth, mutation, fallback 결과
│   ├── prefetch-limits.spec.ts # browser cache 및 동시 요청 제한
│   ├── prefetch-helpers.ts # 공통 browser request observer
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
