# React RSC Graduation Policy

<p><a href="./react-rsc-graduation.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

**Status: Policy defined; graduation blocked.** `@fluojs/react/rsc`는 published export가 아닙니다. 이
정책의 모든 gate에 maintainer-approved evidence가 생기기 전까지 유일한 RSC 및 Server Function
entrypoint는 `@fluojs/react/experimental/rsc`입니다.

## 결정

Graduation은 canonical RSC implementation을 stable `@fluojs/react/rsc` subpath로 옮깁니다. 이는
runtime-neutral package root에 RSC를 추가하지 않습니다. 즉 **no stable root RSC export** 원칙을
유지합니다. 승인된 deprecation window 동안 `@fluojs/react/experimental/rsc`는 stable subpath를
re-export해야 하며 기존 import는 동일한 runtime 및 type behavior를 유지해야 합니다.

Stable subpath는 아래 모든 check의 evidence를 연결한 명시적인 graduation PR에서만 추가할 수 있습니다.
이 정책 작성 자체는 check를 충족하지 않으며 package `1.0`도 승인하지 않습니다.

Authoritative graduation decision은 repository-owned
`tooling/governance/react-rsc-graduation-approval.json` record에 있습니다. Graduation이 blocked인
동안 `approval` field는 `null`입니다. Approval에는 `status: "approved"`, issue `2502`, trusted
maintainer identity, nonzero 40-character evidence commit SHA가 필요합니다. 두 policy mirror의 status는
이 record와 일치해야 합니다. Policy prose와 GitHub-looking URL은 context일 뿐 approval을 성립시키지
않으며, gate는 deterministic하게 유지되고 CI에서 network lookup을 수행하지 않습니다.

Maintainer authority는 기존 `.github/CODEOWNERS`의 default-owner rule에서 가져오며 graduation change
set은 해당 authority metadata를 수정할 수 없습니다. Gate는 local read-only Git object 및 ancestry
check로 기록된 commit이 실제로 존재하고 ancestor of HEAD인지 검증합니다. Login 문자열이나 문법상
유효한 SHA만으로 approval을 자체 선언할 수 없습니다.

## 현재 Evidence 상태

| Gate | 현재 evidence | 상태 |
| --- | --- | --- |
| React 및 renderer version | Prototype은 `react@19.2.6`, 일치하는 React DOM, 정확히 같은 Flight renderer만 받습니다. Supported-version matrix와 upgrade evidence는 없습니다. | blocked |
| Manifest contract | `createReactRscManifest(...)`는 bundler-neutral client-reference 및 server-to-client module map 하나를 snapshot하지만 schema evolution과 renderer-adapter compatibility는 안정 계약이 아닙니다. | blocked |
| Server Function transport | Signed reference, origin/CSRF check, bounded JSON value, 일반 HTTP dispatch는 테스트합니다. Compatibility 및 migration guarantee는 experimental 상태입니다. | partial |
| Rendering 및 hydration | Built-in encoder/decoder, renderer/build plugin, RSC hydration contract, hydration mismatch recovery contract, prerendering evidence가 없습니다. | blocked |
| Transfer-data safety | Stable SSR의 trusted hydration asset은 문서화되어 있지만 private, auth, cookie-bearing, no-store data에 대한 RSC safe transfer 규칙은 완성되지 않았습니다. | blocked |
| Navigation integration | `@fluojs/react/client`는 full-document 및 cache-free 상태입니다. #2506 navigation에 대한 RSC-aware behavior는 승인되지 않았습니다. | blocked |
| Dual-import compatibility | Stable subpath가 없으므로 필수 stable/experimental re-export test도 아직 통과할 수 없습니다. | blocked |

## Graduation Checklist

### React 및 Renderer Stability

- CI가 검증한 정확한 React, React DOM, selected Flight renderer version을 기록합니다. Canary-only 또는
  range를 가정한 compatibility evidence만으로는 부족합니다.
- React upgrade가 support matrix에 들어오는 절차, 거부할 조합, stable root peer range와 더 좁은 RSC
  compatibility matrix가 다른지 정의합니다.
- Stable RSC entrypoint import가 root SSR, `@fluojs/react/vite`, `@fluojs/react/client`만 사용하는
  애플리케이션에 eager effect를 만들지 않음을 증명합니다.

