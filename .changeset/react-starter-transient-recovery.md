---
"@fluojs/cli": minor
---

Generated `react-vite-ssr` applications now preserve their approved shell on network,
HTTP 5xx, and recoverable mapped page-import soft-navigation failures. The persistent shell
provides fresh HTTP retry and explicit ordinary-document navigation while retaining its live
resources. Authentication rejection, redirects, missing pages, DTO rejection, malformed
payloads, and unsupported module keys still use document fallback.

Migration: Existing generated applications are not rewritten. Pass an explicit
network/5xx/mapped-import-failure `failurePolicy` to the shared `ReactClientRouterProvider` and place
`useNavigation().failure` with `router.retry()` and `router.openDocument()` controls outside
the destination page slot, as shown in the updated starter composition guide.
