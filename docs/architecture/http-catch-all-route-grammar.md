# HTTP Catch-All Route Grammar Decision

<p><strong><kbd>English</kbd></strong> <a href="./http-catch-all-route-grammar.ko.md"><kbd>한국어</kbd></a></p>

- Status: Deferred
- Decision date: 2026-07-13
- Issue: [#2499](https://github.com/fluojs/fluo/issues/2499)

## Decision

Catch-all route grammar is deferred. This decision does not add wildcard routes to `@fluojs/http`,
does not change route matching or path-param binding, and does not create a React-only grammar.
Explicit HTTP routes remain the preferred contract.

The `@fluojs/react/client` runtime delivered by
[#2506](https://github.com/fluojs/fluo/issues/2506) does not establish a wildcard requirement. It
uses real anchors and full-document same-origin navigation for pathname or search changes, so the
destination document returns to server-owned HTTP matching, DTO validation, guards, interceptors,
redirects, and not-found handling. Before hydration or with JavaScript disabled, the same anchor
already provides ordinary browser document navigation. A missing explicit server route remains a
normal not-found response; an application or deployment may configure an intentional document
rewrite separately, but that host policy is not a client route grammar.

## Current Contract

The active `@fluojs/http` route grammar remains:

- literal segments such as `/users` and `/healthz`
- full-segment `:param` placeholders such as `/:id`
- duplicate-slash and trailing-slash normalization before matching
- equal segment counts for a parameterized route match
- wildcard prefix matching only for middleware selectors such as `forRoutes('/users/*')`

Route decorators continue to reject catch-all, wildcard, optional, regex-like, and mixed-segment
tokens. `@fluojs/react` `@Router(...)` and `@Path(...)` write the same HTTP metadata and therefore
inherit these rules without exceptions.

## Syntax Evaluation

Two HTTP-owned candidates were considered:

| Candidate | Assessment |
| --- | --- |
| `/*path` | Preferred only if a later HTTP RFC adopts catch-all matching. It is visibly distinct from the current `:param` grammar and makes greediness explicit. |
| `/:path*` | Not preferred. It makes `*` look like an inline modifier on the existing full-segment param syntax, which the current parser intentionally rejects. |

Next.js `[...slug]`, Angular `**`, TanStack splats, and other React- or framework-specific spellings
are not candidates unless a future HTTP RFC independently justifies them as a runtime-neutral fluo
contract.

## Provisional Adoption Contract

Deferral means none of the following behavior is active. A future adoption RFC must either preserve
these provisional constraints or explicitly replace them before implementation:

1. A catch-all is a named, terminal segment. No segment may follow `/*path`.
2. It consumes one or more normalized path segments. The prefix itself still needs an explicit
   route, which keeps `/docs` distinct from `/docs/*path`.
3. Match precedence is `static > param > catch-all`. Catch-all lookup starts only after all eligible
   static and ordinary full-segment param candidates fail.
4. Two routes with the same method, version contract, literal prefix, and terminal catch-all shape
   conflict even when their catch-all names differ. Static and ordinary param routes may coexist
   because they have higher precedence.
5. The match stays compatible with `HandlerMatch.params` as
   `Readonly<Record<string, string>>`. The catch-all value is one slash-joined string without a
   leading slash, not `string[]`; for example, `/docs/api/users` matched by `/docs/*path` yields
   `{ path: 'api/users' }`. Encoding and decoding must follow the existing ordinary path-param
   policy across every adapter.
6. `@FromPath('path')` and `@RequestDto(...)` receive that string through the existing binding and
   validation pipeline. React does not reinterpret it.

## OpenAPI and Documentation Impact

OpenAPI path templates such as `/docs/{path}` do not express that `{path}` greedily consumes
multiple slash-separated segments. Converting `/*path` to a plain template would therefore publish
an inaccurate contract. Before adoption, `@fluojs/openapi` must choose and test one explicit policy:

- omit catch-all operations with an actionable diagnostic,
- require an explicit documentation override, or
- emit a documented vendor extension that preserves greedy semantics.

Package READMEs, architecture docs, migration guidance, examples, and EN/KO mirrors would need to
change together. No OpenAPI output changes under this deferred decision.

## Adapter and Performance Impact

The shared matcher currently separates static routes from same-length parameterized candidates.
Catch-all support must not turn every miss into an unbounded scan. An implementation proposal must
specify a method- and prefix-indexed terminal catch-all bucket, preserve static and param fast paths,
and provide representative lookup benchmarks.

Adapter-native syntax and precedence differ. Express native registration, Fastify routing, and
fetch-style or raw dispatch paths cannot hand off a native catch-all match until conformance tests
prove the same selected descriptor and params as the shared matcher. An initial implementation may
keep catch-all routes on the generic dispatcher path; enabling a native fast path requires
adapter-specific parity and normalization coverage rather than syntax translation alone.

## Revisit Gates

A follow-up implementation issue should be opened only when an HTTP use case cannot be expressed
reasonably with explicit routes or intentional host rewrites. Adoption requires all of the following
in one approved plan:

- `@fluojs/http` parser, duplicate detection, indexed matching, DTO binding, and regression tests
- static/param/catch-all precedence and versioning tests
- OpenAPI behavior and documentation tests
- adapter generic-path parity, native fast path eligibility decisions, and performance evidence
- `@fluojs/react` inheritance tests without a client-owned grammar
- EN/KO documentation parity and the appropriate Changesets release intent

Until those gates are approved, wildcard matching remains middleware-only and no public package
behavior or API surface changes.
