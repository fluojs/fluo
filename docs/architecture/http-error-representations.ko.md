# HTTP Error Representation Decision

<p><a href="./http-error-representations.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

- Status: Accepted
- Decision date: 2026-08-03
- Issue: [#2889](https://github.com/fluojs/fluo/issues/2889)
- Predecessor: [React Page Render Policy Decision](./react-page-render-policies.ko.md)

## Decision Summary

`@fluojs/http`가 error classification, `Accept` negotiation, status, header, request scope,
abort/commit check, `HEAD` body suppression, 최종 response write를 소유한다. Application은
`errorRepresentation.html`을 통해 optional HTML provider 하나를 등록할 수 있다. Canonical JSON은
framework-owned default이자 compatibility representation으로 유지된다.

이 seam은 HTTP가 기존 `HttpException` 또는 unmatched route의 `HandlerNotFoundError`를 분류한 뒤에만
적용된다. React 및 다른 document renderer는 선택된 HTML representation의 byte를 만들 수 있지만 URL을
match하거나 status를 선택하거나 header를 변경하거나 response를 commit하지 않는다.

## Public Contract and Registration

`CreateDispatcherOptions.errorRepresentation`과
`BootstrapApplicationOptions.errorRepresentation`은 `HttpErrorRepresentationOptions`를 받는다.

```ts
interface HttpErrorRepresentationOptions {
  readonly html: HtmlErrorRepresentationProvider;
}

interface HtmlErrorRepresentationProvider {
  canRender?(context: HttpErrorRepresentationContext): boolean | Promise<boolean>;
  render(context: HttpErrorRepresentationContext): string | Uint8Array | Promise<string | Uint8Array>;
}
```

`canRender(...)`는 optional application/route constraint다. 생략하면 HTML을 사용할 수 있다. `false`를
반환하면 해당 outcome의 offer에서 HTML을 제거한다. 두 provider method 모두 async일 수 있으며 active
dispatch lifetime 안에서 실행된다.

`HttpErrorRepresentationContext`는 다음 값을 포함한다.

- 분류된 `HttpException`
- canonical JSON `ErrorResponse`
- 정규화된 `FrameworkRequest`와 optional request id
- active request-scope container
- failure 전에 matching이 성공했다면 matched `HandlerDescriptor`

Context는 의도적으로 `FrameworkResponse`를 제외한다. Provider는 request-scoped application dependency를
resolve할 수 있지만 status, header, body suppression, commit authority는 HTTP가 유지한다. Unmatched route에는
`handler`가 없다. React page descriptor, page catalog, layout, metadata, Suspense fallback, URL-prefix ancestry를
조회하지 않는다.

## Classification and Phase Boundaries

| Failure | Representation behavior |
| --- | --- |
| Unmatched method/path | HTTP matcher가 `HandlerNotFoundError`를 throw하고 negotiation 전에 기존 `NotFoundException` outcome으로 변환한다. |
| Middleware, DTO binding/validation, guard, interceptor, handler의 uncommitted `HttpException` | 원래 pipeline phase와 matched-handler identity를 보존한 뒤 같은 HTTP-owned negotiation을 사용한다. |
| 알 수 없는 throw 값 | Masked canonical JSON `500 INTERNAL_SERVER_ERROR`로 유지되며 HTML representation eligible로 재분류하지 않는다. |
| React pre-commit shell failure | React SSR pre-commit diagnostic과 canonical JSON 500 path를 유지하며 HTML error provider에 다시 진입하지 않는다. |
| React post-shell recoverable error | Shell이 이미 commit되었을 수 있으므로 diagnostic-only로 유지한다. |
| Request abort | Representation work를 시작하거나 재시작하지 않고 fallback commit 없이 중단한다. |
| Client React error | Hydrated application과 browser runtime이 계속 소유한다. |

설정된 runtime exception filter와 dispatcher `onError`는 default writer보다 먼저 실행된다. 이들이 처리하거나
response를 commit하면 representation provider를 호출하지 않는다.

## Deterministic `Accept` Negotiation

Eligible outcome에 HTML provider가 등록되어 있으면 HTTP는 canonical `application/json`과 조건부
`text/html`을 offer한다.

| Request | Result |
| --- | --- |
| `Accept` 없음 | Canonical JSON. |
| `application/json` | Canonical JSON. |
| `text/html` | `canRender`가 없거나 `true`면 HTML. 그렇지 않으면 JSON도 허용될 때 canonical JSON, 허용되지 않으면 JSON `406`. |
| Weighted range | 가장 높은 quality가 우선한다. 가장 specific한 matching range가 각 offer의 quality를 결정한다. |
| 같은 quality와 specificity | Deterministic server tie에서 canonical JSON이 우선한다. |
| `*/*` | 두 representation이 tie이므로 canonical JSON이 우선한다. |
| Specific `q=0` range와 broader wildcard | 해당 media type에는 specific rejection이 우선한다. HTML이 reject되면 HTML provider를 조회하지 않는다. |
| Acceptable offer 없음 | Canonical JSON `406 NOT_ACCEPTABLE`. 406을 위해 HTML provider를 재귀 호출하지 않는다. |

Successful-route `@Produces(...)` metadata와 `ContentNegotiationOptions`는 error representation ownership을
부여하지 않는다. Error availability는 provider의 `canRender(...)` constraint를 통해 application이 소유한다.

## Response Commit and Fallback Rules

1. HTTP는 classification, provider work, write 전에 abort와 `response.committed`를 검사한다.
2. JSON write는 status, code, message, details, metadata, request id를 포함한 canonical `ErrorResponse`를
   보존한다.
3. Negotiated response는 `Content-Type`을 설정하고 기존 `Vary` 값을 제거하지 않은 채 `Accept`를 추가한다.
4. HTML provider는 trusted complete document text 또는 byte만 반환한다. Application은 request-derived 및
   error-derived content를 escape하거나 sanitize해야 한다. HTTP는 provider output을 다시 쓰지 않고 classified
   status와 `text/html; charset=utf-8`을 적용한다.
5. `HEAD`는 선택된 status/header를 유지하고 `render(...)`를 호출하지 않으며 body를 보내지 않는다.
6. 이미 committed된 response는 절대 다시 쓰지 않는다.
7. `canRender(...)` 또는 `render(...)`가 commit 전에 throw하면 configured dispatcher logger가 provider
   failure를 기록하고 HTTP는 원래 canonical JSON outcome으로 한 번만 fallback한다. Fallback은
   representation selection을 우회하므로 재귀할 수 없다.
8. Provider work 중 request가 abort되면 provider failure를 log하거나 fallback response를 commit하지 않는다.
9. Response writer `send(...)` 또는 stream/write failure는 provider failure가 아니다. HTML body나 canonical JSON
   fallback을 retry하지 않고 그대로 propagate한다.

## React Integration

`@fluojs/react`는 application `ReactErrorDocumentRenderer`를 HTTP provider seam에 연결하는 optional adapter
`createReactErrorRepresentationProvider(...)`를 노출한다. 이미 분류된 context를 받아 하나의
`ReactServerEntry`를 만들고 complete Web Stream을 buffer한 뒤 HTTP에 byte를 반환한다.

Adapter는 `ReactServerEntry.status`와 `ReactServerEntry.headers`를 무시한다. 이 field는 successful page
response용이며 HTTP error outcome을 override할 수 없다. Matching을 수행하지 않고 application page renderer나
route-local render policy를 호출하지 않는다. Root는 runtime-neutral 상태를 유지한다. `react-dom/server`는
lazy하게 resolve되며 Node.js, Vite, browser, matcher, RSC, file-routing dependency를 추가하지 않는다.

## Preserved Contracts and Non-goals

- Canonical JSON은 API client와 HTML provider 미등록 상태에서 변경되지 않는다.
- Route grammar, matching precedence, DTO binding, middleware, guard, interceptor, request scope, successful
  response negotiation, `onError` precedence는 변경되지 않는다.
- React-owned matcher, catch-all, file router, route tree, page-local `notFound()`, URL-prefix layout ancestry,
  SPA fallback, client cache, prefetch, RSC graduation을 추가하지 않는다.
- HTTP failure, React shell failure, post-shell recoverable error, request abort, browser error를 하나의 generic
  boundary로 합치지 않는다.
- Provider는 이미 committed된 response를 다시 쓰거나 abort 후 rendering을 재시작할 수 없다.

## Verification Evidence

- HTTP dispatcher test가 classification, JSON compatibility, weighted range, wildcard, specific `q=0`,
  constraint, 406, provider failure, `HEAD`, abort, commit guard, request scope를 검증한다.
- React integration test가 buffered document, 무시되는 entry status/header, unmatched-route ownership,
  route-policy isolation, provider failure fallback, shell-phase separation을 검증한다.
- Shared network/Web portability harness가 Node.js, Express, Fastify, Bun, Deno, Cloudflare Workers에서 JSON,
  HTML, `HEAD`, 406, already-committed response 동작을 검증한다.
