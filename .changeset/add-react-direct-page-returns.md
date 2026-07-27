---
"@fluojs/http": patch
"@fluojs/react": minor
---

Add the request-local HTTP response-finalization seam used by React page rendering. Allow `@Path(...)` handlers to return one `ReactElement` through the configured application page renderer, and add stable SSR diagnostic codes and phases for HTTP pipeline failures, pre-commit shell failures, request aborts, and post-shell recoverable errors.
