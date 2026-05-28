# @fluojs/studio

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 runtime-connected React devtool이며, 기존 static/report artifact 로딩도 계속 지원합니다.

## 목차

- [설치](#설치)
- [릴리스 정책](#릴리스-정책)
- [빠른 시작: Live Devtool](#빠른-시작-live-devtool)
- [Static/Report 호환성](#staticreport-호환성)
- [로컬 보안 모델](#로컬-보안-모델)
- [런타임 지원 매트릭스](#런타임-지원-매트릭스)
- [공개 API](#공개-api)
- [향후 방향](#향후-방향)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/studio
```

배포된 패키지는 다음 caller-facing entrypoint를 제공합니다.

- `@fluojs/studio` / `@fluojs/studio/contracts`: canonical snapshot 파싱, 필터링, Mermaid graph 렌더링 헬퍼와 runtime-connected Studio live event 계약
- `@fluojs/studio/viewer`: 패키징된 React 브라우저 viewer HTML 진입 파일

## 릴리스 정책

- `@fluojs/studio`는 fluo의 intended public publish surface에 포함되는 공개 배포 패키지입니다.
- Studio의 npm 설치 계약은 `pnpm add @fluojs/studio`이며, 저장소 내부 개발 경로는 계속 `pnpm --dir packages/studio dev`를 사용합니다.
- 공개 패키지 표면은 additive입니다. live devtool 계약을 추가하면서도 file-first parsing, filtering, graph rendering, report artifact 호환성을 유지합니다.

## 빠른 시작: Live Devtool

로컬 앱을 runtime-connected Studio sidecar와 함께 실행합니다.

```bash
fluo dev --studio
```

`fluo dev --studio`는 일반 dev process를 실행하고, token-protected local sidecar를 시작하며, 앱이 `@fluojs/runtime`을 import하기 전에 명시적인 Studio runtime config를 Node 앱 child에 주입하고 다음과 같은 URL을 출력합니다.

```text
[fluo] Studio listening at http://127.0.0.1:51234/?token=...
```

그 URL을 열면 live React Studio dashboard에서 런타임 상태를 볼 수 있습니다. Dashboard 코드는 `src/app`, `src/pages`, `src/widgets`, `src/features`, `src/entities`, `src/shared`의 Feature-Sliced Design layer로 구성됩니다.

Live mode는 다음을 보여줍니다.

- connection state(`connecting`, `connected`, `restarting`, `reconnecting`, `stale`, `disconnected`, `error`)
- module/provider/controller/route graph node와 import/export/ownership/dependency edge
- HTTP method/path/controller handler route descriptor
- route/handler correlation, success/error, status code, duration을 포함한 최근 request flow
- bootstrap/restart/request timing summary
- severity, target, message, 가능한 fix hint가 포함된 runtime/request diagnostics

MVP request flow는 route/handler와 dependency-graph correlation을 의미합니다. full method-level service call-chain tracing은 아직 포함하지 않습니다.

## Static/Report 호환성

Studio는 여전히 fluo CLI가 내보낸 JSON 파일을 소비합니다. 런타임은 snapshot을 생산하고, CLI는 artifact export/write/delegation을 소유하며, Studio는 사람과 자동화 호출자가 사용할 수 있도록 snapshot을 파싱, 필터링, 검사, 렌더링하는 공개 헬퍼와 viewer surface를 소유합니다. 지원되는 inspect artifact에는 raw snapshot, snapshot-plus-timing envelope, `fluo inspect --report`가 생성한 report artifact, legacy standalone timing diagnostics가 포함됩니다.

1. **Snapshot 내보내기**:
   ```bash
   fluo inspect ./src/app.module.ts --json > snapshot.json
   ```

2. **패키징된 Studio viewer 열기**:
   ```bash
   pnpm add -D @fluojs/studio
   node -p "require.resolve('@fluojs/studio/viewer')"
   ```

   출력된 `dist/index.html` 경로를 브라우저에서 엽니다. 저장소 내부 Studio 개발에는 다음 명령을 사용합니다.
   ```bash
   pnpm --dir packages/studio dev
   ```

3. **파일 로드**: Studio 웹 인터페이스에 `snapshot.json` 파일을 드래그 앤 드롭합니다. Search와 filter control은 graph, connection explorer, diagnostics, summary가 갱신되는 동안 focus를 유지합니다.

## 로컬 보안 모델

- Studio sidecar는 기본적으로 `127.0.0.1`에 bind됩니다.
- Runtime ingestion과 browser state/SSE API는 실행마다 생성되는 token을 요구합니다.
- Sidecar는 기본적으로 CORS를 활성화하지 않습니다.
- Request body는 기본적으로 수집하지 않습니다. Live request event는 method/path/url/request id/route/handler/status/duration/error metadata만 포함합니다.
- Runtime Studio instrumentation은 CLI가 제공한 명시적 Studio config가 있을 때만 활성화됩니다. Runtime package source는 `process.env`를 직접 읽지 않으며, 유효한 injected config가 없으면 runtime 동작은 no-op입니다.

## 런타임 지원 매트릭스

| Runtime target | MVP expectation |
| --- | --- |
| Node dev runner | `fluo dev --studio`를 통한 full support target입니다. |
| Bun | 이번 MVP에서는 활성화하지 않습니다. Dedicated bridge를 구현하고 검증하기 전까지 `fluo dev --studio`는 Bun 프로젝트를 거부합니다. |
| Deno | 이번 MVP에서는 활성화하지 않습니다. Dedicated bridge를 구현하고 검증하기 전까지 `fluo dev --studio`는 Deno 프로젝트를 거부합니다. |
| Cloudflare Workers | 별도 worker bridge를 구현하고 검증하지 않는 한 이번 MVP에서는 unsupported입니다. |

## 공개 API

Studio는 주로 웹 애플리케이션이지만, 배포된 패키지는 도구/자동화가 사용할 수 있는 계약도 함께 공개합니다. `@fluojs/studio`를 snapshot parsing, filtering, Mermaid graph rendering, live Studio event validation 의미론의 canonical owner로 취급합니다.

| 규격 | 설명 |
|---|---|
| `parseStudioPayload(rawJson)` | raw snapshot JSON, standalone timing JSON, snapshot+timing envelope, `fluo inspect --report` artifact를 받아 parsed payload와 원본 JSON string을 반환합니다. |
| `applyFilters(snapshot, filter)` | 원본 snapshot을 변경하지 않고 readiness/severity/query filter를 적용합니다. |
| `renderMermaid(snapshot)` | 내부 component dependency edge와 외부 dependency node를 포함해 로드된 platform graph를 Mermaid text로 변환합니다. |
| `parseStudioLiveEvent(rawJson)` / `validateStudioLiveEvent(value)` | UI state가 사용하기 전에 runtime-connected sidecar/SSE envelope를 검증합니다. |
| `StudioLiveSnapshot` | React UI가 소비하는 live graph/routes/requests/timing/diagnostics snapshot입니다. |
| `StudioLiveEvent` | `snapshot`, `request`, `timing`, `diagnostic`, `restart`, `disconnect`, `heartbeat`를 위한 versioned live event envelope입니다. |
| `StudioPayload` / `StudioReportArtifact` / `StudioReportSummary` | Static/report 호환성 계약입니다. |

### 배포 패키지 entrypoint

- `@fluojs/studio`: snapshot parsing/filtering/rendering과 live contract용 root helper barrel
- `@fluojs/studio/contracts`: 계약 헬퍼를 직접 가져오고 싶은 도구용 명시적 subpath
- `@fluojs/studio/viewer`: React 브라우저 viewer bundle의 `dist/index.html` entrypoint

`@fluojs/studio/viewer`는 asset-only manifest subpath입니다. 호출자는 JavaScript module이나 TypeScript declaration entrypoint가 아니라 패키징된 HTML 파일 경로를 resolve합니다.

## 향후 방향

MVP는 local runtime-connected devtool입니다. 향후 릴리스에서는 cloud-hosted Studio, accounts/auth, team sharing, production monitoring dashboard, 더 풍부한 bidirectional command, VS Code extension 가능성을 제공해야 합니다. 이 기능들은 현재 shipped claim이 아닙니다.

## 관련 패키지

- **[@fluojs/cli](../cli/README.ko.md)**: `fluo dev --studio`와 inspect/export 명령을 제공합니다.
- **[@fluojs/runtime](../runtime/README.ko.md)**: live snapshot, request trace, timing, diagnostics를 생산합니다.

## 예제 소스

- [main.ts](./src/main.ts) - 테스트 호환 애플리케이션 진입점
- [main.tsx](./src/main.tsx) - React 브라우저 viewer 진입점
- [contracts.ts](./src/contracts.ts) - static/live Studio 계약 정의
