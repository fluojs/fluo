---
"@fluojs/http": minor
"@fluojs/platform-nextjs": minor
---

Add opt-in `createNextAdapter({ headRouting: 'explicit-or-get' })` routing for
Next automatic HEAD and direct HEAD exports. Select explicit HEAD, then ALL,
then GET before one dispatch, preserve the original HEAD method and response
metadata, and cancel active response streams before awaiting request cleanup.
Handler-produced 404 responses never trigger a retry.

The shared HTTP matcher accepts the corresponding adapter-owned
`FrameworkRequest.headRouting` field. Existing generic routing and adapters
without the option retain their defaults; no path wildcard grammar is added.

Migration: consumers opting in can remove wrappers that rewrite HEAD to GET and
discard the body. Middleware, guards, and handlers now observe the original
HEAD instead of that wrapper's GET, so update method-based application branches.
