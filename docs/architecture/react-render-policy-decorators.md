# React Render Policy Decorator Decision

<p><strong><kbd>English</kbd></strong> <a href="./react-render-policy-decorators.ko.md"><kbd>한국어</kbd></a></p>

- Status: Accepted
- Decision date: 2026-07-28
- Issue: [#2834](https://github.com/fluojs/fluo/issues/2834)

## Decision

`@fluojs/react` accepts dedicated `@PageLayout(...)` and `@SuspenseFallback(...)` render-policy
decorators. They record React component references on `@Router(...)` classes or `@Path(...)`
methods. The existing application `ReactPageRenderer` receives the resolved references in a third
`policies` argument and remains responsible for ordinary React composition.

Render policies never write HTTP route metadata, participate in URL matching, introduce route
ancestry, or create a second response path. A direct `ReactElement` still reaches the application
renderer only after the ordinary HTTP handler pipeline. Explicit `ReactServerEntry` and non-React
handler results continue to bypass the application renderer and render policies.

## Options Considered

| Option | Assessment |
| --- | --- |
| Ordinary React composition only | Remains the underlying implementation and is sufficient for application-wide shells, but it cannot declare route-local intent next to a router or page method. |
| `ReactModule.forRoot(...)` page renderer configuration | Remains the single application renderer and composition owner. Adding per-route maps here would duplicate controller registration and separate policy from the declaring page. |
| Typed `@Path(...)` options | Rejected for these policies. Layout and Suspense semantics are independent of HTTP route declaration, and expanding `@Path(...)` would encourage one mixed routing/rendering options object. |
| Dedicated render-policy decorators | Accepted. They keep typed component references close to class/method declarations while the application renderer remains the only consumer. |

## Public Contract

### Component References

`@PageLayout(...)` accepts a `ReactPageLayout` component reference with `children` and `context`
props. `@SuspenseFallback(...)` accepts a `ReactSuspenseFallback` component reference with a
`context` prop. Pre-created JSX elements are not accepted. This avoids request-insensitive element
reuse and lets the application renderer create elements for the active request.

`ReactPageRenderer(page, context, policies)` receives `ReactRenderPolicies`. Its `layouts` array is
a defensive snapshot, and `suspenseFallback` is either the nearest component reference or absent.
Applications may inspect the same resolved metadata with `getReactRenderPolicies(...)`.

### Composition and Inheritance

Layout order is outermost to innermost:

1. base-class `@PageLayout(...)`
2. derived-class `@PageLayout(...)`
3. base-method `@PageLayout(...)`
4. derived-method `@PageLayout(...)`

An application renderer can therefore apply `policies.layouts` with `reduceRight(...)` around the
page. Class and method policy metadata is inherited. A derived layout composes with inherited
layouts rather than replacing them. A derived or method-level `@SuspenseFallback(...)` replaces the
farther class or base-method fallback; the nearest declaration wins.

Each class or method decoration site may declare one layout and one fallback. Repeating the same
policy kind at one site is a bootstrap error. Declaring a policy at another inheritance or
class/method level is intentional composition, even when the component reference is identical.

### Request Context and DI

`ReactRenderContext` exposes the active `request`, `response`, optional `requestId`, and request-scope
`container`. The application renderer passes this context to policy components. The decorators do
not instantiate components through fluo DI and do not resolve tokens themselves. Any application
integration with `context.container` remains explicit and keeps the existing request-scope disposal
and async rendering lifecycle.

### Bootstrap Diagnostics

React module bootstrap validates every registered policy before request dispatch. Failures use
`ReactRenderPolicyConfigurationError` and `REACT_RENDER_POLICY_DIAGNOSTIC_CODES`:

| Code | Meaning |
| --- | --- |
| `react-render-policy-duplicate-page-layout` | One class or method site declares `@PageLayout(...)` more than once. |
| `react-render-policy-duplicate-suspense-fallback` | One class or method site declares `@SuspenseFallback(...)` more than once. |
| `react-render-policy-invalid-reference` | Runtime JavaScript supplied a non-component reference, including a pre-created element. |
| `react-render-policy-invalid-target` | A class policy is not on a React router, or a method policy is not on a `@Path(...)` page. |
| `react-render-policy-missing-page-renderer` | Policy metadata exists but `ReactModule.forRoot(...)` has no `renderPage` callback to consume it. |

## Phase Separation

Layouts and Suspense fallback metadata apply only to a valid `ReactElement` after its `@Path(...)`
handler succeeds. They do not handle or reclassify:

- HTTP pipeline errors from DTO binding, middleware, guards, interceptors, or handlers
- HTTP not-found/404 outcomes
- pre-commit React shell failures
- request aborts
- post-shell recoverable render errors

Those outcomes retain the existing HTTP and `ReactSsrDiagnostic` phase contracts.

## Suspense Boundary

`@SuspenseFallback(...)` names a fallback component for an application renderer to place in an
ordinary React `<Suspense>` boundary. It applies only when a descendant suspends during React SSR,
including streaming SSR. It does not observe or promise pending UI for handler `await`, effects,
event handlers, native form submissions, full-document client navigation, or a client route cache.

The canonical composition keeps persistent layouts outside an innermost page Suspense boundary, but
the renderer remains application-owned and may choose another documented ordinary React tree shape.
The policy does not create an error boundary and does not merge HTTP or React error phases.

## Routing and Rendering Ownership

`@Router(...)`, `@Path(...)`, and `@fluojs/http` continue to own paths, route grammar, duplicate
routes, params, versioning, DTO binding, guards, interceptors, and not-found behavior. Render policy
metadata is read only by the application page-result/rendering path after a handler has been matched.
No URL-prefix layout ancestry or Next.js segment tree is inferred.

## Non-goals

- no `loading`, `error`, `notFound`, template, parallel route, intercepting route, or segment-tree API
- no generic `@Error` decorator
- no handler-await or client-navigation pending-state contract
- no loader data, metadata/head merge, route cache, or navigation persistence
- no automatic layout ancestry from URL prefixes

## Verification Evidence

- `packages/react/src/render-policy.test.ts` covers inheritance order, nearest fallback, duplicate
  handling, invalid targets, and missing-renderer bootstrap diagnostics.
- `packages/react/src/page-renderer.test.ts` covers application-renderer consumption and active
  request-scope DI context identity.
- Existing direct-page-return and SSR lifecycle suites preserve HTTP, explicit-entry, shell,
  recoverable-error, and request-abort phase boundaries.
