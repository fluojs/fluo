# HTTP-first React 풀스택 제품 계약

<p><a href="./react-fullstack-product.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 범위와 수용 경계

이 문서는 운영 CRUD 앱(인증된 목록, 검색, 상세, 편집, 저장, 로그아웃)과 바 주크박스(노래, QR, 검색, 대기열 관리 사이에 유지되는 장기 셸 리소스)의 **목표** 제품 계약입니다. 새 기능이 이미 배포됐다는 뜻이 아닙니다. 완료된 [#2489 roadmap](https://github.com/fluojs/fluo/issues/2489)은 과거 API 마일스톤이고 [#3869](https://github.com/fluojs/fluo/issues/3869)는 추가 제품 수용 게이트입니다. 로드맵 순서는 출시 버전이나 1.0 승인이 아닙니다. API 테스트 통과나 hook export만으로 사용자 여정을 통과할 수 없습니다. 소비자가 별도의 renderer, router, cache, request-race framework를 작성하지 않고 과업을 마쳐야 합니다. [#3879](https://github.com/fluojs/fluo/issues/3879)는 공식 starter의 실제 dev/production browser에서 모든 필수 여정이 통과할 때만 제품 게이트를 닫습니다.

**선행 조건과 공개 진입점.** 생성된 Node.js + Fastify 앱에서 `fluo new my-react-app --starter react-vite-ssr`, `pnpm dev`, production `build`/`start` script를 사용합니다. HTTP page handler는 `@fluojs/react`의 `ReactModule.forRoot({ controllers, renderPage })`, `@Router`/`@Path`, 일반 `@fluojs/http` DTO 및 `@Post`를 사용합니다. Browser에는 `@fluojs/react/client`의 `Link`/`useRouter()`/`ReactClientRouterProvider`, application이 로드한 build manifest에는 `@fluojs/react/vite`를 사용합니다. 정확한 import와 설정은 [React API owner](../../packages/react/README.ko.md) 및 [CLI API owner](../../packages/cli/README.ko.md)를 참고하세요. #3871은 escape와 크기 제한을 적용한 HTTP 선택 초기 payload 및 build-produced destination import를 결합한 두 page starter를 제공하지만 다른 제품 여정의 완료를 뜻하지 않습니다.

URL matching, DTO binding/validation, middleware, guards, interceptors, request scopes, status, headers, errors, abort 및 HTTP request/response lifecycle은 오직 `@fluojs/http`가 소유합니다. Page GET은 application이 조립한 React document를 반환하거나 기존 negotiated destination을 opt-in할 수 있지만 client matcher, 두 번째 action router, 주 API인 file routing은 없습니다. Framework가 제공할 **목표** 공식 조립은 기존 module/provider/router 및 native form 경로 위에 request-owned page shell, SSR/hydration asset, HTTP 승인 이동, 실패/재시도 표현을 결합합니다. Application은 여전히 page, domain DTO, provider, mutation 정책, identity별 데이터 및 hosting을 소유합니다. 공개 생성/설정은 기존 class-static `ReactModule.forRoot(...)`와 기능별 기존 진입점에 남기고 중복 wrapper를 만들지 않습니다. Stable root는 runtime-neutral이고 browser/Vite는 해당 subpath에 남습니다. RSC/Server Functions는 별도의 [graduation gate](./react-rsc-graduation.ko.md) 전까지 experimental입니다.

Framework는 명시한 navigation/history/failure 및 취소 경계, commit 전 payload 검증, 사용 가능한 공식 조립에 책임이 있습니다. Application은 음악 라이선스/player SDK, 대기열 의미, 영속화, idempotency, session/CSRF, 인증 판단, 향후 공식 조립에 포함되지 않은 focus 정책, asset/CDN 배포를 소유합니다. 명시적 로그아웃 teardown, 강제 reload, 실제 탭 종료 또는 OS discard 뒤의 재생은 framework 보장이 아닙니다.

## 사용자 여정 수용 표

표는 roadmap의 이전 근거 baseline을 기록하며 완료된 #3873/#3874/#3875를 소급 취소하지 않습니다. **Shipped**는 해당 seam의 검증된 동작이고 **verification gap**, **assembly burden**, **unsupported**는 그 기반을 넘어서는 목표를 뜻합니다. 아래 background section은 #3881의 추가 범위를 기록합니다. 모든 행은 여전히 #3879의 전체 제품 검증이 필요합니다. S/F/C는 성공/실패/취소이며 dispatch한 POST의 rollback이 아닙니다.

### Background interaction scope

기존 `useForm`은 additive background GET/POST, 독립 stable-id 상태, latest-wins
ownership, session 철회, 합쳐진 fresh same-page HTTP approval을 제공합니다.
공식 example과 packaged starter의 `/catalog/background`는 실제 song datasource,
독립 search/widget read, queue row write를 사용합니다. source/types/dispatcher와
결정적인 listener/browser fixture는 역순 response, 두 held write, 개별 실패,
unmount, native GET/POST303GET을 검증합니다. 이 fixture는 scoped correctness
surface이며 #3879 전체 CRUD/jukebox gate, #3886 soak, 측정된 framework parity나
MusicKit 근거가 아닙니다. 정확한 제공 의미는 [form owner](./react-progressive-forms.ko.md)가 소유합니다.

| 사용자 여정 | 관찰 가능한 S / F / C 목표 | 현재 근거와 분류 | Owner 및 실제 검증 surface |
| --- | --- | --- | --- |
| 첫 실행 | S: scaffold/install/`pnpm dev` 후 첫 HTTP page; F: 잘못된 bootstrap/asset에 실행 가능한 오류, 거짓 ready 없음; C: 중단 시 child/watcher와 앱 종료. | **범위를 한정해 출시된 두 page 조립**이며 전체 CRUD는 아닙니다. `packages/cli/src/new/templates/react-vite-ssr/`와 생성 앱 dev/production browser가 direct GET, hydration, native anchor를 검증합니다. | [#3871](https://github.com/fluojs/fluo/issues/3871), #3879; generated app dev browser 및 production startup. |
| 페이지 추가 | S: 명시적 HTTP `@Path`와 build-mapped browser destination을 한 공식 경로로 추가; F: 잘못되거나 중복된 route/없는 module은 명확히 실패; C: 중단된 request가 일부 page를 commit하지 않음. | **범위를 한정해 제공된 authoring path.** 셋째 page 생성 소비자는 page/handler/DTO와 선택적 link만 수정했고 renderer/entry/manifest/store 수정은 없었습니다. 없는 module은 HTML commit 전에 실패하며 같은 #3880 typegen이 query wire input, module props, saved data를 연결합니다. Packaged dev/production consumer 근거는 계속 필요합니다. | #3871, [#3880](https://github.com/fluojs/fluo/issues/3880); consumer compile fixture, 실제 dispatcher, 생성 앱 browser. |
| SSR | S: 첫 GET에서 HTTP-matched shell/content stream; F: commit 전 오류는 HTTP status/error를 유지하고 abort 시 자원 해제; C: request abort가 진행 중 stream을 취소. | **Shipped baseline; verification gap**: 실제 shell 전달, slow client, 자원 예산. `packages/react/README.md`, `examples/react-vite-ssr/src/app.test.ts`. | [#3885](https://github.com/fluojs/fluo/issues/3885); production HTTP socket/slow client 및 #3879 browser. |
| Hydration | S: 서버 URL/params와 build asset으로 warning 없이 interactive shell hydrate; F: 없는 asset/mismatch를 진단하며 조용히 성공 처리하지 않음; C: unmount 시 browser 구독 정리. | **범위를 한정해 제공된 조립.** 생성 앱은 dev/production browser에서 hydration diagnostic 없이 shell을 유지하고 page state를 reset합니다. #3884는 다른 authoring 경로가 아닌 측정된 병목을 소유합니다. | #3871, [#3884](https://github.com/fluojs/fluo/issues/3884); production browser 및 bundle trace. |
| 이동 | S: HTTP 승인 후에만 URL/params를 commit하고 shell/resource identity 유지; F: 일시적 network/5xx 및 복구 가능한 매핑된 import 실패에서 기존 화면 보존, 재시도 표시, 자동 blank/셸 파괴 없음; C: 이전 요청 결과는 commit/fallback 금지. | 공식 network/5xx/매핑된 import 실패 기본값과 low-level opt-in이 **shipped**입니다. 생성 starter와 production 예제의 실패 browser가 자원 identity, operation/ack 및 mount/cleanup을 확인합니다. | [#3864](https://github.com/fluojs/fluo/issues/3864), #3871; production browser 실패 주입 및 생성 조립. |
| history와 미저장 편집 | S: back/forward마다 새 HTTP 승인, 승인 URL과 화면 일치; F: 실패한 traversal은 URL/history/화면 일치로 복구; C: opt-in dirty edit가 입력 손실·중복 entry 없이 push/replace/back/forward를 거절. | 기존 store의 `useNavigationGuard`와 tagged same-document 복원을 통한 **scoped opt-in 승인**입니다. Untagged/cross-document entry는 native 경계를 유지합니다. `packages/react/src/client-navigation-guard.test.ts`, `examples/react-vite-ssr/tests/navigation-guard.spec.ts`. | #3864, [#3882](https://github.com/fluojs/fluo/issues/3882); production 및 packaged dev/production back/forward, dirty-form·session race. |
| 오류와 재시도 | S: 일시적 실패의 재시도는 **새** HTTP 요청으로 승인받은 결과만 commit; F: 반복 실패에도 기존 shell/page와 조치 가능한 오류 유지, blank/unhandled UI 없음; C: pending UI를 정리하고 fallback 없음. | 공식 network/5xx/매핑된 import 실패 복구 control과 low-level opt-in이 **shipped**, 장시간 soak는 **verification gap**입니다. `packages/react/src/client/store.ts`, 생성 starter와 예제의 실패 browser 테스트. | #3864, [#3872](https://github.com/fluojs/fluo/issues/3872), [#3886](https://github.com/fluojs/fluo/issues/3886); 실패 주입 production browser와 반복 resource probe. |
| 조회와 검색 | S: HTTP DTO 검증된 목록/상세와 독립 검색이 작업별 pending/result로 최신 데이터 표시; F: validation/auth/transport를 구분하고 한 위젯 실패가 다른 것을 blank로 만들지 않음; C: 최신 요청만 반영하고 teardown은 해당 작업만 취소. | Handler 조회는 **shipped**, framework의 독립 background 작업은 **unsupported**. `examples/react-vite-ssr/src/app.ts`, `src/app.test.ts`, `packages/react/src/client/store.ts`(단일 navigation pending). | [#3881](https://github.com/fluojs/fluo/issues/3881), #3880; dispatcher 및 역순 응답 production browser. |
| 폼 제출 | S: JS 없이 native POST가 HTTP DTO/guard/interceptor와 303/GET 통과, enhanced form은 pending 표시; F: 잘못된 입력은 편집 가능한 field와 안전한 오류를 유지, 인증 거절을 성공으로 표시하지 않음; C: browser 대기 중단을 서버 mutation 취소로 주장하지 않음. | Native POST/303/GET과 기존 progressive `useForm` pending/field-error 경로는 **shipped**입니다. Generated input/saved inference도 같은 경로를 사용하며 packaged browser 검증은 계속 필요합니다. `examples/react-vite-ssr/src/app.ts`, `src/app.test.ts`, `tests/production-hydration.spec.ts`. | [#3874](https://github.com/fluojs/fluo/issues/3874), #3880, #3881; dispatcher 및 JS-on/off production browser. |
| 저장 후 최신화 | S: enhanced 저장은 shell을 파괴하지 않고 승인된 최신 데이터 표시; F: 오래된 결과가 새 저장을 덮지 않고 실패를 표시; C: 취소한 재검증은 마지막 승인 화면을 유지. | 명시적 HTTP 승인 refresh와 typed completion은 **shipped**, 기존 #3874 form 경로는 saved/read outcome을 구분하는 자동 follow-up approval을 추가합니다. `invalidate()`는 prefetch/pending만 비우며 native 303/GET도 shipped. | [#3873](https://github.com/fluojs/fluo/issues/3873), #3874, #3881; 저장 후 dispatcher와 production browser. |
| 인증 전환 | S: 다음 soft navigation 전에 session epoch 갱신, 보호 데이터/자원은 앱 정책 적용; F: 401/403은 일시적 재시도나 public cache 성공으로 처리하지 않음; C: 이전 session의 pending 결과가 sign-out 후 commit하지 않음. | Public-prefetch 안전성은 **shipped**, mutation/session 조정은 **assembly burden**. `packages/react/src/client/store.ts`, `docs/contracts/react-navigation-payload.md`, `examples/react-vite-ssr/src/app.test.ts`. | [#3875](https://github.com/fluojs/fluo/issues/3875), #3881; guarded dispatcher 및 login/logout race browser. |
| 개발 중 수정 | S: React/CSS는 예측 가능하게 갱신하고 server/shared는 안전하게 재시작, config는 별도 계약 적용; F: 문법/bootstrap 실패 노출과 수정 후 회복; C: 재시작 중단 시 child/middleware 종료. | 범위가 정해진 Node React Fast Refresh/CSS HMR 및 restart baseline은 **shipped**; #3877의 일반 server/shared/config drain·복구는 **verification gap**. `packages/cli/src/dev-runner/react-vite-dev-app.ts`, `docs/architecture/dev-reload-architecture.ko.md`. | [#3876](https://github.com/fluojs/fluo/issues/3876), [#3877](https://github.com/fluojs/fluo/issues/3877); 생성 앱의 실제 dev browser 편집/복구. |
| 배포 전환 | S: B 배포 후 build A 탭에서 호환되는 승인 목적지로 이동; F: chunk 누락/버전 불일치는 복구 UI 또는 명시적 document upgrade, 무한 재시도/blank 없음; C: 이전 import가 최신 의도 후 commit하지 않음. | **범위가 정해진 v2 build 식별자와 배포 recipe**: 전체 Vite manifest 및 `/assets/` base로 build를 구분하고 불일치는 import 전에 거부하며 명시적 update를 제공합니다. 독립 A→B browser 검증이 필요하고 이 행은 최종 제품 게이트 통과를 주장하지 않습니다. | [#3878](https://github.com/fluojs/fluo/issues/3878), #3884; 고정된 탭/host asset을 사용하는 두 build production browser. |
| 장시간 세션 | S: 주크박스 반복 작업에서 하나의 사용 가능한 shell resource와 제한된 listener/request 수 유지; F: 주입된 복구 가능 오류에 blank/unhandled UI 없음; C: 명시적 logout/reload/탭 종료는 거짓 보존 없이 수행. | **Verification gap**이며 재현된 누수/MusicKit 장애라는 주장이 아닙니다. `packages/react/src/client/store.ts`, `examples/react-vite-ssr/tests/production-hydration.spec.ts`는 짧은 경로만 검증. | #3886; 결정적 1,000-action browser loop와 별도 extended soak, 이후 #3879 gate. |

## 실패와 최신화 기본값

**#3872의 opt-in 공식 조립:** `ReactNavigationExperience`는 pending을 page slot 밖에
두고 승인된 destination의 render throw를 page-local boundary 실패로 처리합니다.
Reset은 HTTP request 또는 history 변경 없이 수행됩니다. Application 오류 view도 throw하면
공통 shell을 유지하면서 외부 diagnostic surface에 표시합니다. Matched
`@PageMetadata(...)`는 제한된 page-owned head의 추가·교체·제거를 SSR과 soft navigation의
HTTP 승인 payload에 함께 전달합니다. Live-region, focus, scroll 기본값은
`onApprovedNavigation`으로 교체할 수 있지만 복구 불가능한 root/browser 오류는 page
boundary가 복구하지 못합니다. 일시적 transport policy, 새 HTTP 승인 `router.retry()`,
명시적 `router.openDocument()`와 실패한 history 복구는 계속 #3864가 소유합니다.
공식 retry 및 문서 이동 control은 page slot 밖의 지속 shell에 둡니다.

**현재** low-level `ReactClientRouterProvider`는 앱이 `failurePolicy`를 제공하지 않으면
document fallback을 유지합니다. 이 opt-in은 network/5xx 실패에서 셸 보존을 선택하고
`useNavigation()`에 안전한 실패를 노출하며 새 HTTP `router.retry()` 또는 명시적인
`router.openDocument()`를 제공합니다. Production Vite 예제는 실패·재시도 동안 실제로
동작하는 resource를 검증합니다. 공식 생성 조립은 network/5xx 및 복구 가능한 매핑된 import 실패의 보존과 조치 가능한
control을 지속 셸에 명시적으로 연결합니다. 실패한 `popstate`는 기록된 승인
history entry로 되돌아갑니다. 늦은 결과와 취소는 commit하지 않습니다. HTTP 인증 거절
(401/403), redirect, 404, 잘못된 DTO/payload, 없는 importer key, 배포 버전 차이를
무조건 일시적 장애로 취급하지 않습니다. 앱은 logout 시 보호 UI를 종료할 수 있고 native
anchor, 수정키 클릭, 새 탭, JS 비활성화 요청, 강제 reload는 문서 경로로 남습니다. 실제
탭 종료/OS discard는 보존 보장이 아닙니다. 복구 가능한 주크박스 이동 실패가 셸을
파괴하거나 blank 화면·unhandled error를 남기면 제품 게이트 실패입니다.
Production starter는 `incompatible-build`에서도 마지막 셸을 유지하고 명시적
document update를 표시합니다. `/assets/` 게시 순서와 asset 보존은
[프로덕션 배포 recipe](../guides/react-production-deployment.ko.md)의 앱/host 책임입니다.

**현재** `router.refresh()`는 새 HTTP 승인으로 같은 page를 재검증한 뒤 typed outcome을 반환하며 셸과 history를 유지하고 승인된 page-local state는 reset합니다. Soft destination이 없거나 실패 정책이 선택하면 문서 reload를 시작합니다. 확정적인 문서 이동에는 `window.location.reload()`를 사용합니다. `router.invalidate()`는 provider가 관리하는 제한된 single-use *public* prefetch와 pending work를 비우지만 현재 페이지 데이터를 다시 가져오지 않습니다. Application은 관련 mutation/auth 전환 후 다음 in-document navigation 전에 `prefetchScope`를 바꾸거나 invalidate해야 합니다. [refresh migration](../getting-started/migrate-react-refresh.ko.md)을 참고하세요. #3874/#3875는 저장/session 통합을 맡고 일반/private loader cache나 자동 cache policy는 배포되지 않았습니다.

## 개발과 배포 경계

### Session composition boundary

앱이 확인한 login, logout, permission 변경은 기존 provider의 `session` option과
`router.sessionChanged({ epoch, reason })`으로 알립니다. 같은 epoch label도 내부
ownership을 전진시킵니다. Barrier는 async policy나 이전 abort listener 실행 전에
초기 SSR fallback을 포함한 approved page/head/retained form data를 철회합니다.
Fresh credential 포함 401은 signed-out, 403은 identity를 지우지 않는 forbidden을
선택하며 anonymous speculation은 credential 포함 session을 종료하지 못합니다.

명시적 saved `ReactModule.formResult({ ..., session, data })`는 동일 경계를
통과합니다. 이를 시작한 confirmed continuation만 fresh GET approval로 이관되며
GET retry는 POST를 재전송하지 않습니다. 앱 보호 자원은 framework teardown registry
대신 기존 React subtree/effect cleanup을 사용합니다. 외부 HttpOnly cookie 변경은
즉시 notification channel이 아닙니다.
[Session migration](../getting-started/migrate-react-session-composition.ko.md)과 owning
navigation/forms 계약이 정확한 기본값과 override를 정합니다. Production example과
packaged starter session 여정은 범위가 한정된 근거이며 #3879의 전체 제품 게이트나
#3886의 extended soak 완료를 뜻하지 않습니다.

| 수정 종류 | 현재 메커니즘과 결과 | 목표 owner 및 실패/복구 경계 |
| --- | --- | --- |
| React component (`.tsx`) | 공식 Node React/Vite client graph에서 `fluo dev`가 app child 교체 없이 Fast Refresh를 적용합니다. 직접 HTTP 요청은 DTO validation 후 최신 SSR page module을 로드합니다. 호환 가능한 component boundary에서만 state가 보존됩니다. | #3876은 이 범위와 syntax 오류 수정을 소유하고 #3877은 일반 shared/server restart·drain 정책을 소유합니다. |
| CSS | Vite가 app origin WebSocket으로 browser stylesheet를 갱신하며 app child나 document를 교체하지 않습니다. | #3876이 이 범위를 소유하고 native raw watch는 process-restart escape hatch로 유지됩니다. |
| Server-only code | Child/process restart와 새 bootstrap; active work의 정돈된 종료와 browser 복구가 필요합니다. | #3877이 shutdown, stale SSR, 실패/재시작 복구를 소유하며 in-place server module swap은 약속하지 않습니다. |
| Server/client shared code | Vite가 변환한 `.tsx` page/document component는 browser HMR과 최신 SSR module load를 받습니다. 나머지 shared source는 supervisor restart를 따르며 state를 잃을 수 있습니다. | #3877이 보편적인 state 보존 대신 일반 shared dependency restart/drain 정책을 소유합니다. |
| Config | `watch: true`일 때 watched env input은 검증된 `@fluojs/config` snapshot을 교체할 수 있습니다. Source/Vite config 변경은 CLI 재시작 경로입니다. | #3877은 명시적 config snapshot reload 및 error rollback을 재시작이 필요한 config/build 변경과 구분합니다. |

근거: `packages/cli/src/dev-runner/react-vite-dev-app.ts`는 app-hosted WebSocket을 사용하는 Vite middleware를 만들고 `packages/cli/src/dev-runner/node-restart-runner.ts`는 HMR 대상 외 child restart를 감독합니다. [개발 리로드 아키텍처](../architecture/dev-reload-architecture.ko.md)가 경계를 기록합니다. Production build manifest load와 static asset/CDN 게시 책임은 application/host에 남습니다. #3878은 A→B 호환성/복구를 맡지만 자동 배포를 뜻하지 않습니다.

## 이슈 소유권과 완료 게이트

의존성은 선행 조건에서 소비자로 향합니다. #3870은 feature/benchmark 구현 **이전**에 이 문서를 확정하고 #3883 측정을 기다리지 않습니다. #3883은 #3884/#3885 최적화 **이전**에 실행 가능한 환경, workload, numeric budget을 확정합니다. #3879만 모든 기능, 측정, 안정성 게이트를 기다립니다. #3879/#3886 fixture 준비는 선행 작업과 병렬로 가능하지만 최종 통과는 선행 결과가 필요합니다.

| 자식 이슈 | 고유 소유권 및 완료 게이트 |
| --- | --- |
| [#3870](https://github.com/fluojs/fluo/issues/3870) | 이 EN/KO 계약, 여정 표와 비교; docs/release metadata 검증. Runtime 제품 PASS는 아닙니다. |
| [#3871](https://github.com/fluojs/fluo/issues/3871) | 공식 starter/SSR/hydration/navigation 조립 하나; 생성 소비자 browser 여정. |
| [#3872](https://github.com/fluojs/fluo/issues/3872) | 이동 pending, render error/head/접근성; production browser. |
| [#3864](https://github.com/fluojs/fluo/issues/3864) | 일시적 실패/retry, shell 및 history/resource identity; 실패 주입 production browser. |
| [#3873](https://github.com/fluojs/fluo/issues/3873) | 현재 page soft revalidation과 `refresh()` migration; 저장 후 browser. |
| [#3874](https://github.com/fluojs/fluo/issues/3874) | Native-progressive form pending/error와 저장 통합; DTO/guard dispatcher 및 JS-on/off browser. |
| [#3875](https://github.com/fluojs/fluo/issues/3875) | Auth/session/mutation invalidation 조정; 보호 dispatcher 및 sign-out browser. |
| [#3876](https://github.com/fluojs/fluo/issues/3876) | React Fast Refresh/CSS HMR; 실제 dev browser file edit. |
| [#3877](https://github.com/fluojs/fluo/issues/3877) | Server/shared/config 안전한 restart, drain, recovery; 실제 dev browser 실패/수정. |
| [#3878](https://github.com/fluojs/fluo/issues/3878) | Build A→B asset/navigation 호환성/복구; 두 build production browser. |
| [#3880](https://github.com/fluojs/fluo/issues/3880) | 두 번째 generator가 아닌 route/query/page-props/mutation 타입 투영 하나; negative consumer compile/HTTP round trip. |
| [#3881](https://github.com/fluojs/fluo/issues/3881) | #3874와 같은 interaction 경로의 비이동 검색/행 작업과 독립 경합; 역순 응답 browser test. |
| [#3882](https://github.com/fluojs/fluo/issues/3882) | 두 번째 router가 아닌 #3864 history 복구 위 opt-in 이동 전 dirty-edit 승인/취소; browser back/forward race. |
| [#3883](https://github.com/fluojs/fluo/issues/3883) | 고정된 동등 앱 benchmark, 환경/workload/numeric baseline budget; 재현 측정과 regression gate. |
| [#3884](https://github.com/fluojs/fluo/issues/3884) | #3883 budget에 대한 측정 기반 client JS/hydration/navigation 개선; production trace/browser. |
| [#3885](https://github.com/fluojs/fluo/issues/3885) | #3883 budget에 대한 측정 기반 SSR shell/slow-client/abort 개선; 실제 production socket. |
| [#3886](https://github.com/fluojs/fluo/issues/3886) | 재시도 구현 중복 없이 반복 주크박스 자원 상한/복구; 결정적 browser와 soak. |
| [#3879](https://github.com/fluojs/fluo/issues/3879) | 최종 생성 앱 통합, 모든 여정의 실제 surface 수용 및 umbrella 종료; API 존재만으로 통과 불가. |

어떤 자식도 별도 public matcher/action 경로를 소유하지 않습니다. #3874는 제출 동작을, #3881은 그 경로의 비이동 모드를, #3880은 타입을, #3864는 실패/history 메커니즘을, #3882는 이를 사용하는 이동 전 의도를, #3886은 반복 수명을 소유합니다. #3879는 이를 통합하며 재구현하지 않습니다. #3870과 #3883은 #3879에 의존하지 않습니다.

## 동일 앱 비교, API 모방이 아님

동일한 인증, 데이터 크기, native form, 실패, production asset 조건의 CRUD와 장기 주크박스를 비교합니다. 아래 항목은 **공식 문서에 나온 메커니즘의 근거**일 뿐 경쟁 앱/Fluo benchmark 실행, 속도 우위, 보안 동등성 또는 언제나 자동으로 적용된다는 주장이 아닙니다. 각 행에 공식 URL과 정확한 source behavior를 표시합니다.

| Framework와 문서화된 기능 | 소비자 작성 비용과 타입 경계 | 성능 근거와 안정성 경계 |
| --- | --- | --- |
| **Fluo, 현재 stable**: 명시적 HTTP handler/DTO와 application renderer, HTTP 승인 payload soft navigation, native POST/303/GET, 제한된 public-only prefetch. | Starter의 첫 page 비용은 낮지만 전체 CRUD/주크박스 통합에는 **assembly burden**이 남습니다. 기존 compiler projection은 limited JSON 계약 안에서 path/query/page props/form data를 연결하며 전체 제품 수용을 뜻하지 않습니다. 위 여정 표 참고. | 동일 앱 지연/bytes/resource budget은 **미측정**이며 #3883이 numeric target을 수립합니다. Stable root는 runtime-neutral이고 RSC/Server Functions는 experimental이라 stable 비교에서 제외합니다. |
| **Next.js App Router**: `loading.js`가 page를 Suspense로 감싸 데이터 렌더 중 layout을 표시합니다([공식 fetching guide](https://nextjs.org/docs/app/getting-started/fetching-data)). `router.refresh()`는 서버에 다시 요청해 갱신된 RSC payload를 합치고 영향을 받지 않는 client React state를 보존하지만 server-side cache를 무효화하지 않습니다([공식 useRouter reference](https://nextjs.org/docs/app/api-reference/functions/use-router)). | 문서의 route/segment/component convention은 수동 layout/loading 조립을 줄입니다. 실제 form DTO, auth, 타입 제약은 앱마다 다르며 Fluo HTTP pipeline과 동등하다고 가정하지 않습니다. | 문서는 refresh 메커니즘을 보여 주지만 **측정 우위는 아닙니다**. Stable 문서 동작만 비교하며 canary/experimental 기능은 baseline에 넣지 않습니다. |
| **React Router Framework Mode**: Server `loader`는 SSR 및 자동 client-navigation fetch에 사용됩니다([공식 data-loading guide](https://reactrouter.com/start/framework/data-loading)). Route `action` 완료 뒤 page loader를 재검증하며 비이동 `<fetcher.Form>`도 제공합니다([공식 actions guide](https://reactrouter.com/start/framework/actions)). | 함께 작성하는 `loader`/`action`과 생성 `Route.ComponentProps`가 수동 wiring을 줄이고 loader data type을 연결합니다. Auth/domain logic과 revalidation policy는 앱이 작성합니다. | 이 문서의 benchmark는 없습니다. [배포 guide](https://reactrouter.com/start/framework/deploying)는 full-stack/static hosting을 설명할 뿐 배포 버전 차이 복구의 근거가 아닙니다. |
| **TanStack Start**: `createServerFn()`은 client에서도 호출 가능한 server-side 함수와 framework 직렬화를 제공합니다([공식 server-functions guide](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)). 같은 디렉터리의 file-based server route는 raw HTTP endpoint를 제공합니다([공식 server-routes guide](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)). | Server-function 입력/출력은 직렬화 가능성을 타입으로 검사하며 validator를 사용할 수 있습니다. Raw server route는 별도 endpoint 선택입니다. 이는 Fluo에 RPC/action router나 file route를 추가하자는 제안이 아닙니다. | 측정한 성능 주장은 없습니다. Guide는 사용자 지정 `generateFunctionId`를 **experimental**로 표시합니다. 이를 stable baseline으로 세거나 모든 Start 내부를 Fluo HTTP 소유 계약과 동일시하지 않습니다. |

기능 존재, 작성 비용, 타입 안전성 칸은 문서 근거 또는 명시적으로 wiring에서 추론한 내용이지 동일 CRUD/주크박스 browser 작업의 통과 증거가 아닙니다. [#3883](https://github.com/fluojs/fluo/issues/3883)이 최적화 **전에** stable version, 같은 workload/cache policy, desktop/low-end 환경과 절대/상대 numeric budget을 고정합니다. #3884/#3885가 client/server 경로를 측정·수정하고 #3886/#3879가 장기 정확성을 검증합니다. 이 roadmap은 경쟁 API 동등성이나 1.0 승인이 아닙니다.

## 근거와 검증 한계

Source seam: `packages/react/src/client/store.ts`, `packages/react/src/client/navigation-payload.ts`, `packages/react/src/module.ts`, `packages/cli/src/dev-runner/react-vite-dev-app.ts`, `examples/react-vite-ssr/src/app.ts`. 기존 테스트: `packages/react/src/client.test.ts`, `examples/react-vite-ssr/src/app.test.ts`, `examples/react-vite-ssr/tests/production-hydration.spec.ts`; [navigation payload 계약](./react-navigation-payload.ko.md)에 HTTP/prefetch 추가 근거가 있습니다. 이는 **기존** 동작 기록이며 이 변경에서 새 browser/performance 실행을 했다는 뜻이 아닙니다. 예제의 native form과 짧은 shell counter는 실제 유료 player나 향후 제품 게이트가 아닙니다. Docs 검증은 link/구조와 EN/KO 쌍을 확인할 뿐 미래 runtime 성공은 보장하지 않습니다. 영향받는 FluoBlog 17장과 FluoShop 4장 companion은 기존 native 실습을 유지하며 typed 계약을 적용합니다. 원고 검증은 해당 DB/browser 실행 근거가 아닙니다.


## Typed 계약 수용

[End-to-end 타입 계약](./react-end-to-end-types.ko.md)이 하나의 frozen compiler/HTTP
projection, 실제 공유 tsconfig/bootstrap options, wire alias와 converter input, URI
selection provenance, module registry, limited JSON props/saved data를 소유합니다.
같은 generator/check/watch lifecycle은 type-only 및 compiler/configuration freshness를
포함해야 합니다. 기존 `--check`가 조용한 재생성 없이 일반 typecheck/build를 gate합니다.
Strict negative consumer, 실제 HTTP query/POST round trip, clean generated dev/production
browser 여정이 필요하며 focused type test만으로 #3880 또는 #3879를 통과하지 않습니다.
이 계약의 존재가 generated GET decoder(#3881), 두 번째 form/provider, erased-type 복구,
성능이나 soak를 보장하지 않습니다.

## Progressive native HTTP forms

[Progressive form 계약](./react-progressive-forms.ko.md)은 기존 provider의 `useForm`과 root의
`ReactModule.formResult`를 하나의 native HTTP 경로로 연결합니다. DTO/guard/interceptor,
request scope, status/error는 HTTP가 계속 소유하며 native POST/303/GET을 유지합니다.
`saved`와 follow-up read 실패, validation/auth와 uncertain persistence를 구분하고
`retryRead()`는 GET만 수행합니다. busy activation은 skip하며 자동 POST retry/replay는 없습니다.
자동 form refresh는 다른 form의 input/error/focus와 shell을 유지하고 기존 명시적
`useRouter().refresh()`의 승인 후 page reset 의미는 바꾸지 않습니다.
