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
- **future `@fluojs/react/client`** — browser navigation 및 client hydration helper를 위한 경계입니다.
  Root package는 client bundle을 생성하거나 client-side route transition을 소유하지 않습니다.
- **future `@fluojs/react/experimental/rsc`** — React Server Components 및 Server Functions 실험을 위한
  경계입니다. RSC와 Server Functions는 stable root contract 밖이며 `@fluojs/react`에서 제공되는 것으로
  문서화하면 안 됩니다.

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
직접적인 React DOM hydration을 통해 이 경계를 보여주며 client navigation은 향후 작업으로 남깁니다.

## 현재 제한 사항

현재 이 패키지가 제공하지 않는 것은 다음입니다.

- `@fluojs/react/client`
- `@fluojs/react/experimental/rsc`
- React Server Components 또는 Server Functions 통합
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

## 관련 패키지

- `@fluojs/core`: 스캐폴드가 사용하는 standard `@Module` decorator를 제공합니다.
- `@fluojs/http`: `@Router(...)`와 `@Path(...)`가 재사용하는 controller, route, DTO, guard,
  interceptor, header, version metadata pipeline을 제공합니다.
- `@fluojs/runtime`: 향후 React 통합 작업은 root import boundary를 넓히지 않고 runtime bootstrap contract와 합성될 예정입니다.
- `@fluojs/vite`: Vite TC39 decorator transform boundary를 소유합니다. React hydration manifest를 파싱하지
  않으므로 React server/client asset mapping에는 `@fluojs/react/vite`를 사용하세요.

## 예제 소스

- `packages/react/src/index.ts`
- `packages/react/src/vite.ts`
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
