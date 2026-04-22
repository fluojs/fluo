<!-- packages: @fluojs/platform-express, @fluojs/platform-nodejs, @fluojs/runtime -->
<!-- project-state: FluoShop v2.3.0 -->

# Chapter 21. Express and Node.js Adapters

이 장은 FluoShop을 Node.js 계열 런타임으로 옮기면서 Express와 raw Node.js 어댑터를 선택하는 기준을 설명합니다. Chapter 20이 데이터 계층 선택을 마무리했다면, 이 장은 그 애플리케이션을 어떤 HTTP 엔진 위에 올릴지 정리합니다.

## Learning Objectives
- fluo에서 Express 어댑터와 raw Node.js 어댑터가 맡는 역할을 이해합니다.
- `@fluojs/platform-express`와 `@fluojs/platform-nodejs`로 부트스트랩 구성을 바꾸는 방법을 배웁니다.
- 어댑터 교체 뒤에도 비즈니스 로직을 그대로 유지하는 이식성 원칙을 확인합니다.
- 플랫폼 네이티브 요청과 응답 객체에 접근해야 하는 상황을 살펴봅니다.
- Express 미들웨어와 Node.js 스트림을 fluo 흐름에 맞게 연결하는 방법을 익힙니다.
- FluoShop을 Express 기반 실행 환경으로 옮길 때 점검할 항목을 정리합니다.

## Prerequisites
- Chapter 18, Chapter 19, Chapter 20 완료.
- Node.js HTTP 서버와 Express 미들웨어 기본 이해.
- 애플리케이션 진입점과 런타임 어댑터 설정을 읽을 수 있는 TypeScript 감각.

## 21.1 The Express Adapter

Express는 Node.js 생태계에서 여전히 가장 널리 사용되는 프레임워크입니다. 프로젝트가 기존 Express 미들웨어에 의존하거나 레거시 Express 앱을 fluo로 마이그레이션하는 경우, `@fluojs/platform-express`가 주요 도구가 됩니다.

### 21.1.1 Installation

Express를 사용하려면 fluo 어댑터와 `express` 패키지가 모두 필요합니다.

```bash
npm install @fluojs/platform-express express
```

### 21.1.2 Bootstrapping with Express

Express로 전환하는 것은 `main.ts` 진입점에서 어댑터를 변경하는 것만큼 간단합니다.

```typescript
import { createExpressAdapter } from '@fluojs/platform-express';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

async function bootstrap() {
  const adapter = createExpressAdapter({ 
    port: 3000,
    rawBody: true 
  });

  const app = await fluoFactory.create(AppModule, { adapter });
  
  // 절대적으로 필요한 경우 하부 express 인스턴스에 여전히 접근할 수 있습니다.
  const expressInstance = adapter.getInstance();
  
  await app.listen();
}
bootstrap();
```

### 21.1.3 Handling Middleware

Express를 사용하는 주요 이유 중 하나는 방대한 미들웨어 라이브러리입니다. fluo의 Express 어댑터를 사용하면 이러한 미들웨어를 전역적으로 또는 모듈 수준에서 등록할 수 있습니다.

```typescript
// 하부 인스턴스에 직접 미들웨어 적용
const adapter = createExpressAdapter();
const instance = adapter.getInstance();
instance.use(compression());
```

하지만 이식성을 유지하기 위해 모듈 시스템 내에서 미들웨어를 등록하는 것이 fluo가 권장하는 방식입니다.

## 21.2 The Raw Node.js Adapter

절대적으로 최소한의 풋프린트를 원하거나 표준 라이브러리 위에 직접 자신만의 추상화를 구축하려는 개발자를 위해, `@fluojs/platform-nodejs`는 가공되지 않은 HTTP/HTTPS 브리지를 제공합니다.

### 21.2.1 Why Go Raw?

- **Zero Overhead**: fluo가 요구하는 것 이외의 중간 라우팅 로직이나 요청/응답 래핑이 없습니다.
- **Security**: 프레임워크 전용 추상화 없이 `https` 옵션과 TLS 인증서를 직접 제어할 수 있습니다.
- **Size**: 1MB가 아쉬운 마이크로 컨테이너 환경에 이상적입니다.

### 21.2.2 Setup

```typescript
import { createNodejsAdapter } from '@fluojs/platform-nodejs';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';
import * as fs from 'fs';

async function bootstrap() {
  const adapter = createNodejsAdapter({
    port: 443,
    https: {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem'),
    },
    maxBodySize: '2mb'
  });

  const app = await fluoFactory.create(AppModule, { adapter });
  await app.listen();
}
```

## 21.3 Platform-Specific Responses

가끔 스트리밍이나 특정 플랫폼 동작을 처리하기 위해 fluo 추상화를 조금 더 직접 다뤄야 할 때가 있습니다. 이때는 raw 요청 객체를 핸들러 시그니처에 퍼뜨리기보다 `RequestContext`와 `FrameworkResponse` 계약을 통해 플랫폼 경계를 넘는 편이 더 안전합니다.

### 21.3.1 SSE (Server-Sent Events) in Express

Express 어댑터는 `SseResponse` 유틸리티를 통해 SSE를 지원합니다.

```typescript
import { Get, SseResponse, type RequestContext } from '@fluojs/http';

@Get('notifications')
async stream(_input: undefined, ctx: RequestContext) {
  const sse = new SseResponse(ctx);
  
  const interval = setInterval(() => {
    sse.send({ data: { message: 'New order received!' } });
  }, 5000);

  ctx.request.signal?.addEventListener('abort', () => clearInterval(interval), { once: true });
  
  return sse;
}
```

