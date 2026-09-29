---
"@fluojs/react": minor
"@fluojs/cli": minor
---

Add an opt-in React page-slot experience with pending announcements, approved-render
error reset, request-selected bounded metadata and overridable focus/scroll effects.
New React starters use this composition and transfer matched page metadata across SSR
and soft navigation.

Existing applications retain low-level provider behavior. To adopt the new defaults,
render `ReactNavigationExperience` inside the existing provider's function child,
pass the initial page and approved destination, and supply the matched initial
`metadata` to `createReactRouteSnapshot`. Remove application-owned title/focus
effects that would compete with page-owned head updates. Render reset does not
retry transport: use the separate #3864 `router.retry()` for fresh HTTP approval.
