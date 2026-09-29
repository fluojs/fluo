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

Identity에 영향을 받지 않는 page에 한해서 handler는
`ReactNavigationPage.create(page, { module, props }, { prefetch: 'public' })`로 speculative
reuse를 허용할 수 있습니다. Optional 세 번째 인자는 사용자, 인증, cookie 및 다른 모든 request
identity에 대해 representation이 동일하다는 application의 명시적 선언입니다. 생략하면 기존
private 기본값을 유지합니다.

## Negotiation and result

Client는 정확히 `Accept: application/vnd.fluo.react-navigation+json;v=1`을 포함한 GET을
보냅니다. 성공한 opt-in page에서 HTTP는 해당 media type의 JSON을 반환합니다. Host는 `v`
parameter를 `"1"`로 직렬화하고 `charset=utf-8`을 추가할 수 있습니다. HTTP는 기존 `Vary`에
`Accept`를 추가하고 `Set-Cookie`와 다른 header를 유지합니다. 일반 navigation은
`prefetch: 'public'`을 선언한 page여도 기존 `Cache-Control`에 `private, no-store`를 더하며
credential을 포함한 일반 결과를 재사용하지 않습니다. `Cookie`와 `Authorization` 없이
요청한 명시적 public page만 최종 status-`200` negotiated response에서
`X-Fluo-Navigation-Prefetch: public`, `Cache-Control: public, max-age=15`,
`Vary: Accept`를 받을 수 있습니다. 최종 response에 **`Set-Cookie`가 없고** 기존
**`Cache-Control` directive가 하나도 없으며** 기존 **`Vary`에는 `Accept` 이외의 값이
없어야** HTTP가 grant합니다. 조건을 만족하지 않으면 application restriction을 덮어
eligibility를 만들지 않고 기존 `private, no-store` policy를 유지합니다. 기존 `public`,
`private`, `no-store`, `Vary: Cookie` 또는 `Vary: *`, request credential, redirect, error는
재사용을 거부합니다. HTML, `HEAD`, 다른 method에는 navigation-prefetch grant가 없습니다.
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
  },
  "metadata": {
    "title": "Product sku-84",
    "meta": [{ "name": "description", "content": "Product sku-84" }],
    "links": [{ "rel": "canonical", "href": "/products/sku-84?preview=false" }]
  }
}
```

`url`과 `params`는 client parsing이 아니라 matching 이후 활성 HTTP request에서 나옵니다.
선택적 `metadata`는 동일한 matched page의 `@PageMetadata(...)` factory를 broad-to-specific
순서로 request scope에서 해석하여 일반 document transfer와 협상된 JSON에 함께 전달합니다.
Page-owned subset은 최대 512자 title, 최대 32개 `name`/`property` meta 및 최대 32개
`rel`/`href` link descriptor이며 각 값은 최대 2048자입니다. Link href는 root-relative
또는 HTTP(S)이고 중복 identity와 잘못된 값은 HTTP commit 또는 browser import 전에 거부합니다.
초기 escaped transfer는 계속 UTF-8 64 KiB 상한을 따르며 opt-in하지 않은 page에는
metadata가 자동으로 생기지 않습니다.
`props`는 application이 제공한 JSON-serializable data여야 합니다. Serialization 실패는
navigation response commit 전에 발생하고 기존 canonical HTTP error path를 따릅니다.
Request-scoped dependency는 response write가 끝날 때까지 살아 있고 일반 dispatcher가
dispose합니다. Opt-in된 일반 document GET에서는 page renderer가 선택적인 네 번째 인자
`ReactInitialNavigationPage`도 받습니다. HTTP가 확정한 URL, matched params, module,
JSON으로 정규화한 props와 inert `application/json` script용 `json`을 포함합니다.
서버는 `<`, `>`, `&`, U+2028, U+2029를 escape한 뒤 UTF-8 64 KiB 상한을 검사합니다.
직렬화 불가 또는 초과 data는 HTML commit 전에 기존 HTTP error response로 실패합니다.
Application renderer는 로드한 Vite manifest(개발 중에는 build importer 집합)에서 선택된
module을 확인한 뒤 escaped transfer를 포함합니다. Browser component graph/props에는
DI instance, secret 또는 server-only import를 넣지 않습니다. Browser는 이어지는
`Link`/`useRouter` navigation과 동일한 build-produced importer map을
`loadReactInitialNavigationDestination(json, modules)`에 전달합니다. 두 번째 HTTP request나
client URL matcher 없이 URL, params, module과 component를 hydration 전에 검증합니다.
생성 starter의 단일 provider는 초기 page와 이후 destination을 공통 shell과 page slot에
합성합니다. Shell은 유지되고 destination-local state는 slot에서 reset됩니다. 일반
`ReactElement` 또는 explicit `ReactServerEntry`에는 자동 transfer가 붙지 않습니다.
일반 document GET의 HTML Web Stream은 React가, sink는 HTTP가 소유합니다.
실패하거나 abort된 rendering은 buffered HTML 일부를 commit하지 않으며 sink가 일찍 닫히거나
write가 실패하면 unfinished reader를 cancel하고 lock을 해제합니다.

정확한 Accept 값이 없으면 direct GET과 JavaScript-disabled GET을 포함해 기존 HTML shell과
hydration asset을 stream합니다. 대체 representation이 있는 성공 HTML은 `Accept`에 따라
달라질 수 있음을 알립니다. `HEAD` 및 다른 method는 navigation representation을
선택하지 않습니다. 기존 HTML error/not-found negotiation과 canonical JSON error는 계속
HTTP가 소유합니다. Error document를 page payload로 파싱하면 안 됩니다.

## Browser consumption and fallback

`@fluojs/react/client`의 `loadReactNavigationDestination(href, modules, { signal? })`는
same-origin HTTP(S)만 받습니다. 각 일반 load는 `credentials: 'same-origin'`, `cache: 'no-store'`,
`redirect: 'manual'`, 명시적 Accept header로 매번 uncached request 하나를 보냅니다.
`Set-Cookie`를 포함한 browser cookie 처리는 browser에 맡기며 cache eligibility 판단에
browser-visible `Set-Cookie`를 사용하지 않습니다(Fetch가 이 header를 숨깁니다).
일반 navigation response는 저장하지 않습니다. Import/render 전에 status, media type,
protocol version, server-confirmed
same-origin URL, string path param, JSON object props, 제공된 build-produced importer map의 module
key를 검증합니다. 로드한 module의 default export도 렌더링 가능한 component인지 확인한
뒤에만 성공으로 보고합니다. Malformed JSON, 지원하지 않는 version/module/URL, 예상 밖
media type, network error, redirect, 404, 401/403, DTO failure, server failure에는 구분
가능한 application-owned full-document fallback 사유를 반환합니다. 취소는
`cancelled`를 반환하며 response body를 읽는 동안 발생한 경우에도 import, rendering 또는
fallback navigation을 시작하지 않습니다. 외부 또는
non-HTTP(S) URL은 fetch 전에 거부하므로 일반 anchor를 사용하세요.
#3864의 별도 opt-in failure policy는 **매핑된** importer의 로드 실패를 일시적
network/server 오류와 함께 `import-failure`로 보존하고 이 page slot 밖에 fresh retry와
명시적 document exit를 표시할 수 있습니다. 알 수 없는 importer key는 계속
`unsupported-module`로 document 경로를 따릅니다. 두 경우 모두 승인된 React render
throw가 아닙니다.

Browser는 React-owned HTML을 교체하거나 path param을 추측하거나 route matcher를 설치하지
않습니다. Build-produced importer를 `ReactClientRouterProvider`의 `navigationModules`로 전달하고
function child의 승인된 destination을 application 소유 page slot의
`ReactNavigationExperience`로 렌더링하세요. 공식 조립은 opt-in이며 package 설치만으로
low-level provider의 navigation effect는 달라지지 않습니다. Pending status는 destination
boundary 밖에 표시되며 마지막 승인 page, URL, params, head는 그대로 둡니다. 승인된
destination의 React render throw는 이미 commit한 URL/params와 shell을 유지하고 keyboard로
조작 가능한 page-local reset을 제공합니다. Reset은 HTTP request/history entry를 추가하지
않습니다. Application 오류 view도 throw하면 별도 외부 diagnostic/document exit가 표시됩니다.
복구 불가능한 shell/root 오류나 browser 종료 뒤의 shell 보존은 보장하지 않습니다.
같은 조립은 승인 snapshot의 page-owned title/meta/link만 갱신·제거하고 bootstrap, icon,
global stylesheet는 소유하지 않습니다. Polite live region은 pending, 완료, 실패를 알립니다.
Page-owned metadata를 SSR과 soft navigation에서 `<head>`로 옮기는 이 조립에는 React 19와
React DOM 19가 필요합니다. 더 넓은 React 18 peer 범위는 다른 패키지 API에 적용되며 이
head reconciliation을 보장하지 않습니다.
Pathname push/replace는 scroll 없는 `<main>` focus 뒤 상단으로 이동하고, query-only는
focus하면서 scroll을 유지하며, fragment-only는 native fragment scrolling을 유지하고 적합한
target에 focus합니다. Back/forward는 browser 복원 scroll을 보존하면서 `<main>`을 focus합니다.
`onApprovedNavigation`으로 이 동작을 application policy로 교체할 수 있습니다. Pending 및
승인 실패는 focus/scroll을 움직이지 않습니다. 기존 `Link`와
`router.push/replace`는 URL 변경 전에 HTTP 결과를 요청합니다. 성공하면 provider가 서버가
확정한 URL과 params를 History API 및 모든 route hook에 반영하고 목적지 component를 새로
mount하며 공통 provider/layout은 유지합니다. 실행 가능한 예제는 shell state를 유지하고
destination-local state를 초기화합니다.

`popstate`와 forward traversal은 매번 HTTP 승인을 다시 요청하고 이전의 private payload나
오래된 params를 새 URL에 재사용하지 않습니다. 새로운 activation 또는 unmount 이후 늦게
도착한 결과는 commit하지 않습니다. 진행 중인 같은 목적지를 다시 활성화해도 request는
늘어나지 않습니다. Fragment-only 변경은 browser의 native same-document history를 사용합니다.
정책에 opt-in하지 않은 실패 또는 미지원 load는 추측한 soft URL을 commit하지 않고 full-document
`assign`/`replace`를 사용합니다. History traversal은 browser URL이 이미 바뀐 뒤이므로 실패
시 해당 문서를 로드합니다. 취소는 fallback을 시작하지 않습니다. Hydration 전 `Link`는
native anchor로 남고 initial request snapshot은 browser path/search와 일치해야 합니다.
Soft destination이 있으면 `refresh()`도 같은 일반 loader를 사용합니다. Opt-in하지 않은 `Link`, `router.push/replace`,
거부된 prefetch에는 기존 credential 포함 일반 loader와 full-document fallback을 적용합니다.

`ReactClientRouterProvider`는 선택적인 `failurePolicy(failure)`를 받으며 동기 또는 비동기로
`'preserve'`나 `'document'`를 반환합니다. 지정하지 않으면 low-level 기본값은 기존 document
fallback입니다. `useNavigation().failure`와 정책에는 `reason`, query·응답 본문·credential·예외
내부를 제거한 목적지 **pathname**, `type: 'push' | 'replace' | 'back' | 'refresh'`만 전달합니다.
사유는 `network`, `server-error`(HTTP 5xx), `unauthorized`(401), `forbidden`(403),
`redirect`, `not-found`(404), `dto-rejected`(400/422), `invalid-payload`,
`unsupported-module`, `import-failure`, `unavailable`(그 밖의 미지원 응답),
`unsupported-destination`으로 구분합니다. 취소는 정책을 호출하지 않습니다. Network/5xx는
앱이 보존할 수 있지만 인증 거절·redirect·404·DTO·invalid payload는 앱이 명시적으로 달리
결정하지 않으면 document 이동입니다. 복구 가능한 import 실패도 앱의 명시적 보존 결정이
필요합니다. Status와 인증 판정은 응답 본문이 아닌 HTTP가 소유합니다.

보존하면 마지막 승인 page, shell, params를 유지하고 push/replace는 history entry를 만들지
않으며 `useNavigation()`은 조치 가능한 `error`로 정착합니다. 실패한 back/forward는 기록된
history 위치로 되돌아가 중복 entry 없이 승인 URL과 화면을 다시 일치시킵니다. 위치를 알
수 없는 traversal은 URL/화면 불일치를 방치하지 않고 document fallback을 사용합니다.
`router.retry()`는 실패한 목적지를 새 credential 포함 uncached HTTP 요청으로 승인받고,
`router.openDocument()`는 명시적으로 일반 문서로 이동합니다. 최신의 완전한 승인만 URL,
params, 목적지 local state를 변경할 수 있습니다. 무효화되거나 뒤처진 응답·정책 결정은
commit/fallback할 수 없습니다. 정책 callback의 throw/rejection은 진단을 남기고 안전한
`application-error` 상태로 정착하며 전역 unhandled rejection이나 두 번째 자동 fallback으로
번지지 않습니다. 인증/session 전환의 실패 UI와 자원 종료는 앱 정책이고 logout/reload/탭
종료 뒤 재생은 보장하지 않습니다.

Low-level provider는 기본적으로 document fallback을 유지합니다. 공식 생성 starter는
network/5xx 및 복구 가능한 매핑된 import 실패의 보존 정책을 명시적으로 선택하며
HTTP가 선택한 page slot 외부의 지속 셸에 재시도·문서 이동 control을 렌더링합니다.
`router.refresh(): Promise<ReactRevalidationResult>`는 현재 pathname/query를
same-origin credential, `no-store`, manual redirect로 다시 요청합니다. Public prefetch와
이전 private payload는 사용하지 않습니다. `useNavigation()`이 `refreshing`, type
`refresh`인 동안 마지막 승인 page·params·fragment·shell·page-local state를 유지합니다.
HTTP 승인이 성공하면 새 props/params를 반영해 `complete`를 게시하고 새 activation key로
page-local state를 remount합니다. History에는 push/replace하지 않고 provider와 shell
resource는 유지합니다. `complete`는 navigation store commit 시점이며 browser paint나
application component 렌더 성공 보장은 아닙니다.
refresh가 승인 전 back/forward activation을 대체하면 먼저 승인된 history entry로
복원한 뒤 해당 page를 다시 요청합니다. 보존 실패는 이동된 URL 아래에 승인 page
data를 표시하거나 forward/back entry 순서를 바꾸지 않습니다. 반환 결과는
`{ status: 'complete' }`, `{ status: 'error', failure }`, `{ status: 'cancelled' }`,
`{ status: 'document' }`이며 마지막 값은 문서 fallback 시작이지 로드 완료가 아닙니다.
안전한 failure의 type은 `refresh`입니다. 보존 실패는 이전 page를 유지하고 `error`를
게시하며 같은 page에 새 HTTP 승인을 요청하는 `retry()`와 `openDocument()`를 제공합니다.
기본 fallback은 현재 URL의 문서를 reload합니다. 새 navigation, 연속 refresh, mutation
invalidation, unmount, provider session-epoch 변경은 이전 작업을 abort하고 loader나
비동기 정책이 응답하지 않아도 Promise를 `cancelled`로 정착시킵니다. 후속 작업 없는
취소는 `idle`입니다. Mutation 후 이전 작업을 무효화하려면 refresh 전에
`invalidate()`를 호출하세요. Invalidation 자체는 표시 중인 데이터를 다시 요청하지
않습니다. Soft destination이 없는 page는 일반 문서를 reload합니다. 이전의 확정적
document reload가 필요한 소비자는 `window.location.reload()`를 사용합니다.
[EN migration](../getting-started/migrate-react-refresh.md)과
[KO migration](../getting-started/migrate-react-refresh.ko.md)을 참고하세요. 이는
component state를 보존할 수 있는 개발 중 React Fast Refresh와 다릅니다.
위의 #3872 승인 page render reset은 transport를 재시도하지 않습니다. 공식
`router.retry()`와 `router.openDocument()` control은 page slot 밖의 공통 shell에 표시합니다.

## Opt-in public prefetch와 provider-local cache

`Link prefetch="hover"` 또는 `Link prefetch="viewport"`만 speculative load를 시작하며 생략하면
off입니다. `ReactClientRouterProvider`에는 기존 `navigationModules`와 application이 auth/session
epoch마다 변경하는 명시적 `prefetchScope` 문자열을 함께 전달해야 합니다. 별도 consumer prefetch
API는 없습니다. Hydration 이전, JavaScript 비활성화, 두 provider 입력 중 하나가 없는 경우,
외부/미지원 목적지, 부적합한 anchor(modified/new-tab/download), fragment-only 변경은
prefetch하지 않습니다. 적합한 hydrated Link의 hover는 pointer 진입 시, viewport는 intersection
진입 시 시작하고 exit 시 취소합니다. Click adoption 이전 hover leave는 해당 기회를 취소합니다.
동일 key의 동시 작업은 합쳐지고, 적합한 click은 진행 중인 prefetch를 추가 GET 없이 이어받을
수 있습니다. Adoption 이후 hover leave는 navigation을 취소할 수 없습니다. 취소되거나 실패한
speculation 자체는 URL/params를 commit하거나 document fallback을 시작하지 않습니다.

Speculation은 기존 navigation Accept를 사용하며 same-origin HTTP(S) GET에
`credentials: 'omit'`, `cache: 'no-store'`, `redirect: 'manual'`을 설정합니다. Browser는
명시적인 `X-Fluo-Navigation-Prefetch: public`과 호환되는
`Cache-Control: public, max-age=15`, `Vary: Accept` 및 status `200`을 확인한 후 요청한
pathname/query와 일치하는 version-`1` JSON, server params/props, build-produced importer
map에서 로드 가능한 component를 모두 검증한 결과만 cache에 넣습니다. 이는 server가
identity 독립성을 선언한 public representation이지 인증된 결과를 추측한 것이 아닙니다.
Browser-visible `Set-Cookie`는 검사하지 않습니다. HTML, error, redirect, 지원하지 않는
module, grant 없는 결과는 cache에 넣지 않습니다.

Provider가 소유하는 완료 cache는 origin, 정규화된 pathname/query(fragment 제외),
representation version, `prefetchScope`를 key로 하고 **한 번만 사용**합니다. 최대 32개
LRU entry이며 각 JSON은 최대 64 KiB입니다. 초과 body는 취소합니다. Concurrent prefetch는
최대 4개이고 초과 opportunity는 대기시키지 않고 건너뜁니다. Entry 만료는 전체 validation과
import 완료 후 15초 **및** 남은 server freshness 중 빠른 시점입니다. Grant한 `max-age`에서
유효한 음수 아닌 `Age`를 빼고 15초로 제한하며 malformed 또는 소진된 freshness는 거부합니다.
Validation/import 시간으로 server freshness가 새로 시작되지는 않습니다. 성공한 opt-in
click은 entry를 제거하고, 재방문·back/forward·refresh는 새 HTTP 승인을 받아야 합니다.
Unmount/disconnect, scope 변경, `router.invalidate()`, 이전 activation을
대체하는 이동은 진행 중인 작업을 abort하고 무효 entry를 지웁니다. 진행 중인 soft navigation을
취소하는 invalidation은 커밋된 route를 유지한 채 idle lifecycle을 발행하며 history 기록이나
document fallback을 시작하지 않습니다. 다만 index 없는 back/forward activation이 이미 browser
URL을 이동시켰다면 기존 entry에 일반 문서를 불러오며 새 history entry를 추가하거나
승인되지 않은 URL에 이전 page를 idle로 정착시키지 않습니다. In-document mutation이나 auth 변경 후에는 다음
same-document navigation **이전에** application이 `prefetchScope`를 갱신하거나
`router.invalidate()`를 호출해야 합니다. 전체 문서 이동은 cache를 파기합니다.
외부 `HttpOnly` cookie 변경은 자동으로 감지하지 않으므로 notification 누락 시에도 opt-in
public page는 identity에 영향을 받지 않아야 합니다.

## Evidence and limits

`packages/react/src/navigation-payload.test.ts`는 실제 HTTP dispatcher, URI version, DTO binding,
guard, interceptor, middleware, scope, redirect, error, cancellation, header 경계를 실행합니다.
`packages/react/src/client-navigation-payload.test.ts`는 browser parsing, cookie-bearing request,
rejection, non-reuse, cancellation을 실행합니다. `packages/react/src/client.test.ts`는
public router store의 history, stale result, fallback을
검증합니다. `examples/react-vite-ssr/src/app.test.ts`는 DTO validation을 검증하고 이 테스트와
`examples/react-vite-ssr/tests/production-hydration.spec.ts`는 manifest-bound destination,
browser rendering, 일반 HTML 및 JavaScript-disabled document 동작을 실행합니다.
`packages/http/src/dispatch/dispatch-response-policy.test.ts`와
`packages/http/src/dispatch/dispatcher.test.ts`는 final response grant의 허용·거부를 검증합니다.
이 stable SSR/Vite representation은 JSON과 build된 client component이지 experimental Flight, 일반
React tree serializer 또는 file-routing contract가 아닙니다.
