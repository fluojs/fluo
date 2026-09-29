---
"@fluojs/react": minor
---

Add an opt-in client navigation failure policy with safe typed reasons, shell-preserving
network/5xx and recoverable mapped import-failure recovery, fresh HTTP retry, explicit document
exit, and failed history traversal restoration. Existing providers continue using full-document
fallback without opt-in.

Migration: Apps that want a persistent shell on transient failures should pass
`failurePolicy={({ reason }) => reason === 'network' || reason === 'server-error' || reason === 'import-failure' ? 'preserve' : 'document'}`
to `ReactClientRouterProvider`, render `useNavigation().failure` controls in their persistent
shell, and call `router.retry()` or `router.openDocument()` for the user's chosen action.
The generated `react-vite-ssr` starter selects this policy and supplies those controls by
default; existing generated applications must make the same edits to opt in.
Authorization, redirect, invalid payload and explicit reload continue through the normal
HTTP document path unless the app deliberately chooses another policy.
