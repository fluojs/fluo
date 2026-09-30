# React starter composition 마이그레이션

<p><a href="./migrate-react-starter-composition.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

공식 `react-vite-ssr` starter는 이제 product와 search page에 같은 HTTP 선택 SSR,
초기 hydration, soft navigation 경로를 제공합니다. 기존 생성 앱은 자동으로 다시 쓰지
않습니다. Low-level `ReactElement`, `ReactServerEntry`, document navigation 경로는
계속 지원합니다.

기존 앱이 새 조립을 적용하려면:

1. 각 `@Path(...)` handler에서 기존처럼 HTTP DTO를 bind/validate합니다. JSON data로만
   구성된 `props` 하나를 만들고
   `ReactNavigationPage.create(createElement(Page, props), { module: './page-name.tsx', props })`
   를 반환합니다. Server-only service, DI instance, credential, secret은 props에서
   제외합니다.
2. Client에서도 렌더링할 수 있는 page를 기본 export component로
   `src/page*.tsx`에 둡니다. `src/entry-client.tsx`에서
   `import.meta.glob('./page*.tsx')`로 만든 importer map을
   `ReactClientRouterProvider`에 전달합니다. HTML streaming 전에 선택한 module이
   production Vite manifest 또는 development importer 집합에 있는지 확인합니다.
3. Application `ReactPageRenderer`의 선택적인 네 번째 인자
   `ReactInitialNavigationPage`를 받습니다. `json`은 inert
   `<script type="application/json" id="fluo-initial-page">` 안에 그대로 렌더링하고
   재직렬화하거나 executable inline JavaScript에 넣지 않습니다. Runtime이 HTML commit 전에
   props를 JSON으로 정규화하고 escape한 전송의 UTF-8 64 KiB 상한을 검사합니다. Browser
   entry는 `loadReactInitialNavigationDestination(json, modules, buildId)`로 script를 검증해
   반환된 component를 payload URL, params, props와 함께 hydrate합니다.
4. 공유 shell/provider를 provider의 destination page slot 밖에 두고 slot 안에는
   `destination ?? initialPage`를 렌더링합니다. 기존 provider에
   `failurePolicy={({ reason }) => reason === 'network' || reason === 'server-error' || reason === 'import-failure' || reason === 'incompatible-build' ? 'preserve' : 'document'}`
   를 전달하고 `useNavigation().failure` 및 `router.retry()`·`router.openDocument()`
   control은 destination slot 밖의 지속 셸에 둡니다. 기존 `Link`와 `useRouter()`는 승인된
   soft 이동을 수행하지만 direct GET, 이른 클릭, JavaScript 비활성화, 미지원 목적지는
   native document 경로를 유지합니다(없는 importer key 포함).

생성 앱의 `src/app.ts`, `src/entry-server.tsx`, `src/react-app.tsx`,
`src/entry-client.tsx`에 이 연결의 실행 가능한 예제가 있습니다. 일반 page를 추가할 때
뒤의 세 파일을 고치거나 다른 route matcher를 만들 필요는 없습니다. 생성 starter는 일시적
실패 보존을 기본으로 선택하지만 기존 앱은 4단계의 정책과 control을 명시적으로 추가해야
합니다. 정책 없는 low-level provider는 실패 시 document를 로드합니다. 이 이전은 #3873의
soft revalidation, #3874의 form 확장이나 stable RSC를 암묵적으로 opt-in하지 않습니다.

생성 앱에서 `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm start`,
`pnpm test:browser`를 확인하세요. Browser test는 direct HTML hydration과 각 soft
이동의 `Accept: application/vnd.fluo.react-navigation+json;v=2` request를 확인합니다.
기존 v1 설치에는 manifest build 식별자와 asset 보존 조건이 추가되므로
[프로덕션 asset 이주](./migrate-react-production-assets.ko.md)를 확인하세요.

## 관찰한 작성 부담

깨끗하게 생성한 프로젝트의 둘째 검색 page는 `src/page-search.tsx`와 `src/app.ts`의
`SearchPageRequest`/`SearchPageRouter`를 사용합니다. `q` query는
`@FromQuery('q')`와 `@RequestDto(...)`가 bind/validate하며 client에서 DTO interface를
복제하지 않습니다. 소비자 실험에서는 native save form과 editor guard를 가진 셋째
note page를 추가했습니다. 두 page starter와 비교해 손댄 source file은 정확히 세
개였습니다: `src/app.ts`(새 path/body DTO, HTTP GET/POST, guard, 등록),
`src/page-note.tsx`(새 page와 native form), `src/page.tsx`(note로 이동하는 선택적 link).
renderer, client entry, manifest, router store, generated type file 수정은 **0개**였습니다.
Page는 JSON props를 `Record<string, unknown>`으로 받아 사용 지점에서 필드를 좁힙니다.
#3880의 후속 typed projection을 위해 다른 authoring 경로나 unsafe cast가 필요하지 않습니다.

독립 생성 소비자 앱에서 `pnpm typecheck && pnpm build`가 exit code `0`으로 끝났고,
Chrome case 다섯 개가 기존 두 page, HTTP 승인 셋째 page, guard 거절/validation 실패
및 JavaScript 비활성화 상태의 인가된 native `POST` → `303` → `GET`을 통과했습니다.
추가 Chrome HTTP probe 두 개에서는 HTML을 깨는 검색 입력을 전송해 초기 script가
literal closing-script 주입 없이 JSON data를 보존함을 확인했고, 크기 상한 초과
destination이 shell commit 전에 HTML이 아닌 `500`을 반환함을 확인했습니다.
이는 작성 부담 실험이며 내장 auth 또는 enhanced form 정책을 약속하지 않습니다.
Identity, persistence, validation message는 여전히 application이 구현하며 공식
form/auth 조립은 #3874/#3875가 소유합니다.
