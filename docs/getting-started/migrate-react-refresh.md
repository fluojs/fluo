# Migrate React current-page refresh

<p><strong><kbd>English</kbd></strong> <a href="./migrate-react-refresh.ko.md"><kbd>한국어</kbd></a></p>

`useRouter().refresh()` from `@fluojs/react/client` previously called
`window.location.reload()`. It now returns `Promise<ReactRevalidationResult>` and, with
`ReactClientRouterProvider.navigationModules`, requests the current pathname and query
through the existing credentialed, no-store HTTP navigation loader. This is a breaking
behavioral change for callers that relied on a document lifecycle restart.

| Previous intent | Migration |
| --- | --- |
| Obtain fresh server-approved current-page props without replacing the shell | `const result = await router.refresh()`; inspect `result.status` before treating the operation as successful. |
| Force a document reload, restarting providers and resources | Call `window.location.reload()` directly. |
| Refresh a page without a built soft destination | `router.refresh()` initiates a document reload and returns `{ status: 'document' }`; that outcome reports initiation, not document load. |
| Trigger another load after a mutation | Call `router.invalidate()` after the mutation, then `await router.refresh()`; mutation/fetcher integration is application-owned. |

`complete` means validated props and params have committed to the navigation store, not
that the browser has painted or an application component rendered. `error` carries only the
safe `ReactNavigationFailure` (`type: 'refresh'`, pathname without query, and classified
reason); the approved page remains available when `failurePolicy` chooses `'preserve'`.
Show `useNavigation().failure` in a persistent shell with `router.retry()` for a fresh
same-page HTTP attempt and `router.openDocument()` for explicit document recovery.
Without a policy, rejected HTTP results use the ordinary document fallback. An aborted,
superseded, invalidated or disconnected operation settles as `cancelled`, never as an
application failure. During `refreshing`, the previous page remains visible; a successful
approval remounts page-local state but preserves the provider and long-lived shell. URL,
fragment and history entry stay unchanged. This differs from development-time React Fast
Refresh, which can retain compatible component state.

The [navigation payload contract](../contracts/react-navigation-payload.md) owns HTTP
approval, failure ordering, resource lifetime and prefetch separation. The
[@fluojs/react API owner](../../packages/react/README.md) owns the public import and
signature. Native forms still follow HTTP POST/303/GET with JavaScript disabled.
