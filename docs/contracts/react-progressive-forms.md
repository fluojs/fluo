# Progressive native HTTP forms

<p><strong><kbd>English</kbd></strong> <a href="./react-progressive-forms.ko.md"><kbd>한국어</kbd></a></p>

## Ownership and canonical path

An ordinary HTML form, a matched HTTP `@Post`/`@RequestDto` handler, and the
existing React provider are the single form path. `useForm` comes from
`@fluojs/react/client`; `ReactModule.formResult` comes from `@fluojs/react`.
HTTP continues to own route matching, input binding and validation, middleware,
guards, interceptors, request scope, headers, status, error filters, abort and
response commit. There is no client DTO validator, action router, compiled
Server Action, or second cache/provider.

The form keeps real `action`, `method="post"` and
`enctype="application/x-www-form-urlencoded"` attributes in SSR. Before provider
connection and with JavaScript disabled it submits normally. A confirmed
handler result returns native `303` and its application-approved document
destination. The host must support the authored encoding; the Fastify example
and starter register its native URL-encoded parser explicitly.

```ts
return ReactModule.formResult({
  destination: `/catalog/${input.sku}`,
  followUp: 'refresh',
});
```

Create that result **after** confirmed persistence. The API does not execute,
deduplicate or roll back a write. Rejected HTTP status never becomes a saved
acknowledgement. Existing native redirects remain native.

## Eligible submission and native fallback

`useForm({ id, action, actions, fields, allowDestination })` binds an ordinary
form through the existing provider. `id` is stable and unique in that provider;
`fields` maps typed DTO field names to authored successful-control names.
`actions` is an exact application-authored allowlist, defaulting to `[action]`.
It does not perform route matching.