### Manifest 및 Server Function Transport

- Client-reference manifest, server-to-client module map, action reference, request marker, response
  envelope, diagnostic code, error-code contract에 versioning 또는 호환 전략을 제공합니다.
- Deterministic manifest snapshot, malformed/unknown reference, async chunk, browser/server module
  separation, 실제 application-owned renderer/build adapter integration 하나 이상을 테스트합니다.
- Server Function call은 guard, middleware, interceptor, request scope, authorization, exact origin
  policy, bounded body/result, application-owned secret을 사용하는 명시적인 일반 fluo HTTP `POST`
  route에 둡니다. Stable RSC는 두 번째 dispatcher를 만들지 않습니다.

### Rendering, Hydration 및 Data Safety

- Angular `ServerRoute[]`, Next route segment, TanStack route tree, file routing, parallel URL matcher를
  만들지 않으면서 SSR, CSR, future prerendering interaction을 문서화하고 테스트합니다.
- Server HTML/first client render equality rule, hydration mismatch diagnostics 및 error recovery,
  pre-hydration interaction fallback, browser-only effect boundary를 정의합니다.
- Escaped 및 bounded safe transfer 규칙을 정의합니다. Auth state, cookie, `Set-Cookie`, private response,
  `Cache-Control: private` 또는 `no-store` data가 reusable bootstrap 또는 Flight cache에 들어가면 안 됩니다.
- Server-only action, secret, private module이 client output에 들어갈 수 없도록 browser/server bundle
  separation을 증명합니다.

### Routing 및 Navigation Ownership

- Route ownership은 `@fluojs/http`에 유지합니다. `@Router(...)`와 `@Path(...)`는 HTTP metadata, DTO
  binding, validation, guard, interceptor, middleware, request lifecycle 위의 facade로 남습니다.
- 별도 contract가 RSC-aware prefetch, refresh, invalidation, cache behavior를 승인하고 테스트하지 않는 한
  issue #2506 semantic을 변경하지 않습니다. Graduation만으로 client data cache를 추가하면 안 됩니다.
- Hydration 전과 JavaScript를 사용할 수 없을 때 real-anchor 및 full-document fallback behavior를 보존합니다.

### Test 및 Runtime Evidence

- `@fluojs/react/rsc`와 `@fluojs/react/experimental/rsc`를 모두 import하고 exported value/type을
  비교하며 experimental path가 deprecation window 전체에서 re-export임을 증명하는 export-map test를
  추가합니다.
- Root `@fluojs/react`와 `@fluojs/react/client`가 RSC, Server Function, renderer, build-tool,
  browser/server-only module을 export하거나 eager load하지 않는 negative test를 유지합니다.
- Manifest, Flight response, action transport, route ownership, hydration mismatch, safe transfer, error
  recovery, 지원 runtime/bundler 조합을 executable test로 다룹니다.
- Executable evidence는 import 존재가 아니라 semantic을 검증해야 합니다. Runtime dual-import evidence는
  stable namespace와 experimental namespace를 직접 비교하고 declaration evidence는 exact type-equality
  assertion을 사용하며 hydration/data-safety/runtime-bundler suite는 canonical input으로 stable runtime을
  호출한 뒤 observable runtime result를 assertion해야 합니다. Module-existence check 또는 matcher
  argument에만 binding을 언급하는 방식은 evidence로 인정하지 않습니다.
- Package build, typecheck, test, docs parity, platform governance, 필요 시 public-export TSDoc,
  release-readiness verification을 통과합니다.

### Documentation 및 Release Evidence

- 같은 PR에서 `packages/react/README.md`와 `README.ko.md`, package reference/chooser docs, migration
  note, known limitation, import example을 갱신합니다.
- Approval issue, evidence link, 선택한 deprecation window, removal criteria를 기록합니다.
- Public package impact와 일치하는 semver intent를 Changesets entry에 기록합니다. Generated version과
  changelog는 canonical GitHub Actions release flow만 소유합니다.

## Stable Subpath 활성화

모든 gate가 승인된 뒤 graduation PR은 다음을 수행해야 합니다.

