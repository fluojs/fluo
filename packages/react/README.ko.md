# @fluojs/react

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 런타임 중립 React 통합입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [런타임 및 피어 계약](#런타임-및-피어-계약)
- [ReactModule Registration](#reactmodule-registration)
- [Router 및 Path Decorators](#router-및-path-decorators)
- [Web Streams SSR](#web-streams-ssr)
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

## 런타임 및 피어 계약

루트 `@fluojs/react` import는 런타임 중립입니다. import 시점에 Node.js built-in, Vite,
`react-dom/server`, React Server Components 패키지, Server Functions 코드를 eager load하면 안 됩니다.

`react`와 `react-dom`은 애플리케이션이 React 런타임 버전을 소유하도록 peer dependencies로 선언합니다.
패키지 루트는 SSR helper를 노출하지만 React server entry를 렌더링할 때만 `react-dom/server`를 lazy
resolve합니다.

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

## 현재 제한 사항

현재 이 패키지가 제공하지 않는 것은 다음입니다.

- `@fluojs/react/vite`
- React Server Components 또는 Server Functions 통합
- hydration asset injection

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
- `ReactModuleOptions` — `controllers`, `imports`, `providers`, `exports`, module-level `middleware`를 포함하는
  `ReactModule.forRoot(...)` option입니다.
- `ReactServerEntry`, `ReactServerEntryOptions`, `ReactServerEntryHeaders`,
  `ReactRecoverableErrorHandler`, `ReactRecoverableErrorContext`, `ReactRenderContext`,
  `ReactReadableStream`, `ReactReadableStreamRenderer`, `ReactReadableStreamRenderOptions`,
  `RenderReactResponseOptions` — streamed React SSR을 위한 type-only contract입니다.
- `ReactScaffoldPhase` — `0.1.0` scaffold surface를 위한 type-only planning marker입니다.
- `ReactRouterMetadata`, `ReactPathMetadata`, `ReactPathOptions` — diagnostics 및 향후 rendering
  integration을 위한 type-only metadata contract입니다.

## 관련 패키지

- `@fluojs/core`: 스캐폴드가 사용하는 standard `@Module` decorator를 제공합니다.
- `@fluojs/http`: `@Router(...)`와 `@Path(...)`가 재사용하는 controller, route, DTO, guard,
  interceptor, header, version metadata pipeline을 제공합니다.
- `@fluojs/runtime`: 향후 React 통합 작업은 root import boundary를 넓히지 않고 runtime bootstrap contract와 합성될 예정입니다.

## 예제 소스

- `packages/react/src/index.ts`
- `packages/react/src/decorators.ts`
- `packages/react/src/server-entry.ts`
- `packages/react/src/render.ts`
- `packages/react/src/module.ts`
- `packages/react/src/render.test.ts`
- `packages/react/src/dispatcher-ssr.test.ts`
- `packages/react/src/module.test.ts`
- `packages/react/src/decorators.test.ts`
- `packages/react/src/index.test.ts`
