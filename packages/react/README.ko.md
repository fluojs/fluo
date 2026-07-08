# @fluojs/react

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 런타임 중립 React 통합 스캐폴드입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [런타임 및 피어 계약](#런타임-및-피어-계약)
- [현재 스캐폴드 계약](#현재-스캐폴드-계약)
- [Public API](#public-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

이 패키지의 첫 공개 릴리스 목표는 `0.1.0`입니다. manifest는 `0.0.0`에서 시작해
Changesets가 표준 릴리스 워크플로를 통해 초기 `0.1.0` 버전을 게시할 수 있게 합니다.

패키지가 게시되면 React와 React DOM을 peer로 함께 설치합니다.

```bash
npm install @fluojs/react react react-dom
```

## 사용 시점

예정된 fluo React SSR 통합 작업을 위한 안정적인 패키지 경계가 필요할 때만 이 패키지를
사용하세요. Phase 1-1은 스캐폴드이며 렌더링 동작을 구현하지 않습니다.

## 런타임 및 피어 계약

루트 `@fluojs/react` import는 런타임 중립입니다. import 시점에 Node.js built-in, Vite,
`react-dom/server`, React Server Components 패키지, Server Functions 코드를 eager load하면 안 됩니다.

`react`와 `react-dom`은 애플리케이션이 React 런타임 버전을 소유하도록 peer dependencies로 선언합니다.
이 스캐폴드 단계에서 패키지 루트는 해당 peer를 import하지 않습니다.

## 현재 스캐폴드 계약

현재 이 패키지가 제공하는 것은 다음뿐입니다.

- provider, controller, renderer, Vite plugin, RSC hook을 등록하지 않는 public `ReactModule` 클래스
- 계획된 `0.1.0` public surface를 위한 type-only 스캐폴드 metadata
- 향후 decorators, server-entry, render 작업을 위한 reserved source files

현재 이 패키지가 제공하지 않는 것은 다음입니다.

- `@Router` 또는 `@Path` 동작
- SSR rendering 또는 streaming
- `@fluojs/react/vite`
- React Server Components 또는 Server Functions 통합

## Public API

- `ReactModule` — 향후 React 통합 작업을 위한 런타임 중립 module marker입니다.
- `ReactScaffoldPhase` — `0.1.0` scaffold surface를 위한 type-only planning marker입니다.

## 관련 패키지

- `@fluojs/core`: 스캐폴드가 사용하는 standard `@Module` decorator를 제공합니다.
- `@fluojs/runtime`: 향후 React 통합 작업은 root import boundary를 넓히지 않고 runtime bootstrap contract와 합성될 예정입니다.

## 예제 소스

- `packages/react/src/index.ts`
- `packages/react/src/module.ts`
- `packages/react/src/index.test.ts`
