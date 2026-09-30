# React 프로덕션 배포

<p><a href="./react-production-deployment.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 빌드와 게시

공식 React starter를 `pnpm build`로 빌드하고 `pnpm start`로 빌드된 서버를 시작합니다.
선택한 Vite client manifest의 전체 출력 그래프와 `/assets/` base를
`createReactViteAssetManifest(...)`에 전달합니다. 생성된 `buildId`를
`ReactModule.forRoot({ navigationBuildId })`와 문서의
`ReactClientRouterProvider.navigationBuildId`에 전달하고 임의의 릴리스 문자열을
대신 사용하지 않습니다. 서버는 manifest가 선택한 해시 bootstrap, lazy JS, CSS,
favicon을 동일 origin의 `/assets/`에서 제공합니다. 다른 빌드의 manifest를
재사용하지 않고 서버 시작 시 읽습니다. 직접 GET은 JS 없이도 HTTP 상태와 HTML을
반환해야 합니다. 프로덕션 bootstrap에는 Vite 개발 client, preamble, WebSocket이
필요하지 않습니다. 임의 CDN host와 교차 origin asset base는 이 recipe의 지원
범위 밖입니다.

B 서버와 manifest로 요청을 전환하기 **전에** B의 해시 출력 전체를 게시합니다.
구체적으로 정하고 관측하는 기존 탭 지원 기간(예: 24시간)이 끝날 때까지 A의
해시 asset을 유지한 뒤 제거합니다. 콘텐츠 주소 asset에는
`Cache-Control: public, max-age=31536000, immutable`을 사용하지만 버전이 없는 favicon은
짧게 캐시합니다. HTML과 인증된
navigation 결과에는 `private, no-store`를 적용합니다. 사용자 간 private
navigation 응답을 캐시하지 않습니다. 누락 asset은 HTTP 404 및
`X-Fluo-Asset-Status: missing`을 반환하여 host가 경로와 빌드를 조사할 수
있게 합니다. 이 순서와 보존은 애플리케이션/CDN 운영 책임이며 Fluo가
프로비저닝하거나 무중단 전환을 보장하지 않습니다.

## 오래된 탭과 복구

A 탭은 매번 B navigation의 검증된 v2 `buildId`를 A 문서 식별자와 비교하고,
다르면 모듈을 import하기 전에 마지막 승인 URL, 페이지, history, 셸 resource를
유지합니다. 공식 셸은 정제된 `incompatible-build` 진단과 명시적
update/document control을 제공합니다. 매핑된 chunk import 실패는
`import-failure`, 없는 모듈 key는 `unsupported-module`입니다. 오래된 탭이
필요한 A asset 누락은 B payload 승인이 아니라 배포 장애입니다. 명시적
update는 일반 B 문서를 로드하므로 resource가 재설정될 수 있으며 자동 reload
반복이나 끊김 없는 재생을 약속하지 않습니다.
[navigation 계약](../contracts/react-navigation-payload.ko.md)과
[v1 이주](../getting-started/migrate-react-production-assets.ko.md)를 확인하세요.
