# @fluojs/platform-nodejs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임을 위한 raw Node.js HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
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

```typescript
import { runNodejsApplication } from '@fluojs/platform-nodejs';
import { AppModule } from './app.module';

await runNodejsApplication(AppModule, {
  port: 3000,
  globalPrefix: 'api',
});
```

## 공개 API 개요

- `createNodejsAdapter(options)`: raw Node.js HTTP 어댑터를 위한 기본 팩토리입니다.
- `bootstrapNodejsApplication(module, options)`: 리스너를 시작하지 않고 애플리케이션 인스턴스를 생성합니다.
- `runNodejsApplication(module, options)`: 생명주기 관리를 포함하여 애플리케이션을 부트스트랩하고 시작합니다.
- `NodejsHttpApplicationAdapter`: `createNodejsAdapter(...)`가 반환하는 어댑터 인스턴스를 설명하는 타입 전용 별칭입니다.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임 facade입니다.
- `@fluojs/websockets`: 실시간 게이트웨이 지원을 제공합니다.
- `@fluojs/http`: 공통 HTTP 추상화 및 데코레이터를 포함합니다.

## 예제 소스

- `packages/platform-nodejs/src/index.test.ts`
- `examples/minimal/src/main.ts` (Fastify 기반이지만 구조적으로 유사함)
