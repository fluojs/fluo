# Migrate React navigation guards

<p><a href="./migrate-react-navigation-guards.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## One provider and decision owner

`@fluojs/react`와 생성된 `@fluojs/cli` 조립을 함께 올립니다. 기존 앱은 opt-in 전에는
보호되지 않습니다. 기존 provider 안에서 `@fluojs/react/client`의 `useNavigationGuard`에
`{ when: form.state.dirty || form.state.pending }`을 전달합니다. 다른 입력과 앱 작업도
소유자 하나에 결합하고 별도 router나 global history interception을 만들지 마세요.
Session UI를 차단하지 않는 `decision?.stay`와 `decision?.proceed` 버튼을 렌더링합니다.
선택적 `confirm(intent, signal)`은 boolean 또는 Promise<boolean>을 반환합니다.
Signal을 지키고 앱 자원을 해제하세요. Store는 signal을 무시하는 promise를 기다리지
않으며 이전 callback은 최신 intent를 redirect하거나 승인하지 못합니다.

## Save, read and leave order

Confirmed saved 뒤 현재 dirty를 확인합니다. 제출 이후 바뀌지 않은 입력만 clean이 됩니다.
저장 뒤 현재 결정의 proceed를 명시적으로 실행하며 validation/uncertain과 오래된
saved 완료로 자동 이동하지 마세요. 대기와 stay는 pending POST를 취소하지 않습니다.
승인한 leave는 이전 navigation 소유 작업을 취소할 뿐 서버 transaction을 되돌리지 않습니다.
`allowDestination`은 기존 저장 후 목적지 제약으로 유지합니다. Form refresh는 다른 초안을
보존하고 navigate follow-up은 승인과 fresh GET을 요청합니다. Read 취소·실패도 saved를
유지하며 `retryRead()`는 GET만 반복합니다. 명시적 `router.refresh()`는 의도적인 현재
page reset이며 leave 승인 대체물이 아닙니다. 이 명시적 데이터 재검증은 leave guard를
호출하지 않고 이전 결정을 철회합니다. 초안 보존 버튼 대신 연결하지 마세요.
새 사용자 intent 뒤 늦은 saved navigate는 사용자가 stay했더라도 leave 권한이 없습니다.
Saved를 유지한 채 명시적 GET-only retry에서 현재 intent의 결정을 새로 요청하세요.

## History, auth and native boundaries

Guard-only provider도 초기·soft entry에 tag를 설치하고 중복 entry 없이 기존 managed
same-document 복원을 재사용합니다. Untagged entry의 복원 delta는 알 수 없으므로 ordinary
document 경계에 남습니다. Native fragment는 query/path 승인이 아닙니다.
Modified/new-tab/download/external anchor와 pre-hydration/JS-disabled GET/POST form은
native로 유지됩니다. `beforeUnload: true`는 별도 동기 exit prompt를 브라우저에 요청할 뿐
custom text, async 저장, 실제 tab 종료 후 복구를 보장하지 않습니다.

Session 변경과 fresh credentialed GET/POST/follow-up 401/403은 abort/policy 전에 이전
content, 입력, head, SSR fallback과 결정 권한을 철회합니다. 결정 UI는 logout을 막지 못합니다.
Configured signed-out/forbidden과 legacy ordinary-document 기본값을 유지하며 auth refresh는
POST를 replay하지 않습니다. [Owning navigation 계약](../contracts/react-navigation-payload.ko.md#navigation-permission),
[forms 계약](../contracts/react-progressive-forms.ko.md#navigation-permission),
[실행 example](../../examples/react-vite-ssr/README.ko.md#navigation-permission)을 참고하세요.
