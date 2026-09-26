# React Navigation Payload Contract

<p><a href="./react-navigation-payload.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Scope and ownership

`@fluojs/react`는 handler가 `ReactNavigationPage.create(page, { module, props })`를 반환하는
HTTP-matched `@Path(...)` GET에 opt-in representation을 제공합니다. 일반 결과는 계속
`ReactModule.forRoot({ renderPage })`를 거친 streamed React document입니다. `module`은
application이 지정한 browser module identity입니다. Application은 로드한 Vite manifest에서
해당 destination을 확인하고 browser에 build-produced `import.meta.glob(...)` importer map을
제공합니다. URL pattern, 조립한 dynamic import URL 또는 React matcher가 아닙니다. Root
entrypoint는 Vite나 browser code를 import하지 않습니다.

HTTP는 route matching, URI/version selection, middleware, DTO materialization/validation,
guards, interceptors, request-scoped provider, response header, status, error negotiation, abort,
final write를 소유합니다. Plain handler value, error, unmatched route, redirect, opt-in하지 않은
React page에서는 navigation payload를 만들지 않습니다. Representation protocol version `1`은
HTTP route URI version과 별개입니다.

## Negotiation and result

Client는 정확히 `Accept: application/vnd.fluo.react-navigation+json;v=1`을 포함한 GET을
보냅니다. 성공한 opt-in page에서 HTTP는 해당 media type의 JSON을 반환합니다. Host는 `v`
parameter를 `"1"`로 직렬화하고 `charset=utf-8`을 추가할 수 있습니다. HTTP는 기존 `Vary`에
`Accept`를 추가하고 `Set-Cookie`와 다른 header를 유지하며 기존 `Cache-Control`에
`private, no-store`를 더합니다. 특히 cookie나 인증의 영향을 받는 navigation result는
client 또는 중간 cache가 재사용하면 안 됩니다.
Configured page renderer의 entry status와 header는 일반 document와 협상된 결과에 모두
적용됩니다. 협상된 결과를 위해 HTML stream을 열지 않습니다. Renderer status가 `404`처럼
2xx가 아니면 browser helper는 이를 거부하고 full-document fallback을 선택합니다.

```json
{
  "version": 1,
  "url": "/products/sku-84?preview=false",
  "params": { "sku": "sku-84" },
  "destination": {
    "module": "./navigation-product.ts",
    "props": { "sku": "sku-84", "preview": false }
  }
}
```

`url`과 `params`는 client parsing이 아니라 matching 이후 활성 HTTP request에서 나옵니다.
`props`는 application이 제공한 JSON-serializable data여야 합니다. Serialization 실패는
navigation response commit 전에 발생하고 기존 canonical HTTP error path를 따릅니다.
Request-scoped dependency는 response write가 끝날 때까지 살아 있고 일반 dispatcher가
dispose합니다. 일반 document GET의 HTML Web Stream은 React가, sink는 HTTP가 소유합니다.
실패하거나 abort된 rendering은 buffered HTML 일부를 commit하지 않으며 sink가 일찍 닫히거나
write가 실패하면 unfinished reader를 cancel하고 lock을 해제합니다.

정확한 Accept 값이 없으면 direct GET과 JavaScript-disabled GET을 포함해 기존 HTML shell과
hydration asset을 stream합니다. 대체 representation이 있는 성공 HTML은 `Accept`에 따라
달라질 수 있음을 알립니다. `HEAD` 및 다른 method는 navigation representation을
선택하지 않습니다. 기존 HTML error/not-found negotiation과 canonical JSON error는 계속
HTTP가 소유합니다. Error document를 page payload로 파싱하면 안 됩니다.

## Browser consumption and fallback

`@fluojs/react/client`의 `loadReactNavigationDestination(href, modules, { signal? })`는
same-origin HTTP(S)만 받습니다. `credentials: 'same-origin'`, `cache: 'no-store'`,
`redirect: 'manual'`, 명시적 Accept header로 매번 uncached request 하나를 보냅니다.
`Set-Cookie`를 포함한 browser cookie 처리는 browser에 맡깁니다. Helper는 response를 저장하거나
prefetch하지 않습니다. Import/render 전에 status, media type, protocol version, server-confirmed
same-origin URL, string path param, JSON object props, 제공된 build-produced importer map의 module
key를 검증합니다. 로드한 module의 default export도 렌더링 가능한 component인지 확인한
뒤에만 성공으로 보고합니다. Malformed JSON, 지원하지 않는 version/module/URL, non-HTML 또는
다른 예상 밖 media type, network error, redirect, 404, 401/403, DTO failure, server failure에는
application-owned full-document fallback을 위한 non-success result를 반환합니다. 취소는
`cancelled`를 반환하며 response body를 읽는 동안 발생한 경우에도 import, rendering 또는
fallback navigation을 시작하지 않습니다. 외부 또는
non-HTTP(S) URL은 fetch 전에 거부하므로 일반 anchor를 사용하세요.

Browser는 React-owned HTML을 교체하거나 path param을 추측하거나 `pushState`를 호출하거나
route matcher를 설치하지 않습니다. Application은 성공 시 import한 component를 명시적으로
렌더링하고 지원되는 same-origin load가 실패하면 `window.location.assign(href)`를 사용할 수
있습니다. `Link`와 `router.push/replace`는 기존 full-document navigation을 계속 수행합니다.
이 API를 soft transition, shared shell 및 route snapshot 갱신에 연결하는 작업은
[#3845](https://github.com/fluojs/fluo/issues/3845)의 범위입니다. Prefetch 또는 재사용 가능한
cache는 없습니다.

## Evidence and limits

`packages/react/src/navigation-payload.test.ts`는 실제 HTTP dispatcher, URI version, DTO binding,
guard, interceptor, middleware, scope, redirect, error, cancellation, header 경계를 실행합니다.
`packages/react/src/client-navigation-payload.test.ts`는 browser parsing, cookie-bearing request,
rejection, non-reuse, cancellation을 실행합니다. `examples/react-vite-ssr/src/app.test.ts`는
DTO validation을 검증하고 이 테스트와
`examples/react-vite-ssr/tests/production-hydration.spec.ts`는 manifest-bound destination,
browser rendering, 일반 HTML 및 JavaScript-disabled document 동작을 실행합니다. 이 stable
SSR/Vite representation은 JSON과 build된 client component이지 experimental Flight, 일반
React tree serializer 또는 file-routing contract가 아닙니다.
