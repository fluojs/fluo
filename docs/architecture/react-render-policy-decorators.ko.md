# React Render Policy Decorator Decision

<p><a href="./react-render-policy-decorators.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

- Status: Accepted
- Decision date: 2026-07-28
- Issue: [#2834](https://github.com/fluojs/fluo/issues/2834)

## Decision

`@fluojs/react`는 전용 `@PageLayout(...)` 및 `@SuspenseFallback(...)` render-policy decorator를
채택한다. 이 decorator는 `@Router(...)` class 또는 `@Path(...)` method에 React component reference를
기록한다. 기존 application `ReactPageRenderer`는 세 번째 `policies` argument로 resolve된 reference를
받고 ordinary React composition을 계속 소유한다.

Render policy는 HTTP route metadata를 기록하거나 URL matching에 참여하거나 route ancestry를
도입하거나 두 번째 response path를 만들지 않는다. Direct `ReactElement`는 일반 HTTP handler pipeline이
끝난 뒤에만 application renderer에 도달한다. Explicit `ReactServerEntry`와 non-React handler result는
계속 application renderer와 render policy를 우회한다.

## Options Considered

| Option | Assessment |
| --- | --- |
| Ordinary React composition only | 계속 underlying implementation이며 application-wide shell에는 충분하지만 router 또는 page method 옆에 route-local intent를 선언할 수 없다. |
| `ReactModule.forRoot(...)` page renderer configuration | single application renderer 및 composition owner로 유지한다. 여기에 per-route map을 추가하면 controller registration을 중복하고 policy가 선언 page에서 분리된다. |
| Typed `@Path(...)` options | 이 policy에는 채택하지 않는다. Layout 및 Suspense semantic은 HTTP route declaration과 독립적이며, `@Path(...)` 확장은 routing/rendering을 섞은 하나의 option object를 유도한다. |
| Dedicated render-policy decorators | 채택한다. Typed component reference를 class/method declaration 가까이에 두면서 application renderer를 유일한 consumer로 유지한다. |

## Public Contract

### Component References

`@PageLayout(...)`는 `children` 및 `context` prop을 받는 `ReactPageLayout` component reference를
받는다. `@SuspenseFallback(...)`는 `context` prop을 받는 `ReactSuspenseFallback` component reference를
받는다. 미리 생성한 JSX element는 허용하지 않는다. 따라서 request와 무관한 element reuse를 막고
application renderer가 활성 request를 위해 element를 생성할 수 있다.

`ReactPageRenderer(page, context, policies)`는 `ReactRenderPolicies`를 받는다. `layouts` array는
defensive snapshot이고 `suspenseFallback`은 가장 가까운 component reference이거나 존재하지 않는다.
Application은 `getReactRenderPolicies(...)`로 같은 resolved metadata를 검사할 수 있다.

### Composition and Inheritance

Layout order는 outermost에서 innermost 순서다.

1. base-class `@PageLayout(...)`
2. derived-class `@PageLayout(...)`
3. base-method `@PageLayout(...)`
4. derived-method `@PageLayout(...)`

따라서 application renderer는 page를 기준으로 `policies.layouts`에 `reduceRight(...)`를 적용할 수 있다.
Class 및 method policy metadata는 상속된다. Derived layout은 inherited layout을 대체하지 않고 함께
compose한다. Derived 또는 method-level `@SuspenseFallback(...)`은 더 먼 class 또는 base-method fallback을
대체하며 가장 가까운 declaration이 우선한다.

각 class 또는 method decoration site는 layout 하나와 fallback 하나를 선언할 수 있다. 같은 site에서 같은
policy kind를 반복하면 bootstrap error다. 다른 inheritance 또는 class/method level에서 policy를 선언하는
것은 component reference가 같더라도 의도적인 composition이다.

### Request Context and DI

`ReactRenderContext`는 활성 `request`, `response`, optional `requestId`, request-scope `container`를
노출한다. Application renderer는 이 context를 policy component에 전달한다. Decorator는 fluo DI를 통해
component를 instantiate하지 않고 token도 직접 resolve하지 않는다. `context.container`와의 application
integration은 계속 명시적이며 기존 request-scope disposal 및 async rendering lifecycle을 유지한다.

### Bootstrap Diagnostics

React module bootstrap은 request dispatch 전에 등록된 policy를 모두 검증한다. Failure는
`ReactRenderPolicyConfigurationError`와 `REACT_RENDER_POLICY_DIAGNOSTIC_CODES`를 사용한다.

| Code | Meaning |
| --- | --- |
| `react-render-policy-duplicate-page-layout` | 한 class 또는 method site가 `@PageLayout(...)`을 두 번 이상 선언했다. |
| `react-render-policy-duplicate-suspense-fallback` | 한 class 또는 method site가 `@SuspenseFallback(...)`을 두 번 이상 선언했다. |
| `react-render-policy-invalid-reference` | Runtime JavaScript가 pre-created element를 포함한 non-component reference를 전달했다. |
| `react-render-policy-invalid-target` | Class policy가 React router에 없거나 method policy가 `@Path(...)` page에 없다. |
| `react-render-policy-missing-page-renderer` | Policy metadata가 있지만 `ReactModule.forRoot(...)`에 이를 consume할 `renderPage` callback이 없다. |

## Phase Separation

Layout 및 Suspense fallback metadata는 `@Path(...)` handler가 성공한 뒤 valid `ReactElement`에만 적용한다.
다음 결과를 처리하거나 재분류하지 않는다.

- DTO binding, middleware, guard, interceptor, handler의 HTTP pipeline error
- HTTP not-found/404 outcome
- pre-commit React shell failure
- request abort
- post-shell recoverable render error

이 outcome은 기존 HTTP 및 `ReactSsrDiagnostic` phase contract를 유지한다.

## Suspense Boundary

`@SuspenseFallback(...)`는 application renderer가 ordinary React `<Suspense>` boundary에 배치할 fallback
component를 지정한다. Streaming SSR을 포함한 React SSR 중 descendant가 suspend할 때만 적용한다. Handler
`await`, effect, event handler, native form submission, full-document client navigation, client route cache를
위한 pending UI를 관찰하거나 약속하지 않는다.

Canonical composition은 persistent layout을 innermost page Suspense boundary 밖에 유지하지만 renderer는
application-owned 상태이므로 다른 ordinary React tree shape를 선택해 문서화할 수 있다. 이 policy는 error
boundary를 만들지 않고 HTTP와 React error phase를 합치지 않는다.

## Routing and Rendering Ownership

`@Router(...)`, `@Path(...)`, `@fluojs/http`가 path, route grammar, duplicate route, param, versioning,
DTO binding, guard, interceptor, not-found behavior를 계속 소유한다. Render policy metadata는 handler match
이후 application page-result/rendering path에서만 읽는다. URL prefix layout ancestry나 Next.js segment tree를
추론하지 않는다.

## Non-goals

- `loading`, `error`, `notFound`, template, parallel route, intercepting route, segment-tree API 없음
- generic `@Error` decorator 없음
- handler-await 또는 client-navigation pending-state contract 없음
- loader data, metadata/head merge, route cache, navigation persistence 없음
- URL prefix 기반 automatic layout ancestry 없음

## Verification Evidence

- `packages/react/src/render-policy.test.ts`는 inheritance order, nearest fallback, duplicate handling,
  invalid target, missing-renderer bootstrap diagnostic을 검증한다.
- `packages/react/src/page-renderer.test.ts`는 application-renderer consumption과 활성 request-scope DI
  context identity를 검증한다.
- 기존 direct-page-return 및 SSR lifecycle suite는 HTTP, explicit-entry, shell, recoverable-error,
  request-abort phase boundary를 보존한다.
