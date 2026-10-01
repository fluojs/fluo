# React End-to-End 타입 계약

<p><a href="./react-end-to-end-types.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 하나의 compiler·HTTP 경로

`fluo typegen`은 실제 application module을 bootstrap하고 compiled HTTP
descriptor를 project합니다. `--tsconfig`는 실제 application compiler 설정을,
`--options`는 같은 module namespace가 export한 application options 객체를
선택합니다. Runtime startup과 generation은 이 객체를 공유합니다.
Generation은 HTTP port에서 listen하지 않습니다.

범위는 stable HTTP-first React tooling이며 임의 TypeScript schema 생성이 아닙니다.
DTO와 default-export browser function component를 compiler graph에 포함합니다.
`--export` 기본값은 `AppModule`입니다. `--tsconfig` 생략 시 module에서 `tsconfig.json`을
찾으며 없으면 실패합니다. `--options` 생략 시 bootstrap 기본값을 사용합니다.
Versioning/converter에는 실제 공유 options를 선택하세요. Runtime은 계속
`FluoFactory.create(AppModule, applicationOptions)` 다음 `app.listen()`을 실행하며
generation이 import하는 module은 listener를 시작하면 안 됩니다.

```bash
fluo typegen src/app.module.ts --export AppModule \
  --options applicationOptions --tsconfig tsconfig.json \
  --output src/react-pages.ts
fluo typegen src/app.module.ts --export AppModule \
  --options applicationOptions --tsconfig tsconfig.json \
  --output src/react-pages.ts --check
```

하나의 frozen source/configuration snapshot이 generation을 소유합니다.
Tooling은 실제 평가된 controller·DTO constructor를 project-relative
declaration kind/path/ordinal identity와 연결합니다. Class name, registration
position, stack, function source 문자열이나 추정 sourcemap으로 매칭하지 않습니다.
구체적인 factory instantiation은 resolved type을 유지하며 unavailable,
ambiguous, unresolved association은 diagnostic으로 실패합니다. Inherited
metadata와 override handler의 compilation 여부는 HTTP만 결정합니다.

Artifact version 2의 freshness에는 type-only dependency, compiler 설정,
TypeScript version이 포함됩니다. Output 자체는 input fingerprint에서 제외합니다.
Watch는 bootstrap 전에 구독하고 후속 generation의 dependency watch를 갱신합니다.
실패하면 마지막 valid output을 보존하고 shutdown에서 소유한 watcher와 active
work를 정리합니다. Publication은 atomic이며 같은 byte는 `UNCHANGED`입니다.
Typecheck/build는 먼저 `--check`를 실행하고 stale output을 조용히 재생성하지 않습니다.
Missing, stale, malformed, unsupported-version artifact의 exit code는 각각
`2`, `3`, `4`, `5`이며 generation/configuration 실패는 `1`입니다. 복구는 명시적
generation으로 수행하고 check 안에서 자동 재생성하지 않습니다.
[이주](../getting-started/migrate-react-typegen.ko.md)와
[toolchain matrix](../reference/toolchain-contract-matrix.ko.md)를 참고하세요.

## Wire input

HTTP binding metadata가 logical property, wire alias, omission policy를
제공합니다. Default initializer나 TypeScript optional property는 HTTP의
`@Optional()` materialization policy를 대체하지 않습니다.
Required binding 누락은 initializer가 있어도 실패하며 optional binding만 생략 시
initializer를 유지합니다. Path argument는 compiled placeholder name을 사용하고,
query/form contract는 DTO property name을 받아 HTTP source alias를 출력합니다.
Raw `useSearchParams()` snapshot은 검증된 server DTO가 아닙니다.

Conversion으로 input type을 복원할 수 없으면 type-only
`HttpWire<Server, Wire>`를 선언합니다.

```ts
import { Convert, FromQuery, type HttpWire } from '@fluojs/http';

class SearchInput {
  @Convert({ convert(value: unknown) { return Number(value); } })
  @FromQuery('page')
  page: HttpWire<number, string> = 1;
}
```

이 선언은 global converter chain에도 적용됩니다. Converter, runtime marker,
client validator를 설치하지 않습니다. Generated query builder는 HTTP text와
repeated text를 받고 `URLSearchParams`로 alias를 encode합니다. Repeated value
순서와 empty string을 보존하며 없는 optional value는 생략합니다. Number와
boolean은 implicit stringification 대신 명시적인 text wire 계약이 필요합니다.
Validation과 conversion의 권한은 HTTP에 남습니다.

`href`, `link`, `push`, `replace`는 path param이 있으면 먼저 받고 다음에 query를
받습니다. 모든 binding이 optional일 때만 query를 생략할 수 있습니다. Key는 호출자
객체 순서가 아닌 compiled binding 순서를 따릅니다. Array는 원소 순서로 같은 key를
반복하고 빈 array는 key를 출력하지 않으며 `''`는 `key=`, 없는 optional 값은 생략됩니다.
Path는 `encodeURIComponent`, query는 form URL encoding을 사용합니다. Space는 `+`,
literal plus/slash/percent는 `%2B`/`%2F`/`%25`가 되며 Unicode와 reserved character는
`URLSearchParams`의 UTF-8 encoding을 따릅니다. Fragment, relative route, client matcher는
생성하지 않습니다. DTO가 `@FromQuery('q') term`을 선언한 예입니다.

