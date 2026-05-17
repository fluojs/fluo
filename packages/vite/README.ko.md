# @fluojs/vite

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 프로젝트를 위한 Vite 플러그인과 빌드 유틸리티입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install --save-dev @fluojs/vite vite @babel/core @babel/plugin-proposal-decorators @babel/preset-typescript
```

`@babel/core` `>=7.26.0`, `@babel/plugin-proposal-decorators` `>=7.28.0`, `@babel/preset-typescript` `>=7.27.0`, `vite` `>=6.2.0`은 peer dependency입니다. `fluoDecoratorsPlugin()`이 Vite transform 시점에 Babel decorator plugin과 TypeScript preset을 해석하기 때문입니다.

## 사용 시점

- fluo 애플리케이션이 TC39 표준 데코레이터가 포함된 TypeScript를 Vite로 빌드할 때
- starter 프로젝트가 Babel 설정을 inline으로 복사하지 않고 유지보수되는 decorator transform을 import해야 할 때
- 향후 Vite 대상 fluo 빌드 유틸리티에 독립적인 public package 경계가 필요할 때

## 빠른 시작

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    ssr: 'src/main.ts',
    target: 'node20',
  },
});
```

이 플러그인은 `.ts` 애플리케이션 파일을 Babel로 변환하며 `2023-11` decorators proposal과 `@babel/preset-typescript`를 사용합니다. 파일 경계를 판단하기 전에 Vite query suffix를 제거한 뒤 declaration 파일, `.test.` 또는 `.spec.` 파일, `node_modules`, `.ts`가 아닌 파일은 건너뛰므로 생성된 Vitest 테스트 파일은 계속 전용 `@fluojs/testing/vitest` transform 경로를 사용합니다.

## 공개 API

- `fluoDecoratorsPlugin()` — 생성된 fluo starter 프로젝트가 사용하는 Vite 플러그인을 만듭니다.

## 관련 패키지

- [`@fluojs/cli`](../cli/README.ko.md): 이 Vite 플러그인을 import하는 starter 프로젝트를 생성합니다.
- [`@fluojs/testing`](../testing/README.ko.md): Vitest 전용 decorator transform entrypoint를 제공합니다.

## 예제 소스

- `packages/vite/src/index.ts`
- `packages/vite/src/internal/decorators-plugin.ts`
- `packages/cli/src/new/scaffold.ts`
