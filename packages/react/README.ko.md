# @fluojs/react

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 런타임 중립 React 통합 스캐폴드입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [런타임 및 피어 계약](#런타임-및-피어-계약)
- [Router 및 Path Decorators](#router-및-path-decorators)
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

React page handler가 API controller와 구문상 구분되어야 하지만 fluo HTTP metadata pipeline에는
그대로 참여해야 할 때 이 패키지를 사용하세요. `@Router(...)`와 `@Path(...)`는 `@fluojs/http`
controller 및 `GET` route metadata 위의 React facade이므로 request DTO binding, versioning,
guards, interceptors, headers, route validation은 계속 HTTP runtime contract를 사용합니다.

## 런타임 및 피어 계약

루트 `@fluojs/react` import는 런타임 중립입니다. import 시점에 Node.js built-in, Vite,
`react-dom/server`, React Server Components 패키지, Server Functions 코드를 eager load하면 안 됩니다.

`react`와 `react-dom`은 애플리케이션이 React 런타임 버전을 소유하도록 peer dependencies로 선언합니다.
Decorator metadata를 위해 패키지 루트가 해당 peer를 import하지 않습니다.

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

## 현재 제한 사항

현재 이 패키지가 제공하지 않는 것은 다음입니다.

- SSR rendering 또는 streaming
- `@fluojs/react/vite`
- React Server Components 또는 Server Functions 통합
- decorators가 기록하는 HTTP metadata를 넘어서는 ReactModule 기반 route registration

## Public API

- `Router` — HTTP controller metadata와 React router marker metadata를 함께 기록하는 class decorator입니다.
- `Path` — HTTP `GET` route metadata와 React render metadata를 함께 기록하는 method decorator입니다.
- `getReactRouterMetadata` — router class에서 React router marker metadata를 읽습니다.
- `getReactPathMetadata` — router method에서 React render metadata를 읽습니다.
- `ReactModule` — 향후 React 통합 작업을 위한 런타임 중립 module marker입니다.
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
- `packages/react/src/module.ts`
- `packages/react/src/decorators.test.ts`
- `packages/react/src/index.test.ts`
