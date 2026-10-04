# React type generation 마이그레이션

<p><a href="./migrate-react-typegen.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 하나의 application graph 유지

React, HTTP, CLI를 함께 올립니다. Artifact version 2는 기존 `fluo typegen`을 확장합니다.
Version 1 output은 unsupported이며 check가 조용히 upgrade하지 않습니다. Runtime의
`FluoFactory.create(AppModule, applicationOptions)` 다음 `app.listen()`을 유지합니다.
선택 module에서 같은 options 객체를 export해 `--options`로 전달하세요. Converter/version
설정을 복제하거나 listener를 시작하는 main entry를 import하지 않습니다.

```bash
fluo typegen src/app.ts --export AppModule --tsconfig tsconfig.json --options applicationOptions --output src/generated/react-pages.ts
fluo typegen src/app.ts --export AppModule --tsconfig tsconfig.json --options applicationOptions --output src/generated/react-pages.ts --check
fluo typegen src/app.ts --export AppModule --tsconfig tsconfig.json --options applicationOptions --output src/generated/react-pages.ts --watch
```

Type-only dependency와 browser component를 포함하는 실제 application tsconfig를 사용합니다.
Runtime도 기본 options를 사용할 때만 `--options`를 생략합니다. Generation은 bootstrap/close를
소유하고 listen하지 않습니다. Atomic publication, `UNCHANGED` no-rewrite, serialized watch,
실패 시 last-valid output 보존을 유지합니다.

## 복제 대신 generated consumer 사용

1. HTTP DTO binding을 입력의 권위로 유지합니다. Typed query에는 DTO property name을
   전달하고 builder가 source alias를 출력합니다. Required binding은 initializer가 있어도
   필수이며 `@Optional()`만 생략을 허용합니다. Global conversion을 포함해 변환 전 wire
   text는 `@fluojs/http`의 type-only `HttpWire<Server, Wire>`로 선언합니다.
   HTTP는 모든 request를 계속 validate/convert합니다.
2. `href`, `link`, `push`, `replace`에는 `reactPageRoutes`를 import합니다. Path param이
   있으면 query는 그 뒤에 옵니다. 기존 `Link`/`useRouter`를 유지하며 client matcher를
   만들거나 `useSearchParams()`를 validated DTO로 cast하지 않습니다.
3. `ReactNavigationPage.create`의 literal `module`과 concrete result를 유지합니다.
   Finite JSON props를 받는 browser function component를 default export하고 generated
   `ReactPagePropsRegistry`를 strict typecheck에 포함합니다. 기존 조립에서 prefetch까지
   initial loader의 네 번째 인자와 soft loader의 `contracts` option에 `reactPageModules`를
   전달합니다. Type-only registry 포함만으로 runtime decoder가 연결되지는 않습니다.
4. 복제한 form Input/alias map 대신 기존 `useForm`에 `reactFormRoutes[id].contract`를
   전달합니다. 저장 후 literal-inferred `ReactModule.formResult({ destination, followUp,
   data })`를 반환합니다. Saved data cast나 추가 form/provider를 만들지 않습니다.
   제공하는 것은 `fields`/`decodeSaved`이며 GET `decodeRead`가 아닙니다.

## 일반 typecheck와 build 전에 실패시키기

기존 두 script 맨 앞에 같은 `--check` 명령을 `&&`로 연결합니다. Write-mode generation으로
대체하지 않습니다. Missing/stale/malformed/unsupported output은 일반 typecheck와 production
build를 막아야 하며 exit code는 `2`/`3`/`4`/`5`, generation/configuration 실패는 `1`입니다.
Source/configuration을 수정하고 명시적으로 generate한 뒤 artifact를 검토하고 check를
다시 실행합니다. Runtime 출력이 같아 보여도 type-only/config/compiler 입력은 freshness에
포함됩니다.

Positive/negative strict consumer, 실제 query/POST HTTP round trip, dev/production browser의
direct hydration, navigation, enhanced form, JS-disabled POST/303/GET을 검증합니다.
Saved/read-failed와 uncertain persistence를 구분하며 GET만 retry합니다. Auth/session과
public-only prefetch 제약은 바뀌지 않습니다.

지원 JSON shape, URI provenance, 거부하는 header/media/custom version과 diagnostic은
[end-to-end 타입 계약](../contracts/react-end-to-end-types.ko.md)을 따릅니다.
이는 소비자의 검증 절차이며 이 이주 문서에서 실행했다는 receipt가 아닙니다.
