# Migrate progressive native HTTP forms

<p><strong><kbd>English</kbd></strong> <a href="./migrate-react-progressive-forms.ko.md"><kbd>한국어</kbd></a></p>

## Upgrade and preserve the baseline

Upgrade the affected `@fluojs/react`, `@fluojs/http` and `@fluojs/cli` releases
together. This is an additive opt-in: existing native `@Post`/`@RequestDto`
handlers and `303` destinations still work. The existing required
`errorRepresentation.html` configuration is unchanged; the safe DTO
`form.project` option is added alongside it.

Keep the real form action, method, encoding, named submitter, hidden CSRF fields
and the host's body parser. The official Fastify starter registers URL-encoded
parsing and uses `/catalog/login`, `/catalog`, `/catalog/:sku` for its demo
session and CRUD journey. That demo cookie and process-local map are not a
production identity service or durable database.

## Replace application-local mutation fetch

Use `useForm` from `@fluojs/react/client` inside the existing provider, spread
`formProps` on a native form, and use `fieldProps`/`fieldErrors` for authored DTO
names. Field values remain browser strings; HTTP owns DTO conversion and
validation. DTO classes and numeric DTO field names can be typed without
pretending that a browser string is an already-validated number.

Return `ReactModule.formResult({ destination, followUp })` from the ordinary
handler only after confirming persistence. Choose `refresh` for current-page
approval and `navigate` for an HTTP-approved destination. Keep an application
same-origin destination policy; the helper does not match a client action route.

Configure safe DTO errors with `errorRepresentation.form.project`. Throw
`HttpFormRejection.create(...)` for an explicitly safe domain rejection.
Generic 400/422 responses do not acquire field errors from exception details.
For the native fallback, configure the existing HTML provider to retain only
escaped, allowlisted nonsecret input. Do not reflect passwords or token values.

## Update outcome and recovery UI

For end-to-end inference, generate with the same application tsconfig/bootstrap
options and replace copied Input types and `fields` maps with the generated
`reactFormRoutes[id].contract`. Use that route's `href` as `action` in the same
`useForm`; do not pass both `fields` and `contract`. Return optional JSON `data`
through the existing `ReactModule.formResult` after persistence and narrow
`state.mutation.status === 'saved'` before reading inferred data. Its decoder
rejects malformed saved data as protocol uncertainty before destination policy.
This does not generate GET `decodeRead` support. See the
[typegen migration](./migrate-react-typegen.md) for v2 freshness and mandatory
`--check` before ordinary typecheck/build.

Read `state.pending`, `state.dirty`, `state.mutation` and `state.followUp`.
Render only safe messages and associate each field error element with the
`${id}-${field}-errors` id. Keep unrelated form input and focus intact.

`mutation.status === 'saved'` is separate from follow-up completion.
Show a saved/read-failed state and use `retryRead()` for GET-only recovery.
`uncertain` means a dispatched write may have persisted: keep input, offer an
authoritative read, and make any new POST an explicit user decision with
duplicate risk. There is no automatic POST retry or native replay.

Busy activation is skipped rather than queued. `cancel()` cancels waiting,
not the server transaction. Route/unmount/provider changes obsolete the old
interaction. Supply the existing application session/prefetch scope boundary;
identity coordination remains #3875, not an implicit form-helper feature.

Automatic same-page form refresh preserves unrelated form state and the shell.
Existing explicit `useRouter().refresh()` still intentionally resets page state
after approval. Do not replace it with an optimistic cache write.

## Executable reference and evidence

Use the [official example](../../examples/react-vite-ssr/README.md) or a clean
React Vite starter. Their production browser journey exercises native
POST/303/GET, correction, pending, authorization/CSRF, duplicate activation,
uncertain completion and read-only recovery. The example's explicit fault
entry is for deterministic verification only; normal startup uses the normal
production entry.

The [owning form contract](../contracts/react-progressive-forms.md) defines
the protocol and ownership. [Navigation payload](../contracts/react-navigation-payload.md)
continues to own v2 build identity/params/metadata. #3880 supplies this interaction's
typed projection; #3881's non-navigation work and #3882's opt-in dirty/pending
guards remain separate extensions, not additional APIs supplied by this migration.