```tsx
import { Link } from '@fluojs/react/client';
import { reactPageRoutes } from './react-pages.js';

const search = reactPageRoutes['GET /search SearchRouter show'];
<Link {...search.link({ term: 'tea + coffee' })}>Search</Link>;
// href: /search?q=tea+%2B+coffee
```

Unversioned route와 provenance-backed URI route는 compiled effective path로
href를 생성합니다. Versioned header/media/custom route와 provenance가 없는
route는 거부합니다. Literal `/v2` segment로 version selection을 추정하지 않습니다.
HTTP route version, navigation protocol v2, form protocol v1, artifact version 2는
독립적입니다.

## Browser props와 saved data

Generated `reactPageModules` map에는 limited JSON `decodeProps` contract가
있습니다. Module-to-props registry는 build-mapped module literal과 authored
function component를 연결합니다. Initial transfer와 soft navigation은
build identity 승인 후 destination import 전에 같은 contract를 사용합니다.
Importer allowlist는 계속 필수입니다.

Generated registry를 strict consumer program에 포함합니다(`strict`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
Module이 맞아도 잘못되거나 누락·추가된 props는 alias input을 포함해 compile에
실패해야 하며 broad overload로 registry를 우회하면 안 됩니다. React tree는 renderer가
계속 소유하고 wire에는 JSON data만 전달합니다.

Loader seam에서는 같은 map을
`loadReactInitialNavigationDestination(json, modules, buildId, reactPageModules)`의
네 번째 인자와 `loadReactNavigationDestination`의 `contracts: reactPageModules`로
전달합니다. 공식 조립은 기존 provider를 통해 일반 navigation과 public prefetch에도
연결해야 합니다. Registry import만으로 runtime validation이 설치되지는 않습니다.
Contract 누락이나 decoder 실패는 import 전 `invalid-payload`이며 auth/session이나
public-prefetch 승인을 우회하지 않습니다.

지원하는 JSON subset은 finite plain object, homogeneous array, discriminated
union, finite number, string, boolean, null, literal value입니다. Optional
property는 생략하며 `undefined`가 있는 property로 반환하지 않습니다.
`unknown`은 JSON으로 검증한 `ReactJsonValue`로 노출하고 unchecked domain type으로
승격하지 않습니다. Class value, function, custom `toJSON`, positional tuple,
open index signature, recursive type definition, `any`, unresolved generic
shape는 source-located correction이 필요합니다.
Symbol, bigint, Date/DI instance, required `undefined`도 지원하지 않습니다. 구체적인
generic과 finite nested object/array union은 지원하며 조용히 `any`로 낮추지 않습니다.
Optional object member는 JSON omission을 따르고 runtime cycle이나 non-JSON 값을
domain data로 받지 않습니다. Date/money는 custom `toJSON` 대신 plain props/data를
반환하기 전에 명시적으로 string으로 변환합니다.

Generated `reactFormRoutes`는 HTTP action href와 기존
`ReactFormContract<Input, Data>`의 `{ fields, decodeSaved }`를 제공합니다.
`useForm`과 static `ReactModule.formResult`는 각각 하나의 경로를 유지합니다.

```ts
import { useForm } from '@fluojs/react/client';
import { reactFormRoutes } from './react-pages.js';

const save = reactFormRoutes['POST /catalog/:sku CatalogRouter edit'];
const form = useForm({
  id: 'edit',
  action: save.href({ sku }),
  contract: save.contract,
  allowDestination: (destination) => destination.startsWith('/catalog/'),
});
```

소비자는 DTO interface나 field alias를 복제하거나 saved data를 cast하지 않습니다.
Unknown field는 typecheck에서 실패합니다. Saved acknowledgement와 follow-up read는
별도의 discriminated state입니다. Malformed saved data는 protocol uncertainty이며
typed persistence failure나 POST 재전송 허가가 아닙니다.
`ReactModule.formResult({ destination, followUp, data })`는 literal saved-data inference를
유지하고 optional explicit `session`은 기존 session barrier를 통과합니다. `decodeRead`와
generated GET decoder는 이 projection의 범위가 아닙니다(#3881). Native POST/303/GET,
validation/auth/rejected/uncertain outcome, successful-control 의미와 GET-only
`retryRead()`는 기존 [form 계약](./react-progressive-forms.ko.md)을 유지합니다.

Generated runtime에는 URL construction, alias, JSON contract만 포함합니다.
Server implementation, DTO constructor, compiler/DI import, secret은 browser
dependency가 아닙니다. Shipped declaration과 실제 generated consumer의
dev/production browser behavior로 이 경계를 입증해야 하며 source alias나
`skipLibCheck`만으로 대체하지 않습니다.

## 근거와 검증 경계

Source owner는 `packages/http/src/type-projection.ts`,
`packages/cli/src/commands/typegen-compiler.ts`, `typegen-projection.ts`,
`packages/react/src/typegen.ts`, `typegen-runtime.ts`, `navigation-payload.ts`,
`client/navigation-payload.ts`입니다. Focused evidence surface는
`packages/cli/src/commands/typegen-projection.test.ts`, `typegen-watch.test.ts`,
`packages/http/src/type-projection.test.ts`,
`packages/react/src/client-navigation-payload.test.ts`입니다. 이 경로는 검증 대상을
정의하며 이번 문서 작업에서 packaged dev/production browser, 전체 issue, 성능,
soak 또는 제품 gate를 통과했다는 주장이 아닙니다.
