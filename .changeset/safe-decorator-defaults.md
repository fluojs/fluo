---
"@fluojs/http": minor
"@fluojs/openapi": minor
"@fluojs/core": minor
"@fluojs/react": minor
---

Allow omitted or undefined paths for HTTP verb decorators, Sse, Query, Route(method), and React Path, preserving the empty relative path and controller/router prefix. Allow Module(), ApiOperation(), and ApiBody() with the existing empty-object metadata semantics.

Keep required semantic arguments, metadata merge and stacking behavior, React options absence, route validation, and lifecycle contracts unchanged. These fifteen conveniences add factory caller paths, not bare decorator overloads. React uses minor metadata under the current 0.x policy; Changesets combines this intent with pending releases.
