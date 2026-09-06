# HTTP 의존성 보안 업데이트

<p><a href="./dependency-security-update.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 범위와 선택 버전

[Issue #3700](https://github.com/fluojs/fluo/issues/3700)은 2026-09-06 확인한 공개 upstream advisory 9개에 맞춰 독립된 두 install graph를 갱신합니다. 원래 Dependabot alert 15건은 공유 advisory 6개를 lockfile마다 한 번씩 집계한 결과이며, 서로 다른 결함 15개가 아니라 advisory 9개입니다. 이는 dependency 유지보수이며 모든 Fluo 배포에서 실제 공격 가능한 request 경로가 노출된다는 주장이 아닙니다.

| 의존성 | Root workspace | Isolated HTTP benchmark | 분류 |
| --- | --- | --- | --- |
| `fast-uri` | Major-3 override `3.1.7`; lock `3.1.7`, `4.1.4` | Major-3 override `3.1.7`; lock `3.1.7`, `4.1.4` | Fastify schema/serialization의 전이 의존성 |
| `fastify` | Public adapter dependency `^5.12.3`, lock `5.12.3` | Direct dependency `^5.12.3`, override와 lock `5.12.3` | HTTP runtime |
| `qs` | Override와 lock `6.16.0` | Isolated external lockfile에 없음 | Express의 전이 의존성 |
| `browserslist` | Lock `4.28.9` | Isolated external lockfile에 없음 | HTTP request routing이 아닌 development/build tooling |

Advisory의 수정 최저 버전은 `fast-uri 3.1.6`, `fastify 5.12.1`, `qs 6.16.0`, `browserslist 4.28.7`입니다. 선택한 release에는 구현 시점의 추가 호환 수정이 포함됩니다. Ajv는 major-3 URI parser를 유지하지만, 갱신된 Fastify compiler/serializer dependency는 major 4를 요구합니다. Override는 `fast-uri@3`으로 제한하여 `^4.0.0`을 요구하는 dependency에 major 3을 강제하지 않습니다. 다른 lockfile 변경은 Fastify의 upstream `fast-json-stringify` 7 의존성을 포함한 이 dependency들의 resolution closure에 속합니다.

두 lockfile은 pnpm `10.4.1`로 생성합니다. Root graph는 오래된 전이 pin이 영향받는 버전을 유지하지 못하도록 `fast-uri@3`과 `qs`에 exact override를 사용합니다. Browserslist의 기존 build-time range는 수정 버전을 허용하므로 runtime dependency나 추가 override 없이 전이 lock만 갱신합니다. Benchmark는 NestJS adapter가 자체 exact Fastify dependency를 가지므로 Fastify override를 유지합니다. Benchmark의 direct dependency만 바꾸면 nested copy가 남을 수 있습니다.

Benchmark의 `link:../../../packages/*` dependency는 현재 worktree에서 빌드한 Fluo package를 로드하며, 해당 package의 dependency는 계속 root workspace에서 해석합니다. 따라서 isolated external lockfile이 실행 중인 benchmark 전체를 설명하지는 않습니다. 두 graph를 모두 install하고 검증해야 하며, 어느 쪽도 published consumer install은 아닙니다.

## Advisory 적용과 runtime 경계

목록의 advisory를 dismiss하거나 제외하지 않습니다. Fluo가 upstream의 영향받는 기능을 기본으로 사용하지 않는 경우에도 모든 영향받는 resolution을 갱신합니다.

| Advisory | Graph / 원래 alert | 수정과 경계 |
| --- | --- | --- |
| [GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8) | Root + benchmark / 179, 183 | `fast-uri 3.1.6`은 scheme-relative IDN host canonicalization을 수정합니다. URI parsing은 Fastify schema dependency graph에 있으며 Fluo의 client-identity parser가 아닙니다. |
| [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc) | Root + benchmark / 178, 182 | `fast-uri 3.1.6`은 malformed IPv6 normalization을 수정합니다. Application-owned URL이나 schema input을 가정하여 제외하지 않습니다. |
| [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf) | Root + benchmark / 177, 181 | `fast-uri 3.1.6`은 반복 hostname percent-decoding을 수정합니다. Dependency가 설치되므로 모든 copy를 갱신합니다. |
| [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp) | Root + benchmark / 176, 180 | `fast-uri 3.1.6`은 percent-encoded scheme normalization을 수정합니다. Routing과 URL authorization은 별도의 application/framework 책임입니다. |
| [GHSA-3m5p-2c4r-xxw2](https://github.com/advisories/GHSA-3m5p-2c4r-xxw2) | Root + benchmark / 173, 175 | Fastify `5.12.3`은 `5.12.1`의 hop-count proxy 수정을 포함합니다. Fluo는 Node transport peer를 snapshot하고 `resolveHttpConnection(request, { trustProxy })`를 사용하며, `createFastifyApp`에서 native Fastify `trustProxy`를 활성화하지 않습니다. Native extension과 NestJS benchmark에도 upstream 수정이 필요합니다. |
| [GHSA-w2qp-rph6-63g4](https://github.com/advisories/GHSA-w2qp-rph6-63g4) | Root + benchmark / 172, 174 | Fastify `5.12.3`은 `5.12.1`의 root-primitive schema coercion 수정을 포함합니다. Fluo DTO validation은 Fastify Ajv validator가 아니라 `@fluojs/validation`이 소유합니다. 설치된 native schema machinery도 갱신합니다. |
| [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) | Root / 171 | `qs 6.16.0`은 bracket-key comma parsing의 array-limit bypass를 수정합니다. Express와 body-parser가 `qs`를 설치하지만 Fluo의 portable query 계약은 nested `qs` object가 아닌 flat string/string-array value입니다. |
| [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | Root / 170 | `qs 6.16.0`은 attacker-controlled `isBuffer` 처리를 수정합니다. Fluo 자체의 Express URL-encoded body reader는 `URLSearchParams`를 사용하지만 native middleware는 body-parser를 사용할 수 있으므로 dependency를 제외하지 않습니다. |
| [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | Root / 168 | Browserslist `4.28.9`는 `4.28.7`의 custom-stats 수정을 포함합니다. Root Babel/build graph가 browser target과 stats를 처리하는 경로이며 HTTP runtime 공격 경로가 아닙니다. |

Fresh audit에서 Browserslist의 [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx)도 확인했으며 같은 업데이트로 제거합니다. Audit service는 이 advisory 9개와 별개로 바뀝니다. Alert를 dismiss하거나 scoped 수정이 전체 dependency audit의 성공을 의미한다고 주장하지 말고 추가 finding을 별도로 보고하세요.

호환성 증거는 기존 Fastify/Express adapter suite, HTTP routing과 connection-identity suite, Node request parsing, validation suite에 둡니다. 이들은 native-route handoff와 fallback, 중복 query key와 decoding, body materialization, explicit proxy trust, DTO validation을 보존합니다. 동작 기준은 계속 [HTTP Runtime Contract](../architecture/http-runtime.ko.md)와 adapter package README입니다.

수정된 Fastify line은 RFC 10008도 적용합니다. `QUERY`에는 request content와 일치하는 `Content-Type`이 필요합니다. Body가 없거나 type을 명시하지 않은 `QUERY`는 이제 Fluo dispatch 전에 HTTP `400`을 받으므로 빈 `GET`의 대체재로 사용하지 마세요. `Content-Type: application/json`과 함께 `{"term":"fluo"}` 같은 body를 보내세요. Native-fallback fixture는 이제 이 유효한 요청을 사용하고 method, route, status뿐 아니라 전달된 body도 검증합니다. Malformed request의 수락을 유지하려고 upstream validation을 우회하거나 Fastify를 downgrade하지 않습니다. 다른 adapter가 malformed input을 수락하는 것은 portability 보장이 아닙니다.

## Published consumer graph

Root `pnpm.overrides`와 두 repository lockfile은 private installation policy입니다. npm이나 pnpm이 published `@fluojs/*` dependency를 설치할 때 상속되지 않습니다.

- **Fastify:** `@fluojs/platform-fastify -> fastify -> @fastify/ajv-compiler -> ajv -> fast-uri` 경로입니다. Fastify는 compiler와 `fast-json-stringify`/`json-schema-ref-resolver`를 통해서도 `fast-uri`에 도달합니다. Public adapter는 이제 `fastify ^5.12.3`을 요구하므로 이 manifest를 포함하는 release는 해당 dependency를 `5.8.5`로 충족할 수 없습니다. 그러나 patched nested major-3 `fast-uri`까지 보장하지는 않습니다. Ajv의 `^3.0.1`은 여전히 오래된 consumer lock을 허용합니다. Fresh packed npm consumer에서 Ajv는 `fast-uri 3.1.7`을, `@fastify/ajv-compiler 4.0.6` / `fast-json-stringify 7.0.1`은 `^4.0.0` range를 통해 `fast-uri 4.1.4`를 해석합니다. 이들은 서로 다른 supported major line이며 중복된 취약 resolution이 아닙니다.
- **Express:** `@fluojs/platform-express -> express -> qs`와 `express -> body-parser -> qs` 경로입니다. Adapter는 `express ^5.1.0`을 유지하며 Express `5.2.1`조차 `qs ^6.14.0`을 허용합니다. Express floor를 올려도 `qs 6.16.0`을 강제하지 못하고, Fluo에 사용하지 않는 direct `qs` dependency를 추가해도 모든 nested copy를 제한하지 못합니다. Consumer가 직접 전이 resolution을 refresh하거나 override해야 합니다.
- **Validation:** `@fluojs/validation`은 Ajv나 `fast-uri`가 아닌 `validator`와 Standard Schema contract에 의존합니다. Fastify schema dependency를 Fluo DTO validation에 귀속시키면 안 됩니다.
- **Build tool:** Repository의 `@babel/core -> @babel/helper-compilation-targets -> browserslist` 경로는 development/build 작업입니다. Build tool이나 `@fluojs/vite` / `@fluojs/testing` peer surface를 통해 Babel을 사용하는 consumer는 자신의 build graph를 갱신해야 하며, 이를 이유로 무관한 public runtime package를 bump하지 않습니다.

하위 호환 public dependency-floor 수정을 위해 `@fluojs/platform-fastify`만 patch Changeset을 받습니다. Express manifest와 Fluo runtime code는 바뀌지 않습니다. Private root/benchmark와 build-only lockfile 업데이트에는 무관한 public package bump가 필요하지 않습니다. Version과 changelog는 canonical Changesets workflow로만 release합니다.

## Consumer lockfile 갱신

이 변경을 포함한 release가 publish된 뒤 `@fluojs/platform-fastify`를 해당 release로 업그레이드하세요. Node.js는 adapter의 문서화된 `>=24.0.0 <27` 범위로 유지합니다. 각 application, image build, 독립 install workspace의 전이 lock을 갱신하세요. Fluo repository lock을 갱신해도 이들은 바뀌지 않습니다.

npm application root에서 갱신하고 확인합니다.

```bash
npm update @fluojs/platform-fastify fast-uri qs
npm ls fastify fast-uri qs browserslist --all
npm audit
```

pnpm application에서는 다음을 실행합니다.

```bash
pnpm update @fluojs/platform-fastify
pnpm update fast-uri qs --depth Infinity
pnpm why fastify fast-uri qs browserslist
pnpm audit
```

관련된 모든 installed copy가 위 advisory 수정 최저 버전 이상인지 확인하고, 새 adapter의 Fastify copy는 `^5.12.3`을 충족해야 합니다. Application build graph에 Browserslist가 있으면 함께 갱신하세요. 업데이트를 막는 오래된 application pin, resolution, override를 검토하고 교체하며, 더 새로운 수정 버전을 downgrade하지 마세요.

Upstream constraint나 기존 lock 때문에 영향받는 전이 버전이 남으면, 해당 package를 전이적으로만 받는 application은 npm root policy를 설정할 수 있습니다.

```json
{
  "overrides": {
    "fast-uri@3": "^3.1.7",
    "qs": "^6.16.0"
  }
}
```

pnpm `10.4.1`은 application root의 `pnpm.overrides` 아래에 같은 항목을 둡니다. URI override는 major 3으로 제한하고 필요한 major-4 copy를 major 3으로 대체하지 마세요. 두 package 중 하나에 직접 의존하는 application은 direct manifest range도 맞춰야 합니다. Reinstall하여 application lockfile을 재생성하고 **모든** nested version을 확인한 뒤 adapter/native-middleware/schema test를 실행하며, 검토한 lockfile을 commit하고 rebuild·redeploy하세요. Fresh install 한 번이 오래된 compatible lock의 재등장을 영구적으로 막지는 않습니다.

## Maintainer 재현

Node 24와 pnpm `10.4.1`을 사용합니다.

```bash
pnpm install --frozen-lockfile
pnpm audit
pnpm why fast-uri fastify qs browserslist
pnpm -r why fast-uri fastify qs browserslist
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace install --frozen-lockfile
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace audit
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace why fast-uri fastify
```

Adapter test와 benchmark compile 전에 영향받는 workspace dependency closure를 build하세요. Fastify/Express suite와 HTTP routing, connection identity, query/body parsing, validation coverage를 실행하고 build된 adapter를 실제 HTTP로 구동하세요. Isolated benchmark의 `typecheck`, `build:fluo`, `build:fluo:bun`, `build:nestjs`를 검증합니다. 이번 유지보수에는 throughput 측정이 필요하지 않습니다.

Published-graph 증거는 build된 local adapter와 workspace production dependency를 pnpm으로 pack하고, root override가 없는 빈 npm consumer에 tarball을 install한 뒤 lockfile과 `npm ls --all`을 확인하여 남깁니다. 이는 linked worktree install을 npm consumer resolution으로 오인하지 않고 `workspace:^` 변환 이후 실제 package manifest를 검사합니다. Root `build`, `typecheck`, `lint`, `test` gate는 `pnpm verify:platform-consistency-governance`와 stable `verify:changeset-release-lane` gate와 함께 lead 검증에서 계속 필요합니다.
