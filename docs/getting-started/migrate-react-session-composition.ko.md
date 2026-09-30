# Migrate React session composition

Startup은 `FluoFactory.create(AppModule, { adapter })`와 `app.listen()`을 유지합니다.
일반 HTTP handler, validation, origin/CSRF 검사, native POST/303/GET도 유지합니다.
이 변경이 로그인 provider를 설치하거나 cookie를 감지하는 것은 아닙니다.

## Existing provider and router

새 session provider 대신 기존 `ReactClientRouterProvider`에 조립합니다.

```tsx
<ReactClientRouterProvider
  initialSnapshot={snapshot}
  navigationModules={navigationModules}
  navigationBuildId={navigationBuildId}
  session={{ epoch: 'initial-nonsecret-label' }}
>
  {children}
</ReactClientRouterProvider>
```

앱이 login/logout/permission 변경을 확인한 뒤
`router.sessionChanged({ epoch: nextLabel, reason: 'login' })`를 호출합니다.
같은 label도 이전 ownership을 무효화합니다. Controlled epoch prop, 별도 notifier,
prefetch-scope만 바꾸는 경로, cookie 추측은 사용하지 않습니다.
`useRouterState().session`으로 기존 provider의 승인 상태를 읽습니다.

철회는 policy 전에 초기 SSR fallback을 포함한 page 승인/head/retained form data를
제거합니다. Fresh credential 포함 401은 기본 signed-out, 403은 identity를 지우지 않는
forbidden입니다. 선택적 session policy는 barrier 뒤에 실행하며 same-origin 문서 이동을
검증합니다. Transient network/5xx는 기존 failure policy를 유지합니다. 외부 cookie 변경
자체는 cross-tab signal이 아닙니다. 이 in-document 기본값은 configured 또는 명시적으로
활성화된 session-aware 조립에 적용합니다. 미설정 legacy provider는 fresh 401/403 철회
뒤 일반 HTTP document로 이동하여 보호된 plain children을 남기지 않습니다.
`failurePolicy: () => 'preserve'`로 인증 거절 콘텐츠를 보존하지 마세요.
Session policy의 `'refresh'`는 GET/POST 인증 거절 모두 fresh GET 승인으로 소비하며
POST를 재실행하지 않습니다. Saved form의 session policy가 보류된 동안 binding을
취소하면 즉시 대기를 정착시키고 늦은 document exit을 막습니다.

## HTTP forms and saved data

Canonical handler는 다음 결과를 반환할 수 있습니다.

```ts
return ReactModule.formResult({
  destination: '/account', followUp: 'navigate',
  data: { revision: 2 },
  session: { epoch: 'new-nonsecret-label', reason: 'login' },
});
```

명시적 결과는 async destination policy 전에 동일한 barrier를 통과한 뒤 confirmed saved
continuation만 fresh approval로 이관합니다. Saved follow-up 실패는 persistence 실패가
아니며 GET retry는 POST를 재실행하지 않습니다. 일반 mutation은 다른 form 상태를
보존합니다. Native 성공은 303, enhanced saved acknowledgement는 v1을 유지합니다.

Generated contract의 `ReactFormContract<Input, Data>`는 `fields`와
`decodeSaved(value: unknown): Data`를 기존 `useForm({ contract, ... })`에 전달합니다.
수동 `fields`는 unprojected이며 generated saved-data type을 주장할 수 없습니다.
잘못된 decoded data는 protocol uncertainty입니다. Root 경계는 nonfinite/class/Date/
function/hook/accessor/undefined member/sparse array/cycle을 조용히 정규화하지 않고
거절합니다.

## App-owned resources

보호 player/channel/listener는 앱의 기존 session-aware React subtree와 effect cleanup
안에 배치합니다. Runtime에는 public teardown registry가 없습니다. Store settlement는
paint나 SDK disposal receipt가 아니므로 실제 연결 operation과 cleanup을 검증하세요.
Example/starter session fixture는 실제 MessageChannel acknowledgement, 두 port close,
새 session 복구를 검증합니다. Auth 철회는 향후 dirty-confirm 조립보다 우선하며
여기서 future dirty-navigation guard를 제공하는 것은 아닙니다.