1. `packages/react/package.json`에 type/import target을 갖춘 `./rsc`를 publish합니다.
2. `@fluojs/react/rsc`를 canonical implementation entrypoint로 만듭니다.
3. `@fluojs/react/experimental/rsc`를 deprecation documentation과 함께 direct re-export로 유지합니다.
4. 두 import path의 runtime 및 declaration compatibility test를 추가합니다.
5. Root `@fluojs/react`와 `@fluojs/react/client`의 isolation을 유지합니다.
6. Pre-1.0에서는 일반적으로 `minor`인 backward-compatible feature changeset을 포함합니다.

Package root export의 모든 conditional leaf는 각각 `./dist/index.js` 또는 `./dist/index.d.ts` canonical
artifact를 유지해야 하고 legacy `main`/`types` field도 같은 target을 유지해야 합니다. `./rsc` 추가가
root consumer를 RSC artifact로 redirect해서는 안 됩니다.

해당 PR이 존재하기 전까지 governance는 `./rsc` export를 거부해야 합니다.

## Deprecation Window 및 Migration

Graduation release를 **G**라고 합니다. Experimental re-export는 G와 그 이후 최소 한 번의 published
`@fluojs/react` minor release **D**까지 유지해야 합니다. Removal은 D 이후 release에서만 제안할 수
있으므로 consumer에게 migration을 위한 완전한 후속 minor release 하나를 제공합니다.

```ts
// deprecation window 전과 도중
import { createReactFlightResponse } from '@fluojs/react/experimental/rsc';

// graduation 이후 권장 경로
import { createReactFlightResponse } from '@fluojs/react/rsc';
```

Maintainer가 public adoption 전에 명시적으로 다르게 결정하지 않는 한 experimental path 제거는 미래의
breaking change입니다. `0.x`에서는 removal에 `minor` changeset과 consumer-facing migration note가
필요하고, `1.0+`에서는 `major` changeset이 필요합니다. G 이후 path를 조용히 제거하거나 incompatible
behavior로 redirect하거나 window를 단축하면 안 됩니다.

## Semver 및 Roadmap Label

Roadmap label `0.4.0`과 `0.5.0`은 **roadmap phase positions**이며 실제 package version을 보장하지
않습니다. Committed Changesets와 canonical `.github/workflows/release.yml` flow만 generated package
version을 결정합니다.

`@fluojs/react/rsc`를 추가하지 않고 정책만 정의하는 변경은 published package API나 behavior를 바꾸지
않으므로 policy-only PR에는 release changeset이 없습니다. 향후 stable subpath 추가는 backward-compatible
feature work이며 pre-1.0에서는 일반적으로 `minor` changeset을 사용합니다. Experimental-path removal은
위에서 설명한 breaking change로 별도 분류합니다. `1.0` release에는 여전히 explicit maintainer approval과
repository-wide graduation requirement가 필요합니다.

## 안정적으로 유지할 Known Limitation

Graduation은 built-in Flight renderer/decoder, Vite 또는 Webpack RSC plugin, automatic `"use server"`
transform/export discovery, file route, route segment, client route table, SPA document swapping, client
data cache, prefetch, automatic private-data serialization을 약속하지 않습니다. 이후 추가에는 각각 별도의
behavioral contract, test, docs parity, Changesets intent가 필요합니다.

## Verification

Policy 및 향후 graduation 변경은 다음을 실행합니다.

```bash
pnpm vitest run tooling/governance/react-rsc-discoverability.test.ts
pnpm --dir packages/react test
pnpm docs:sync-check
pnpm verify:platform-consistency-governance
pnpm verify:release-readiness
```

향후 graduation PR은 두 import path의 export-map/declaration compatibility test와 evidence record가 지정한
renderer, bundler, hydration, runtime matrix도 실행합니다.

## 관련 Evidence

- [Behavioral Contract Rules](./behavioral-contract-policy.ko.md)
- [Versioning & Release Rules](./release-governance.ko.md)
- [Testing Guide](./testing-guide.ko.md)
- [`@fluojs/react` package contract](../../packages/react/README.ko.md)
- [Canonical package surface](../reference/package-surface.ko.md)
- [Issue #2502](https://github.com/fluojs/fluo/issues/2502)