For compiler-projected handlers, use `useForm({ id, action, contract,
allowDestination })` with `reactFormRoutes[id].contract` and its generated `href`.
The contract supplies HTTP-owned field/control aliases and `decodeSaved`; do not
also pass `fields`, copy an Input interface or cast saved data. Existing manually
authored `fields` remains supported without generated result inference. Optional
`data` on `ReactModule.formResult` retains literal/union inference and is checked
as limited JSON on acknowledgement, before asynchronous destination policy.
Malformed data is protocol uncertainty, not confirmed typed persistence.
Optional explicit `session` still uses the existing session barrier. Neither
generated GET decoding nor `decodeRead` is promised here (#3881). Supported shapes,
converter wire declarations and freshness belong to the
[end-to-end types contract](./react-end-to-end-types.md).

Resolve the actual submitter and its `formaction`, `formmethod`, `formenctype`
and `formtarget` before interception. Supported same-origin URL-encoded POSTs
retain duplicate names, enabled successful controls, the selected submitter,
hidden CSRF controls and browser validity/`novalidate` behavior. File controls,
image submitters, other encodings, methods, targets, origins, unsupported actions,
unconnected providers and an unapproved browser URL stay native before any
enhanced POST. A consumer-prevented submit stays prevented.

The browser supplies same-origin credentials. Interaction fetches use
`credentials: 'same-origin'`, `cache: 'no-store'`, and manual redirects.
Applications supply their usual cookie/auth/origin/CSRF policy. The form helper
does not invent a session or exempt an enhanced request from those policies.

## Negotiated validation and safe disclosure

Only an explicit `Accept: application/vnd.fluo.form+json;v=1` submission opts
into the form representation. The versioned wire outcomes are `saved` or
`validation`; rejected HTTP status and unexpected transport/protocol responses
are not save acknowledgements. Negotiated validation preserves its HTTP status.

Configure `errorRepresentation.form.project` to author safe errors for an actual
DTO-validation rejection. An arbitrary 400/422 is not relabeled by looking at
its details or message. For deliberate domain validation, throw
`HttpFormRejection.create({ fieldErrors, formErrors })` from `@fluojs/http`.
The bounded projection accepts at most 32 field keys, 8 messages per field/form
and 256 characters per message. It emits only field/form message data, not
submitted values, exception bodies, credentials or stacks. Applications remain
responsible for the messages they explicitly author.

Canonical API JSON, absent-Accept behavior, configured HTML representations,
filters, HEAD, abort and committed responses retain HTTP ownership. A native
invalid-submit document may explicitly render escaped, allowlisted nonsecret
input with editable fields and safe errors. Do not reflect an entire body or
retain passwords/tokens. The official catalog demonstrates that opt-in document.

## Local state, concurrency and cancellation

The binding exposes typed field names through `values`, `fieldErrors` and
`fieldProps`, local `pending`/`dirty`, a discriminated `mutation`, and separately
discriminated `followUp`. `fieldProps` associates the authored control with its
error element; that element uses `${id}-${field}-errors`.

One form admits one enhanced POST at a time. Repeated busy activation increments
`skipped`; it is not queued. Separate forms remain independently usable.
After settlement an explicit submit captures current successful controls and
replaces only that form's applicable result. Unchanged input becomes clean on a
confirmed save; input edited during the outstanding write stays dirty.

Dispatched writes may persist despite cancellation, network loss, 5xx or an
unexpected response. `uncertain` is not rollback and not exactly-once
persistence. `cancel()` ends browser waiting, not the server transaction.
There is no automatic POST retry and no enhanced-to-native POST replay.
An explicit resubmission is a new operation and may duplicate a previous save.
The application owns idempotency, transactions and reconciliation.

New route/history intent, provider/session rebinding, explicit cancellation and
unmount cancel obsolete interaction ownership. Late body reads, policy
decisions, acknowledgements and follow-up loads cannot commit through an old
generation. `allowDestination(destination, signal)` may be asynchronous; its
obsolete decision cannot navigate or trigger fallback. An error for another
form cannot take focus from the user's current control.

## Confirmed save and follow-up read

Provider speculation and old navigation reads are invalidated at POST dispatch,
and again after confirmed success before approval. An approved same-origin
HTTP(S) destination must also satisfy the application's destination policy.
An opaque manual redirect or followed login/error document is never interpreted
as a save or a readable Location.

`followUp: 'refresh'` uses the existing provider's current-page approval,
preserving its history entry, fragment, shell/resource identity and unrelated
form inputs/errors/focus. The destination path/query must be the current
approved page. `followUp: 'navigate'` approves the handler's destination through
the existing HTTP navigation loader and commits only its approved payload.
The accepted v2 `navigationBuildId`, params and metadata contract is unchanged.

A failed, cancelled, unsupported or incompatible-build follow-up leaves
`mutation.status === 'saved'`; it does not imply that persistence failed.
`retryRead()` repeats GET approval only. Preserve input and show this distinction
with an explicit read-only recovery control. Existing explicit
`useRouter().refresh()` still intentionally resets page state after successful
approval; automatic form refresh is not a silent redefinition of that API.

## Explicit saved session and data

`ReactModule.formResult` preserves literal options and may include optional `data`
and explicit `session: { epoch, reason }`. Native success remains 303 and negotiated
saved remains v1. Saved data accepts only finite JSON primitives, dense arrays and
plain objects: Date, classes, functions, undefined members, hooks/accessors and
cycles are rejected without invoking `toJSON`. A generated
`ReactFormContract<Input, Data> { fields; decodeSaved(value: unknown): Data }` enters
the same `useForm({ contract, ... })`; malformed decoded data is protocol uncertainty,
not a typed cast or persistence rollback. Handwritten fields do not assert saved types.

An explicit saved session enters the router's common revocation barrier before
asynchronous session/destination policy. Only the initiating form's confirmed safe
saved continuation transfers; unrelated old writes/results and retained values are
obsolete. Logout may settle without a GET; login/permission acknowledgement uses
the handler's fresh follow-up GET rather than issuing an extra page refresh.
GET retry never resends POST or repeats the explicit session notification.
Fresh POST/follow-up 401 and 403 enter auth policy instead of unconditional old-page
preservation. A rejected follow-up remains separate from confirmed `saved`.
Ordinary mutations continue preserving unrelated inputs/errors/focus.

## Companion ownership

[Product acceptance](./react-fullstack-product.md),
[navigation payload](./react-navigation-payload.md), and
[HTTP error representations](../architecture/http-error-representations.md)
remain governing companions. See the [usage guide](../guides/react-user-concepts.md),
[consumer migration](../getting-started/migrate-react-progressive-forms.md), and
[runnable example](../../examples/react-vite-ssr/README.md).

The typed names/outcomes consume the same #3880 projection; #3881 extends this
same interaction for non-navigation work and #3882 consumes dirty/pending state
for opt-in navigation guards. None introduces a competing form API here.
#3875 supplies the documented application session composition. Optimistic cache mutation,
comprehensive uploads, distributed duplicate protection and those follow-up
issues are not provided by this contract.
