# @fluojs/react

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 런타임 중립 React 통합입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [Stable SSR Mental Model](#stable-ssr-mental-model)
- [런타임 및 피어 계약](#런타임-및-피어-계약)
- [Phase Boundaries](#phase-boundaries)
- [ReactModule Registration](#reactmodule-registration)
- [Router 및 Path Decorators](#router-및-path-decorators)
- [Web Streams SSR](#web-streams-ssr)
- [Hydration Asset Contract](#hydration-asset-contract)
- [Vite Asset Manifest Integration](#vite-asset-manifest-integration)
- [Client Navigation Runtime](#client-navigation-runtime)
- [Experimental RSC Prototype](#experimental-rsc-prototype)
- [Experimental Server Functions](#experimental-server-functions)
- [RSC Graduation Policy](#rsc-graduation-policy)
- [현재 제한 사항](#현재-제한-사항)
- [Public API](#public-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

이 패키지의 첫 공개 릴리스 목표는 `0.1.0`입니다. manifest는 `0.0.0`에서 시작해
Changesets가 표준 릴리스 워크플로를 통해 초기 `0.1.0` 버전을 게시할 수 있게 합니다.

패키지가 게시되면 React와 React DOM을 peer로 함께 설치합니다.

```bash
npm install @fluojs/react react react-dom
```

## 사용 시점

React page handler가 API controller와 구문상 구분되어야 하지만 fluo module graph 및 HTTP metadata
pipeline에는 그대로 참여해야 할 때 이 패키지를 사용하세요. `ReactModule.forRoot(...)`는 React
router를 일반 module controller metadata에 배치하고, `@Router(...)`와 `@Path(...)`는 `@fluojs/http`
controller 및 `GET` route metadata 위의 React facade이므로 request DTO binding, versioning,
guards, interceptors, headers, route validation, matching, dispatch는 계속 HTTP runtime contract를 사용합니다.

## Stable SSR Mental Model

안정 `0.1.0` 모델은 HTTP-first React SSR입니다. `@Router(...)`와 `@Path(...)`는
`@fluojs/http` metadata 위의 lexical React facade입니다. 즉 class와 method를 readability 및
diagnostics를 위한 React page surface로 표시한 뒤, HTTP runtime이 이미 이해하는 controller와 `GET`
route metadata를 기록합니다. URL matching은 React가 아니라 `@fluojs/http`가 계속 소유하므로 React
page path는 HTTP route grammar, conflict detection, versioning, DTO materialization, validation,
guards, interceptors, headers, module middleware, request scope, request lifecycle을 그대로 상속합니다.

따라서 이 패키지는 Next.js App Router clone, React Server Components framework, TanStack route tree,
Angular `Routes[]` table, file-route scanner, primary React-owned `routes: []` configuration model이
**아닙니다**. React router는 page 형태를 가진 HTTP handler로 이해하세요. Route discovery와 dispatch는
기존 fluo module/controller pipeline에 남아 있고, page handler는 일반 값을 반환하거나 streamed HTML이
필요할 때 `createReactServerEntry(...)`를 반환합니다.

## 런타임 및 피어 계약

루트 `@fluojs/react` import는 런타임 중립입니다. import 시점에 Node.js built-in, Vite,
`react-dom/server`, React Server Components 패키지, Server Functions 코드를 eager load하면 안 됩니다.

`react`와 `react-dom`은 애플리케이션이 React 런타임 버전을 소유하도록 peer dependencies로 선언합니다.
패키지 루트는 SSR helper를 노출하지만 React server entry를 렌더링할 때만 `react-dom/server`를 lazy
resolve합니다.

## Phase Boundaries

`@fluojs/react`는 안정 root가 작고 runtime-neutral 상태로 남도록 명시적인 subpath boundary를 사용합니다.

- **root `@fluojs/react`** — 안정 `0.1.0` SSR MVP 계약입니다. `ReactModule.forRoot(...)`,
  `@Router(...)`, `@Path(...)`, metadata reader, `createReactServerEntry(...)`,
  `renderReactResponse(...)`, Web Streams SSR, 명시적인 hydration asset option을 포함합니다.
- **`@fluojs/react/vite`** — Vite build manifest parsing, React server/client entry selection,
  deterministic stylesheet 및 JavaScript ordering, manifest diagnostics, hydration option 생성을 위한
  경계입니다. Root package는 여전히 manifest discovery나 scanning 없이 명시적인 asset option만 받습니다.
- **`@fluojs/react/client`** — progressive anchor, HTTP-first full-document navigation,
  hydration-safe URL/path-param/navigation lifecycle hook을 위한 경계입니다. Browser API는
  runtime-neutral root에서 계속 분리됩니다.
- **`@fluojs/react/experimental/rsc`** — exact-version compatibility diagnostics,
  client-reference/server-module manifest seam, 일반 fluo HTTP handler를 통한 Flight payload response를
  제공하고 일반 fluo HTTP handler 위에 signed Server Function transport를 추가하는 명시적으로 불안정한
  React Server Components prototype입니다. Stable root나 `@fluojs/react/client`에서는 export하지 않습니다.

## ReactModule Registration

일반 fluo module import 안에서 `ReactModule.forRoot({ controllers: [...] })`를 사용해 React router를
등록합니다. 반환되는 module은 일반 fluo module definition입니다. `imports`, `providers`, `exports`,
`middleware`를 포함할 수 있으며, 각 필드는 `@Module(...)` metadata와 같은 visibility 및 lifecycle rule을
유지합니다.

```tsx
import { Module, Inject } from '@fluojs/core';
import { ReactModule, Router, Path } from '@fluojs/react';

class DashboardPresenter {
  render() {
    return { page: 'dashboard' };
  }
}

@Inject(DashboardPresenter)
@Router('/dashboard')
class DashboardRouter {
  constructor(private readonly presenter: DashboardPresenter) {}

  @Path('/')
  index() {
    return this.presenter.render();
  }
}

@Module({
  imports: [
    ReactModule.forRoot({
      controllers: [DashboardRouter],
      providers: [DashboardPresenter],
    }),
  ],
})
class AppModule {}
```

`ReactModule`은 URL matching을 소유하지 않습니다. 이 module을 통해 등록한 router는 일반 HTTP handler
source가 되므로 `createHandlerMapping(...)`과 `Dispatcher`가 계속 duplicate route detection,
module-level middleware, request scope 생성, guard 및 interceptor 실행, route versioning을 담당합니다.

## Router 및 Path Decorators

`@Router(basePath)`는 class를 React router로 표시하고 `@Controller(basePath)`와 동등한 HTTP
controller metadata를 기록합니다. 또한 diagnostics 및 향후 rendering integration을 위해
`getReactRouterMetadata(...)`로 읽을 수 있는 React router marker metadata를 저장합니다.

`@Path(path, options?)`는 method를 React page route로 표시하고 `@Get(path)`와 동등한 HTTP `GET`
route metadata를 기록합니다. 또한 `getReactPathMetadata(...)`로 읽을 수 있는 React render
metadata를 저장합니다. 이 phase에서 optional `options` 객체는 metadata일 뿐이며 HTTP matching이나
dispatch를 변경하지 않습니다.

```tsx
import { Router, Path } from '@fluojs/react';
import { FromPath, Optional, RequestDto, FromQuery } from '@fluojs/http';

class DashboardEditRequest {
  @FromPath('id')
  id = '';

  @Optional()
  @FromQuery('tab')
  tab?: string;
}

@Router('/dashboard')
class DashboardRouter {
  @Path('/:id/edit')
  @RequestDto(DashboardEditRequest)
  edit(input: DashboardEditRequest) {
    return { page: 'dashboard-edit', input };
  }
}
```

React page path는 기존 `@fluojs/http` route grammar를 그대로 사용합니다. 지원 범위는 literal
segment와 full-segment `:param` placeholder뿐입니다. wildcard, catch-all route, optional segment,
regex-like token, `user-:id` 같은 mixed literal/parameter segment, `:id.json` 같은 suffix param은
지원하지 않습니다.

[HTTP catch-all route grammar 결정](../../docs/architecture/http-catch-all-route-grammar.ko.md)은
wildcard 도입을 유예합니다. React는 자체 syntax를 추가하지 않습니다. Page handler는 명시적인 server
route를 유지해야 하며, 향후 catch-all은 먼저 승인된 `@fluojs/http` contract가 되어야 합니다.

## Web Streams SSR

React page handler에서 `createReactServerEntry(...)`를 반환하면 기존 fluo HTTP dispatcher를 통해 HTML을
streaming합니다. Guard, interceptor, module middleware, route header, `@HttpCode(...)`, DTO binding,
request scope, duplicate route detection은 모두 `renderReactResponse(...)`가 HTML response를 finalize하기
전에 실행됩니다.

```tsx
import { HttpCode, RequestDto, FromPath } from '@fluojs/http';
import { Router, Path, createReactServerEntry } from '@fluojs/react';

class DashboardRequest {
  @FromPath('id')
  id = '';
}

@Router('/dashboard')
class DashboardRouter {
  @HttpCode(206)
  @Path('/:id')
  @RequestDto(DashboardRequest)
  show(input: DashboardRequest) {
    return createReactServerEntry(<main>Dashboard {input.id}</main>, {
      headers: { 'x-react-page': 'dashboard' },
      onRecoverableError(error, context) {
        // 애플리케이션 logger로 보고하세요. response status는 이미 committed 상태입니다.
        void error;
        void context;
      },
    });
  }
}
```

Renderer는 기본적으로 `react-dom/server`의 `renderToReadableStream(...)`을 사용하고, Suspense streaming을
보존하며, `Content-Type: text/html; charset=utf-8`을 기록합니다. Adapter가 제공한
`RequestContext.request.signal`을 전달하고, shell render failure는 response byte가 commit되기 전에
throw합니다. Recoverable Suspense error는 `onRecoverableError`로 보고되며 이미 committed된 status를 다시
쓰지 않습니다. Handler가 entry를 dispatcher에 반환하지 않고 직접 response를 finalize해야 할 때만
`renderReactResponse(entry, requestContext)`를 호출하세요.

## Hydration Asset Contract

`createReactServerEntry(...)`는 명시적인 React DOM hydration asset option을 받아 Web Streams renderer에
전달합니다.

- `bootstrapScripts`는 classic bootstrap `<script>` tag를 emit합니다. 같은 `src`를 가진 중복 entry는
  React DOM에 전달되기 전에 제거됩니다.
- `bootstrapModules`는 module bootstrap `<script type="module">` tag를 emit하며 동일한 중복 제거 규칙을
  적용합니다.
- `bootstrapScriptContent`는 신뢰된 inline script content를 제공된 그대로 emit합니다. fluo는 임의 값을 이
  문자열로 serialize하지 않습니다. 신뢰된 build-time data 또는 애플리케이션이 승인된 safety contract로
  escape한 content에만 사용하세요.
- `nonce`는 React DOM이 emit하는 bootstrap script에 붙일 CSP nonce입니다.
- `identifierPrefix`는 server-rendered `useId()` output과 client hydration이 같은 prefix를 쓰도록 React
  DOM에 전달됩니다.
- `assetMap`은 신뢰된 build 산출 logical asset name과 public URL의 defensive snapshot입니다. fluo는 이
  snapshot을 custom renderer에 전달하며, markup에 영향을 준다면 애플리케이션이 server root component와
  client `hydrateRoot(...)` 호출에 같은 데이터를 넘겨야 합니다.

```tsx
const assetMap = {
  'main.js': '/assets/main.123.js',
  'styles.css': '/assets/styles.123.css',
} as const;

return createReactServerEntry(<App assetMap={assetMap} />, {
  assetMap,
  bootstrapModules: [assetMap['main.js']],
  bootstrapScriptContent: 'window.__FLUO_ASSET_MAP__ = {"main.js":"/assets/main.123.js"};',
  identifierPrefix: 'fluo-',
  nonce: cspNonce,
});
```

애플리케이션이 hydration option을 직접 넘기는 경우 CSS/JS ordering은 계속 caller가 소유합니다.
`@fluojs/react/vite`는 manifest stylesheet 순서를 app-rendered document head 안에서 hydration script보다 먼저
보존하고, 그 다음 manifest JavaScript order와 `bootstrapScripts` 및 `bootstrapModules`의 caller order를 중복
제거 후 보존합니다. 이 패키지는 filesystem에서 Vite manifest를 발견하거나, client bundle을 생성하거나, 신뢰할 수
없는 user data를 inline script로 serialize하지 않습니다.

## Vite Asset Manifest Integration

Vite로 빌드한 React 애플리케이션에서 이미 로드한 Vite manifest를 `createReactServerEntry(...)`가 받는 안정
hydration option으로 바꿔야 할 때 `@fluojs/react/vite`를 사용합니다.

```tsx
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { createReactServerEntry } from '@fluojs/react';

const assets = createReactViteAssetManifest({
  base: '/assets/',
  entries: {
    client: 'src/entry-client.tsx',
    server: 'src/entry-server.tsx',
  },
  manifest: viteManifest,
  nonce: cspNonce,
});

if (!assets.ok) {
  throw new Error(assets.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
}

return createReactServerEntry(<App assetMap={assets.manifest.assetMap} />, {
  ...assets.manifest.hydrationOptions,
});
```

`createReactViteAssetManifest(...)`는 이미 로드된 manifest 값을 받습니다. Filesystem을 읽거나, Vite를
실행하거나, client bundle을 만들거나, root package에 Vite dependency를 추가하지 않습니다. 파싱하는 manifest
schema는 Vite client manifest 형태와 호환됩니다.

| Field | Required | Meaning |
| --- | --- | --- |
| `file` | yes | chunk의 JavaScript output file입니다. 선택된 server/client entry는 `.js`, `.mjs`, `.cjs`로 끝나야 합니다. |
| `src` / `name` | no | 명시적인 `entries.server` 및 `entries.client` selector를 위한 secondary lookup key입니다. |
| `isEntry` / `isDynamicEntry` | no | diagnostics 및 future compatibility를 위해 보존되는 Vite entry marker입니다. |
| `imports` | no | static imported chunk id입니다. imported chunk는 client entry보다 먼저 정렬됩니다. |
| `css` | no | chunk가 emit한 stylesheet file입니다. 반환되는 `manifest.css`는 dependency order를 유지하고 중복을 제거합니다. |
| `assets` | no | 반환되는 `assetMap`에 복사되는 static asset file입니다. |

성공 결과는 다음을 포함합니다.

- `manifest.hydrationOptions` — `createReactServerEntry(...)`에 바로 넘길 수 있는 `assetMap`,
  `bootstrapModules`, `bootstrapScripts`, trusted `bootstrapScriptContent`, `identifierPrefix`, `nonce`입니다.
- `manifest.css` — hydration script보다 먼저 application-rendered document head에 넣을 stylesheet URL입니다.
- `manifest.js.modules` 및 `manifest.js.scripts` — Vite client import graph에서 나온 module script와 caller가
  제공한 classic script입니다.
- `manifest.assetMap` — manifest key, source name, emitted file, CSS, static asset을 public URL에 매핑한
  defensive snapshot입니다.
- `manifest.serverEntry` 및 `manifest.clientEntry` — resolve된 React server/client entry입니다.

예상 가능한 manifest failure는 throw하지 않고 diagnostics를 반환합니다. Stable diagnostic code는 다음입니다.

- `react-vite-manifest-missing-server-entry`
- `react-vite-manifest-missing-client-entry`
- `react-vite-manifest-malformed`
- `react-vite-manifest-unsupported-output-shape`

`@fluojs/react/vite`는 `@fluojs/vite`와 분리됩니다. `vite.config.ts`에서 fluo 애플리케이션의 TC39 decorator
transform이 필요하면 `@fluojs/vite`를 사용하세요. React SSR code에서 React build asset을 파싱해 기존 hydration
contract에 공급해야 하면 `@fluojs/react/vite`를 사용하세요. 두 패키지 모두 file route, React-only route grammar,
Next.js route segment convention, RSC bundler behavior, URL matching을 소유하지 않습니다.
실행 가능한 `examples/react-vite-ssr/` 애플리케이션은 생성된 asset, streamed Suspense content,
직접적인 React DOM hydration, client navigation subpath를 통해 이 경계를 보여줍니다.

## Client Navigation Runtime

Client-owned route table을 추가하지 않고 hydrated React page에서 navigation control과 URL state가
필요하면 `@fluojs/react/client`를 사용합니다. 활성 fluo HTTP request에서 initial snapshot을 만들고,
server rendering과 hydration에서 같은 snapshot을 `ReactClientRouterProvider`에 전달합니다. 이
request-scoped snapshot은 server/client URL state drift를 막고 기존 HTTP route match가 만든 path
param을 전달합니다. Client runtime은 route param을 직접 derive하거나 validate하지 않습니다.

```tsx
import {
  Link,
  ReactClientRouterProvider,
  createReactRouteSnapshot,
  useNavigation,
  usePathname,
  useRouter,
  useSearchParams,
} from '@fluojs/react/client';

function DashboardNav() {
  const navigation = useNavigation();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <nav aria-label="Dashboard">
      <Link href="/dashboard/42/edit?tab=profile">Edit</Link>
      <button type="button" onClick={() => router.push('/dashboard/42/edit?tab=profile')}>
        Open editor
      </button>
      <output>{pathname} · {searchParams.get('tab')} · {navigation.status}</output>
    </nav>
  );
}

const initialSnapshot = createReactRouteSnapshot({
  url: requestContext.request.url,
  params: requestContext.request.params,
});

const app = (
  <ReactClientRouterProvider initialSnapshot={initialSnapshot}>
    <DashboardNav />
  </ReactClientRouterProvider>
);
```

Navigation contract는 의도적으로 HTTP-first입니다.

- `Link`는 항상 실제 `<a href>`를 렌더링하므로 pre-hydration click, JavaScript disabled 환경,
  modified click, download, explicit target, cross-origin destination은 native browser behavior를
  유지합니다. Hydration 이후 same-origin HTTP(S) URL을 향한 unmodified primary click은
  `router.push(...)`로 위임됩니다.
- `router.push(href)`는 `window.location.assign(...)`, `router.replace(href)`는
  `window.location.replace(...)`를 사용합니다. 현재 URL의 pathname 또는 search(query string)를
  변경하는 same-origin destination은 full-document navigation을 수행하므로 fluo HTTP route matching,
  `@RequestDto` binding/validation, guard, interceptor, redirect, not-found response, non-HTML response,
  server failure가 계속 authoritative합니다.
- 현재 pathname과 search를 유지하고 fragment만 바꾸는 fragment-only destination은 same-document
  예외입니다. Browser는 새 HTTP request를 보내지 않고 `hashchange`를 발생시키며, 요청한 destination과
  일치하는 event가 route snapshot URL/hash를 갱신하면서 `push` 또는 `replace` lifecycle을 완료합니다.
  Server request가 없으므로 해당 fragment 변경에서는 fluo HTTP route matching, `@RequestDto`
  binding/validation, guard, interceptor가 실행되지 않습니다.
- 정규화된 destination이 현재 route snapshot과 같은 identical URL이면 router는
  `window.location.assign(...)`이나 `window.location.replace(...)`를 호출하지 않습니다. 대신 요청한
  navigation type과 destination을 포함한 `skipped` 상태를 노출합니다.
- `router.back()`은 `window.history.back()`에 위임합니다. `router.refresh()`는 문서화된 revalidation
  mechanism으로 `window.location.reload()`를 사용하며 RSC, loader, client-data cache를 암시하지 않습니다.
- `usePathname()`, `useSearchParams()`, `useParams()`, `useRouterState()`는 provider의 immutable route
  snapshot을 읽습니다. `popstate`와 `hashchange`는 URL-derived field를 갱신합니다. 새 server document 없이
  history event가 pathname을 바꾸면 client route grammar로 추측하지 않고 stale path param을 비웁니다.
- `useNavigation()`은 `idle`, `navigating`, `refreshing`, `complete`, `error`, `skipped`를 노출합니다.
  Full-document path/search transition은 일반적으로 현재 document를 `navigating` 또는 `refreshing`
  상태에서 떠나며, destination document는 server-owned `idle` snapshot으로 시작합니다. Fragment-only
  transition은 일치하는 `hashchange` 이후 현재 document에서 `complete`가 됩니다.
- Router method는 cross-origin 또는 non-HTTP(S) destination을 `ReactClientNavigationError`로 거부합니다.
  이런 destination에는 일반 anchor를 사용하세요.

이 phase는 `prefetch`를 의도적으로 제공하지 않습니다. 소유한 client data/render cache가 없으므로
prefetch를 제공하면 일관되게 revalidate하거나 consume할 수 없는 behavior를 약속하게 됩니다.

Client navigation에는 catch-all route가 필요하지 않습니다. `Link`는 실제 anchor로 남으므로 hydration
gap이나 JavaScript disabled 환경에서는 일반 full-document browser navigation으로 fallback합니다. 이후
server는 명시적인 `@Path(...)`/HTTP route를 match하거나 정상적인 not-found response를 반환합니다.
의도적인 deployment-level document rewrite를 별도로 설정할 수 있지만, 이는 React route grammar를 만들거나
server DTO validation을 변경하지 않습니다.

## Experimental RSC Prototype

> **Experimental contract:** `@fluojs/react/experimental/rsc`는 명시적인 graduation issue가 RSC API를
> 안정화하기 전까지 변경될 수 있습니다. 이 API를 root package에서 import하거나 semver-stable React
> framework internal로 간주하지 마세요.

Prototype은 **정확히** `react@19.2.6`, `react-dom@19.2.6`, 그리고 같은 버전의 Flight renderer를
지원합니다. Version range와 canary version은 지원하지 않습니다. 애플리케이션이
`react-server-dom-webpack`을 선택한다면 같은 exact version으로 고정하세요. 이 package는 해당 renderer를
설치하거나 import하거나 감싸지 않습니다. Experimental RSC subpath를 사용하지 않는 애플리케이션을 위한
stable root peer range는 더 넓게 유지됩니다.

RSC endpoint를 활성화하기 전에 `inspectReactRscEnvironment(...)`를 호출하세요. React version이 하나라도
다르거나, runtime이 Web `ReadableStream`을 제공하지 않거나, application-owned build adapter가
client-reference manifest와 명시적인 server-to-client module map을 모두 제공하지 않으면 stable diagnostic을
반환합니다.

```ts
import {
  REACT_RSC_SUPPORTED_VERSION,
  inspectReactRscEnvironment,
} from '@fluojs/react/experimental/rsc';

const support = inspectReactRscEnvironment({
  reactVersion: '19.2.6',
  reactDomVersion: '19.2.6',
  flightRendererVersion: REACT_RSC_SUPPORTED_VERSION,
  runtime: { name: 'node', webStreams: typeof ReadableStream !== 'undefined' },
  build: {
    name: 'application-rsc-build',
    clientReferenceManifest: true,
    serverClientModuleMap: true,
  },
});
```

`createReactRscManifest(...)`는 초기 bundler-neutral module graph seam을 정의합니다. Client-reference key는
`{ id, chunks, name, async? }` metadata를 가리키고, 각 server module id는 export name을 해당
client-reference key에 매핑합니다. Helper는 defensive snapshot을 반환하고, 존재하지 않는 mapping target을
diagnostic으로 거부하며, file scan이나 bundle 생성을 수행하지 않습니다. 이 seam을 특정 React Flight
renderer manifest로 변환하는 일은 application build adapter의 책임입니다.

```ts
import { createReactRscManifest } from '@fluojs/react/experimental/rsc';

const manifest = createReactRscManifest({
  clientReferences: {
    Counter: {
      id: 'client:counter',
      chunks: ['assets/counter.js'],
      name: 'Counter',
    },
  },
  serverClientModuleMap: {
    'server:dashboard': {
      Counter: 'Counter',
    },
  },
});
```

Flight encoding도 애플리케이션이 소유합니다. 선택한 renderer가 encoded text, byte 또는 Web
`ReadableStream<Uint8Array>`를 만든 뒤 일반 fluo HTTP controller나 React `@Path(...)` handler에서
`createReactFlightResponse(...)`를 반환하세요. 기존 dispatcher가 route metadata, middleware, guard,
interceptor, request scope, error, adapter response writing을 계속 소유합니다. Helper는 고정된
`text/x-component; charset=utf-8` content type만 추가하며 별도 router를 만들지 않습니다.

```ts
import { Controller, Get } from '@fluojs/http';
import { createReactFlightResponse } from '@fluojs/react/experimental/rsc';

@Controller('/rsc')
class RscController {
  @Get('/dashboard')
  dashboard() {
    const payload = applicationFlightRenderer.render({ page: 'dashboard' });
    return createReactFlightResponse(payload);
  }
}
```

RSC manifest와 Flight response helper 자체는 Flight encoder/decoder, Webpack 또는 Vite RSC plugin,
automatic module graph discovery, client bundle generation, file route, route segment, React-owned URL
matcher를 제공하지 않습니다. 아래 Server Function transport는 같은 불안정 subpath에 별도로 opt-in하는
prototype입니다.

## Experimental Server Functions

`createReactServerFunctionRegistry(...)`는 server-only action을 정의하고 HMAC-SHA-256 reference를 발급하며
호출을 검증합니다. Router를 직접 만들지는 않습니다. 명시적인 일반 fluo `@Post(...)` route에
`registry.invoke(context)`를 mount해야 module middleware, route/controller guard, interceptor,
request-scoped provider, request observer, error envelope, adapter response writing이 기존 HTTP lifecycle에
남습니다.

```ts
import {
  BadRequestException,
  Controller,
  Post,
  type RequestContext,
  UnauthorizedException,
} from '@fluojs/http';
import { createReactServerFunctionRegistry } from '@fluojs/react/experimental/rsc';

const actions = createReactServerFunctionRegistry({
  actions: {
    updateProfile(args, context) {
      const subject = context.principal?.subject;
      if (subject === undefined) {
        throw new UnauthorizedException();
      }
      const name = args[0];
      if (typeof name !== 'string') {
        throw new BadRequestException('Profile name must be a string.');
      }
      return { name, subject, updated: true };
    },
  },
  allowedOrigins: ['https://app.example.com'],
  crypto: globalThis.crypto,
  secret: serverFunctionSecret,
  maxBodyBytes: 64 * 1024,
});

export const updateProfileReference = await actions.createReference('updateProfile');

@Controller('/_fluo')
class ReactActionController {
  @Post('/actions')
  invoke(_input: undefined, context: RequestContext) {
    return actions.invoke(context);
  }
}
```

Server action module을 client bundle에서 import하지 말고 발급한 reference를 신뢰할 수 있는 client
bootstrap data로 전달하세요. 그다음 명시적인 endpoint와 application-owned fetch implementation으로
callable을 만듭니다.

```ts
import { createReactServerFunctionClient } from '@fluojs/react/experimental/rsc';

const updateProfile = createReactServerFunctionClient({
  endpoint: '/_fluo/actions',
  fetch: globalThis.fetch,
  reference: bootstrap.serverFunctions.updateProfile,
});

await updateProfile('Ada');
```

모든 argument를 신뢰할 수 없는 값으로 취급하세요. Authorization은 각 action 내부 또는 명시적인 endpoint를
감싸는 guard에서 수행해야 하며, 유효한 reference 자체는 authorization이 아닙니다. Action handler는 활성
`RequestContext`를 받으므로 `context.container`에서 request-scoped provider를 resolve하고 request-local
state를 격리할 수 있습니다. Server Functions는 mutation 지향 integration point이며 query loader, client
data cache, DTO validation/guard/middleware/interceptor/request scope/observability 우회 수단이 아닙니다.

Transport security contract는 의도적으로 명시적입니다.

- Action id는 `[A-Za-z0-9_-]{1,128}`과 일치합니다. Reference는 id를 노출하지만 최소 32 byte의
  application-owned secret을 사용한 HMAC-SHA-256으로 무결성을 보호합니다. Secret rotation은 기존
  reference를 무효화하며 action name을 암호화하지는 않습니다.
- Request는 `application/json`, `x-fluo-react-action: 1`, `allowedOrigins`에 포함된 정확한 HTTP(S)
  `Origin`을 사용해야 합니다. Custom header는 browser cross-origin 호출을 non-simple request로 만들고,
  origin allowlist가 CSRF policy를 제공합니다.
- `maxBodyBytes` 기본값은 64 KiB입니다. Adapter가 `rawBody`를 노출하면 정확한 byte를 사용하고, 그렇지 않으면
  normalized body를 측정합니다. Network body가 JSON parsing 전에 거부되도록 platform adapter의 pre-parse
  body limit을 같거나 더 작은 값으로 설정하세요.
- Argument와 result는 `null`, boolean, finite number, string, dense array, plain object만 허용합니다.
  Circular value, sparse array, symbol/non-enumerable property, prototype-sensitive key, class instance,
  `undefined`, `bigint`, non-finite number는 거부합니다. Nesting 기본값은 32이고 128보다 크게 설정할 수 없습니다.
- Result serialized limit 기본값은 1 MiB이며 client response도 기본 1 MiB로 제한합니다.

예상 가능한 실패는 기존 fluo HTTP error envelope와 stable code를 사용합니다.

| Condition | Status | Code |
| --- | ---: | --- |
| malformed request shape | 400 | `REACT_SERVER_FUNCTION_INVALID_REQUEST` |
| unsafe arguments | 400 | `REACT_SERVER_FUNCTION_ARGUMENT_SERIALIZATION_FAILED` |
| missing/invalid request marker | 403 | `REACT_SERVER_FUNCTION_CSRF_REJECTED` |
| missing/unapproved origin | 403 | `REACT_SERVER_FUNCTION_ORIGIN_REJECTED` |
| invalid, tampered, retired action reference | 404 | `REACT_SERVER_FUNCTION_ACTION_NOT_FOUND` |
| oversized request | 413 | `REACT_SERVER_FUNCTION_PAYLOAD_TOO_LARGE` |
| non-JSON content type | 415 | `REACT_SERVER_FUNCTION_UNSUPPORTED_MEDIA_TYPE` |
| unsafe action result | 500 | `REACT_SERVER_FUNCTION_RESULT_SERIALIZATION_FAILED` |
| oversized action result | 500 | `REACT_SERVER_FUNCTION_RESULT_TOO_LARGE` |

이 prototype은 `"use server"` scan, module transform, export discovery, reference 자동 생성, action id 암호화,
database mutation convention을 제공하지 않습니다. Stable root와 `@fluojs/react/client`는 모든 Server
Function code에서 계속 격리됩니다.

## RSC Graduation Policy

`@fluojs/react/rsc`는 현재 export되지 않습니다. Canonical
[React RSC graduation policy](../../docs/contracts/react-rsc-graduation.ko.md)는 experimental API를
안정화하기 전에 필요한 evidence를 기록합니다. 여기에는 exact React/renderer compatibility, versioned
manifest 및 Server Function transport contract, browser/server bundle separation, SSR/CSR/prerendering
behavior, hydration mismatch 및 error recovery, private/auth/cookie-bearing data의 safe transfer rule,
HTTP route ownership, #2506 navigation isolation, executable runtime/bundler coverage, bilingual docs,
Changesets release evidence가 포함됩니다.

모든 gate가 승인되면 `@fluojs/react/rsc`가 canonical implementation이 되고
`@fluojs/react/experimental/rsc`는 문서화된 deprecation window 동안 테스트되는 re-export로 남습니다.
Stable package root는 계속 RSC-free입니다. 현재 정책은 graduation을 blocked로 표시하므로 이 문서 변경은
stable subpath를 추가하지 않고 deprecation window도 시작하지 않습니다.

## 현재 제한 사항

현재 이 패키지가 제공하지 않는 것은 다음입니다.

- stable RSC root 또는 `@fluojs/react/rsc` subpath. RSC는 명시적으로 불안정한
  `@fluojs/react/experimental/rsc` prototype에서만 제공합니다.
- 자동 `"use server"` transform/export discovery 또는 built-in Flight renderer/build plugin
- SPA document swapping, client data/loader cache, navigation prefetching
- Next.js App Router, TanStack route tree, Angular `Routes[]`, file-route scanner, React-owned
  `routes: []` table
- 자동 client bundle 생성
- filesystem scanning 또는 자동 manifest file discovery. 이미 로드한 manifest 값을 `@fluojs/react/vite`에 넘기세요.
- `bootstrapScriptContent`로 임의 data를 자동 serialize하는 기능
- `renderToPipeableStream(...)` 같은 Node 전용 `react-dom/server` pipeable stream root API

## Public API

- `Router` — HTTP controller metadata와 React router marker metadata를 함께 기록하는 class decorator입니다.
- `Path` — HTTP `GET` route metadata와 React render metadata를 함께 기록하는 method decorator입니다.
- `getReactRouterMetadata` — router class에서 React router marker metadata를 읽습니다.
- `getReactPathMetadata` — router method에서 React render metadata를 읽습니다.
- `ReactModule` — `forRoot(...)`가 기존 fluo module/controller metadata path를 통해 React router를
  등록하는 런타임 중립 module facade입니다.
- `createReactServerEntry` — page handler가 Web Streams SSR을 위해 반환하는 runtime-neutral React server
  entry를 생성합니다.
- `renderReactResponse` — lazy `react-dom/server` loading으로 React server entry 하나를 fluo HTML
  response에 렌더링합니다.
- `ReactAssetMap`, `ReactBootstrapAsset`, `ReactBootstrapScriptDescriptor` — build-produced asset map 및
  React DOM bootstrap script/module entry를 위한 type-only contract입니다.
- `ReactModuleOptions` — `controllers`, `imports`, `providers`, `exports`, module-level `middleware`를 포함하는
  `ReactModule.forRoot(...)` option입니다.
- `ReactServerEntry`, `ReactServerEntryOptions`, `ReactServerEntryHeaders`,
  `ReactRecoverableErrorHandler`, `ReactRecoverableErrorContext`, `ReactRenderContext`,
  `ReactReadableStream`, `ReactReadableStreamRenderer`, `ReactReadableStreamRenderOptions`,
  `RenderReactResponseOptions` — streamed React SSR 및 hydration asset을 위한 type-only contract입니다.
- `ReactScaffoldPhase` — `0.1.0` scaffold surface를 위한 type-only planning marker입니다.
- `ReactRouterMetadata`, `ReactPathMetadata`, `ReactPathOptions` — diagnostics 및 향후 rendering
  integration을 위한 type-only metadata contract입니다.
- `@fluojs/react/vite` subpath — Vite manifest를 root에서 Vite를 import하지 않고 안정 hydration asset contract로
  파싱하는 `createReactViteAssetManifest(...)`, `ReactViteBuildManifest`, `ReactViteBuildManifestChunk`,
  `ReactViteManifestOptions`, `ReactViteManifestDiagnostic`, `ReactViteAssetManifest`,
  `ReactViteHydrationOptions`, `ReactViteJavaScriptAssets`, `ReactViteBootstrapData`,
  `ReactViteResolvedEntry`를 제공합니다.
- `@fluojs/react/client` subpath — root package를 넓히거나 client route grammar를 추가하지 않고
  progressive HTTP-first browser navigation을 제공하는 `Link`, `ReactClientRouterProvider`,
  `createReactRouteSnapshot(...)`, `useRouter()`, `usePathname()`, `useParams()`,
  `useSearchParams()`, `useNavigation()`, `useRouterState()`를 제공합니다.
- `@fluojs/react/experimental/rsc` subpath — root re-export 없이 `inspectReactRscEnvironment(...)`,
  `createReactRscManifest(...)`, `createReactFlightResponse(...)`, exact-version 및 Flight content type
  constant, diagnostic, client-reference/server-module mapping type, signed
  `createReactServerFunctionRegistry(...)`, 명시적인 `createReactServerFunctionClient(...)`, stable Server
  Function error code와 관련 transport type을 제공하며 root나 stable-client에서 re-export하지 않습니다.

## 관련 패키지

- `@fluojs/core`: 스캐폴드가 사용하는 standard `@Module` decorator를 제공합니다.
- `@fluojs/http`: `@Router(...)`와 `@Path(...)`가 재사용하는 controller, route, DTO, guard,
  interceptor, header, version metadata pipeline을 제공합니다.
- `@fluojs/runtime`: 향후 React 통합 작업은 root import boundary를 넓히지 않고 runtime bootstrap contract와 합성될 예정입니다.
- `@fluojs/vite`: Vite TC39 decorator transform boundary를 소유합니다. React hydration manifest를 파싱하지
  않으므로 React server/client asset mapping에는 `@fluojs/react/vite`를 사용하세요.
- Application-selected Flight renderer: RSC payload를 encode하고 renderer-specific build manifest를
  소비합니다. Experimental subpath는 renderer package를 import하지 않고 compatibility, manifest, HTTP
  response seam만 모델링합니다.

## 예제 소스

- `packages/react/src/index.ts`
- `packages/react/src/vite.ts`
- `packages/react/src/client.ts`
- `packages/react/src/client.test.ts`
- `packages/react/src/experimental/rsc.ts`
- `packages/react/src/experimental/rsc.test.ts`
- `packages/react/src/experimental/rsc-diagnostics.test.ts`
- `packages/react/src/experimental/rsc-flight.test.ts`
- `packages/react/src/experimental/rsc-manifest.test.ts`
- `packages/react/src/experimental/server-functions-server.ts`
- `packages/react/src/experimental/server-functions-client.ts`
- `packages/react/src/experimental/server-functions-dispatch.test.ts`
- `packages/react/src/experimental/server-functions-security.test.ts`
- `packages/react/src/experimental/server-functions-client.test.ts`
- `packages/react/src/vite/create-asset-manifest.ts`
- `packages/react/src/decorators.ts`
- `packages/react/src/server-entry.ts`
- `packages/react/src/render.ts`
- `packages/react/src/module.ts`
- `packages/react/src/render.test.ts`
- `packages/react/src/dispatcher-ssr.test.ts`
- `packages/react/src/hydration-assets.test.ts`
- `packages/react/src/vite.test.ts`
- `packages/react/src/lifecycle-pipeline.test.ts`
- `packages/react/src/module.test.ts`
- `packages/react/src/decorators.test.ts`
- `packages/react/src/index.test.ts`
- `examples/react-stable-ssr/README.ko.md`
- `examples/react-stable-ssr/src/app.test.ts`
- `examples/react-vite-ssr/README.ko.md`
- `examples/react-vite-ssr/src/app.test.ts`
- `examples/react-vite-ssr/src/hydration.test.ts`
- `examples/react-vite-ssr/tests/production-hydration.spec.ts`
