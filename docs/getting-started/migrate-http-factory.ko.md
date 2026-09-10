# HTTP Factory Migration

<p><strong><kbd>한국어</kbd></strong> <a href="./migrate-http-factory.md"><kbd>English</kbd></a></p>

## Scope and public imports

이 breaking migration은 `FluoFactory.create(AppModule, { adapter })`를 유일한
HTTP 앱 생성 구현으로 만듭니다. 범위는 `@fluojs/runtime`, HTTP adapter의
선택적 listen-target capability, Node shutdown registration, Node CLI starter,
제거된 runtime 이름의 소비자입니다. DI context, microservice, host entrypoint,
decorator, protocol operation을 HTTP 앱 생성과 같은 기능으로 취급하지 않습니다.

| 제거된 공개 surface | 대체 경로 |
| --- | --- |
| `@fluojs/runtime`의 `fluoFactory` | `FluoFactory`를 import하세요. Context와 microservice static 메서드는 별도 동작을 유지합니다. |
| `bootstrapApplication({ rootModule, ...options })` | `FluoFactory.create(rootModule, options)` |
| 기본 security header가 없다는 가정의 Factory 호출 | `securityHeaders: false`를 전달하거나 공통 기본값을 채택하세요. |
| readiness, adapter, post-listen setup 실패 뒤 `app.listen()` 재시도 | 새 앱을 만드세요. 실패한 앱은 terminal shutdown에 진입합니다. |
| Worker `createCloudflareWorkerAdapter(...)` | `CloudflareWorkerHttpApplicationAdapter.create(...)` 뒤 `FluoFactory.create(AppModule, { adapter })`와 `app.listen()`을 사용하세요. |
| Worker `bootstrapCloudflareWorkerApplication(...)` | `CloudflareWorkerHttpApplicationAdapter`를 생성해 `FluoFactory.create(...)`에 전달하고 no-socket `app.listen()`을 await합니다. Worker direct-creation recipe를 참고하세요. |
| Worker `createCloudflareWorkerEntrypoint(...)`, `createCloudflareWorkerEnvEntrypoint(...)` | fixed module에는 `CloudflareWorkerApplicationHost.create(AppModule, options)`를 사용하고, 첫 environment configuration에는 같은 메서드의 `{ fromEnv }`를 사용하세요. |

제거된 이름은 package root, 모든 export-map subpath, 배포 JavaScript,
emitted declaration에서 사라지며 compatibility alias는 없습니다.
`BootstrapApplicationOptions`는 기존 integration 계약의 options type으로
남지만 호출 가능한 대안이 아닙니다. `CreateApplicationOptions`는 이제
`logger`, `cors`, `globalPrefix`, `globalPrefixExclude`, `securityHeaders`,
`shutdownRegistration`, `forceExitTimeoutMs`를 포함합니다.

## Canonical recipe

지원되는 Node `>=24 <27` host에서 import하는 패키지를 설치하고 `AppModule`
평가 전에 기존 standard-decorator 설정을 유지하세요.
아래 fragment는 이미 등록된 `AppModule`이 있다고 가정합니다.

```ts
import { FluoFactory } from '@fluojs/runtime';
import {
  createConsoleApplicationLogger,
  NodeHttpApplicationAdapter,
  createNodeShutdownSignalRegistration,
} from '@fluojs/platform-nodejs';
import { AppModule } from './app.js';

const app = await FluoFactory.create(AppModule, {
  adapter: NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 3000 }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
// For an explicit shutdown instead of a signal:
await app.close('manual');
```

Fastify나 Express에서는 `FastifyHttpApplicationAdapter.create(options)` 또는
`ExpressHttpApplicationAdapter.create(options)`로 adapter import/configuration만 바꾸세요. Node logger나
signal callback을 import한다면 `@fluojs/platform-nodejs`를 직접 의존성에
추가하고 transitive dependency에 기대지 마세요. Node CLI starter는 이제 이
직접 의존성과 같은 Factory recipe를 생성합니다. Node mixed starter는 소유한
microservice를 계속 instance 메서드로 연결하고 시작합니다.

Host-owned lifecycle에서는 `shutdownRegistration`을 생략하고 host가
`app.close(signal?)`을 호출합니다. Factory는 `process`나 Node builtin을
import하지 않고, signal을 임의로 만들거나 Fetch host 대신 socket을 bind하지
않습니다. Listen 전에도 앱을 닫을 수 있으며 이 경로는 signal을 등록하지
않습니다. Adapterless HTTP shell은 close 전에 `app.dispatch()`로 사용할 수
있습니다. 이 shell의 `listen()`은 사용 오류로 reject하지만 shell을 dispose하지
않습니다. DI 전용 작업은 `createApplicationContext`를 사용하세요.

