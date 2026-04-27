# @fluojs/platform-nodejs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임을 위한 raw Node.js HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [동작 계약](#동작-계약)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/platform-nodejs
```

## 사용 시점

Express나 Fastify와 같은 중간 프레임워크의 오버헤드 없이 Node.js 내장 `http` 또는 `https` 모듈에서 직접 fluo 애플리케이션을 실행하려는 경우에 사용합니다. 최소한의 리소스 사용, 저수준 최적화 또는 표준 Node API가 선호되는 환경에 이상적입니다.

## 빠른 시작

```typescript
import { createNodejsAdapter } from '@fluojs/platform-nodejs';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
});

await app.listen();
```

## 주요 패턴

### 서버 옵션 커스텀
어댑터는 HTTPS 설정 및 바디 크기 제한을 포함한 표준 Node.js 서버 옵션을 수용합니다.

```typescript
const adapter = createNodejsAdapter({
  port: 443,
  https: {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem'),
  },
  maxBodySize: '1mb',
});
```

`maxBodySize`는 raw Node 요청 바디가 아직 스트리밍되는 동안 바로 강제되며, 부트스트랩 시 `multipart.maxTotalSize`를 따로 재정의하지 않으면 같은 값이 멀티파트 전체 페이로드 한도의 기본값으로도 사용됩니다.

### 직접 애플리케이션 실행
`runNodejsApplication`을 사용하여 graceful shutdown 및 로깅이 포함된 보일러플레이트 없는 시작이 가능합니다.

시그널 기반 종료가 `forceExitTimeoutMs`를 넘기거나 실패하면 헬퍼는 해당 상태를 로그와 `process.exitCode`로 보고하지만, 최종 프로세스 종료는 호스트 프로세스 소유자에게 맡깁니다.

```typescript
import { runNodejsApplication } from '@fluojs/platform-nodejs';
import { AppModule } from './app.module';

await runNodejsApplication(AppModule, {
  port: 3000,
  globalPrefix: 'api',
  shutdownSignals: ['SIGINT', 'SIGTERM'],
});
```

## 동작 계약

- `createNodejsAdapter(options)`는 Node 내장 `http` 또는 `https` 서버 primitive 위에서 fluo를 직접 실행하는 adapter-first 진입점입니다.
- `maxBodySize`는 raw Node 요청 바이트가 아직 스트리밍되는 동안 강제되며, 부트스트랩/실행 헬퍼에서 `multipart.maxTotalSize`를 명시적으로 제공하지 않으면 멀티파트 전체 크기 한도의 기본값이 됩니다.
- `bootstrapNodejsApplication(module, options)`는 raw Node 어댑터가 포함된 애플리케이션을 만들지만 리스닝은 시작하지 않으므로 이후 `app.listen()`과 `app.close()` 생명주기는 호출자가 소유합니다.
- `runNodejsApplication(module, options)`는 부트스트랩, 리스닝 시작, graceful shutdown 배선을 함께 수행합니다. 시그널 기반 종료가 타임아웃되거나 실패하면 해당 상태를 로그와 `process.exitCode`로 보고하며, 최종 프로세스 종료는 호스트 프로세스가 계속 소유합니다.
- 고급 압축 및 shutdown 유틸리티 함수는 이 기본 platform startup surface가 아니라 `@fluojs/runtime/node` 또는 runtime 내부 seam에 남아 있습니다.

## 공개 API 개요

- `createNodejsAdapter(options)`: raw Node.js HTTP 어댑터를 위한 기본 팩토리입니다.
- `bootstrapNodejsApplication(module, options)`: 리스너를 시작하지 않고 애플리케이션 인스턴스를 생성합니다.
- `runNodejsApplication(module, options)`: 생명주기 관리를 포함하여 애플리케이션을 부트스트랩하고 시작합니다.
- `BootstrapNodejsApplicationOptions`: bootstrap-only Node.js 애플리케이션 생성 옵션입니다.
- `NodejsAdapterOptions`: `port`, `host`, `https`, `maxBodySize`, retry 설정, raw body 보존, shutdown timeout을 포함하는 `createNodejsAdapter(...)`의 transport-level 옵션입니다.
- `NodejsApplicationSignal`: `runNodejsApplication(...)` shutdown 등록이 지원하는 시그널 이름입니다.
- `NodejsHttpApplicationAdapter`: `createNodejsAdapter(...)`가 반환하는 어댑터 인스턴스를 설명하는 타입 전용 별칭이며, `@fluojs/runtime/node`가 공개하는 어댑터 surface를 그대로 보존합니다.
- `RunNodejsApplicationOptions`: 부트스트랩, 리스닝 시작, graceful shutdown 배선을 한 번에 수행하기 위한 옵션입니다.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임 facade입니다.
- `@fluojs/websockets`: 실시간 게이트웨이 지원을 제공합니다.
- `@fluojs/http`: 공통 HTTP 추상화 및 데코레이터를 포함합니다.

## 예제 소스

- `packages/platform-nodejs/src/index.test.ts`
- `examples/minimal/src/main.ts` (Fastify 기반이지만 구조적으로 유사함)
