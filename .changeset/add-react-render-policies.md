---
"@fluojs/react": minor
---

Add class- and method-level `PageLayout` and `SuspenseFallback` component-reference policies, pass resolved policies and the active request-scope container to the application page renderer, and reject invalid policy declarations during bootstrap.

Applications that construct `ReactRenderContext` objects themselves, including custom renderer adapters and test fixtures, must now provide the active request-scope container as `container: requestContext.container` or an equivalent `Container`. Applications that receive the context from fluo's `ReactPageRenderer` callback require no migration.
