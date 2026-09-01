# @fluojs/testing

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Node.js `>=20.19.3 <21 || >=22.2.0 <27` fluo 애플리케이션을 위한 기본 request-level 테스트 헬퍼, 모듈 구성, 프로바이더 오버라이드 유틸리티입니다.

`@fluojs/testing`은 fluo 애플리케이션 테스트를 위한 공식적인 기준(Baseline)을 제공합니다. 격리된 테스트 환경을 구축하고, 의존성을 가짜(Fake)나 목(Mock)으로 교체하며, 모듈 그래프에서 직접 컴포넌트를 resolve하거나 `createTestApp(...).request(...).send()`로 가상 HTTP 요청을 실행하여 e2e 스타일 테스트를 수행할 수 있게 합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [canonical TDD ladder](#canonical-tdd-ladder)
- [React Consumer Testing Recipe](#react-consumer-testing-recipe)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add -D @fluojs/testing vitest
```

`vitest`는 mock 헬퍼와 `@fluojs/testing/vitest` 엔트리포인트가 요구하는 peer dependency입니다. `@babel/core`는 Vitest decorators plugin이 사용하는 워크스페이스의 Babel을 로드하기 때문에 peer로 선언되어 있습니다. 따라서 non-Vitest harness subpath만 사용하더라도 패키지 매니저가 해당 peer 경고를 표시할 수 있습니다.

`@fluojs/testing/vitest`를 사용할 때는 `fluoBabelDecoratorsPlugin()`이 런타임에 Babel을 호출하므로, 사용하는 워크스페이스에 `@babel/core`도 함께 설치해야 합니다. Vitest 플러그인은 Vite query/hash suffix를 제거한 뒤 `.ts`, `.tsx`, `.mts`, `.cts` 소스 id를 변환하고, `node_modules`는 건너뛰며, 가장 가까운 root Babel config인 `babel.config.cjs`, `babel.config.mjs`, `babel.config.js`, `babel.config.json`을 해석합니다.

```bash
pnpm add -D @babel/core
```

## 사용 시점

- 프로덕션 모듈 트리를 모방하는 테스트 컨테이너를 생성해야 할 때.
- 실제 서비스(데이터베이스, 메일러, 외부 API 등)를 테스트 더블로 교체하고 싶을 때.
- 라이브러리나 어댑터 패키지에서 책임별 서브패스를 통해 적합성(conformance) 및 이식성(portability) 하니스를 사용해야 할 때.
- 스타터 템플릿이나 애플리케이션 테스트에 사용할 안정적인 unit / integration / e2e 스타일 기준선이 필요할 때.

## 빠른 시작

```typescript
import { createTestApp } from '@fluojs/testing';

const app = await createTestApp({ rootModule: AppModule });

try {
  const response = await app
    .request('POST', '/users/')
    .header('x-request-id', 'test-request-1')
    .query('include', 'profile')
    .principal({ subject: 'user-1', roles: ['admin'] })
    .body({ name: 'Ada' })
    .send();

  expect(response.status).toBe(201);
} finally {
  await app.close();
}
```

애플리케이션 route, guard, interceptor, DTO validation, request body, query parameter, header, synthetic principal, request-scoped provider isolation, serialized response를 검증하는 기본 HTTP/e2e 스타일 경로로는 `createTestApp({ rootModule })`을 사용하세요. 하나의 slice 안에서 module wiring, provider visibility, provider/guard/interceptor override가 계약일 때는 `createTestingModule(...)`을 사용합니다.

## 주요 패턴

### 컴파일 전 프로바이더 오버라이드

```typescript
import { createTestingModule } from '@fluojs/testing';
import { vi } from 'vitest';

const module = await createTestingModule({ rootModule: AppModule })
  .overrideProvider(USER_REPOSITORY, {
    create: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
  })
  .compile();

let testError: unknown;
let testFailed = false;
let disposeError: unknown;
let disposeFailed = false;

try {
  const service = await module.resolve(UserService);
} catch (error: unknown) {
  testError = error;
  testFailed = true;
} finally {
  try {
    await module.container.dispose();
  } catch (error: unknown) {
    disposeFailed = true;
    disposeError = error;
  }
}

if (testFailed) {
  if (disposeFailed) {
    throw new AggregateError(
      [testError, disposeError],
      'Test and testing module disposal both failed.',
    );
  }

  throw testError;
}

if (disposeFailed) {
  throw disposeError;
}
```

Testing builder는 route-pipeline 테스트에서 cross-cutting behavior를 교체할 수 있도록 `overrideProviders([[token, value], ...])`, `overrideGuard(...)`, `overrideInterceptor(...)`, `overrideFilter(...)`도 지원합니다. Guard와 interceptor override는 route가 같은 token을 `@UseGuards(...)` 또는 `@UseInterceptors(...)`로 참조할 때 request path에서도 안전하게 검증할 수 있습니다. Filter override는 컴파일된 module graph의 token을 교체하므로, 해당 filter가 runtime app 표면에 등록되는 경우 request-level coverage와 함께 사용하세요. 성공적으로 컴파일된 모든 `TestingModuleRef`를 보관하고 caller-owned `container`는 `finally`(suite setup은 `afterEach`)에서 dispose하여 통과, 실패, 조기 반환 테스트 모두 lifecycle resource를 해제하세요. 완료된 `container.dispose()` 호출은 idempotent합니다. Teardown 실패는 surface되며, in-flight assertion도 실패할 수 있다면 어느 하나를 suppress하거나 assertion failure를 대체하지 말고(예: `AggregateError`) 두 오류를 함께 보고하세요.

`compile()`은 module에 선언했거나 override한 factory provider를 포함해 lifecycle hook이 있는 singleton provider에 대해 production module bootstrap과 같은 의미를 따릅니다. effective provider graph를 해석하고, testing module을 반환하기 전에 provider 순서대로 각 instance의 `onModuleInit()`을 실행한 뒤 `onApplicationBootstrap()`을 실행합니다. Builder는 반환 시점까지 내부에서 생성한 container를 소유합니다. Override 적용, lifecycle hook 실행, resolved singleton 동기화가 실패하면 reject하기 전에 container를 dispose합니다. Cleanup이 성공하면 원래 compile 실패를 그대로 보존하고, cleanup도 실패하면 원래 실패와 cleanup 실패를 `AggregateError`로 함께 보고합니다. 성공한 `TestingModuleRef`의 동작은 바뀌지 않으며 호출자는 unconditional `finally` 또는 `afterEach` cleanup을 통해 `module.container.dispose()`의 소유권을 계속 가집니다. `get()`은 synchronous singleton 및 multi-provider 경로에서도 DI ownership 의미를 보존하므로, 반복 sync read는 같은 singleton contribution을 재사용하고 container가 해당 instance를 계속 정리할 수 있습니다.

### `overrideModule()` 사용 시 모듈 identity 보존

`createTestingModule({ rootModule })`에는 명시적인 루트 모듈이 필요합니다. 그래야 테스트가 프로덕션 bootstrap과 같은 모듈 그래프 형태를 컴파일합니다. `overrideModule(source, replacement)`로 import된 모듈을 교체해도, 컴파일된 testing module은 provider 해석에 replacement import를 사용하면서 원래 `rootModule`과 컴파일된 `modules[].type` identity를 보존합니다. 따라서 diagnostics, graph assertion, module introspection 헬퍼는 테스트 전용 synthetic wrapper 클래스가 아니라 사용자가 작성한 애플리케이션 모듈 클래스에 계속 연결됩니다.

```typescript
const module = await createTestingModule({ rootModule: AppModule })
  .overrideModule(StripeModule, FakeStripeModule)
  .compile();

expect(module.rootModule).toBe(AppModule);
expect(module.modules.some((compiledModule) => compiledModule.type === BillingModule)).toBe(true);
```

### `createTestApp()` 기반 request-level 테스트

```typescript
import { createTestApp } from '@fluojs/testing';

const app = await createTestApp({ rootModule: AppModule });

try {
  const response = await app
    .request('POST', '/users/')
    .header('authorization', 'Bearer test-token')
    .query('include', ['profile', 'settings'])
    .principal({ subject: 'user-1', roles: ['member'] })
    .body({ name: 'Ada' })
    .send();

  expect(response.status).toBe(201);
} finally {
  await app.close();
}
```

`app.request(...).send()`는 수동 `FrameworkRequest`/`FrameworkResponse` stub 없이 HTTP 의미에 가까운 테스트를 작성하게 해 주고 runtime dispatch와 같은 isolated request-scoped DI boundary를 생성하므로 애플리케이션 개발자의 기본 경로입니다. Assertion 실패가 runtime resource 누수로 이어지지 않도록 반환된 app은 `finally` 블록에서 닫으세요. `app.dispatch(...)`, `makeRequest(...)`, raw `FluoFactory.create(...)` 테스트는 adapter/runtime contract, framework internal, 또는 low-level dispatch boundary 자체를 증명해야 하는 compatibility case에 남겨 둡니다.

Cookie-bound route에는 adapter가 정규화한 cookie 값을 담는 object request overload를 사용하세요.

```ts
const response = await app.request({
  path: '/session',
  cookies: { session: 'test-session' },
}).send();
```

`cookies`는 `FrameworkRequest.cookies`에 직접 할당됩니다. `Cookie` header를 parse하거나 adapter별 cookie 의미를 도입하지 않습니다. `TestingModuleRef.dispatch(...)`도 같은 정규화된 cookie record를 받습니다.

`createTestApp(...)`은 runtime HTTP bootstrap과 같은 application bootstrap option을 받습니다. 여기에는 `providers`, `filters`, `converters`, `interceptors`, `middleware`, `observers`, `versioning`, `conditionalRequest`, `errorRepresentation`, diagnostics option이 포함됩니다. 따라서 application test는 같은 virtual request pipeline으로 canonical JSON, negotiated HTML, conditional `304`/`412`, `HEAD`, 406, provider fallback을 검증할 수 있습니다. 테스트 헬퍼는 request-context middleware를 앞에 추가하되, 호출자가 넘긴 middleware를 같은 app middleware chain 안에 보존합니다.

### 명시적 서브패스의 mock 헬퍼

```typescript
import { createMock, createDeepMock } from '@fluojs/testing/mock';
import { vi } from 'vitest';

const repo = createMock<UserRepository>({ findById: vi.fn() });
const mailer = createDeepMock(MailService);
```

`asMock(fn)`은 함수만 받아 Vitest `Mock<T>`로 좁히며, 임의의 값을 변환하는 cast가 아닙니다. `mockToken(token, value)`는 token 기반 override를 위해 `{ provide: token, useValue: value }` 형태의 `ValueProvider` descriptor를 만듭니다. `createMock(..., { strict: true })`는 지정하지 않은 member 접근을 거부합니다. `DeepMocked<T>`는 root `@fluojs/testing` 패키지, `@fluojs/testing/types`, `@fluojs/testing/mock`에서 모두 노출됩니다. 세 경로는 Vitest peer declaration을 non-mock runtime helper로 끌어들이지 않으면서 같은 Vitest-compatible mock type boundary를 공유합니다. Vitest를 사용하지 않는 소비자는 `@fluojs/testing/app`, `@fluojs/testing/module`, 또는 harness subpath에서 non-mock helper만 import하세요.

배포된 런타임 import가 안정적으로 해석되도록, mock 헬퍼를 사용할 워크스페이스에는 `vitest`를 함께 설치해야 합니다.

### 적합성 및 이식성 하니스

프레임워크 지향 플랫폼 패키지를 작성할 때는 `@fluojs/testing/platform-conformance`, `@fluojs/testing/platform-shell-lifecycle-conformance`, `@fluojs/testing/http-adapter-portability`, `@fluojs/testing/web-runtime-adapter-portability` 같은 서브패스를 사용해 적합성 및 이식성 검증을 수행합니다.

`createPlatformShellLifecycleConformanceHarness({ createShell })`는 active `start()` / `stop()` overlap 전체가 `PlatformLifecycleConflictError`로 reject되는지, callback reentry가 synchronous 시점과 임의의 await 이후에도 conflict-safe한지, 실패한 transition이 settle된 뒤 호출자가 retry할 수 있는지 검증합니다. 컴포넌트 수준 검사는 `createPlatformConformanceHarness(...).assertAll()`에 유지하세요. PlatformShell lifecycle 계약은 의도적으로 별도 harness입니다.

이식성 하니스의 cleanup도 계약에 포함됩니다. 앱이 bootstrap된 뒤 setup, `listen()`, partial app을 노출한 run callback, assertion이 실패하면 하니스는 해당 partial app을 닫습니다. `app.close()`가 실패하면 하니스는 cleanup 실패를 보고하며, setup 또는 assertion이 이미 실패한 경우에는 원래 실패와 cleanup 실패를 모두 보존하는 aggregate error를 발생시킵니다.

`HttpAdapterPortabilityHarness`와 web-runtime portability harness 메서드는 공개 어댑터 계약 체크입니다. 직접 같은 검증을 다시 만들기보다 `assertSupportsCustomHttpRouteMethods()`, `assertPreservesMalformedCookieValues()`, `assertSupportsSseStreaming()`, `assertPreservesRawBodyForJsonAndText()`, `assertPreservesExactRawBodyBytesForByteSensitivePayloads()`, `assertExcludesRawBodyForMultipart()`, `assertDefaultsMultipartTotalLimitToMaxBodySize()`, `assertSettlesStreamDrainWaitOnClose()`, `assertReportsConfiguredHostInStartupLogs()`, `assertReportsHttpsStartupUrl(...)`, `assertRemovesShutdownSignalListenersAfterClose()`처럼 초점이 분명한 assertion을 사용하세요.

Adapter가 body-bearing `QUERY`와 대표 `PURGE` route를 real listener 또는 fetch dispatch seam으로 실행하는지 증명하려면 `assertSupportsCustomHttpRouteMethods()`를 사용하세요. 이 assertion은 `CONNECT`를 일반 routing conformance 범위 밖에 두며 custom method에 native route handoff를 요구하지 않습니다.

HTTP 어댑터가 런타임 전반에서 `rawBody`의 byte-sensitive payload byte를 그대로 보존하는지 증명해야 할 때는 `assertPreservesExactRawBodyBytesForByteSensitivePayloads()`를 사용하세요.

JSON, HTML, `HEAD`, unsupported `Accept` 406, already-committed response 동작을 증명하려면
`assertSupportsHttpErrorRepresentations()`를 사용하세요. Network harness는 shared
`NetworkHttpErrorRepresentationBootstrapOptions`를 adapt하고 fetch-style harness는
`WebHttpErrorRepresentationBootstrapOptions`를 adapt합니다. Adapter bootstrap type에 추가 required field가
있다면 `createErrorRepresentationBootstrapOptions`를 제공하세요. Typed builder는 common fixture field만 받아 cast
없이 해당 adapter의 complete bootstrap option을 반환합니다.
`assertDoesNotCommitAbortedHttpErrorRepresentations()`는 HTML provider를 시작한 뒤 adapter의 native request
surface를 통해 abort하고, cancellation 이후 provider result와 canonical JSON fallback 어느 쪽도 write되지 않음을
증명합니다.

## canonical TDD ladder

애플리케이션 기능 테스트는 가장 작은 명시적 dependency boundary에서 시작해 바깥쪽으로 확장합니다.

1. **Unit**: `src/**` 아래 service, controller, helper, failure branch 가까이에 `*.test.ts` 파일을 둡니다. 클래스를 직접 구성하고 명시적 fake를 넘기거나, typed mock이 설정을 읽기 쉽게 만들 때 `@fluojs/testing/mock` 헬퍼를 사용합니다.
2. **Slice/module integration**: DI wiring과 provider override coverage에는 `createTestingModule({ rootModule })` 또는 `Test.createTestingModule({ rootModule })` 기반 `*.slice.test.ts` 파일을 추가합니다.
3. **HTTP e2e-style**: `test/app.e2e.test.ts` 같은 app-level 테스트는 `createTestApp({ rootModule })`와 기본 route assertion helper인 `app.request(...).send()`로 virtual request pipeline을 검증합니다. 더 낮은 수준의 dispatch contract 자체가 테스트 대상일 때만 `app.dispatch(...)`를 사용합니다.
4. **Platform/conformance**: harness subpath는 일반 애플리케이션 기능 coverage가 아니라 adapter/runtime package contract에만 사용합니다.

```txt
src/users/
  users.service.test.ts
  users.controller.test.ts
  users.slice.test.ts

test/
  app.e2e.test.ts
```

fluo는 테스트가 명시적인 `rootModule`을 이름으로 지정해야 한다는 점에서 NestJS와 다릅니다. 테스트 유틸리티는 legacy TypeScript design metadata나 reflection flag에서 dependency를 추론하지 않고, 작성자가 만든 module graph를 컴파일합니다.

## React Consumer Testing Recipe

React 애플리케이션은 같은 testing ladder를 유지하고 React-specific testing helper 대신 기존 boundary에
build/browser evidence를 추가합니다.

1. Render-policy 및 metadata composition을 pure value로 unit test합니다.
2. Direct page return, missing-renderer diagnostic, DTO validation, request-scope identity, response ownership,
   guard, interceptor, native mutation route는 `createTestApp({ rootModule })`로 검증하고 `finally`에서 app을
   닫습니다.
3. CI에서 `fluo typegen ... --check`를 실행하고 generated-route fixture를 TypeScript로 compile합니다.
   Positive route-id/params case와 negative unknown-id, missing-param, extra-param, stale-output case를 유지합니다.
4. React DOM으로 server markup을 hydrate합니다. Aligned tree는 diagnostic 없이 interactive해야 하고,
   의도적으로 mismatch한 tree 하나는 `onRecoverableError`를 capture해야 합니다.
5. Production asset을 대상으로 Playwright를 실행한 뒤 별도 `javaScriptEnabled: false` context에서 native
   form scenario를 반복해 일반 `POST` → `303` → `GET` fallback을 executable 상태로 유지합니다.

Runnable map은 [`@fluojs/react`](../react/README.ko.md#consumer-testing-loop)와
[`examples/react-vite-ssr`](../../examples/react-vite-ssr/README.ko.md#canonical-consumer-test-map)에
문서화되어 있습니다. 이 layer들은 이미 real HTTP dispatcher와 application page renderer를 compose하므로
synthetic React test runtime은 필요한 setup을 줄이기보다 coverage를 약화시킵니다.

## 공개 API

- **루트 패키지**: `createTestingModule(...)`, `Test.createTestingModule(...)`, `createTestApp(...)`, 모듈 introspection 헬퍼, `DeepMocked<T>`를 포함한 공용 app/module 테스트 타입
- **서브패스**: `@fluojs/testing/app`, `@fluojs/testing/module`, `@fluojs/testing/http`, `@fluojs/testing/mock` (`DeepMocked<T>` 포함), `@fluojs/testing/types` (`DeepMocked<T>` 포함), `@fluojs/testing/vitest`, `@fluojs/testing/vitest/tooling`
- **하니스 서브패스**: `platform-conformance`, `platform-shell-lifecycle-conformance`, `http-adapter-portability`, `web-runtime-adapter-portability`, `fetch-style-websocket-conformance`. HTTP portability harness는 adapter-owned bootstrap typing을 위해 `assertSupportsConditionalRequests()`, `assertSupportsCustomHttpRouteMethods()`, `assertSupportsHttpErrorRepresentations()`, `assertDoesNotCommitAbortedHttpErrorRepresentations()`, `assertSupportsPortableResponseCookies()`, `createConditionalRequestBootstrapOptions`, `createErrorRepresentationBootstrapOptions`, `NetworkHttpErrorRepresentationBootstrapOptions`, `WebHttpErrorRepresentationBootstrapOptions`를 노출합니다.
- **도구 지원**: `@fluojs/testing/vitest`의 `fluoBabelDecoratorsPlugin()` 및 `@fluojs/testing/vitest/tooling`의 Vitest workspace config helper (`vitest`와 `@babel/core`를 함께 요구)

Package manifest는 public body-bearing RFC `QUERY` portability assertion이 사용하는 검증된 Node listener window와 일치하도록 `engines.node >=20.19.3 <21 || >=22.2.0 <27`을 선언합니다. Node 21, Node 22.2.0 미만, 검증되지 않은 Node 27 이상은 제외됩니다. 문서화된 경우 non-Node runtime 애플리케이션 테스트에서 runtime-native 도구를 사용할 수 있지만, 배포된 `@fluojs/testing` 패키지 자체는 이 정확한 Node.js engine 범위를 따릅니다.

`@fluojs/testing/vitest/tooling`은 각 package의 공개 `exports`에 선언된 entrypoint만 workspace alias로 매핑합니다. Private source file, internal helper, export되지 않은 source entrypoint는 의도적으로 제외하므로 테스트가 published package 소비자에게 제공되는 import boundary와 같은 경계를 검증합니다.

## 관련 패키지

- `@fluojs/di`: 테스트 컨테이너가 사용하는 기반 DI 시스템입니다.
- `@fluojs/runtime`: 테스트 빌더가 확장하는 모듈 그래프 로직을 제공합니다.
- `@fluojs/http`: `TestApp`에서 사용하는 가상 디스패치 시스템입니다.

## 예제 소스

- `packages/testing/src/module.test.ts`
- `packages/testing/src/portability/error-representation-portability.ts`
- `examples/minimal/src/app.test.ts`
- `examples/auth-jwt-passport/src/app.test.ts`
