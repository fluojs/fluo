# @fluojs/platform-deno

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

네이티브 `Deno.serve`를 기반으로 구축된 fluo 런타임용 Deno 기반 HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [HTTPS와 런타임 이식성](#https와-런타임-이식성)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
deno add npm:@fluojs/platform-deno npm:@fluojs/runtime npm:@fluojs/http
```

이 패키지는 Deno에서 실행하는 것을 전제로 합니다. 배포 manifest는 npm 메타데이터가 Deno 런타임 계약과 어긋나지 않도록 의도적으로 `engines.node`를 선언하지 않으며, 저장소의 Node.js 20+ 요구사항은 메인테이너용 빌드/테스트 툴체인에만 적용됩니다.

## 사용 시점

fluo 애플리케이션을 [Deno](https://deno.com/) 런타임에서 실행할 때 이 패키지를 사용합니다. 이 어댑터는 Deno의 네이티브 `fetch` 표준 `Request` 및 `Response` 객체를 활용하여 TypeScript 백엔드 개발을 위한 안전하고 고성능인 환경을 제공합니다.

애플리케이션 종료 중에는 새 유입을 중단하고, Deno 서버 수명주기가 종료되기 전에 활성 HTTP 핸들러가 bounded drain window 안에서 마무리될 수 있도록 동작합니다.

`runDenoApplication(...)`을 Deno signal API를 사용할 수 있는 환경에서 실행하면 `SIGINT`/`SIGTERM` 리스너도 등록하고, 애플리케이션이 닫히면 해당 리스너를 정리합니다.

## 빠른 시작

```typescript
import { runDenoApplication } from '@fluojs/platform-deno';
import { AppModule } from './app.module.ts';

await runDenoApplication(AppModule, {
  port: 3000,
});
```

## 주요 패턴

### 수동 요청 디스패칭
테스트나 커스텀 `Deno.serve` 구현을 위해 어댑터의 `handle` 메서드를 사용하여 네이티브 웹 요청을 수동으로 디스패치할 수 있습니다. 다만 `handle(...)`은 런타임 dispatcher가 바인딩된 뒤에만 동작하므로, 먼저 `app.listen()`(또는 `runDenoApplication(...)`)으로 부트스트랩을 완료해야 합니다.

```typescript
import { fluoFactory } from '@fluojs/runtime';

const adapter = createDenoAdapter({ port: 3000 });
const app = await fluoFactory.create(AppModule, { adapter });

await app.listen();

const response = await adapter.handle(new Request('http://localhost:3000/health'));
```

### Deno 네이티브 WebSocket 지원
어댑터는 `@fluojs/websockets/deno` 바인딩을 통해 Deno의 네이티브 `Deno.upgradeWebSocket`을 지원합니다.

```typescript
// Deno 어댑터가 활성화된 경우 게이트웨이는 자동으로 Deno의 네이티브 업그레이드를 사용합니다.
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

## HTTPS와 런타임 이식성

`https` 옵션으로 Deno TLS 인증서 자료를 전달하면 `Deno.serve`를 HTTPS 모드로 시작할 수 있습니다. 어댑터는 `https.cert`와 `https.key`를 Deno의 `cert` 및 `key`로 전달하며, 시작 로그도 `https://` listen URL을 보고하므로 Deno 패키지가 공유 HTTP 어댑터 이식성 계약과 정렬됩니다.

```typescript
await runDenoApplication(AppModule, {
  hostname: '127.0.0.1',
  https: {
    cert: await Deno.readTextFile('./cert.pem'),
    key: await Deno.readTextFile('./key.pem'),
  },
  port: 3443,
});
```

`hostname`은 Deno 네이티브 옵션 이름으로 유지됩니다. 공유 HTTP 어댑터 테스트와 교차 런타임 설정 헬퍼를 위해 `host`도 이식성 alias로 허용하며, 둘 다 제공하면 `hostname`이 우선합니다.

## 공개 API 개요

- `createDenoAdapter(options)`: Deno HTTP 어댑터를 위한 팩토리입니다.
- `bootstrapDenoApplication(module, options)`: 커스텀 오케스트레이션을 위한 고급 부트스트랩입니다.
- `runDenoApplication(module, options)`: Deno를 위한 권장 빠른 시작 헬퍼입니다.
- `handle(request)`: 수동 `Request` to `Response` 디스패처입니다.
- `https: { cert, key }`: `Deno.serve`로 전달되고 보고되는 listen URL에 반영되는 HTTPS 시작 옵션입니다.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임입니다.
- `@fluojs/websockets`: 전용 서브패스 `@fluojs/websockets/deno`를 포함합니다.
- `@fluojs/http`: HTTP 데코레이터 및 추상화 계층입니다.

## 예제 소스

- `packages/platform-deno/src/adapter.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
