# Migrate React navigation guards

<p><strong><kbd>English</kbd></strong> <a href="./migrate-react-navigation-guards.ko.md"><kbd>한국어</kbd></a></p>

## One provider and decision owner

Upgrade `@fluojs/react` and the generated `@fluojs/cli` composition together.
Existing apps remain unprotected unless they opt in. Inside the existing provider,
import `useNavigationGuard` from `@fluojs/react/client` and pass
`{ when: form.state.dirty || form.state.pending }`. Combine other inputs and app work
in that one owner; do not install another router or intercept history globally.
Render `decision?.stay` and `decision?.proceed` buttons outside blocking session UI.
An optional `confirm(intent, signal)` returns boolean or Promise<boolean>. Respect
its signal and release application resources; the store does not wait for ignored
signals. Old callbacks cannot redirect or approve a later intent.

## Save, read and leave order

Observe confirmed saved, then current dirty: only unchanged input becomes clean.
Explicitly proceed on the current decision after saving; validation/uncertain and
old saved completions must not automatically navigate. Waiting or staying does not
cancel pending POST. Approved leave cancels obsolete navigation-owned work, not a
server transaction. Keep `allowDestination` as the existing post-save constraint.
Form refresh preserves unrelated drafts; navigate follow-up requests permission
and fresh GET. Cancelled/failed follow-up retains saved and `retryRead()` repeats
GET only. Explicit `router.refresh()` remains intentional current-page reset, not
a leave-approval replacement. This explicit data revalidation does not invoke the
leave guard and revokes the old decision; do not wire it as a draft-preservation
button. A late saved navigate loses leave authority after a newer user intent,
even when the user stays. Keep saved and explicitly retry GET for a new current decision.

## History, auth and native boundaries

Guard-only providers tag initial and soft history entries and reuse managed
same-document restoration without duplicate entries. Untagged entries have no
reliable restoration delta and remain ordinary document boundaries. Native
fragments do not mean query/path approval. Modified/new-tab/download/external
anchors and pre-hydration/JS-disabled GET/POST forms remain native.
`beforeUnload: true` only requests the browser's separate synchronous exit prompt;
custom text, async save and tab-termination recovery are not promised.

Session changes and fresh credentialed GET/POST/follow-up 401/403 revoke old
content, inputs, head, SSR fallback and decision authority before abort/policy.
The decision UI cannot block logout. Keep configured signed-out/forbidden and
legacy ordinary-document defaults; auth refresh never replays POST.
See the [owning navigation contract](../contracts/react-navigation-payload.md#navigation-permission),
[forms contract](../contracts/react-progressive-forms.md#navigation-permission),
and [runnable example](../../examples/react-vite-ssr/README.md#navigation-permission).
