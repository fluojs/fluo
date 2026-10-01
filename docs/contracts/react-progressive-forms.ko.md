# Progressive native HTTP forms

<p><a href="./react-progressive-forms.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Ownership and canonical path

일반 HTML form, HTTP가 match한 `@Post`/`@RequestDto` handler, 기존 React provider가
유일한 form 경로입니다. `useForm`은 `@fluojs/react/client`, `ReactModule.formResult`는
`@fluojs/react`에서 가져옵니다. route matching, 입력 binding/validation, middleware,
guard, interceptor, request scope, header, status, error filter, abort, response
commit은 계속 HTTP가 소유합니다. client DTO validator, action router, compiled
Server Action이나 별도 cache/provider를 만들지 않습니다.

SSR에도 실제 `action`, `method="post"`,
`enctype="application/x-www-form-urlencoded"`를 유지합니다. provider 연결 전과
JavaScript disabled 상태에서는 그대로 native submit합니다. 저장을 확인한 handler
결과는 native `303`과 application이 허용한 document destination을 반환합니다.
host가 작성한 encoding을 지원해야 하며 Fastify example과 starter는 native
URL-encoded parser를 명시적으로 등록합니다.

```ts
return ReactModule.formResult({
  destination: `/catalog/${input.sku}`,
  followUp: 'refresh',
});
```

저장이 확인된 **뒤에** 결과를 만드세요. 이 API는 write를 실행하거나 중복 제거하거나
rollback하지 않습니다. 거절된 HTTP status는 saved acknowledgement가 되지 않습니다.
기존 native redirect는 계속 native 경로입니다.

## Eligible submission and native fallback

`useForm({ id, action, actions, fields, allowDestination })`은 기존 provider를 통해
일반 form에 연결합니다. `id`는 해당 provider에서 안정적이고 고유해야 하며 `fields`는
typed DTO field name을 작성한 successful-control name에 연결합니다. `actions`는
application이 작성한 정확한 allowlist이며 기본값은 `[action]`입니다. route를 match하지
않습니다.

