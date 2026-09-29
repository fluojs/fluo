---
"@fluojs/cli": minor
---

Generated `react-vite-ssr` applications now preserve their approved shell on network and
HTTP 5xx soft-navigation failures. The persistent shell provides fresh HTTP retry and explicit
ordinary-document navigation while retaining its live resources. Authentication rejection,
redirects, missing pages, DTO rejection and malformed payloads still use document fallback.

Migration: Existing generated applications are not rewritten. Pass an explicit network/5xx
`failurePolicy` to the shared `ReactClientRouterProvider` and place
`useNavigation().failure` with `router.retry()` and `router.openDocument()` controls outside
the destination page slot, as shown in the updated starter composition guide.
