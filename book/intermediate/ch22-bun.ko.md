<!-- packages: @fluojs/platform-bun, @fluojs/runtime, @fluojs/websockets -->
<!-- project-state: FluoShop v2.4.0 -->

# Chapter 22. Porting to Bun

이 장은 FluoShop을 Bun 런타임으로 옮기며 높은 처리량과 통합 툴체인을 활용하는 방법을 설명합니다. Chapter 21이 Node.js 계열 어댑터 선택을 다뤘다면, 이 장은 같은 애플리케이션을 Bun 위에서 더 가볍게 실행하는 흐름으로 넘어갑니다.

## Learning Objectives
- Bun이 fluo 애플리케이션 이식성에 주는 장점을 이해합니다.
- `@fluojs/platform-bun`으로 부트스트랩 구성을 전환하는 방법을 배웁니다.
- Bun의 네이티브 WebSocket 처리와 fluo 게이트웨이 연결 방식을 살펴봅니다.
- `createBunFetchHandler`로 기존 Bun 서버에 fluo를 통합하는 방법을 익힙니다.
- Node.js에서 Bun으로 이동할 때 확인해야 할 호환성 항목을 정리합니다.
- FluoShop을 Bun으로 실행할 때 기대할 수 있는 성능상 이점을 분석합니다.

## Prerequisites
- Chapter 21 완료.
- Bun 설치와 기본 실행 명령 사용 경험.
- WebSocket 게이트웨이와 런타임별 진입점 차이에 대한 기본 이해.

## 22.1 Why Bun for fluo?

- **Performance**: Bun의 네이티브 HTTP 서버는 낮은 지연 시간과 빠른 시작 시간을 목표로 설계되었습니다.
- **Unified Toolchain**: `ts-node`나 별도 실행 래퍼 없이 TypeScript 진입점을 직접 실행할 수 있습니다.
- **Modern Standards**: Bun은 `Request` 및 `Response` 같은 웹 API를 중심에 두며, fluo의 어댑터 철학과 잘 맞습니다.
- **Native WebSockets**: Bun의 내장 WebSocket 지원은 게이트웨이 기반 실시간 기능을 가볍게 운영하는 데 유리합니다.
- **Dependency Management**: Bun의 패키지 매니저는 `pnpm` 및 `npm` 흐름과 함께 쓸 수 있어 CI/CD 전환 부담을 낮춥니다.

## 22.2 The Bun Adapter

`@fluojs/platform-bun` 패키지는 Bun 런타임의 `Bun.serve()` 모델에 맞춰 설계되었습니다. fluo 애플리케이션은 같은 컨트롤러와 서비스 구조를 유지하면서 Bun의 네이티브 HTTP 처리 경로를 사용할 수 있습니다.

### 22.2.1 Installation

시작하려면 fluo 프로젝트에 Bun 어댑터를 설치하세요. 이 패키지는 fluo의 HTTP 디스패처를 Bun의 네이티브 서버 모델에 연결하는 역할을 합니다.

```bash
bun add @fluojs/platform-bun
```

### 22.2.2 Bootstrapping FluoShop on Bun

Bun에서 FluoShop을 실행하려면 `main.ts` 진입점에서 `createBunAdapter`를 선택하도록 바꾸면 됩니다. fluo가 요청 디스패치와 DI 생명주기를 유지하므로, 전환 범위는 런타임 경계에 집중됩니다.

```typescript
// apps/fluoshop-api/src/main.ts
import { createBunAdapter } from '@fluojs/platform-bun';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

async function bootstrap() {
  const adapter = createBunAdapter({ 
    port: 3000,
    // Bun 전용 옵션
    hostname: '0.0.0.0',
    development: process.env.NODE_ENV !== 'production'
  });

  const app = await fluoFactory.create(AppModule, { adapter });
  
  await app.listen();
  console.log(`FluoShop running on Bun at ${await app.getUrl()}`);
}

bootstrap();
```

## 22.3 Native WebSockets

Bun은 런타임에 내장된 WebSocket 구현을 제공합니다. fluo의 WebSocket 모듈은 Bun 어댑터가 활성화되면 이 네이티브 경로를 사용할 수 있도록 런타임별 바인딩을 제공합니다.

### 22.3.1 Setting Up Native WebSockets

fluo에서 WebSockets는 게이트웨이(Gateways)를 통해 처리됩니다. Bun에서 실행될 때 프레임워크는 Bun의 네이티브 `Upgrade` 메커니즘과 게이트웨이 계약을 연결합니다.

```typescript
import { WebSocketGateway, OnGatewayConnection } from '@fluojs/websockets';

@WebSocketGateway({ path: '/events' })
export class NotificationGateway implements OnGatewayConnection {
  handleConnection(client: any) {
    console.log('Client connected via Bun native WebSockets');
  }
  // fluo가 내부적으로 Bun 전용 업그레이드 로직을 처리합니다.
}
```