Compiler-projected handler에는 `reactFormRoutes[id].contract`와 generated `href`를
기존 `useForm({ id, action, contract, allowDestination })`에 전달합니다. Contract가
HTTP-owned field/control alias와 `decodeSaved`를 제공하므로 `fields`를 함께 전달하거나
Input interface를 복제하거나 saved data를 cast하지 않습니다. 수동 `fields` 경로는
generated result inference 없이 계속 지원합니다. `ReactModule.formResult`의 optional
`data`는 literal/union inference를 유지하며 acknowledgement에서 비동기 destination
policy 전에 limited JSON으로 검증합니다. Malformed data는 protocol uncertainty이며
typed persistence 확인이 아닙니다. Optional explicit `session`은 기존 session barrier를
사용합니다. Generated GET decoding이나 `decodeRead`는 여기서 약속하지 않습니다(#3881).
지원 shape, converter wire 선언, freshness는
[end-to-end 타입 계약](./react-end-to-end-types.ko.md)을 따릅니다.

interception 전에 실제 submitter와 `formaction`, `formmethod`, `formenctype`,
`formtarget`을 해석합니다. 지원하는 same-origin URL-encoded POST는 duplicate name,
활성 successful control, 선택한 submitter, hidden CSRF control, 브라우저
validity/`novalidate` 의미를 유지합니다. file control, image submitter, 다른 encoding,
method, target, origin, 미지원 action, 연결되지 않은 provider와 미승인 browser URL은
enhanced POST를 보내기 전에 native 경로에 남습니다. consumer가 막은 submit은 계속
막힌 상태입니다.

same-origin credential은 브라우저가 제공합니다. interaction fetch는
`credentials: 'same-origin'`, `cache: 'no-store'`, manual redirect를 사용합니다.
application은 기존 cookie/auth/origin/CSRF 정책을 제공합니다. helper가 session을
만들거나 enhanced request를 정책에서 면제하지 않습니다.

## Negotiated validation and safe disclosure

명시적인 `Accept: application/vnd.fluo.form+json;v=1`만 form representation에 opt-in합니다.
versioned wire outcome은 `saved` 또는 `validation`이며 거절된 HTTP status와 예상하지
못한 transport/protocol response는 save acknowledgement가 아닙니다. negotiated
validation은 HTTP status를 유지합니다.

실제 DTO validation 거절의 안전한 오류는 `errorRepresentation.form.project`로
작성합니다. 임의의 400/422를 details나 message를 보고 validation으로 바꾸지 않습니다.
명시적인 domain validation에는 `@fluojs/http`의
`HttpFormRejection.create({ fieldErrors, formErrors })`를 throw합니다. bounded projection은
field key 32개, field/form별 message 8개, message당 256자까지 허용합니다. field/form
message만 내보내며 제출 값, exception body, credential, stack을 추가하지 않습니다.
application이 직접 작성한 message의 안전성은 application 책임입니다.

canonical API JSON, absent-Accept, 설정한 HTML representation, filter, HEAD, abort,
committed response는 HTTP가 계속 소유합니다. native invalid-submit document는 escaped,
allowlisted nonsecret input과 수정 가능한 field 및 안전한 오류를 명시적으로 렌더링할
수 있습니다. 전체 body를 반사하거나 password/token을 유지하지 마세요. 공식 catalog가
이 opt-in document를 보여줍니다.

## Local state, concurrency and cancellation

binding은 `values`, `fieldErrors`, `fieldProps`의 typed field name, local
`pending`/`dirty`, discriminated `mutation`, 별도로 discriminated된 `followUp`을 제공합니다.
`fieldProps`는 작성한 control을 error element에 연결하며 element id는
`${id}-${field}-errors`입니다.

한 form은 enhanced POST 하나만 진행합니다. busy 상태의 반복 activation은 `skipped`를
증가시키고 queue에 넣지 않습니다. 별도 form은 독립적으로 사용할 수 있습니다.
settlement 뒤의 명시적 submit은 현재 successful control을 capture하고 그 form의
적용 가능한 결과만 대체합니다. 저장 확인 시 제출 이후 변하지 않은 input은 clean이
되며 진행 중 수정한 input은 dirty 상태를 유지합니다.

dispatch한 write는 cancellation, network loss, 5xx, 예상하지 못한 response에도 저장될
수 있습니다. `uncertain`은 rollback이나 exactly-once persistence가 아닙니다.
`cancel()`은 browser waiting을 끝내며 server transaction을 취소하지 않습니다.
자동 POST retry와 enhanced-to-native POST replay는 없습니다. 명시적 resubmission은
새 operation이며 이전 save를 중복할 수 있습니다. idempotency, transaction,
reconciliation은 application 책임입니다.

새 route/history intent, provider/session rebinding, 명시적 cancellation, unmount는 이전
interaction ownership을 취소합니다. 늦은 body read, policy decision, acknowledgement,
follow-up load는 이전 generation으로 commit할 수 없습니다.
`allowDestination(destination, signal)`은 async일 수 있으며 오래된 결정이 navigation이나
fallback을 시작하지 못합니다. 다른 form의 오류가 현재 control의 focus를 가져가지 않습니다.

## Confirmed save and follow-up read

POST dispatch 시 provider speculation과 이전 navigation read를 무효화하고 저장 확인 뒤
approval 전에 다시 무효화합니다. 승인할 same-origin HTTP(S) destination은 application의
destination policy도 통과해야 합니다. opaque manual redirect나 따라간 login/error
document를 save 또는 읽을 수 있는 Location으로 해석하지 않습니다.

`followUp: 'refresh'`는 기존 provider의 current-page approval을 사용해 history entry,
fragment, shell/resource identity와 다른 form의 input/error/focus를 유지합니다.
destination path/query는 현재 승인된 page여야 합니다. `followUp: 'navigate'`는 기존
HTTP navigation loader로 handler destination을 승인하고 승인한 payload만 commit합니다.
기존 v2 `navigationBuildId`, params, metadata 계약은 그대로입니다.

실패, 취소, 미지원 destination 또는 incompatible-build follow-up도
`mutation.status === 'saved'`를 유지하며 저장 실패를 뜻하지 않습니다. `retryRead()`는
GET approval만 반복합니다. input을 유지하고 이 차이를 명시적 read-only recovery control로
보여주세요. 기존 `useRouter().refresh()`는 승인 성공 뒤 page state를 의도적으로 reset합니다.
automatic form refresh가 그 API를 몰래 재정의하지 않습니다.

## Explicit saved session and data

`ReactModule.formResult`는 option literal을 유지하며 선택적 `data`와 명시적인
`session: { epoch, reason }`를 포함할 수 있습니다. Native 성공은 303, 협상한 saved는
v1입니다. Saved data는 finite JSON primitive, dense array, plain object만 허용합니다.
Date/class/function/undefined member/hook/accessor/cycle은 `toJSON`을 실행하지 않고
거절합니다. Generated
`ReactFormContract<Input, Data> { fields; decodeSaved(value: unknown): Data }`를 기존
`useForm({ contract, ... })`에 전달합니다. 잘못된 decoded data는 protocol uncertainty이며
typed cast나 persistence rollback이 아닙니다. 수동 fields로 saved type을 주장하지 않습니다.

명시적 saved session은 async session/destination policy 전에 router의 동일한 철회
barrier를 통과합니다. Initiating form의 확인된 safe saved continuation만 이관하며 다른
이전 write/result/retained value는 무효입니다. Logout은 GET 없이 정착할 수 있습니다.
Login/permission acknowledgement는 별도 page refresh 대신 handler의 fresh follow-up GET을
사용합니다. GET retry는 POST나 explicit session notification을 반복하지 않습니다.
Fresh POST/follow-up 401·403은 이전 화면을 무조건 보존하지 않고 auth policy에 전달됩니다.
거절된 follow-up은 confirmed `saved`와 별개입니다. 일반 mutation은 다른 input/error/focus의
보존을 계속 유지합니다.

## Companion ownership

[제품 acceptance](./react-fullstack-product.ko.md),
[navigation payload](./react-navigation-payload.ko.md),
[HTTP error representation](../architecture/http-error-representations.ko.md)이
계속 governing companion입니다. [사용 guide](../guides/react-user-concepts.ko.md),
[consumer migration](../getting-started/migrate-react-progressive-forms.ko.md),
[실행 가능한 example](../../examples/react-vite-ssr/README.ko.md)을 함께 보세요.

typed name/outcome은 같은 #3880 projection을 소비하며 #3881은 같은 interaction의
non-navigation 작업을 확장하고 #3882는 dirty/pending state로 opt-in navigation guard를
구현합니다. 여기서 경쟁하는 form API를 만들지 않습니다. application session coordination은
#3875가 소유합니다. optimistic cache mutation, 포괄적인 upload 지원, distributed
duplicate protection과 해당 후속 이슈 구현은 이 계약에서 제공하지 않습니다.
