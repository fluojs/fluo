# tooling-babel

<p><strong><kbd>한국어</kbd></strong> <a href="./README.md"><kbd>English</kbd></a></p>

이 디렉터리는 저장소 개발용 private 도구이며 애플리케이션에 설치하는 공개 패키지가 아닙니다.

## 시작할 파일

- [babel.config.cjs](./babel.config.cjs): TypeScript 제거와 표준 데코레이터 변환 설정.
- [Core 빌드 스크립트](../../packages/core/package.json): 공유 설정을 사용하는 패키지 빌드 예시.
- [Babel 8 검증](./babel8-baseline.test.ts): 변환 순서와 실행 결과의 회귀 검증.

애플리케이션을 만들려면 [루트 빠른 시작](../../README.ko.md#빠른-시작)을 사용하세요. 지원하는 변환 조합은 [도구 체인 계약](../../docs/reference/toolchain-contract-matrix.ko.md)을 따릅니다.
