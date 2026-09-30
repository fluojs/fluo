# React navigation v1에서 프로덕션 빌드 식별자로 이주

<p><a href="./migrate-react-production-assets.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

선택적으로 사용하던 `application/vnd.fluo.react-navigation+json;v=1`
payload는 필수 `buildId`를 가진 v2로 바뀝니다. v1 탭은 v2 응답을 soft
destination으로 승인하지 않고 일반 문서 GET으로 이동해야 합니다. v2 탭은
v1 응답을 유효하지 않은 표현으로 거부하고 앱의 문서 fallback 정책을
따릅니다. 직접 HTML 요청에는 Accept 헤더가 필요하지 않습니다.

1. `/assets/` base로 전체 client 출력을 빌드하고 Vite manifest를 보존합니다.
   `createReactViteAssetManifest({ manifest, base: '/assets/', entries })`의
   `result.manifest.buildId`를 사용합니다. 이 식별자는 lazy entry까지 포함하며
   임의 문자열로 대체하지 않습니다.
2. 동일 식별자를 `ReactModule.forRoot({ navigationBuildId: buildId,
   controllers, renderPage })`와 문서의
   `<ReactClientRouterProvider navigationBuildId={buildId} navigationModules={modules} ...>`에
   전달합니다. 빌드된 문서의 초기 transfer에 `version: 2`와 `buildId`가 있어야
   hydration을 허용하며 누락 식별자를 묵인하지 않습니다.
3. navigation과 익명 public prefetch에 정확히
   `Accept: application/vnd.fluo.react-navigation+json;v=2`를 보냅니다.
   `incompatible-build`는 명시적 update 선택지로 처리하고 매핑된
   `import-failure`와 `unsupported-module` 및 기존 HTTP 오류/redirect 정책을
   구분합니다.
4. B 서버/manifest보다 B asset을 먼저 게시하고 정해 둔 기존 탭 보존 기간
   동안 A asset을 유지합니다. [배포 recipe](../guides/react-production-deployment.ko.md)를
   확인하세요.

현재 `@fluojs/react`는 0.2.2이므로 이 프로토콜/설정 변경은 breaking 0.x
minor Changeset 대상이며 임의의 게시 버전 또는 1.0 승인이 아닙니다.
생성된 CLI starter는 자동으로 식별자를 제공하지만 직접 조립한 앱은
manifest, 문서 및 client importer가 같은 빌드에서 나오도록 해야 합니다.
