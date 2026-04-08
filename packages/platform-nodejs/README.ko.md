# @konekti/platform-nodejs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 런타임을 위한 raw Node.js HTTP 어댑터 패키지입니다.

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
npm install @konekti/platform-nodejs
```

## 사용 시점

Express나 Fastify와 같은 중간 프레임워크의 오버헤드 없이 Node.js 내장 `http` 또는 `https` 모듈에서 직접 Konekti 애플리케이션을 실행하려는 경우에 사용합니다. 최소한의 리소스 사용, 저수준 최적화 또는 표준 Node API가 선호되는 환경에 이상적입니다.

## 빠른 시작

```typescript
import { createNodejsAdapter } from '@konekti/platform-nodejs';
import { KonektiFactory } from '@konekti/runtime';
import { AppModule } from './app.module';

const app = await KonektiFactory.create(AppModule, {
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

### 직접 애플리케이션 실행
`runNodejsApplication`을 사용하여 graceful shutdown 및 로깅이 포함된 보일러플레이트 없는 시작이 가능합니다.

```typescript
import { runNodejsApplication } from '@konekti/platform-nodejs';
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
- `NodejsHttpAdapter`: `HttpApplicationAdapter`를 구현하는 기본 어댑터 클래스입니다.

## 관련 패키지

- `@konekti/runtime`: 핵심 런타임 facade입니다.
- `@konekti/websockets`: 실시간 게이트웨이 지원을 제공합니다.
- `@konekti/http`: 공통 HTTP 추상화 및 데코레이터를 포함합니다.

## 예제 소스

- `packages/platform-nodejs/src/index.test.ts`
- `examples/minimal/src/main.ts` (Fastify 기반이지만 구조적으로 유사함)

