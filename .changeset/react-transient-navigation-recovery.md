---
"@fluojs/react": minor
---

Add an opt-in client navigation failure policy with safe typed reasons, shell-preserving
network/5xx recovery, fresh HTTP retry, explicit document exit, and failed history traversal
restoration. Existing providers continue using full-document fallback without opt-in.

Migration: Apps that want a persistent shell on transient failures should pass
`failurePolicy={({ reason }) => reason === 'network' || reason === 'server-error' ? 'preserve' : 'document'}`
to `ReactClientRouterProvider`, render `useNavigation().failure` controls in their persistent
shell, and call `router.retry()` or `router.openDocument()` for the user's chosen action.
Authorization, redirect, invalid payload and explicit reload continue through the normal
HTTP document path unless the app deliberately chooses another policy.
