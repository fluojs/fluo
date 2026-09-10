# Node Adapter Creation Migration

<p><a href="./migrate-node-adapter-create.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Scope

이 API 호환성을 깨는 변경은 `@fluojs/platform-nodejs`의 중복 adapter 생성 API를 기존 `NodeHttpApplicationAdapter` 클래스의 `create(options)`로 통합합니다. 지원 Node.js 범위는 `>=24.0.0 <27`이며, 패키지 API 소유 문서는 [Node README](../../packages/platform-nodejs/README.ko.md)입니다. 다른 runtime이나 Express/Fastify server 구현은 합치지 않습니다.

## Imports and calls

| 제거된 표면 | 대체 표면 |
| --- | --- |
| Root `createNodejsAdapter(options)` | Root `NodeHttpApplicationAdapter.create(options)` |
| Root 또는 `/internal`의 `createNodeHttpAdapter(options, compression, multipart)` | `NodeHttpApplicationAdapter.create({ ...options, compression, multipart })` |
| Root `NodejsAdapterOptions` | `NodeHttpAdapterOptions` |
| Root type-only `NodejsHttpApplicationAdapter` | `NodeHttpApplicationAdapter` |

두 자유 함수는 export뿐 아니라 구현도 삭제됩니다. 모든 공개 subpath, 배포 JavaScript, `.d.ts`에 영구 alias를 남기지 않습니다. 일반 앱은 package root에서 import합니다. First-party integration이 `/internal`을 사용하는 경우에도 같은 클래스와 options type을 import하며 별도 클래스가 만들어지지 않습니다. 기존 positional factory 인수를 객체에 옮길 때 뒤쪽 `compression`과 `multipart`가 우선하도록 위 spread 순서를 사용하세요.

## Canonical recipe

Repository 예제가 아니라 설치한 앱의 bootstrap 예제입니다. `@fluojs/platform-nodejs`, `@fluojs/runtime`과 authored `AppModule`이 필요하며, module의 표준 decorator build/metadata 설정을 먼저 준비해야 합니다.

```typescript
import { NodeHttpApplicationAdapter, type NodeHttpAdapterOptions } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const options: NodeHttpAdapterOptions = {
  host: '127.0.0.1',
  port: 3000,
  compression: true,
  maxBodySize: 1_048_576,
  multipart: { maxTotalSize: 2_097_152 },
  shutdownTimeoutMs: 10_000,
};
const adapter = NodeHttpApplicationAdapter.create(options);
const app = await FluoFactory.create(AppModule, { adapter });
await app.listen();

// When the host requests shutdown:
await app.close();
```

## Preserved behavior

- `create`는 port와 body cap을 검증하고 구체적인 adapter를 생성합니다. `port`는 정수 `0..65535`, 기본값은 `3000`이며 `process.env.PORT`를 읽지 않습니다. `0`은 `listen()`에서 실제 ephemeral port를 할당하고 이후 `getListenTarget()` / `getServer().address()`로 확인합니다.
- `maxBodySize`는 0 이상의 정수 bytes이며 기본값은 `1_048_576`입니다. Multipart의 `maxTotalSize` 생략은 유효 `maxBodySize`를 따릅니다. 명시한 total은 body cap보다 작거나 커도 그대로 적용되고 `0`도 보존합니다. 한도 초과는 listener에서 `413`입니다. Multipart file/count/field 제한과 buffered/streaming 선택은 같은 `multipart` 객체로 전달합니다.
- `compression` 기본값은 `false`입니다. `true`에서 full response는 협상한 gzip을 사용할 수 있지만 range 응답은 재압축하지 않아 identity byte, `206`/`416`, range metadata 계약을 유지합니다.
- `http`와 `https`는 각각 Node server construction options이며 동시에 제공하면 server 생성 전에 throw합니다. `rawBody` 기본값은 `false`이고 multipart raw-body 제외는 유지됩니다.
- Retry 기본값은 `retryDelayMs: 150`, `retryLimit: 20`이며 adapter drain 기본값은 `shutdownTimeoutMs: 10_000`입니다. 모두 0 이상의 정수이고 잘못된 값은 생성 시 throw합니다. Adapter instance가 listener와 socket을 소유하고 `close()`가 idle connection 정리와 bounded drain을 수행합니다.
- 기존 public positional constructor의 인수 순서, subclassing, DI class token, `instanceof`, instance `listen`/`close`/server 접근은 유지됩니다. Static 반환 타입은 이제 portable interface로 좁혀지지 않는 `NodeHttpApplicationAdapter`입니다. Constructor의 기존 저수준 호환 경로를 private으로 바꾸거나 instance 상태를 static으로 옮기지 않습니다.
- Node/Nodejs bootstrap/run helper, logger, filesystem, signal API는 이 이슈에서 제거하지 않습니다. Bootstrap/run helper는 같은 static 생성 구현을 사용하되 기존 lifecycle과 signal 소유권을 유지합니다. `forceExitTimeoutMs`는 run-helper signal 완료 bound이며 adapter drain bound가 아닙니다.

