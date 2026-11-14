---
"@fluojs/di": minor
---

Close provider registration validation gaps and honor explicit scopes on value and alias providers.

- Non-boolean `multi` flags, non-constructor factory `resolverClass` values, and direct self-aliases such as `{ provide: 'S', useExisting: 'S' }` now throw `InvalidProviderError` at registration instead of being misclassified, failing with a raw `TypeError`, or failing later as a circular dependency.
- `ValueProvider` and `ExistingProvider` accept an optional `scope` (default `'singleton'`). Value providers honor it: `'transient'` values are neither cached nor disposed by the container, and `'request'` values are cached per request scope, so request scopes can register value and alias providers with `scope: 'request'`.
- Aliases never own an instance; the target's scope still decides the instance lifetime. A `'request'` alias is resolvable only inside a request scope and makes singleton consumers fail with `ScopeMismatchError` naming the alias.

Inputs that were silently accepted before now either throw or behave according to their declared scope. Remove invalid `multi`/`resolverClass` values and self-aliases, and drop an explicit `scope` from value or alias providers if you relied on it being ignored.