내부적으로 Bun 어댑터는 `Upgrade` 헤더를 감지하고 Bun 런타임에서 요구하는 대로 `server.upgrade(request)`를 호출합니다. 애플리케이션 코드는 게이트웨이 계약에 머물고, 업그레이드 세부 사항은 어댑터 경계에 남습니다.

## 22.4 Manual Fetch Handling

가끔 기존 Bun 서버나 더 복잡한 설정에 fluo를 통합하고 싶을 때가 있습니다. `createBunFetchHandler`를 사용하면 `Bun.serve()`에 전달할 수 있는 네이티브 `fetch` 함수를 얻을 수 있습니다.

```typescript
import { createBunFetchHandler } from '@fluojs/platform-bun';

// ... 앱 부트스트랩 ...

const handler = await createBunFetchHandler({
  dispatcher: app.getHttpDispatcher(),
});

Bun.serve({
  fetch: handler,
  port: 3001,
});
```

이 방식은 fluo API 옆에 정적 파일 서빙이나 커스텀 라우팅 같은 Bun 기능을 함께 배치해야 할 때 유용합니다.

## 22.5 Portability Checklist

Node.js에서 Bun으로 이동할 때는 다음 항목을 먼저 확인하세요.

1. **Native Dependencies**: Bun은 많은 Node.js 패키지를 지원하지만, C++ 바인딩을 쓰는 저수준 패키지는 별도 검증이 필요합니다.
2. **FileSystem**: 플랫폼별 최적화가 중요한 경로에서는 `Bun.file()` 사용 가능성을 검토하세요. 공용 서비스 코드는 가능하면 fluo 추상화 뒤에 두는 편이 안전합니다.
3. **Environment Variables**: Bun은 `.env` 파일을 자동으로 로드하므로 `ConfigModule` 설정을 단순하게 가져갈 수 있습니다.
4. **Testing**: Bun의 내장 테스트 러너(`bun test`)를 사용할 수 있지만, 기존 fluo 계약 테스트가 같은 의미를 유지하는지 확인해야 합니다.

## 22.6 FluoShop on Bun: Performance Review

Bun으로 전환하면 FluoShop은 다음 운영상 이점을 기대할 수 있습니다.
- **Faster Startup**: Bun의 네이티브 TS 실행은 별도 런타임 컴파일 계층을 줄여 시작 시간을 낮춥니다.
- **Higher Throughput**: 네이티브 `fetch` 처리 경로를 통해 높은 동시 요청 환경에서 지연 시간을 줄일 수 있습니다.
- **Simplified Deployment**: 단일 `bun` 바이너리 중심의 실행 모델은 컨테이너 이미지와 배포 스크립트를 단순하게 만들 수 있습니다.

## 22.7 Conclusion

Bun은 JavaScript 런타임 선택지를 넓혀 줍니다. fluo의 표준 우선 아키텍처는 핵심 로직을 다시 작성하지 않고도 이런 런타임 특성을 검토하고 적용할 수 있게 합니다.

다음으로, 보안과 표준을 다음 단계로 끌어올린 또 다른 현대적인 런타임인 **Deno**를 살펴보겠습니다.

---

*이후 섹션은 Bun 이식 과정에서 함께 검토할 데이터, 프로바이더, 운영 차이를 보강합니다.*

Bun의 장점은 HTTP 처리에만 머물지 않습니다. 네이티브 sqlite 모듈을 쓰면 로컬 개발, 테스트, 작은 엣지 배포에서 더 짧은 영속성 경로를 구성할 수 있습니다. 다만 운영 데이터베이스 선택은 성능뿐 아니라 백업, 복구, 마이그레이션 정책까지 함께 판단해야 합니다.

Drizzle과 함께 쓰면 Node 기반 Postgres 구성과 Bun 기반 SQLite 구성을 같은 저장소 패턴 안에서 비교할 수 있습니다. fluo에서는 드라이버별 로직을 프로바이더 경계에 두고, 도메인 서비스가 스키마와 쿼리 계약에 집중하도록 설계하는 것이 중요합니다.

Bun 어댑터의 핵심 책임은 Bun의 `Request` 및 `Response` 객체를 fluo 내부 컨텍스트로 변환하는 것입니다. 이 경계 덕분에 `@Body()` 및 `@Headers()` 같은 데코레이터는 런타임이 바뀌어도 같은 의미를 유지합니다. 성능을 판단할 때는 변환 계층의 비용과 실제 비즈니스 로직의 비용을 함께 측정해야 합니다.