## CLI and existing applications

`fluo new --shape application --transport http --runtime node --platform nodejs`는 위 static adapter와 Factory를 사용하며, `createConsoleApplicationLogger()`와 `shutdownRegistration: createNodeShutdownSignalRegistration()`도 명시적으로 생성합니다. 기존 프로젝트는 자동 수정하지 않으므로 import와 호출을 위 표대로 이전하세요. Factory는 기본 security headers를 적용하고, CORS와 prefix는 opt-in이며, signal callback을 생략하면 host가 종료를 소유합니다. 기존 `runNodejsApplication`에서 이전할 때 필요한 middleware와 logger를 보존하고 Node signal 종료가 필요하면 이 callback을 전달하세요. Factory가 listen 뒤 등록하고 close에서 해제합니다. 기존 run helper를 그대로 쓰는 앱은 기존 동작을 유지합니다. 공통 기본값과 오류·정리 정책은 [HTTP Factory migration](./migrate-http-factory.ko.md)을 따르세요.

## Evidence and release impact

- 실제 생성·검증: `packages/platform-nodejs/src/node/internal-node.ts`의 static `create`; 두 전용 factory와 단일 caller port/body resolver는 삭제됩니다.
- 하위 구현은 adapter instance 작업입니다. Constructor가 `createNodeServer`와 `createNodeRequestResponseFactory`, `NodeListenLifecycle`을 사용하고, `listen`/`close`가 instance lifecycle을 사용합니다. 이는 adapter 생성 forwarding wrapper가 아닙니다. 기존 request/compression plumbing은 raw Node constructor와 Express/Fastify internal-seam 소비자에게 필요하므로 유지됩니다.
- Runtime 회귀: `packages/platform-nodejs/src/adapter-create.test.ts`, `src/index.test.ts`, `src/lifecycle.test.ts`, `src/lifecycle.integration.test.ts`.
- 배포 소비자 회귀: `packages/platform-nodejs/src/published-declaration-surface.test.ts`와 `src/node-adapter-consumer.test-fixture.ts`가 root/internal type import, static options/반환 타입, constructor, JavaScript export와 클래스 identity를 검사합니다.
- CLI 회귀: `packages/cli/src/new/scaffold.test.ts`. Docs enforcement companion: `tooling/governance/node-adapter-creation.test.ts`.
- 소비자 조사는 CLI, runtime, GraphQL, OpenAPI, Socket.IO, WebSockets 테스트와 package README, website Docs, `book/03-internals/ch13-node-adapters`, `book/intermediate/ch21-express-node`, `book/advanced/ch10-runtime-branching` EN/KO까지 포함합니다. Historical changelog는 당시 릴리스 기록이므로 다시 쓰지 않습니다.

```bash
pnpm --filter '@fluojs/platform-nodejs...' build
pnpm --filter '@fluojs/platform-nodejs' typecheck
pnpm --filter '@fluojs/platform-nodejs' test
pnpm verify:platform-consistency-governance
pnpm verify:docs
```

API 삭제와 생성 starter의 bootstrap 소유권 변경은 maintainer의 명시적 요청에 따라 platform-nodejs와 CLI patch Changeset으로 기록합니다. patch 분류가 migration 요구 사항을 없애거나 삭제된 API를 보존한다는 뜻은 아닙니다. HTTP/runtime README 소비자 변경도 배포 README 정합을 위한 patch이며 해당 package runtime 동작은 변경하지 않습니다. 나머지 Docs/Book 및 타 package test-only 변경은 독립적인 배포 API 변경이 아닙니다. 이 명령 목록은 검증 절차이며 실행 결과 자체가 아닙니다.
