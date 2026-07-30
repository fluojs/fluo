# React Page Render Policy Decision

<p><strong><kbd>English</kbd></strong> <a href="./react-page-render-policies.ko.md"><kbd>한국어</kbd></a></p>

- Status: Partially accepted
- Decision date: 2026-07-29
- Issue: [#2856](https://github.com/fluojs/fluo/issues/2856)
- Predecessor: [React Render Policy Decorator Decision](./react-render-policy-decorators.md)

## Decision Summary

The next bounded React page render-policy set contains one accepted policy and no React-owned error
or not-found response path.

| Candidate | Decision | Owner | Renderer consumption | Response or error phase |
| --- | --- | --- | --- | --- |
| Page metadata presentation | **Accepted** as `@PageMetadata(factory)` plus typed resolution and React element helpers. | The application `ReactPageRenderer` owns document-head placement. `@fluojs/react` owns only declaration ordering, deterministic data composition, and safe React element creation. | The renderer receives ordered metadata factories in `ReactRenderPolicies` after authoritative HTTP matching and calls `resolveReactPageMetadata(...)` with the active render context. | Runs only after a matched `@Path(...)` handler returns a valid `ReactElement` and before the renderer returns `ReactServerEntry`. Resolution failures remain uncommitted `http-pipeline` failures. |
| Generic error presentation | **Rejected**. Phase-specific presentation work is **deferred**. | `@fluojs/http`, React SSR diagnostics, the application React tree, and the browser each retain their existing phase. | None. No `@ErrorPresentation(...)` export or placeholder is added. | Handler/HTTP, pre-commit shell, post-shell recoverable, request-abort, and client React failures remain distinct. |
| Page-local not-found presentation | **Rejected**. An HTTP-owned not-found outcome seam may be reconsidered separately. | The HTTP matcher, `HandlerNotFoundError` conversion, application `onError`, and the HTTP error writer remain authoritative. | None. An unmatched request never selects React page metadata or calls `ReactPageRenderer`. | Route misses and handler-thrown `NotFoundException` values stay on the HTTP error path before any React page response commit. |

## Accepted Metadata Policy

### Owner and Interface

`@PageMetadata(factory)` records one synchronous `ReactPageMetadataFactory` reference on a
`@Router(...)` class or `@Path(...)` method. It does not render a document head, write response
headers, discover assets, or serialize inline data. The application renderer remains the only module
that decides where the resolved `<title>`, `<meta>`, and `<link>` elements belong in its document.

The renderer-facing interface stays small:

1. `ReactRenderPolicies.pageMetadata` contains ordered factory references.
2. `resolveReactPageMetadata(policies, context)` invokes and composes them for the active request.
3. `createReactPageMetadataElements(metadata)` creates ordinary React elements with React-owned text
   and attribute escaping.

### Inheritance and Order

Metadata factories use the same broad-to-specific order as accepted layout policies:

1. base-class `@PageMetadata(...)`
2. derived-class `@PageMetadata(...)`
3. base-method `@PageMetadata(...)`
4. derived-method `@PageMetadata(...)`

Each factory runs once per matched page render in that order. There is no URL-prefix ancestry,
segment tree, file ancestry, or cross-request cache.

### Duplicate Behavior

Each class or method decoration site may declare `@PageMetadata(...)` once. A same-site duplicate is
a bootstrap error with `react-render-policy-duplicate-page-metadata`. Declarations at different
inheritance or class/method sites intentionally compose.

Resolved values compose deterministically:

- the nearest non-`undefined` `title` wins;
- `<meta>` identity is `name` plus its value or `property` plus its value;
- `<link>` identity is the exact `rel` plus `href` pair;
- a later descriptor with the same identity replaces the earlier descriptor and occupies the later
  declaration position;
- unrelated descriptors retain factory and array order.

This policy does not infer relation-specific uniqueness. For example, two different canonical URLs
remain two different descriptors; applications must author the intended relation set explicitly.

### Request Context and DI

Factories receive `ReactPageMetadataContext`, a response-free view containing the active `request`,
optional `requestId`, and the same request-scope `container` identity visible to the handler and page
renderer. The missing `response` field is intentional: metadata cannot change status, headers, or
commit timing.

Factories are synchronous because the existing `ReactPageRenderer` and HTTP response-value finalizer
are synchronous before `ReactServerEntry` writing. fluo does not instantiate factories through DI or
resolve tokens for them. Data that requires asynchronous provider work must be loaded by the matched
handler or another existing HTTP lifecycle owner before page composition; this decision does not add
an async metadata loader.

### Bootstrap Diagnostics

Bootstrap applies the existing render-policy checks to metadata declarations:

- the factory reference must be a function;
- class declarations must belong to the declaring `@Router(...)` class;
- method declarations must belong to the declaring `@Path(...)` method;
- a same-site duplicate fails deterministically;
- any metadata policy without configured `renderPage` fails with the existing
  `react-render-policy-missing-page-renderer` diagnostic.

### Escaping and Serialization

`ReactPageMetadata` is bounded to string titles, `name`/`property` meta descriptors, and `rel`/`href`
link descriptors with optional `media` and `type`. `createReactPageMetadataElements(...)` passes those
values to ordinary React `createElement(...)` calls. React therefore escapes title text and attribute
values under its normal server-rendering contract.

The helper exposes no `dangerouslySetInnerHTML`, script descriptor, JSON transfer field, arbitrary
tag, or raw HTML escape hatch. Vite manifest loading, CSS discovery, CSP policy, inline bootstrap
serialization, and asset hosting remain application or `@fluojs/react/vite` responsibilities.

### Renderer Consumption and Failure Phase

HTTP matching and the matched handler complete before the page-result finalizer reads metadata
factories. The application renderer calls the resolver with the same request-scoped context and may
place the returned elements in its document head. Explicit `ReactServerEntry` values and non-React
handler values continue to bypass all page policies.

A factory throw occurs before the renderer returns an entry and before React shell creation or
response commit. It remains an `http-pipeline` failure observed by the existing React SSR diagnostic
bridge and HTTP error path. Metadata does not catch, translate, or render that error.

## Rejected Generic Error Presentation

A single page decorator cannot honestly own all error-shaped outcomes:

| Failure | Current owner | Why one render policy is invalid |
| --- | --- | --- |
| DTO, middleware, guard, interceptor, or handler failure | HTTP dispatcher, filters, `onError`, and error writer | The page renderer may never receive a successful element. |
| Pre-commit React shell failure | React SSR renderer and pre-commit diagnostic path | Re-entering the same renderer with a fallback can recurse and needs a separate shell contract. |
| Post-shell recoverable render error | React renderer callback and diagnostics | Status and headers may already be committed and cannot be replaced with a new document. |
| Request abort | Adapter and HTTP/React cancellation paths | An abort is not a presentation request and must not restart rendering. |
| Client React error | Application React error boundary | It occurs in another runtime after hydration and has no server request-scope DI lifetime. |

There is therefore no inheritance order, duplicate rule, request-context extension, DI integration,
renderer input, or response rewrite for a generic error policy. Future work may evaluate one
phase-specific seam at a time, beginning with a non-recursive application-owned pre-commit shell
fallback contract. That work remains deferred until its owner, retry behavior, diagnostic identity,
and commit guarantees are independently specified.

## Rejected Page-local Not-found Presentation

An unmatched request has no matched `HandlerDescriptor`, router class, method, inheritance chain, or
page renderer input. A page-local decorator consequently has no authoritative declaration to select.
Guessing from URL prefixes or adding a catch-all would create the React matcher and segment semantics
explicitly excluded by the HTTP-first model.

A matched handler may still throw `NotFoundException` for application lookup failure. That outcome is
an HTTP exception handled by application `onError` or the normal HTTP error writer; it does not become
a successful React page result. No metadata factory, layout, Suspense fallback, or page renderer runs
for either route-miss case.

Any future HTML not-found presentation must start from an HTTP-owned, typed not-found outcome that is
available consistently to global error handling and every adapter. It must define content
negotiation, API versus document selection, filter precedence, request scope, and commit behavior
before React can be one optional response representation. That is a separate HTTP contract, not a
page render policy.

## Preserved Contracts

- `PageLayout` order and `SuspenseFallback` nearest-wins behavior are unchanged.
- `ReactRenderContext` and request-scope container identity are unchanged.
- HTTP route grammar, matcher precedence, conflicts, params, versioning, DTO binding, middleware,
  guards, interceptors, filters, not-found conversion, and error writing are unchanged.
- Direct `ReactServerEntry` and non-React values still bypass the application page renderer.
- Success metadata is still resolved only after the matched handler completes, before the renderer
  returns the entry, and before SSR shell creation or response commit.
- SSR diagnostic codes and `http-pipeline`, `pre-commit-shell`, `request-abort`, and
  `post-shell-recoverable` phases are unchanged.
- The runtime-neutral root adds no Node.js, Vite, browser, RSC, or `react-dom/server` eager import.

## Non-goals

- no Next.js segment metadata, `generateMetadata`, `error`, `notFound`, or file convention
- no URL-prefix ancestry, React matcher/tree/file routing, wildcard, or catch-all behavior
- no generic policy spanning HTTP, React shell, recoverable streaming, abort, and client phases
- no client cache, SPA document swap, navigation persistence, loader, or revalidation policy
- no RSC graduation, Server Function widening, Vite asset discovery, or arbitrary inline serialization
- no response status/header mutation from metadata factories
- no async metadata loader or automatic DI instantiation

## Verification Evidence

- Metadata unit tests cover bootstrap validation, inheritance and factory order, title/meta/link
  composition, duplicate replacement, and React escaping.
- Request-level tests cover application renderer consumption, request-scope identity, missing
  renderer diagnostics, and metadata factory isolation from response ownership.
- Negative request tests prove unmatched routes and handler-thrown `NotFoundException` responses stay
  HTTP-owned and do not invoke metadata factories or the page renderer.
- Existing `PageLayout`, `SuspenseFallback`, direct-page-return, SSR diagnostic, shell, recoverable
  error, request-abort, root-import, and HTTP dispatcher suites remain the regression baseline.
