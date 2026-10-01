# Migrate progressive native HTTP forms

<p><a href="./migrate-react-progressive-forms.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Upgrade and preserve the baseline

영향받는 `@fluojs/react`, `@fluojs/http`, `@fluojs/cli` release를 함께 올립니다.
additive opt-in이며 기존 native `@Post`/`@RequestDto` handler와 `303` destination은
계속 동작합니다. 기존 required `errorRepresentation.html` 설정은 그대로이고 안전한
DTO `form.project` option을 함께 추가합니다.

실제 action, method, encoding, named submitter, hidden CSRF field와 host body parser를
유지합니다. 공식 Fastify starter는 URL-encoded parsing을 등록하고 demo session 및
CRUD에 `/catalog/login`, `/catalog`, `/catalog/:sku`를 사용합니다. demo cookie와
process-local map은 production identity service나 durable database가 아닙니다.

## Replace application-local mutation fetch

기존 provider 안에서 `@fluojs/react/client`의 `useForm`을 사용하고 native form에
`formProps`, 작성한 DTO name에 `fieldProps`/`fieldErrors`를 연결합니다. field value는
browser string이며 DTO conversion과 validation은 HTTP가 소유합니다. DTO class와
numeric DTO field name을 typing할 수 있지만 browser string을 검증된 number로
취급하지 않습니다.

일반 handler에서 저장 확인 뒤에만 `ReactModule.formResult({ destination, followUp })`를
반환합니다. current-page approval은 `refresh`, HTTP-approved destination 이동은
`navigate`를 선택합니다. application same-origin destination policy를 유지하며 helper가
client action route를 match하지 않습니다.

DTO 안전 오류는 `errorRepresentation.form.project`로 설정합니다. 명시적인 안전 domain
거절에는 `HttpFormRejection.create(...)`를 throw합니다. generic 400/422의 exception
details를 field error로 바꾸지 않습니다. native fallback에는 기존 HTML provider를
설정해 escaped, allowlisted nonsecret input만 유지합니다. password/token value를
반사하지 마세요.

## Update outcome and recovery UI

End-to-end inference에는 같은 application tsconfig/bootstrap options로 생성하고 복제한
Input type과 `fields` map 대신 generated `reactFormRoutes[id].contract`를 사용합니다.
그 route의 `href`를 같은 `useForm`의 `action`에 전달하며 `fields`와 `contract`를 함께
전달하지 않습니다. 저장 후 기존 `ReactModule.formResult`로 optional JSON `data`를
반환하고 `state.mutation.status === 'saved'`로 좁힌 뒤 추론된 data를 읽습니다. Decoder는
destination policy 전에 malformed saved data를 protocol uncertainty로 거부합니다.
GET `decodeRead` 지원을 생성하지 않습니다. V2 freshness와 일반 typecheck/build 전 필수
`--check`는 [typegen 이주](./migrate-react-typegen.ko.md)를 참고하세요.

`state.pending`, `state.dirty`, `state.mutation`, `state.followUp`을 읽습니다.
안전한 message만 렌더링하고 field error element id를 `${id}-${field}-errors`로 연결합니다.
다른 form의 input과 focus를 유지합니다.

`mutation.status === 'saved'`와 follow-up completion은 별개입니다. saved/read-failed 상태를
보여주고 `retryRead()`로 GET-only recovery를 수행합니다. `uncertain`은 dispatch한 write가
저장됐을 수 있음을 뜻합니다. input을 유지하고 authoritative read를 제공하며 새 POST는
중복 위험을 설명한 명시적 사용자 결정으로 만듭니다. 자동 POST retry/native replay는 없습니다.

busy activation은 queue 대신 skip합니다. `cancel()`은 waiting을 취소하며 server transaction을
취소하지 않습니다. route/unmount/provider 변경은 이전 interaction을 obsolete 처리합니다.
기존 application session/prefetch scope boundary를 제공하세요. identity coordination은
여전히 #3875가 소유하며 form helper가 암묵적으로 구현하지 않습니다.

automatic same-page form refresh는 다른 form state와 shell을 유지합니다. 기존 명시적
`useRouter().refresh()`는 승인 후 page state를 의도적으로 reset합니다. 이를 optimistic
cache write로 대체하지 마세요.

## Executable reference and evidence

[공식 example](../../examples/react-vite-ssr/README.ko.md) 또는 clean React Vite starter를
사용합니다. production browser journey는 native POST/303/GET, correction, pending,
authorization/CSRF, duplicate activation, uncertain completion, read-only recovery를
검증합니다. example의 명시적 fault entry는 deterministic verification 전용이며 일반
startup은 정상 production entry를 사용합니다.

protocol과 ownership은 [owning form contract](../contracts/react-progressive-forms.ko.md)가
정의합니다. v2 build identity/params/metadata는
[navigation payload](../contracts/react-navigation-payload.ko.md)가 계속 소유합니다.
#3880은 같은 interaction의 typed projection을 제공합니다. #3881의 non-navigation 작업과
#3882의 opt-in dirty/pending guard는 별도 확장이며 이 migration의 추가 API가 아닙니다.