Platform bootstrap/run helper와 adapter 생성 자유 함수는 제거됩니다.
각 platform의 공개 adapter class에서 static `create(options)`를 호출하고
Factory에 전달한 뒤 `app.listen()`을 호출하세요. Host callback은 명시적으로 선택합니다.
Body parsing, multipart/compression 설정, native middleware, connection drain,
realtime binding은 계속 adapter가 소유합니다. Transport 전용 option을
Factory로 옮기지 마세요.

## Platform startup migration

아래는 제거된 이전 API이며 호환 alias가 아닙니다.

| Platform | Removed entrypoints | Adapter creation |
| --- | --- | --- |
| Fastify | `createFastifyAdapter`, `bootstrapFastifyApplication`, `runFastifyApplication` | `FastifyHttpApplicationAdapter.create(options)` |
| Express | `createExpressAdapter`, `bootstrapExpressApplication`, `runExpressApplication` | `ExpressHttpApplicationAdapter.create(options)` |
| Node | `bootstrapNodeApplication`, `bootstrapNodejsApplication`, `runNodeApplication`, `runNodejsApplication` | `NodeHttpApplicationAdapter.create(options)` |
| Bun | `createBunAdapter`, `bootstrapBunApplication`, `runBunApplication` | `BunHttpApplicationAdapter.create(options)` |
| Deno | `createDenoAdapter`, `bootstrapDenoApplication`, `runDenoApplication` | `DenoHttpApplicationAdapter.create(options)` |

Adapter를 Factory에 전달합니다. Bootstrap-only 생성을 대체할 때는 listen을
생략하고, run 호출을 대체할 때는 `app.listen()`까지 명시적으로 await합니다.
Helper 전용 `Bootstrap*ApplicationOptions`, `Run*ApplicationOptions`, platform
signal alias 대신 adapter options, `CreateApplicationOptions`, `NodeShutdownSignal`,
`BunShutdownSignal`, `DenoShutdownSignal`을 사용합니다. Static factory는 concrete
class를 반환하므로 adapter 고유 기능에 접근하기 위한 cast가 필요하지 않습니다.

- Fastify/Express의 이전 두 번째 multipart 인자는 `options.multipart`로 옮깁니다.
  TLS, raw-body, body limit, native middleware, drain 설정은 adapter에 유지하고,
  CORS, prefix, application middleware, security headers, logger는 Factory로 옮깁니다.
- Node/Fastify/Express는 `createNodeShutdownSignalRegistration(signals?)`, Bun은
  `createBunShutdownSignalRegistration(signals?)`, Deno는
  `createDenoShutdownSignalRegistration(signals?)`을 `shutdownRegistration`에 전달합니다.
  이전 `shutdownSignals: false`처럼 host가 직접 소유하려면 callback을 생략합니다.
- Bun direct adapter의 `shutdownTimeoutMs` 기본값은 10초입니다. 이전 managed
  run의 기본 drain을 유지하려면 `shutdownTimeoutMs: 30_000`을 명시합니다.
  이전 `forceExitTimeoutMs: t`를 보존하려면 adapter의 `shutdownTimeoutMs: t`와
  Factory의 `forceExitTimeoutMs: t`를 각각 설정합니다. 두 bound는 별개입니다.
  Node-family drain은 기본 10초, signal 완료는 30초이며 Deno drain은 10초입니다.
  Deno의 `hostname`은 계속 `host`보다 우선합니다.
- Bun/Deno standalone fetch handler와 Workers/Next.js host bridge는 유지하며
  socket을 여는 managed starter로 바꾸지 않습니다.

## Defaults, order, and failures

- Factory는 호출자의 middleware 배열을 복사하고 설정된 CORS →
  설정된 prefix/exclusion → 기본 security headers → 호출자 middleware 순으로
  실행합니다. Module middleware는 route matching 뒤에 실행됩니다.
  CORS와 prefix는 기본 off이고 security headers는 기본 on이며 `false`로 끕니다.
- `logger` 기본값은 portable console logger입니다. 전달된 객체 자체가
  `APPLICATION_LOGGER`로 등록됩니다. Node console이나 JSON 출력 형식이
  필요하면 해당 logger를 명시적으로 선택하세요.
- 생성은 graph compilation, runtime token 등록, singleton lifecycle resolution,
  두 startup hook pass, platform start, dispatcher construction 순으로 실행합니다.
  생성 실패는 전달된 adapter의 `bootstrap-failed` close를 포함해 확보한 자원을
  정리하고 최초 오류를 보존합니다.
