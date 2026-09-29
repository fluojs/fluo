# Node React 스타터의 개발 HMR 이전

<p><a href="./migrate-react-dev-hmr.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

새 `fluo new --starter react-vite-ssr` 프로젝트는 기존 `fluo dev` 명령에서 React
Fast Refresh와 CSS HMR을 실행합니다. 별도 Vite 서버나 production build가 필요하지
않습니다. `@fluojs/cli`를 업그레이드해도 기존 생성 앱은 자동으로 수정되지 않습니다.

기존 Node React/Vite 앱에서 이 경로를 사용하려면:

1. `@fluojs/cli`를 업그레이드하고 `@vitejs/plugin-react@^6.1.1`을 dev dependency로
   설치하세요. `vite.server.config.ts`에서 기존 `@fluojs/vite` decorator plugin을
   `react()` 앞에 유지하고 과거 development stylesheet stub을 제거하세요.
2. `import '@vitejs/plugin-react/preamble'` 뒤에 `await import('./entry-client')`가
   있는 `src/entry-client-dev.ts`를 추가하세요. 개발 renderer에서만 `/@vite/client`와
   `/src/entry-client-dev.ts`를 bootstrap module로 사용하고 production entry와
   manifest는 유지하세요.
3. CLI 소유 개발 gateway가 공개 HTTP port와 Vite WebSocket을 유지하도록 하고,
   Vite middleware와 `/@react-refresh`는 생성된 app의 임시 Fastify listener에
   연결하세요. 공식 생성 `src/main.ts`가 참고 구현입니다. 직접 HTTP 요청마다 DTO
   handler를 거친 뒤 `vite.ssrLoadModule(...)`으로 최신 page/document module을
   읽으세요. `@fluojs/http`의 matching/validation을 대체하지 마세요. Vite의
   CSS는 inline style element로 주입되므로 개발용 `securityHeaders`에서만
   `style-src 'self' 'unsafe-inline'`을 허용하고 production 기본 CSP는 유지하세요.
4. `fluo dev` 또는 생성된 `pnpm dev`를 실행하고 component/CSS를 수정하면서
   browser 결과와 직접 SSR 요청을 확인하세요. Production hydration은 별도로
   `pnpm build` 및 `pnpm start`를 실행해 확인하세요.

Bootstrap SSR graph에는 속하지 않는 browser module만 Fast Refresh를 단독으로
사용합니다. Server-only 소스 수정은 안정된 gateway 뒤의 app graph를 교체하고
browser document를 유지합니다. Shared graph 수정은 readiness 뒤 document를
reload할 수 있으며 config와 `.env` 수정은 child restart 경계를 유지합니다.
App 재시작 중 HTTP 요청에는 `Retry-After: 1`과 503을 응답하고 bootstrap 실패 시
수정 저장까지 사용 불가 상태를 유지합니다.
Config로 process를 다시 시작하면서 browser module 적재가 중단되면 readiness 뒤
document를 다시 요청하세요. 동일 document 유지는 server-only 수정에 적용됩니다.
React가 호환되는 component boundary로 판단할 때만 hook/input state가 보존됩니다.
Hook 순서, 호환되지 않는 export, 전파된 full reload는 remount나 document 교체를
일으킬 수 있습니다. Syntax/transform 오류는 Vite browser overlay와 terminal에
나타나며 소스를 수정하면 같은 `fluo dev` session에서 회복합니다.
`--raw-watch`와 `FLUO_DEV_RAW_WATCH=1`은 native-watch 의미를 유지하며 Fast Refresh
보장은 아닙니다. Bun, Deno, Workers는 이 Node starter 변경만으로 React Fast
Refresh 지원 대상이 되지 않습니다.
