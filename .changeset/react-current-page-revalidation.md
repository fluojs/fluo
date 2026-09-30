---
"@fluojs/react": minor
"@fluojs/cli": minor
---

Change `useRouter().refresh()` from a document reload to fresh HTTP-approved current-page
revalidation with a typed completion, preserved shell, and page-local reset on approval.
Existing consumers requiring an unconditional document reload must use
`window.location.reload()`. Generated React starters expose current-page refresh and
retain failure/retry controls in the shared shell. See
`docs/getting-started/migrate-react-refresh.md` for the completion and fallback boundary.
