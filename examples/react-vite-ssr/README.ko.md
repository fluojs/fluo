# react-vite-ssr example

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

`0.2.0` 예제 phase를 위한 최소 Vite-backed `@fluojs/react` 애플리케이션입니다. 두 번째 routing
model을 만들지 않고 HTTP-owned page route, DTO-bound parameter, streamed React SSR, Vite manifest
asset, hydrated browser interaction 하나를 연결합니다.

## 이 예제가 보여주는 것

- fluo HTTP module graph가 발견하는 `@Router('/products')` 및 `@Path('/:sku')` page route.
- `@RequestDto(...)`, `@FromPath('sku')`, `@FromQuery('preview')`를 통한 typed path/search input.
- Web Streams SSR이 fallback과 resolve된 recommendation content를 emit하는 `Suspense` boundary.
- `dist/client/.vite/manifest.json`을 생성하는 Vite client build와, 이미 로드한 manifest를 ordered
  CSS 및 hydration module asset으로 바꾸는 `@fluojs/react/vite`.
- React DOM `hydrateRoot(...)`를 통해 interactive 상태가 되는 server-rendered counter.
- 생성된 Vite client asset까지 Fastify adapter로 제공하는 production build.

## 레포 루트에서 실행하기

```sh
pnpm install
pnpm build
pnpm --filter @fluojs/example-react-vite-ssr build
pnpm --filter @fluojs/example-react-vite-ssr start
```

`http://127.0.0.1:3000/products/sku-42?preview=true`를 열고 `Count: 0`을 활성화하세요.
Vite-generated client entry가 server HTML을 hydrate한 뒤에만 label이 `Count: 1`로 바뀝니다.

반복 가능한 SSR 및 hydration 검증은 다음 명령으로 실행합니다.

```sh
pnpm vitest run examples/react-vite-ssr
```

## phase 경계와 제한 사항

- 안정 `0.1.0` root contract는 계속 HTTP-first React SSR을 소유합니다. 이 `0.2.0` 예제는 초기
  SSR 예제 이후 추가된 `@fluojs/react/vite` manifest parser와 그 contract를 조합합니다.
- `src/entry-client.ts`가 browser-only boundary입니다. Server module은 `window`나 `document`에
  접근하지 않으며, server는 application boundary에서 Vite manifest를 명시적으로 로드합니다.
- `@fluojs/react/client` navigation이 제공되기 전에는 link와 form이 일반 browser document
  navigation을 수행합니다. 이 예제는 SPA navigation, event replay, client route matching,
  navigation cache를 약속하지 않습니다.
- 이 예제는 Next.js App Router, file-based router, TanStack route tree, RSC, catch-all route,
  production starter-template 변경이 아닙니다.
- Asset controller는 의도적으로 최소 구현이며 이 예제의 Vite config가 emit하는 flat filename을
  제공합니다. Production deployment에서는 일반적으로 기존 static-file 또는 CDN boundary 뒤에
  build asset을 배치해야 합니다.

## 프로젝트 구조

```txt
examples/react-vite-ssr/
├── src/
│   ├── app.ts              # @Router/@Path page와 Vite asset serving module
│   ├── app.test.ts         # DTO, streamed Suspense, manifest asset assertion
│   ├── entry-client.ts     # Browser-only hydrateRoot(...) entry
│   ├── entry-server.ts     # 명시적 Vite server-entry selector
│   ├── hydration.test.ts   # DOM-equivalent hydration interaction 및 warning 검증
│   ├── main.ts             # 생성된 manifest를 로드하고 Fastify 시작
│   ├── page.ts             # server/client 공유 document와 interactive counter
│   └── recommendations.ts  # Lazy Suspense content
├── vite.client.config.ts
├── vite.server.config.ts
├── README.md
└── README.ko.md
```

## 관련 문서

- `../react-stable-ssr/README.ko.md` — explicit-asset `0.1.0` SSR baseline
- `../../packages/react/README.ko.md` — React package 및 Vite manifest contract
- `../../packages/vite/README.ko.md` — Vite build의 TC39 decorator transform boundary
- `../../docs/contracts/behavioral-contract-policy.ko.md` — behavior/docs/test alignment rule
