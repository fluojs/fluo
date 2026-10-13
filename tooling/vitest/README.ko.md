# tooling-vitest

<p><strong><kbd>한국어</kbd></strong> <a href="./README.md"><kbd>English</kbd></a></p>

저장소 테스트를 위한 private 공통 설정입니다. 생성 앱의 테스트 설정과 구분하세요.

## 시작할 파일

- [src/index.ts](./src/index.ts): `createFluoVitestWorkspaceConfig()`로 데코레이터 변환, workspace source alias, metadata 준비와 Node 테스트 환경을 조합합니다.
- [루트 vitest.config.ts](../../vitest.config.ts): 프로젝트별 테스트 대상과 추가 설정.
- [Core vitest.config.ts](../../packages/core/vitest.config.ts): 패키지별 설정의 사용 예시.

Source alias를 쓰는 저장소 테스트는 현재 소스를 검증하며 게시된 npm 패키지의 호환성을 대신 증명하지 않습니다. 앱의 테스트 작성법은 [@fluojs/testing](../../packages/testing/README.ko.md), 저장소 실행 명령은 [기여 가이드](../../CONTRIBUTING.ko.md)를 참고하세요.