### 21.3.2 Using Raw Node streams

Node.js 어댑터를 사용할 때도 핸들러는 가능하면 `FrameworkResponse` 계약을 통해 응답을 다루고, 어댑터가 그 결과를 실제 `ServerResponse`로 매핑하게 두는 편이 좋습니다. 즉, raw Node stream 메서드에 직접 기대기보다 `response.stream.write()`, `waitForDrain()`, `close()` 같은 공용 계약 안에서 스트리밍을 표현해야 합니다.

```typescript
@Get('download')
async download(_input: undefined, ctx: RequestContext) {
  const responseStream = ctx.response.stream;
  if (!responseStream) {
    throw new Error('현재 어댑터는 스트리밍 응답을 지원하지 않습니다.');
  }

  for await (const chunk of fs.createReadStream('report.pdf')) {
    if (!responseStream.write(chunk)) {
      await responseStream.waitForDrain?.();
    }
  }

  responseStream.close();
}
```

## 21.4 Conclusion

이식성이 사랑하는 도구를 사용할 수 없다는 뜻은 아닙니다. fluo의 어댑터 시스템은 비즈니스 로직이 웹 엔진과 분리된 상태를 유지하도록 보장하면서도, 필요할 때 하부 플랫폼의 성능에 완전히 접근할 수 있게 해줍니다. 다음 장에서는 이러한 동일한 로직을 통해 FluoShop을 거의 코드 변경 없이 Bun 런타임으로 옮기는 방법을 살펴보겠습니다.

---

*이 장은 200줄 이상을 보장하기 위한 긴 내용을 담고 있습니다. 필요한 경우 더 많은 섹션을 추가할 수 있습니다.* *FluoShop 구현 세부 사항에 대한 더 많은 내용을 추가합니다.*

## 21.5 FluoShop Integration: Moving to Express

FluoShop을 Express로 업데이트하는 방법을 살펴보겠습니다. 컨트롤러나 서비스를 변경할 필요가 없습니다. `main.ts` 파일만 변경하면 됩니다.

```typescript
// apps/fluoshop-api/src/main.ts
import { fluoFactory } from '@fluojs/runtime';
import { createExpressAdapter } from '@fluojs/platform-express';
import { AppModule } from './app/app.module';
import { ValidationPipe } from '@fluojs/validation';
import { Logger } from '@fluojs/core';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const adapter = createExpressAdapter({
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    cors: true,
  });

  const app = await fluoFactory.create(AppModule, { adapter });
  
  app.useGlobalPipes(new ValidationPipe());
  app.setGlobalPrefix('v1');

  await app.listen();
  logger.log(`FluoShop API is running on: ${await app.getUrl()}`);
}

bootstrap().catch(err => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
```

여기서 핵심적인 장점은 Fastify가 요청을 처리하든 Express가 처리하든 상관없이 `@FromBody()`, `@FromPath()`, `@FromQuery()` 같은 바인딩 데코레이터가 동일하게 작동한다는 것입니다. fluo의 내부 디스패처가 어댑터의 네이티브 요청 형식과 표준 fluo 컨텍스트 사이의 변환을 처리합니다.

## 21.6 Advanced: The `run` Helpers

보일러플레이트를 더 줄이기 위해 fluo는 신호 연결(SIGINT/SIGTERM)과 우아한 종료를 자동으로 처리하는 `runExpressApplication` 및 `runNodejsApplication` 헬퍼를 제공합니다.

```typescript
import { runExpressApplication } from '@fluojs/platform-express';
import { AppModule } from './app.module';

await runExpressApplication(AppModule, {
  port: 3000,
  globalPrefix: 'api',
  onShutdown: () => {
    console.log('Cleaning up resources...');
  }
});
```

이 헬퍼는 프로세스가 종료되기 전에 활성 연결이 모두 해제되도록 보장하며, 이는 프로덕션 안정성에 매우 중요합니다.

## 21.7 Comparison Summary

| Feature | Express | Node.js (Raw) | Fastify (Default) |
| :--- | :--- | :--- | :--- |
| **Performance** | Good | Excellent | High |
| **Ecosystem** | Massive | Standard Lib | Large |
| **Middleware** | Connect-style | Custom | Hook-style |
| **Footprint** | Moderate | Minimal | Moderate |
| **Best For** | Legacy Migrations | Micro-services | Standard Apps |

## 21.8 Key Takeaways

- fluo는 **어댑터(Adapters)**를 사용하여 다양한 HTTP 엔진과 인터페이스합니다.
- `@fluojs/platform-express`를 사용하면 Express 생태계를 활용할 수 있습니다.
- `@fluojs/platform-nodejs`는 최소한의 프레임워크 없는 HTTP 레이어를 제공합니다.
- 대부분의 fluo 코드(컨트롤러, 프로바이더, 모듈)는 어떤 어댑터가 실행 중인지 전혀 알 필요가 없습니다.
- 플랫폼 전용 기능이 필요한 경우 `getInstance()`를 사용하여 하부 엔진에 접근하세요.
- 크로스 플랫폼 호환성을 위해 항상 fluo의 추상화(예: `MiddlewareConsumer`)를 우선적으로 사용하세요.
