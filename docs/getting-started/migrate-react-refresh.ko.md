# React 현재 페이지 refresh 이전

<p><a href="./migrate-react-refresh.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

`@fluojs/react/client`의 `useRouter().refresh()`는 이전에
`window.location.reload()`를 호출했습니다. 이제 `Promise<ReactRevalidationResult>`를
반환하며 `ReactClientRouterProvider.navigationModules`가 있으면 기존 credential 포함,
no-store HTTP navigation loader로 현재 pathname/query를 다시 요청합니다. 문서 lifecycle
재시작에 의존하던 소비자에게는 breaking behavior 변경입니다.

| 이전 의도 | 이전 방법 |
| --- | --- |
| 셸을 교체하지 않고 서버가 승인한 현재 page의 새 props 받기 | `const result = await router.refresh()` 이후 `result.status`를 확인합니다. |
| Provider와 자원을 재시작하는 확정적 문서 reload | `window.location.reload()`를 직접 호출합니다. |
| Built soft destination 없는 page의 refresh | `router.refresh()`는 문서 reload를 시작하고 `{ status: 'document' }`를 반환합니다. 이는 로드 완료가 아닙니다. |
| Mutation 뒤 새 데이터 요청 | Mutation 뒤 `router.invalidate()`를 호출하고 `await router.refresh()`로 결과를 확인합니다. Mutation/fetcher 연동은 application 책임입니다. |

`complete`는 검증한 props/params가 navigation store에 commit되었다는 뜻이지
browser paint나 application component 렌더 완료가 아닙니다. `error`에는 안전한
`ReactNavigationFailure`(`type: 'refresh'`, query 없는 pathname, 분류된 reason)만
포함되며 `failurePolicy`가 `'preserve'`를 선택하면 이전 승인 page를 유지합니다.
지속 셸에 `useNavigation().failure`를 표시하고 같은 page의 새 HTTP 시도에는
`router.retry()`, 명시적 문서 복구에는 `router.openDocument()`를 사용하세요.
정책이 없으면 거부된 HTTP 결과는 일반 document fallback입니다. Abort, supersession,
invalidation, disconnect는 `cancelled`로 정착하며 application failure가 아닙니다.
`refreshing` 동안 이전 page가 표시되고 승인에 성공하면 page-local state만 remount하며
provider와 장기 셸을 유지합니다. URL·fragment·history entry는 바꾸지 않습니다.
이는 호환되는 component state를 유지할 수 있는 개발 중 React Fast Refresh와 다릅니다.

HTTP 승인, 실패 순서, resource lifetime, prefetch 구분은
[navigation payload 계약](../contracts/react-navigation-payload.ko.md)이 소유하고
public import/signature는 [@fluojs/react API owner](../../packages/react/README.ko.md)가
소유합니다. JavaScript가 비활성화되어도 native form은 HTTP POST/303/GET을 유지합니다.


## Progressive native HTTP forms

[Progressive form 계약](../contracts/react-progressive-forms.ko.md)은 기존 provider의 `useForm`과 root의
`ReactModule.formResult`를 하나의 native HTTP 경로로 연결합니다. DTO/guard/interceptor,
request scope, status/error는 HTTP가 계속 소유하며 native POST/303/GET을 유지합니다.
`saved`와 follow-up read 실패, validation/auth와 uncertain persistence를 구분하고
`retryRead()`는 GET만 수행합니다. busy activation은 skip하며 자동 POST retry/replay는 없습니다.
자동 form refresh는 다른 form의 input/error/focus와 shell을 유지하고 기존 명시적
`useRouter().refresh()`의 승인 후 page reset 의미는 바꾸지 않습니다.
