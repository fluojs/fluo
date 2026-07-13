# HTTP Catch-All Route Grammar Decision

<p><a href="./http-catch-all-route-grammar.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

- Status: Deferred
- Decision date: 2026-07-13
- Issue: [#2499](https://github.com/fluojs/fluo/issues/2499)

## Decision

Catch-all route grammar 도입을 유예한다. 이 결정은 `@fluojs/http`에 wildcard route를 추가하지
않고, route matching이나 path-param binding을 변경하지 않으며, React 전용 grammar를 만들지 않는다.
명시적인 HTTP route가 계속 권장 계약이다.

[#2506](https://github.com/fluojs/fluo/issues/2506)에서 제공한 `@fluojs/react/client` runtime은
wildcard 요구를 만들지 않는다. Pathname 또는 search가 바뀌면 실제 anchor와 same-origin
full-document navigation을 사용하므로 destination document는 server-owned HTTP matching, DTO
validation, guard, interceptor, redirect, not-found 처리로 돌아간다. Hydration 전이나 JavaScript가
비활성화된 환경에서도 같은 anchor가 일반 browser document navigation을 제공한다. 명시적인 server
route가 없으면 정상적인 not-found response가 유지된다. 애플리케이션이나 deployment가 의도적인
document rewrite를 별도로 설정할 수 있지만, 그 host policy는 client route grammar가 아니다.

## Current Contract

현재 `@fluojs/http` route grammar는 다음과 같다.

- `/users`, `/healthz` 같은 literal segment
- `/:id` 같은 full-segment `:param` placeholder
- matching 전 duplicate slash와 trailing slash 정규화
- parameterized route match에 동일한 segment 개수 요구
- `forRoutes('/users/*')` 같은 middleware selector에서만 wildcard prefix matching 허용

Route decorator는 catch-all, wildcard, optional, regex-like, mixed-segment token을 계속 거부한다.
`@fluojs/react`의 `@Router(...)`와 `@Path(...)`는 같은 HTTP metadata를 기록하므로 예외 없이 이
규칙을 상속한다.

## Syntax Evaluation

HTTP-owned candidate 두 가지를 검토했다.

| Candidate | Assessment |
| --- | --- |
| `/*path` | 향후 HTTP RFC가 catch-all matching을 채택하는 경우에만 선호한다. 현재 `:param` grammar와 시각적으로 구분되고 greedy 동작을 명시적으로 드러낸다. |
| `/:path*` | 선호하지 않는다. 현재 parser가 의도적으로 거부하는 inline modifier를 기존 full-segment param syntax에 붙인 것처럼 보인다. |

Next.js `[...slug]`, Angular `**`, TanStack splat 및 다른 React/framework 전용 표기법은 향후 HTTP
RFC가 runtime-neutral fluo contract로 독립적으로 정당화하지 않는 한 candidate가 아니다.

## Provisional Adoption Contract

유예 결정이므로 아래 동작은 현재 활성화되지 않는다. 향후 도입 RFC는 구현 전에 다음 provisional
constraint를 보존하거나 명시적으로 대체해야 한다.

1. Catch-all은 이름이 있는 terminal segment다. `/*path` 뒤에는 다른 segment를 둘 수 없다.
2. 하나 이상의 정규화된 path segment를 소비한다. Prefix 자체에는 계속 명시적인 route가 필요하므로
   `/docs`와 `/docs/*path`를 구분한다.
3. Match precedence는 `static > param > catch-all`이다. 모든 eligible static 및 일반 full-segment
   param candidate가 실패한 뒤에만 catch-all lookup을 시작한다.
4. Method, version contract, literal prefix, terminal catch-all shape가 같은 두 route는 catch-all 이름이
   달라도 충돌한다. Static 및 일반 param route는 더 높은 우선순위를 가지므로 함께 존재할 수 있다.
5. Match는 `HandlerMatch.params`의 `Readonly<Record<string, string>>` 형태와 호환되어야 한다.
   Catch-all 값은 `string[]`가 아니라 leading slash가 없는 하나의 slash-joined string이다. 예를 들어
   `/docs/*path`가 `/docs/api/users`를 match하면 `{ path: 'api/users' }`가 된다. Encoding/decoding은
   모든 adapter에서 기존 일반 path-param policy를 따라야 한다.
6. `@FromPath('path')`와 `@RequestDto(...)`는 기존 binding/validation pipeline을 통해 이 string을
   받는다. React는 이 값을 다시 해석하지 않는다.

## OpenAPI and Documentation Impact

`/docs/{path}` 같은 OpenAPI path template은 `{path}`가 slash로 나뉜 여러 segment를 greedy하게
소비한다는 의미를 표현하지 않는다. 따라서 `/*path`를 일반 template으로 바꾸면 부정확한 contract를
게시하게 된다. 도입 전 `@fluojs/openapi`는 다음 중 하나의 명시적인 policy를 선택하고 테스트해야 한다.

- actionable diagnostic과 함께 catch-all operation 생략
- 명시적인 documentation override 요구
- greedy semantic을 보존하는 문서화된 vendor extension emit

Package README, architecture doc, migration guidance, example, EN/KO mirror도 함께 변경해야 한다. 이 유예
결정에서는 OpenAPI output이 바뀌지 않는다.

## Adapter and Performance Impact

Shared matcher는 현재 static route와 동일 길이의 parameterized candidate를 분리한다. Catch-all 지원으로
모든 miss가 제한 없는 scan이 되어서는 안 된다. 구현 proposal은 method/prefix indexed terminal
catch-all bucket을 정의하고 static 및 param fast path를 보존하며 대표 lookup benchmark를 제공해야 한다.

Adapter-native syntax와 precedence는 서로 다르다. Express native registration, Fastify routing,
fetch-style 또는 raw dispatch path는 conformance test가 shared matcher와 같은 descriptor 및 params를
선택함을 입증하기 전까지 native catch-all match를 handoff하면 안 된다. 초기 구현은 catch-all route를
generic dispatcher path에 남길 수 있다. native fast path를 활성화하려면 syntax translation만이 아니라
adapter별 parity 및 normalization coverage가 필요하다.

## Revisit Gates

명시적인 route나 의도적인 host rewrite로 합리적으로 표현할 수 없는 HTTP use case가 확인될 때만 후속
implementation issue를 열어야 한다. 도입하려면 승인된 하나의 계획에 다음 항목을 모두 포함해야 한다.

- `@fluojs/http` parser, duplicate detection, indexed matching, DTO binding, regression test
- static/param/catch-all precedence 및 versioning test
- OpenAPI behavior 및 documentation test
- adapter generic-path parity, native fast path eligibility 결정, performance evidence
- client-owned grammar를 추가하지 않는 `@fluojs/react` inheritance test
- EN/KO documentation parity 및 적절한 Changesets release intent

이 gate가 승인되기 전까지 wildcard matching은 middleware-only로 유지되고 공개 package behavior 또는 API
surface는 변경되지 않는다.
