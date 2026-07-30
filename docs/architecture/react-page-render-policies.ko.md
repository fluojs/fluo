# React Page Render Policy Decision

<p><a href="./react-page-render-policies.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

- Status: Partially accepted
- Decision date: 2026-07-29
- Issue: [#2856](https://github.com/fluojs/fluo/issues/2856)
- Predecessor: [React Render Policy Decorator Decision](./react-render-policy-decorators.ko.md)

## Decision Summary

다음 bounded React page render-policy 집합은 하나의 accepted policy만 포함하며 React-owned error 또는
not-found response path를 추가하지 않는다.

| Candidate | Decision | Owner | Renderer consumption | Response or error phase |
| --- | --- | --- | --- | --- |
| Page metadata presentation | Typed resolution과 React element helper를 포함한 `@PageMetadata(factory)`로 **채택**한다. | Application `ReactPageRenderer`가 document-head placement를 소유한다. `@fluojs/react`는 declaration order, deterministic data composition, safe React element creation만 소유한다. | Authoritative HTTP matching 이후 renderer가 `ReactRenderPolicies`의 ordered metadata factory를 받고 active render context와 함께 `resolveReactPageMetadata(...)`를 호출한다. | Matched `@Path(...)` handler가 valid `ReactElement`를 반환한 뒤, renderer가 `ReactServerEntry`를 반환하기 전에만 실행한다. Resolution failure는 uncommitted `http-pipeline` failure로 남는다. |
| Generic error presentation | **거부**한다. Phase-specific presentation work는 **유예**한다. | `@fluojs/http`, React SSR diagnostic, application React tree, browser가 각자의 기존 phase를 유지한다. | 없음. `@ErrorPresentation(...)` export나 placeholder를 추가하지 않는다. | Handler/HTTP, pre-commit shell, post-shell recoverable, request-abort, client React failure를 계속 구분한다. |
| Page-local not-found presentation | **거부**한다. HTTP-owned not-found outcome seam은 별도 작업에서 재검토할 수 있다. | HTTP matcher, `HandlerNotFoundError` conversion, application `onError`, HTTP error writer가 authoritative 상태를 유지한다. | 없음. Unmatched request는 React page metadata를 선택하거나 `ReactPageRenderer`를 호출하지 않는다. | Route miss와 handler가 throw한 `NotFoundException`은 React page response commit 전 HTTP error path에 남는다. |

## Accepted Metadata Policy

### Owner and Interface

`@PageMetadata(factory)`는 `@Router(...)` class 또는 `@Path(...)` method에 synchronous
`ReactPageMetadataFactory` reference 하나를 기록한다. Document head를 render하거나 response header를
기록하거나 asset을 discover하거나 inline data를 serialize하지 않는다. Resolve된 `<title>`, `<meta>`,
`<link>` element를 application document의 어디에 둘지는 application renderer만 결정한다.

Renderer-facing interface는 작게 유지한다.

1. `ReactRenderPolicies.pageMetadata`가 ordered factory reference를 포함한다.
2. `resolveReactPageMetadata(policies, context)`가 active request를 위해 factory를 호출하고 compose한다.
3. `createReactPageMetadataElements(metadata)`가 React-owned text/attribute escaping을 사용하는 ordinary
   React element를 생성한다.

### Inheritance and Order

Metadata factory는 accepted layout policy와 같은 broad-to-specific order를 사용한다.

1. base-class `@PageMetadata(...)`
2. derived-class `@PageMetadata(...)`
3. base-method `@PageMetadata(...)`
4. derived-method `@PageMetadata(...)`

각 factory는 matched page render마다 이 순서로 한 번 실행한다. URL-prefix ancestry, segment tree, file
ancestry, cross-request cache는 없다.

### Duplicate Behavior

각 class 또는 method decoration site는 `@PageMetadata(...)`를 한 번만 선언할 수 있다. Same-site
duplicate는 `react-render-policy-duplicate-page-metadata`를 가진 bootstrap error다. 서로 다른 inheritance
또는 class/method site의 declaration은 의도적으로 compose한다.

Resolve된 값은 deterministic하게 compose한다.

- 가장 가까운 non-`undefined` `title`이 우선한다.
- `<meta>` identity는 `name`과 그 값 또는 `property`와 그 값이다.
- `<link>` identity는 정확한 `rel`과 `href` pair다.
- 같은 identity의 later descriptor는 earlier descriptor를 대체하고 later declaration 위치를 차지한다.
- 관련 없는 descriptor는 factory 및 array order를 유지한다.

이 policy는 relation-specific uniqueness를 추론하지 않는다. 예를 들어 서로 다른 canonical URL 두 개는
서로 다른 descriptor로 남으므로 application이 의도한 relation set을 명시적으로 작성해야 한다.

### Request Context and DI

Factory는 active `request`, optional `requestId`, handler와 page renderer가 보는 것과 같은 request-scope
`container` identity를 포함하는 response-free view인 `ReactPageMetadataContext`를 받는다. `response` field를
제외한 것은 의도적이다. Metadata는 status, header, commit timing을 바꿀 수 없다.

기존 `ReactPageRenderer`와 HTTP response-value finalizer는 `ReactServerEntry` writing 전에 synchronous이므로
factory도 synchronous다. fluo는 DI로 factory를 instantiate하거나 token을 대신 resolve하지 않는다. Async
provider work가 필요한 data는 matched handler 또는 기존 HTTP lifecycle owner가 page composition 전에
load해야 한다. 이 결정은 async metadata loader를 추가하지 않는다.

### Bootstrap Diagnostics

Bootstrap은 metadata declaration에 기존 render-policy check를 적용한다.

- factory reference는 function이어야 한다.
- class declaration은 자신을 선언한 `@Router(...)` class에 있어야 한다.
- method declaration은 자신을 선언한 `@Path(...)` method에 있어야 한다.
- same-site duplicate는 deterministic하게 실패한다.
- configured `renderPage` 없이 metadata policy가 존재하면 기존
  `react-render-policy-missing-page-renderer` diagnostic으로 실패한다.

### Escaping and Serialization

`ReactPageMetadata`는 string title, `name`/`property` meta descriptor, optional `media`와 `type`을 가진
`rel`/`href` link descriptor로 제한한다. `createReactPageMetadataElements(...)`는 이 값을 ordinary React
`createElement(...)` call에 전달한다. 따라서 React의 일반 server-rendering contract가 title text와
attribute value를 escape한다.

Helper는 `dangerouslySetInnerHTML`, script descriptor, JSON transfer field, arbitrary tag, raw HTML escape
hatch를 노출하지 않는다. Vite manifest loading, CSS discovery, CSP policy, inline bootstrap serialization,
asset hosting은 application 또는 `@fluojs/react/vite` 책임으로 남는다.

### Renderer Consumption and Failure Phase

HTTP matching과 matched handler가 완료된 뒤 page-result finalizer가 metadata factory를 읽는다. Application
renderer는 같은 request-scoped context로 resolver를 호출하고 반환된 element를 document head에 배치할 수
있다. Explicit `ReactServerEntry`와 non-React handler value는 계속 모든 page policy를 우회한다.

Factory throw는 renderer가 entry를 반환하기 전이자 React shell creation과 response commit 전에 발생한다.
기존 React SSR diagnostic bridge와 HTTP error path가 관찰하는 `http-pipeline` failure로 남는다. Metadata는
이 error를 catch, translate, render하지 않는다.

## Rejected Generic Error Presentation

하나의 page decorator는 모든 error-shaped outcome을 정직하게 소유할 수 없다.

| Failure | Current owner | Why one render policy is invalid |
| --- | --- | --- |
| DTO, middleware, guard, interceptor, handler failure | HTTP dispatcher, filter, `onError`, error writer | Page renderer가 successful element를 받지 못할 수 있다. |
| Pre-commit React shell failure | React SSR renderer와 pre-commit diagnostic path | 같은 renderer에 fallback을 다시 진입시키면 recursion이 생길 수 있으며 별도 shell contract가 필요하다. |
| Post-shell recoverable render error | React renderer callback과 diagnostic | Status와 header가 이미 commit되었을 수 있어 새 document로 대체할 수 없다. |
| Request abort | Adapter와 HTTP/React cancellation path | Abort는 presentation request가 아니며 rendering을 다시 시작하면 안 된다. |
| Client React error | Application React error boundary | Hydration 이후 다른 runtime에서 발생하며 server request-scope DI lifetime이 없다. |

따라서 generic error policy에는 inheritance order, duplicate rule, request-context extension, DI integration,
renderer input, response rewrite가 없다. 향후 작업은 non-recursive application-owned pre-commit shell fallback
contract부터 phase-specific seam 하나씩 평가할 수 있다. Owner, retry behavior, diagnostic identity, commit
guarantee를 독립적으로 명시하기 전까지 해당 작업은 deferred 상태다.

## Rejected Page-local Not-found Presentation

Unmatched request에는 matched `HandlerDescriptor`, router class, method, inheritance chain, page renderer input이
없다. 따라서 page-local decorator에는 선택할 authoritative declaration이 없다. URL prefix에서 추측하거나
catch-all을 추가하면 HTTP-first model이 명시적으로 제외한 React matcher와 segment semantic이 생긴다.

Matched handler는 application lookup failure를 위해 `NotFoundException`을 throw할 수 있다. 이 outcome은
application `onError` 또는 일반 HTTP error writer가 처리하는 HTTP exception이며 successful React page
result가 되지 않는다. Route miss와 handler-thrown not-found 양쪽 모두 metadata factory, layout, Suspense
fallback, page renderer를 실행하지 않는다.

향후 HTML not-found presentation은 global error handling과 모든 adapter에 일관되게 제공되는 HTTP-owned
typed not-found outcome에서 시작해야 한다. React를 optional response representation으로 사용하기 전에
content negotiation, API/document selection, filter precedence, request scope, commit behavior를 정의해야
한다. 이는 page render policy가 아니라 별도 HTTP contract다.

## Preserved Contracts

- `PageLayout` order와 `SuspenseFallback` nearest-wins behavior는 바뀌지 않는다.
- `ReactRenderContext`와 request-scope container identity는 바뀌지 않는다.
- HTTP route grammar, matcher precedence, conflict, param, versioning, DTO binding, middleware, guard,
  interceptor, filter, not-found conversion, error writing은 바뀌지 않는다.
- Direct `ReactServerEntry`와 non-React value는 계속 application page renderer를 우회한다.
- Success metadata는 React shell creation 이후 buffered 또는 streaming response commit 직전에만 적용된다.
- SSR diagnostic code와 `http-pipeline`, `pre-commit-shell`, `request-abort`,
  `post-shell-recoverable` phase는 바뀌지 않는다.
- Runtime-neutral root는 Node.js, Vite, browser, RSC, `react-dom/server` eager import를 추가하지 않는다.

## Non-goals

- Next.js segment metadata, `generateMetadata`, `error`, `notFound`, file convention 없음
- URL-prefix ancestry, React matcher/tree/file routing, wildcard, catch-all behavior 없음
- HTTP, React shell, recoverable streaming, abort, client phase를 합치는 generic policy 없음
- client cache, SPA document swap, navigation persistence, loader, revalidation policy 없음
- RSC graduation, Server Function widening, Vite asset discovery, arbitrary inline serialization 없음
- metadata factory의 response status/header mutation 없음
- async metadata loader 또는 automatic DI instantiation 없음

## Verification Evidence

- Metadata unit test는 bootstrap validation, inheritance/factory order, title/meta/link composition, duplicate
  replacement, React escaping을 검증한다.
- Request-level test는 application renderer consumption, request-scope identity, missing renderer diagnostic,
  metadata factory의 response ownership isolation을 검증한다.
- Negative request test는 unmatched route와 handler-thrown `NotFoundException` response가 HTTP-owned 상태를
  유지하고 metadata factory 또는 page renderer를 호출하지 않음을 증명한다.
- 기존 `PageLayout`, `SuspenseFallback`, direct-page-return, SSR diagnostic, shell, recoverable error,
  request-abort, root-import, HTTP dispatcher suite는 regression baseline으로 유지한다.