- Listen은 readiness, adapter startup, startup diagnostics, 선택적 host shutdown
  registration을 기다립니다. 어느 단계가 실패해도 close를 시도한 뒤 원래
  오류로 reject하며 cleanup logger가 throw해도 같습니다. 동시 listen은 같은
  결과를 공유합니다. Startup과 close가 경쟁하면 수용된 startup을 기다리고
  늦은 ready 전이를 막으며 한 번 정리합니다.
- Close는 admission을 동기적으로 닫고 수용된 startup을 기다린 뒤 signal 해제를
  한 번 시도합니다. 이후 child close와 기존 runtime cleanup/hook/adapter/container
  phase를 실행합니다. 동시 close는 실패도 공유합니다. Signal 해제 오류는 이후
  호출에도 유지되며 자원 정리를 건너뛰지 않고 별도 teardown 오류와 aggregate됩니다.
  `state = 'closed'`는 runtime 자원이 닫혔다는 뜻이지 host signal 정리 성공을
  뜻하지 않습니다.
- Node registration은 부분 설치된 handler를 rollback하고 앞선 signal 해제가
  실패해도 모든 해제를 시도합니다. Custom registration은 unregister callback을
  반환하기 전의 rollback을 직접 소유합니다. Node signal completion은 기존
  `30_000` ms 기본값을 유지하고 실패를 로그와 `process.exitCode`로 보고하며
  `process.exit()`는 호출하지 않습니다. Adapter drain bound는 별개입니다.

정확한 hook order와 incomplete-phase retry 규칙은
[lifecycle owner](../architecture/lifecycle-and-shutdown.ko.md)가 소유합니다.
HTTP startup 실패는 이제 terminal이지만 DI context와 microservice cleanup
계약을 이 계약으로 합치지는 않습니다.

## Resolution, dispatch, and identity

`app.get(token)`은 `PublicToken<T>`에서 `Promise<T>`를 추론하며 class-token
추론, explicit generic, DI instance identity, constructor compatibility를
보존합니다. Close 시작 후 reject하고 비동기 resolution 뒤에도 admission을
다시 확인하므로 shutdown과 경합한 provider를 반환하지 않습니다.
일반 HTTP dispatch에는 `app.dispatch(...)`를 사용하세요. Close 시작부터 새
작업을 거절하지만 이미 수용한 request를 취소하지는 않습니다.

`app.container`와 `app.dispatcher`는 원래 identity를 가진 저수준 integration
surface로 유지됩니다. 직접 접근하면 container 자체 disposal boundary 전까지
app wrapper gate를 우회하므로 일반 요청 경로와 동등하지 않습니다.
Instance `listen`, `close`, `send`, `publish`를 static으로 옮기지 않습니다.

## Implementation and verification evidence

`packages/runtime/src/bootstrap.ts`의 `FluoFactory.create`가 HTTP 생성 본문을
직접 소유하며 전용 자유 함수 구현과 alias는 삭제됩니다. Private lifecycle/
provider/token 단계는 `create`와 `createApplicationContext`가 공유합니다.
`bootstrapModule`은 두 메서드와 testing module builder가 사용하는 기존
저수준 graph seam으로 유지됩니다. `http-adapter-shared.ts`의 integration
함수는 Workers와 Next.js의 hosted lifecycle이 사용하며,
이름을 바꿔 재노출한 public runtime HTTP 생성 대안이 아닙니다.

자동 회귀는 `factory-lifecycle.test.ts`, `factory-public-types.test.ts`,
`application.test.ts`, `portable-runtime-boundary.test.ts`, Node
`factory-signals.test.ts`, CLI `factory-scaffold.test.ts`에 있습니다.
Lifecycle machine contract, negative regression, discoverability index를
함께 갱신합니다.

Package check 전에 dependency closure를 build하고 runtime/Node/CLI 집중
테스트, `pnpm verify:docs`, `pnpm verify:platform-consistency-governance`를
실행하세요. 구현 receipt가 실제 명령과 exit code를 기록하며 이 안내 자체가
배포 release나 외부 host 검증을 주장하지는 않습니다.

모든 Changeset은 maintainer의 명시적 요청에 따라 patch 의도를 기록합니다.
이 분류가 위의 breaking runtime/Node/CLI/testing 변경에 필요한 migration을
없애지는 않습니다.
`@fluojs/cron`도 `@fluojs/runtime`과 함께 업그레이드하세요. 필수 Runtime
의존성은 유지하며 scheduling 계약 자체는 바꾸지 않습니다.
선택적 HTTP capability는 additive 변경입니다. 다른 package README 변경은
제거된 runtime import를 이전할 뿐 독립적인 동작 변경은 없으며, tarball에
포함되는 README를 patch entry로 반영합니다. Book과 Docs companion 자체는
별도의 공개 `@fluojs/*` API 변경이 아닙니다.