Bun은 서버 측 로직에서도 `fetch` API를 중심에 둡니다. fluo는 내부 디스패처를 웹 표준 `Request` 및 `Response` 객체와 맞춰 이 모델을 자연스럽게 사용합니다. 그 결과 Bun 이식은 단순한 성능 실험이 아니라 표준 기반 런타임 경계를 검증하는 과정이 됩니다.

## 22.8 Advanced Bun Features in fluo

Bun의 런타임 기능은 HTTP 외의 데이터 경로에서도 검토할 가치가 있습니다.

### 22.8.1 Bun SQL with Drizzle

Drizzle(20장에서 다룸)을 사용하고 있다면 `bun:sqlite` 또는 네이티브 SQL 드라이버를 별도 프로바이더로 감싸서 평가할 수 있습니다.

```typescript
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

const sqlite = new Database('fluoshop.db');
const db = drizzle(sqlite);
```

이 드라이버를 fluo 프로바이더에 주입하면 Bun의 SQLite 구현을 사용하면서도 타입 안전성과 저장소 경계를 유지할 수 있습니다.

### 22.8.2 Environment-Specific Providers

런타임에 따라 프로바이더를 교체해야 한다면 fluo의 DI 시스템을 사용하세요. Bun의 파일 시스템 API처럼 플랫폼 전용 기능은 이런 경계 뒤에 둘 때 이식성이 유지됩니다. 이렇게 하면 서비스 코드는 파일 처리 의도를 표현하고, 실제 구현만 런타임에 맞게 선택할 수 있습니다.

```typescript
@Module({
  providers: [
    {
      provide: 'FILE_SERVICE',
      useFactory: () => {
        if (typeof Bun !== 'undefined') {
          return new BunFileService(); // Bun.file() 사용
        }
        return new NodeFileService(); // fs.promises 사용
      }
    }
  ]
})
export class StorageModule {}
```

## 22.9 Summary of the Porting Process

FluoShop을 Bun으로 옮기는 절차는 다음처럼 정리할 수 있습니다.
1. Bun과 `@fluojs/platform-bun` 패키지를 설치합니다.
2. `main.ts`에서 `@fluojs/platform-fastify` 또는 `@fluojs/platform-express`를 `@fluojs/platform-bun`으로 교체합니다.
3. 새 어댑터를 사용하도록 `bootstrap()` 함수를 업데이트합니다.
4. `bun run src/main.ts` 명령어로 애플리케이션을 시작합니다.

이 절차가 짧게 유지되는 이유는 fluo의 **동작 계약 정책(Behavioral Contract Policy)**이 핵심 데코레이터와 서비스 의미를 런타임 밖에 두기 때문입니다. GET 요청 처리와 서비스 주입의 의미가 같다면, Bun 전환은 코드 전체가 아니라 어댑터와 운영 설정을 검증하는 일이 됩니다.

## 22.10 Key Takeaways

- Bun은 툴체인을 통합하여 높은 성능과 현대적인 개발 경험을 제공합니다.
- `@fluojs/platform-bun`은 Bun의 네이티브 `Bun.serve()` 모델을 fluo 생명주기와 연결합니다.
- Bun의 WebSockets는 fluo의 게이트웨이 시스템을 통해 런타임 전용 경로로 연결됩니다.
- 어댑터 패턴 덕분에 Bun으로 이동해도 표준 fluo 코드는 변경되지 않은 상태를 유지합니다.
- 커스텀 서버 설정이나 다른 앱에 fluo를 내장하기 위해 `createBunFetchHandler`를 사용하세요.
- Bun의 네이티브 SQLite 및 FileSystem 지원은 런타임 인식 프로바이더 뒤에서 사용하는 편이 안전합니다.
- 이식성은 fluo의 나중에 추가된 기능이 아니라 핵심 기능입니다.

## 22.11 Troubleshooting Common Bun Issues

Bun은 Node.js와 높은 호환성을 제공하지만, 레거시 모듈이나 저수준 API 주변에서는 차이가 드러날 수 있습니다. FluoShop처럼 의존성이 많은 앱을 옮길 때는 다음 항목을 별도로 확인하세요.

1. **Top-Level Await**: Bun은 이를 네이티브로 지원하지만, 오래된 CommonJS 모듈과 섞어 쓸 때는 초기화 순서를 검증해야 합니다.
2. **Buffer vs Uint8Array**: Bun은 성능을 위해 `Uint8Array`를 선호합니다. 호환성을 위해 `Buffer`를 지원하지만, 가능한 경우 웹 표준인 `Uint8Array`를 사용하면 fluo 핸들러에서 더 나은 성능을 얻을 수 있습니다.
3. **Signal Handling**: Bun의 `process.on('SIGINT', ...)`은 작동하지만, 종료 핸들러가 비동기 정리를 끝낼 수 있는지 확인하세요.

이 차이를 사전에 확인하면 Bun 배포가 성능 실험에 그치지 않고 안정적인 운영 선택지가 됩니다.
