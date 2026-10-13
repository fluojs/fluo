# tooling-vite

<p><strong><kbd>한국어</kbd></strong> <a href="./README.md"><kbd>English</kbd></a></p>

저장소 테스트용 private Vite 도구입니다. 애플리케이션용 공개 플러그인은 [@fluojs/vite](../../packages/vite/README.ko.md)를 사용하세요.

## 시작할 파일

[src/index.ts](./src/index.ts)의 `fluoBabelDecoratorsPlugin()`은 공개 `fluoDecoratorsPlugin`에 저장소의 [Babel 설정](../babel/babel.config.cjs), source map, `test` 변환 경계를 전달합니다. [공유 Vitest 설정](../vitest/src/index.ts)이 이 함수를 사용합니다.

이 내부 래퍼를 생성 앱에 복사하지 말고 [도구 체인 계약](../../docs/reference/toolchain-contract-matrix.ko.md)과 공개 플러그인의 설정을 따르세요.
