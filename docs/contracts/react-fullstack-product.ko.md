# HTTP-first React 풀스택 제품 계약

<p><a href="./react-fullstack-product.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 범위와 수용 경계

이 문서는 운영 CRUD 앱(인증된 목록, 검색, 상세, 편집, 저장, 로그아웃)과 바 주크박스(노래, QR, 검색, 대기열 관리 사이에 유지되는 장기 셸 리소스)의 **목표** 제품 계약입니다. 새 기능이 이미 배포됐다는 뜻이 아닙니다. 완료된 [#2489 roadmap](https://github.com/fluojs/fluo/issues/2489)은 과거 API 마일스톤이고 [#3869](https://github.com/fluojs/fluo/issues/3869)는 추가 제품 수용 게이트입니다. 로드맵 순서는 출시 버전이나 1.0 승인이 아닙니다. API 테스트 통과나 hook export만으로 사용자 여정을 통과할 수 없습니다. 소비자가 별도의 renderer, router, cache, request-race framework를 작성하지 않고 과업을 마쳐야 합니다. [#3879](https://github.com/fluojs/fluo/issues/3879)는 공식 starter의 실제 dev/production browser에서 모든 필수 여정이 통과할 때만 제품 게이트를 닫습니다.

**선행 조건과 공개 진입점.** 생성된 Node.js + Fastify 앱에서 `fluo new my-react-app --starter react-vite-ssr`, `pnpm dev`, production `build`/`start` script를 사용합니다. HTTP page handler는 `@fluojs/react`의 `ReactModule.forRoot({ controllers, renderPage })`, `@Router`/`@Path`, 일반 `@fluojs/http` DTO 및 `@Post`를 사용합니다. Browser에는 `@fluojs/react/client`의 `Link`/`useRouter()`/`ReactClientRouterProvider`, application이 로드한 build manifest에는 `@fluojs/react/vite`를 사용합니다. 정확한 import와 설정은 [React API owner](../../packages/react/README.ko.md) 및 [CLI API owner](../../packages/cli/README.ko.md)를 참고하세요. 이 문서는 현재 공개 입력, 기본값, 출력을 바꾸지 않습니다.

URL matching, DTO binding/validation, middleware, guards, interceptors, request scopes, status, headers, errors, abort 및 HTTP request/response lifecycle은 오직 `@fluojs/http`가 소유합니다. Page GET은 application이 조립한 React document를 반환하거나 기존 negotiated destination을 opt-in할 수 있지만 client matcher, 두 번째 action router, 주 API인 file routing은 없습니다. Framework가 제공할 **목표** 공식 조립은 기존 module/provider/router 및 native form 경로 위에 request-owned page shell, SSR/hydration asset, HTTP 승인 이동, 실패/재시도 표현을 결합합니다. Application은 여전히 page, domain DTO, provider, mutation 정책, identity별 데이터 및 hosting을 소유합니다. 공개 생성/설정은 기존 class-static `ReactModule.forRoot(...)`와 기능별 기존 진입점에 남기고 중복 wrapper를 만들지 않습니다. Stable root는 runtime-neutral이고 browser/Vite는 해당 subpath에 남습니다. RSC/Server Functions는 별도의 [graduation gate](./react-rsc-graduation.ko.md) 전까지 experimental입니다.

Framework는 명시한 navigation/history/failure 및 취소 경계, commit 전 payload 검증, 사용 가능한 공식 조립에 책임이 있습니다. Application은 음악 라이선스/player SDK, 대기열 의미, 영속화, idempotency, session/CSRF, 인증 판단, 향후 공식 조립에 포함되지 않은 focus 정책, asset/CDN 배포를 소유합니다. 명시적 로그아웃 teardown, 강제 reload, 실제 탭 종료 또는 OS discard 뒤의 재생은 framework 보장이 아닙니다.

## 사용자 여정 수용 표

분류는 목표가 아니라 **현재 checkout**의 상태입니다. **shipped**는 범위를 한정한 근거가 있고, **verification gap**은 실제 surface 검증이 필요하며, **assembly burden**은 framework의 공식 조립이 필요하고, **unsupported**는 새 동작이 필요하며, **intentional non-goal**은 계약 밖입니다. 같은 행에 shipped 기반과 다른 목표 분류가 함께 있을 수 있습니다. 모든 행은 #3879에서 다시 실행합니다. Owner는 부족한 결과를 구현하거나 입증할 자식 이슈입니다. 각 행의 S/F/C는 제품 게이트에서 관찰할 성공/실패/취소 결과입니다. 해당될 때 취소는 사용자 또는 request abort이며 이미 제출한 POST의 rollback이 아닙니다.

| 사용자 여정 | 관찰 가능한 S / F / C 목표 | 현재 근거와 분류 | Owner 및 실제 검증 surface |
| --- | --- | --- | --- |
| 첫 실행 | S: scaffold/install/`pnpm dev` 후 첫 HTTP page; F: 잘못된 bootstrap/asset에 실행 가능한 오류, 거짓 ready 없음; C: 중단 시 child/watcher와 앱 종료. | **Shipped baseline; assembly burden**: 이후 전체 여정은 아직 조립 필요. `packages/cli/README.md`, `packages/cli/src/dev-runner/react-vite-dev-app.ts`, `packages/react/src/module.ts`; 생성 starter도 document를 조립합니다. | [#3871](https://github.com/fluojs/fluo/issues/3871), #3879; generated app dev browser 및 production startup. |
| 페이지 추가 | S: 명시적 HTTP `@Path`와 build-mapped browser destination을 한 공식 경로로 추가; F: 잘못되거나 중복된 route/없는 module은 명확히 실패; C: 중단된 request가 일부 page를 commit하지 않음. | **Assembly burden.** `packages/react/src/module.ts`, `examples/react-vite-ssr/src/app.ts`, `examples/react-vite-ssr/src/app.test.ts`; typegen은 path-only입니다. | #3871, [#3880](https://github.com/fluojs/fluo/issues/3880); consumer compile fixture, 실제 dispatcher, 생성 앱 browser. |
| SSR | S: 첫 GET에서 HTTP-matched shell/content stream; F: commit 전 오류는 HTTP status/error를 유지하고 abort 시 자원 해제; C: request abort가 진행 중 stream을 취소. | **Shipped baseline; verification gap**: 실제 shell 전달, slow client, 자원 예산. `packages/react/README.md`, `examples/react-vite-ssr/src/app.test.ts`. | [#3885](https://github.com/fluojs/fluo/issues/3885); production HTTP socket/slow client 및 #3879 browser. |
| Hydration | S: 서버 URL/params와 build asset으로 warning 없이 interactive shell hydrate; F: 없는 asset/mismatch를 진단하며 조용히 성공 처리하지 않음; C: unmount 시 browser 구독 정리. | **Shipped baseline; assembly burden.** `packages/react/src/client.test.ts`, `examples/react-vite-ssr/tests/production-hydration.spec.ts`; 생성 조립은 전체 예제와 아직 다릅니다. | #3871, [#3884](https://github.com/fluojs/fluo/issues/3884); production browser 및 bundle trace. |
| 이동 | S: HTTP 승인 후에만 URL/params를 commit하고 shell/resource identity 유지; F: 일시적 network/5xx에서 기존 화면 보존, 재시도 표시, 자동 blank/셸 파괴 없음; C: 이전 요청 결과는 commit/fallback 금지. | 정상 경로는 **shipped**, 일시적 실패의 제품 기본은 **unsupported**. `packages/react/src/client/store.ts`는 취소 외 실패에 document `assign`/`replace`; `packages/react/src/client.test.ts`, `examples/react-vite-ssr/tests/production-hydration.spec.ts`는 성공/fallback을 보지만 resource 보존은 입증하지 않습니다. | [#3864](https://github.com/fluojs/fluo/issues/3864), #3871; network/5xx 주입 production browser의 resource instance, mount/cleanup count. |
| history와 미저장 편집 | S: back/forward마다 새 HTTP 승인, 승인 URL과 화면 일치; F: 실패한 traversal은 URL/history/화면 일치로 복구; C: opt-in dirty edit가 입력 손실·중복 entry 없이 push/replace/back/forward를 거절. | 새 승인 동작은 **shipped**, 사용자 의도 취소·실패 history 복구는 **unsupported**. `packages/react/src/client/store.ts`, `packages/react/src/client.test.ts`, `examples/react-vite-ssr/tests/production-hydration.spec.ts`. | #3864, [#3882](https://github.com/fluojs/fluo/issues/3882); production browser back/forward와 dirty-form race. |
| 오류와 재시도 | S: 일시적 실패의 재시도는 **새** HTTP 요청으로 승인받은 결과만 commit; F: 반복 실패에도 기존 shell/page와 조치 가능한 오류 유지, blank/unhandled UI 없음; C: pending UI를 정리하고 fallback 없음. | 공식 복구 조립은 **unsupported**. 현재 document fallback은 의도된 low-level 호환성입니다. `packages/react/src/client/store.ts`, `docs/contracts/react-navigation-payload.md`; 실패 중 장기 자원 생존 browser 증거는 없습니다. | #3864, [#3872](https://github.com/fluojs/fluo/issues/3872), [#3886](https://github.com/fluojs/fluo/issues/3886); 실패 주입 production browser와 반복 resource probe. |
| 조회와 검색 | S: HTTP DTO 검증된 목록/상세와 독립 검색이 작업별 pending/result로 최신 데이터 표시; F: validation/auth/transport를 구분하고 한 위젯 실패가 다른 것을 blank로 만들지 않음; C: 최신 요청만 반영하고 teardown은 해당 작업만 취소. | Handler 조회는 **shipped**, framework의 독립 background 작업은 **unsupported**. `examples/react-vite-ssr/src/app.ts`, `src/app.test.ts`, `packages/react/src/client/store.ts`(단일 navigation pending). | [#3881](https://github.com/fluojs/fluo/issues/3881), #3880; dispatcher 및 역순 응답 production browser. |
| 폼 제출 | S: JS 없이 native POST가 HTTP DTO/guard/interceptor와 303/GET 통과, enhanced form은 pending 표시; F: 잘못된 입력은 편집 가능한 field와 안전한 오류를 유지, 인증 거절을 성공으로 표시하지 않음; C: browser 대기 중단을 서버 mutation 취소로 주장하지 않음. | Native POST/303/GET은 **shipped**, 공식 enhanced pending/field-error 조립은 **unsupported**. `examples/react-vite-ssr/src/app.ts`, `src/app.test.ts`, `tests/production-hydration.spec.ts`. | [#3874](https://github.com/fluojs/fluo/issues/3874), #3880, #3881; dispatcher 및 JS-on/off production browser. |
| 저장 후 최신화 | S: enhanced 저장은 shell을 파괴하지 않고 승인된 최신 데이터 표시; F: 오래된 결과가 새 저장을 덮지 않고 실패를 표시; C: 취소한 재검증은 마지막 승인 화면을 유지. | Soft revalidation은 **unsupported**. `packages/react/src/client/store.ts`의 `invalidate()`는 prefetch/pending만 비우고 `refresh()`는 document reload; native 303/GET은 **shipped**. | [#3873](https://github.com/fluojs/fluo/issues/3873), #3874, #3881; 저장 후 dispatcher와 production browser. |
| 인증 전환 | S: 다음 soft navigation 전에 session epoch 갱신, 보호 데이터/자원은 앱 정책 적용; F: 401/403은 일시적 재시도나 public cache 성공으로 처리하지 않음; C: 이전 session의 pending 결과가 sign-out 후 commit하지 않음. | Public-prefetch 안전성은 **shipped**, mutation/session 조정은 **assembly burden**. `packages/react/src/client/store.ts`, `docs/contracts/react-navigation-payload.md`, `examples/react-vite-ssr/src/app.test.ts`. | [#3875](https://github.com/fluojs/fluo/issues/3875), #3881; guarded dispatcher 및 login/logout race browser. |
| 개발 중 수정 | S: React/CSS는 예측 가능하게 갱신하고 server/shared는 안전하게 재시작, config는 별도 계약 적용; F: 문법/bootstrap 실패 노출과 수정 후 회복; C: 재시작 중단 시 child/middleware 종료. | Fast Refresh/CSS HMR은 **unsupported**, 재시작 기반은 **shipped**. `packages/cli/src/dev-runner/react-vite-dev-app.ts`의 `hmr: false`, `docs/architecture/dev-reload-architecture.md`. | [#3876](https://github.com/fluojs/fluo/issues/3876), [#3877](https://github.com/fluojs/fluo/issues/3877); 생성 앱의 실제 dev browser 편집/복구. |
| 배포 전환 | S: B 배포 후 build A 탭에서 호환되는 승인 목적지로 이동; F: chunk 누락/버전 불일치는 복구 UI 또는 명시적 document upgrade, 무한 재시도/blank 없음; C: 이전 import가 최신 의도 후 commit하지 않음. | 버전 차이 복구는 **verification gap**. `packages/react/src/client/navigation-payload.ts`는 build module/import를 검사하고 `examples/react-vite-ssr/tests/production-hydration.spec.ts`는 단일 build만 다룹니다. | [#3878](https://github.com/fluojs/fluo/issues/3878), #3884; 고정된 탭/host asset을 사용하는 두 build production browser. |
| 장시간 세션 | S: 주크박스 반복 작업에서 하나의 사용 가능한 shell resource와 제한된 listener/request 수 유지; F: 주입된 복구 가능 오류에 blank/unhandled UI 없음; C: 명시적 logout/reload/탭 종료는 거짓 보존 없이 수행. | **Verification gap**이며 재현된 누수/MusicKit 장애라는 주장이 아닙니다. `packages/react/src/client/store.ts`, `examples/react-vite-ssr/tests/production-hydration.spec.ts`는 짧은 경로만 검증. | #3886; 결정적 1,000-action browser loop와 별도 extended soak, 이후 #3879 gate. |

## 실패와 최신화 기본값

**현재** low-level `ReactClientRouterProvider`는 취소되지 않은 모든 실패 load에 document fallback을 유지합니다. 성공 시에는 공통 provider/layout을 보존합니다. 아직 공개되지 않은 option을 가정하지 마세요. **목표** 공식 조립(#3871과 #3864)은 일시적 network/5xx 실패에서 마지막 승인 URL/params/page/shell을 유지하고, 실패와 명시적 retry/document-exit 선택지를 보여 주며, 재시도는 새 HTTP 승인을 받습니다. `popstate`는 browser URL이 먼저 변경된 뒤에도 일관되게 복구해야 합니다. 늦은 결과와 취소는 commit하지 않습니다. HTTP 인증 거절(401/403), redirect, 404, 잘못된 DTO/payload, 미지원 module/import, 배포 버전 차이마다 별도 정책과 테스트가 필요합니다. 모두 일시적 실패로 재시도하지 않습니다. 앱은 로그아웃할 때 보호 UI를 명시적으로 종료할 수 있습니다. Native anchor, 수정키 클릭, 새 탭, JS 비활성화 요청, 강제 reload는 계속 문서 경로를 사용합니다. 실제 탭 종료/OS discard는 보존 보장이 아닙니다. 복구 가능한 주크박스 이동 실패가 셸을 자동으로 파괴하거나 blank 화면·unhandled error를 남기면 제품 게이트 실패입니다.

**현재** `router.refresh()`는 `browser.reload()`를 호출하는 document reload이지 soft data revalidation이 아닙니다. `router.invalidate()`는 provider가 관리하는 제한된 single-use *public* prefetch와 pending work를 비우지만 현재 페이지 데이터를 다시 가져오지 않습니다. Application은 관련 mutation/auth 전환 후 다음 in-document navigation 전에 `prefetchScope`를 바꾸거나 invalidate해야 합니다. [#3873](https://github.com/fluojs/fluo/issues/3873)이 향후 shell 보존 HTTP 승인 refresh와 기존 reload 의존 소비자의 명시적 migration을 소유하고, #3874/#3875가 저장/session 통합을 맡습니다. 일반/private loader cache와 자동 cache policy는 배포되지 않았습니다.

## 개발과 배포 경계

| 수정 종류 | 현재 메커니즘과 결과 | 목표 owner 및 실패/복구 경계 |
| --- | --- | --- |
| React component (`.tsx`) | `fluo dev`가 관리하는 Node child를 재시작합니다. Browser state와 shell resource 보존은 **보장하지 않습니다**. | #3876이 React가 허용하는 범위의 local state만 보존하는 Fast Refresh와 수정 후 오류 복구를 제공합니다. |
| CSS | 현재 React dev child는 재시작합니다. Vite middleware의 `hmr: false`는 CSS HMR이 아닙니다. | #3876이 불필요한 앱 teardown 없는 CSS 갱신과 reload 필요 시점을 문서화합니다. |
| Server-only code | Child/process restart와 새 bootstrap; active work의 정돈된 종료와 browser 복구가 필요합니다. | #3877이 shutdown, stale SSR, 실패/재시작 복구를 소유하며 in-place server module swap은 약속하지 않습니다. |
| Server/client shared code | 현재는 child/process restart이며 공통 dependency 변경은 양쪽 bundle/state를 무효화할 수 있습니다. | #3877이 양쪽을 분류하고 무조건적인 state 보존 대신 안전한 restart/reload를 선택합니다. |
| Config | `watch: true`일 때 watched env input은 검증된 `@fluojs/config` snapshot을 교체할 수 있습니다. Source/Vite config 변경은 CLI 재시작 경로입니다. | #3877은 명시적 config snapshot reload 및 error rollback을 재시작이 필요한 config/build 변경과 구분합니다. |

근거: `packages/cli/src/dev-runner/react-vite-dev-app.ts`는 `server: { hmr: false, middlewareMode: true }`로 Vite middleware를 만듭니다. `packages/cli/src/dev-runner/node-restart-runner.ts`는 child restart를 감독하고 [개발 리로드 아키텍처](../architecture/dev-reload-architecture.ko.md)는 code restart와 config snapshot 계열을 구분합니다. Production build manifest load와 static asset/CDN 게시 책임은 application/host에 남습니다. #3878은 A→B 호환성/복구를 맡지만 자동 배포를 뜻하지 않습니다.

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
| **Fluo, 현재 stable**: 명시적 HTTP handler/DTO와 application renderer, HTTP 승인 payload soft navigation, native POST/303/GET, 제한된 public-only prefetch. | Starter의 첫 page 비용은 낮지만 전체 CRUD/주크박스 작업, 타입이 연결되지 않은 query/page props, 장애 복구에는 **assembly burden**이 있습니다. Typegen은 path-only입니다. 위 여정 표 참고. | 동일 앱 지연/bytes/resource budget은 **미측정**이며 #3883이 numeric target을 수립합니다. Stable root는 runtime-neutral이고 RSC/Server Functions는 experimental이라 stable 비교에서 제외합니다. |
| **Next.js App Router**: `loading.js`가 page를 Suspense로 감싸 데이터 렌더 중 layout을 표시합니다([공식 fetching guide](https://nextjs.org/docs/app/getting-started/fetching-data)). `router.refresh()`는 서버에 다시 요청해 갱신된 RSC payload를 합치고 영향을 받지 않는 client React state를 보존하지만 server-side cache를 무효화하지 않습니다([공식 useRouter reference](https://nextjs.org/docs/app/api-reference/functions/use-router)). | 문서의 route/segment/component convention은 수동 layout/loading 조립을 줄입니다. 실제 form DTO, auth, 타입 제약은 앱마다 다르며 Fluo HTTP pipeline과 동등하다고 가정하지 않습니다. | 문서는 refresh 메커니즘을 보여 주지만 **측정 우위는 아닙니다**. Stable 문서 동작만 비교하며 canary/experimental 기능은 baseline에 넣지 않습니다. |
| **React Router Framework Mode**: Server `loader`는 SSR 및 자동 client-navigation fetch에 사용됩니다([공식 data-loading guide](https://reactrouter.com/start/framework/data-loading)). Route `action` 완료 뒤 page loader를 재검증하며 비이동 `<fetcher.Form>`도 제공합니다([공식 actions guide](https://reactrouter.com/start/framework/actions)). | 함께 작성하는 `loader`/`action`과 생성 `Route.ComponentProps`가 수동 wiring을 줄이고 loader data type을 연결합니다. Auth/domain logic과 revalidation policy는 앱이 작성합니다. | 이 문서의 benchmark는 없습니다. [배포 guide](https://reactrouter.com/start/framework/deploying)는 full-stack/static hosting을 설명할 뿐 배포 버전 차이 복구의 근거가 아닙니다. |
| **TanStack Start**: `createServerFn()`은 client에서도 호출 가능한 server-side 함수와 framework 직렬화를 제공합니다([공식 server-functions guide](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)). 같은 디렉터리의 file-based server route는 raw HTTP endpoint를 제공합니다([공식 server-routes guide](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)). | Server-function 입력/출력은 직렬화 가능성을 타입으로 검사하며 validator를 사용할 수 있습니다. Raw server route는 별도 endpoint 선택입니다. 이는 Fluo에 RPC/action router나 file route를 추가하자는 제안이 아닙니다. | 측정한 성능 주장은 없습니다. Guide는 사용자 지정 `generateFunctionId`를 **experimental**로 표시합니다. 이를 stable baseline으로 세거나 모든 Start 내부를 Fluo HTTP 소유 계약과 동일시하지 않습니다. |

기능 존재, 작성 비용, 타입 안전성 칸은 문서 근거 또는 명시적으로 wiring에서 추론한 내용이지 동일 CRUD/주크박스 browser 작업의 통과 증거가 아닙니다. [#3883](https://github.com/fluojs/fluo/issues/3883)이 최적화 **전에** stable version, 같은 workload/cache policy, desktop/low-end 환경과 절대/상대 numeric budget을 고정합니다. #3884/#3885가 client/server 경로를 측정·수정하고 #3886/#3879가 장기 정확성을 검증합니다. 이 roadmap은 경쟁 API 동등성이나 1.0 승인이 아닙니다.

## 근거와 검증 한계

Source seam: `packages/react/src/client/store.ts`, `packages/react/src/client/navigation-payload.ts`, `packages/react/src/module.ts`, `packages/cli/src/dev-runner/react-vite-dev-app.ts`, `examples/react-vite-ssr/src/app.ts`. 기존 테스트: `packages/react/src/client.test.ts`, `examples/react-vite-ssr/src/app.test.ts`, `examples/react-vite-ssr/tests/production-hydration.spec.ts`; [navigation payload 계약](./react-navigation-payload.ko.md)에 HTTP/prefetch 추가 근거가 있습니다. 이는 **기존** 동작 기록이며 이 변경에서 새 browser/performance 실행을 했다는 뜻이 아닙니다. 예제의 native form과 짧은 shell counter는 실제 유료 player나 향후 제품 게이트가 아닙니다. Docs 검증은 link/구조와 EN/KO 쌍을 확인할 뿐 미래 runtime 성공은 보장하지 않습니다. Book chapter는 현재 framework 동작 또는 앱 소유 교육 정책을 설명하고 이 미래 제품 계약은 어느 쪽도 바꾸지 않으므로 이 범위의 Book chapter는 수정하지 않습니다.
