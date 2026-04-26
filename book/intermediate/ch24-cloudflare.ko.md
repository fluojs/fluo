<!-- packages: @fluojs/platform-cloudflare-workers, @fluojs/runtime, @fluojs/websockets -->
<!-- project-state: FluoShop v2.6.0 -->

# Chapter 24. Cloudflare Workers Edge Deployment

이 장은 FluoShop을 Cloudflare Workers에 배포하며 엣지 환경의 제약과 장점을 fluo 어댑터로 다루는 방법을 설명합니다. Chapter 23이 Deno에서 표준 우선 런타임 이식을 검증했다면, 이 장은 같은 원칙을 전 세계 엣지 실행 환경으로 확장합니다.

## Learning Objectives
- Cloudflare Workers가 fluo 애플리케이션에 적합한 이유를 이해합니다.
- `@fluojs/platform-cloudflare-workers`로 Worker 진입점을 구성하는 방법을 배웁니다.
- `fetch` 기반 실행 모델과 지연 부트스트랩 패턴을 구분해 설명합니다.
- 파일 시스템 부재, 실행 시간 제한, 메모리 한계 같은 엣지 제약을 정리합니다.
- Worker `env`, KV, D1, WebSocketPair 같은 네이티브 기능을 fluo와 연결하는 방법을 살펴봅니다.
- Wrangler 배포 흐름과 FluoShop의 엣지 운영 체크포인트를 확인합니다.

## Prerequisites
- Chapter 21, Chapter 22, Chapter 23 완료.
- Cloudflare Workers와 `fetch` 기반 서버리스 실행 모델 기본 이해.
- 환경 바인딩과 엣지 배포 설정 파일을 읽을 수 있는 운영 감각.

## 24.1 Why Cloudflare Workers for fluo?

- **Extreme Low Latency**: 코드를 사용자와 가까운 위치에서 실행해 왕복 지연 시간을 줄일 수 있습니다.
- **Cost Efficiency**: 요청 단위 과금 모델은 짧고 빈번한 API 호출에 적합한 비용 구조를 제공할 수 있습니다.
- **Web APIs**: Workers는 fluo가 기반으로 하는 `fetch`, `Request`, `Response` 표준을 중심에 둡니다.
- **Isolate Architecture**: V8 Isolate 모델은 컨테이너보다 가벼운 실행 단위를 제공하며, 빠른 시작과 격리를 목표로 합니다.
- **Native Edge Features**: KV, Durable Objects, D1(SQL) 같은 엣지 네이티브 저장소와 상태 관리 기능을 제공합니다.

## 24.2 The Cloudflare Worker Adapter

`@fluojs/platform-cloudflare-workers` 패키지는 메모리 제한 및 제한된 실행 시간과 같은 Worker 환경의 제약 조건에 최적화되어 있습니다.

### 24.2.1 Installation

엣지를 타겟팅하려면 Cloudflare Workers 어댑터를 설치하세요. 이 어댑터는 장기 실행 서버가 아니라 Worker `fetch` 호출 모델에 fluo 애플리케이션을 연결합니다.

```bash
npm install @fluojs/platform-cloudflare-workers
```

### 24.2.2 Bootstrapping FluoShop as a Worker

Worker 환경에서는 전통적인 Node.js 방식처럼 장기 실행 서버 소켓을 열지 않습니다. 대신 Cloudflare 런타임이 각 요청마다 호출하는 `fetch` 핸들러를 내보냅니다. fluo 어댑터는 이 핸들러와 애플리케이션 디스패처 사이의 매핑을 담당합니다.

```typescript
// src/index.ts
import { fluoFactory } from '@fluojs/runtime';
import { createCloudflareWorkerAdapter } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const adapter = createCloudflareWorkerAdapter({
  globalPrefix: 'api/v1',
  cors: true,
});

// 한 번 부트스트랩하면 동일한 Isolate 내의 요청에서 재사용됩니다.
const app = await fluoFactory.create(AppModule, { adapter });
await app.listen();

export default {
  fetch: (req, env, ctx) => adapter.fetch(req, env, ctx),
};
```

이 구조는 의존성 주입 컨테이너 부트스트랩을 요청마다 반복하지 않고, 같은 Isolate 안에서 재사용할 수 있게 합니다. 엣지에서는 이런 초기화 경계가 응답 시간과 비용에 직접 영향을 줍니다.

## 24.3 Lazy Bootstrapping (Zero-Config)

더 단순한 설정이 필요하다면 fluo의 진입점 헬퍼를 사용할 수 있습니다. 이 헬퍼는 첫 요청 시 부트스트랩을 처리하므로, Worker 파일에서 반복되는 초기화 코드를 줄일 수 있습니다.

```typescript
import { createCloudflareWorkerEntrypoint } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const worker = createCloudflareWorkerEntrypoint(AppModule);

export default {
  fetch: worker.fetch,
};
```

## 24.4 Handling Edge Constraints

Cloudflare Workers는 전통적인 Node.js 환경과 다른 제약을 갖습니다. fluo 애플리케이션도 이 제약을 런타임 계약으로 받아들여야 합니다.

1. **No Filesystem**: `fs`를 사용할 수 없습니다. 작은 데이터에는 Cloudflare KV를, 큰 객체 저장소에는 R2를 검토하세요.
2. **Limited Execution Time**: 요청 처리는 짧고 예측 가능해야 합니다. 플랜에 따라 CPU 시간 제한이 운영 설계의 일부가 됩니다.
3. **Isolate Memory**: 의존성 그래프를 가볍게 유지하세요. fluo의 명시적 DI는 무거운 리플렉션 라이브러리와 불필요한 메타데이터 생성을 피하는 데 도움이 됩니다.
4. **Environment Variables**: `fetch` 핸들러에 전달되는 `env` 객체를 통해 변수 및 바인딩에 접근합니다.

### 24.4.1 Integrating Worker Env into fluo

fluo의 Cloudflare 어댑터는 Worker `env` 객체(KV 네임스페이스 및 시크릿 포함)를 `ConfigService` 경계로 연결합니다. 서비스 코드는 Cloudflare의 전역 객체를 직접 읽지 않고도 설정과 바인딩을 같은 구성 계약으로 다룰 수 있습니다.

```typescript
import { ConfigService } from '@fluojs/config';
import { Inject } from '@fluojs/core';

@Inject(ConfigService)
export class MyService {
  constructor(private config: ConfigService) {
    // Cloudflare env 객체의 변수를 올바르게 확인합니다.
    const apiKey = this.config.get('API_KEY');
  }
}
```

## 24.5 Edge-Native WebSockets

Cloudflare는 서버 측 WebSockets를 위해 `WebSocketPair`를 지원합니다. fluo의 WebSocket 모듈은 이 환경을 위한 바인딩을 제공하므로, FluoShop의 실시간 기능을 엣지 제약 안에서 검토할 수 있습니다.

```typescript
// 어댑터가 활성화된 경우 게이트웨이가 자동으로 Cloudflare의 WebSocketPair를 사용합니다.
import { Module } from '@fluojs/core';
import { WebSocketGateway } from '@fluojs/websockets';
import { CloudflareWorkersWebSocketModule } from '@fluojs/websockets/cloudflare-workers';

@WebSocketGateway({ path: '/ws' })
export class EdgeGateway {
  // 로직은 Node/Bun 버전과 동일하게 유지됩니다.
}

@Module({
  imports: [CloudflareWorkersWebSocketModule.forRoot()],
  providers: [EdgeGateway],
})
export class RealtimeModule {}
```

## 24.6 Deployment with Wrangler

Cloudflare의 CLI 도구인 `wrangler`로 fluo 애플리케이션을 배포합니다. Worker 이름, 진입점, 호환성 날짜, 환경 변수는 `wrangler.toml`에서 관리합니다. 이 파일은 코드와 별도로 엣지 실행 환경의 계약을 설명하므로, 배포 설정도 리뷰 가능한 산출물이 됩니다.

```toml
# wrangler.toml
name = "fluoshop-api"
main = "src/index.ts"
compatibility_date = "2024-04-01"

[vars]
API_KEY = "secret-value"
```

배포 명령:
```bash
npx wrangler deploy
```

## 24.7 Conclusion

FluoShop을 Cloudflare Workers에 배포하면 전 세계 엣지 위치에서 실행되는 서버리스 백엔드 구성을 얻을 수 있습니다. fluo의 어댑터 중심 아키텍처는 애플리케이션 로직을 유지한 채 Node.js 서버와 엣지 실행 환경을 비교할 수 있게 합니다.

마지막으로 25장에서는 전체 FluoShop 아키텍처를 검토하고 서비스 메시 전략을 사용하여 확장하는 방법을 살펴보겠습니다. 엣지 런타임까지 검토했으므로, 이제 관심사는 개별 어댑터 선택에서 전체 분산 시스템 운영으로 넓어집니다.

---

*이후 섹션은 엣지 배포에서 함께 판단해야 할 데이터 배치, 보안, 상태 관리 경계를 보강합니다.*

엣지로 이동하면 데이터 영속성에 대한 판단도 달라집니다. PostgreSQL 같은 중앙 데이터베이스는 여전히 중요하지만, 도쿄에서 실행되는 Worker가 `us-east-1`의 데이터베이스를 매 요청마다 호출하면 엣지의 지연 시간 이점이 줄어듭니다. Cloudflare D1 및 KV 같은 서비스는 데이터를 실행 지점에 더 가깝게 배치하는 선택지를 제공합니다.

FluoShop에서는 세션 관리에 KV를, 관계형 데이터 경로에 D1을 검토할 수 있습니다. fluo의 모듈식 프로바이더 시스템을 사용하면 비즈니스 컨트롤러를 바꾸지 않고 저장소 구현을 교체할 수 있습니다. 예를 들어 `ProductRepository` 인터페이스를 정의하고 Cloudflare에서 실행될 때 `D1ProductRepository` 구현체를 제공하는 방식입니다.

Cloudflare의 WAF와 봇 관리 기능은 FluoShop API 앞단의 보호 계층으로 사용할 수 있습니다. fluo는 애플리케이션 레벨의 로직을 담당하고 Cloudflare는 엣지 레벨의 라우팅과 방어를 담당하도록 역할을 나누면, 운영자가 직접 관리해야 하는 인프라 표면을 줄일 수 있습니다.

또 하나의 핵심은 실행 컨텍스트입니다. Workers에서는 `ctx.waitUntil()`을 사용해 응답 이후의 비동기 작업을 런타임에 등록할 수 있습니다. fluo 어댑터는 백그라운드 작업이나 이벤트 전파 중 이 경계를 활용할 수 있으며, 분석 데이터 전송이나 웹훅 트리거처럼 요청 응답과 분리된 작업에서 중요합니다.

## 24.8 Advanced: Durable Objects and State

Cloudflare에서 요청 간에 공유되는 상태가 필요하다면 Durable Objects를 검토합니다. Durable Object는 특정 상태를 담당하는 고유한 인스턴스를 제공하며, fluo는 이 내부에서 DI와 구조화된 로직을 구성하는 방식으로 통합될 수 있습니다.

```typescript
import { DurableObject } from 'cloudflare:workers';

export class MyDurableObject extends DurableObject {
  // 여기에 fluo 통합 로직 작성. 내부 상태 전이를 처리하기 위해
  // DO 내부에 작은 fluo 앱을 부트스트랩할 수 있습니다.
}
```

## 24.9 D1 SQL Database at the Edge

Cloudflare D1은 Worker와 가까운 위치에서 사용할 수 있는 SQL 데이터베이스입니다. D1 드라이버와 Drizzle(20장)을 함께 쓰면 엣지 배치와 SQL 모델을 같은 fluo 저장소 경계 안에서 다룰 수 있습니다. 다만 전역 복제와 일관성 요구가 서비스마다 다르므로, 어떤 데이터를 엣지에 둘지 먼저 결정해야 합니다.

```typescript
import { drizzle } from 'drizzle-orm/d1';

@Module({
  providers: [
    {
      provide: 'DATABASE',
      inject: ['CF_ENV'],
      useFactory: (env) => drizzle(env.DB)
    }
  ]
})
export class DatabaseModule {}
```

## 24.10 Summary: The Edge Advantage

- **Global Presence**: 수동 복제 없이 300개 이상의 위치에서 즉시 사용 가능.
- **Performance**: V8 Isolate 모델을 통해 빠른 시작과 높은 동시 처리량을 목표로 합니다.
- **Simplicity**: 웹 표준 API(fetch, Request, Response)가 개발 및 테스트를 단순화합니다.
- **Scalability**: Cloudflare 플랜과 런타임 제한 안에서 대규모 요청을 처리할 수 있습니다.
- **Unified Logic**: fluo를 사용하면 온프레미스에서와 동일한 컨트롤러와 서비스를 엣지에서도 사용할 수 있습니다.

## 24.11 Key Takeaways

- Cloudflare Workers는 엣지의 V8 Isolate에서 실행되며 전통적인 서버리스에 대한 가벼운 대안을 제공합니다.
- `@fluojs/platform-cloudflare-workers`는 fluo 생명주기와 통합되는 표준 `fetch` 기반 어댑터를 제공합니다.
- Worker 런타임에 맞추기 위해 `listen()`을 호출하는 대신 `fetch` 핸들러를 내보내세요.
- KV, D1, WebSockets와 같은 네이티브 엣지 기능은 전용 fluo 바인딩과 프로바이더 경계로 연결할 수 있습니다.
- Worker `env` 객체의 변수와 바인딩에 원활하게 접근하려면 `ConfigService`를 사용하세요.
- 배포와 환경 관리를 일관되게 유지하려면 `wrangler`를 사용하세요.
- `ctx.waitUntil`은 fluo에 의해 처리되어 엣지에서 백그라운드 작업이 성공적으로 완료되도록 보장합니다.
- 엣지는 단순한 호스팅 플랫폼이 아니라, 글로벌 애플리케이션 아키텍처에 대해 생각하는 다른 방식입니다.

## 24.12 Future-Proofing with Cloudflare and Fluo

Cloudflare 플랫폼은 Workers AI, 고급 스트리밍, 새로운 저장소 기능처럼 계속 확장되고 있습니다. fluo에서는 이런 기능을 비즈니스 로직에 직접 흩뿌리지 않고, 어댑터와 프로바이더 경계 뒤에 배치하는 것이 중요합니다. 그래야 플랫폼 기능을 추가하더라도 핵심 도메인 로직을 안정적으로 유지할 수 있습니다.

FluoShop은 이제 글로벌 엣지 배포까지 검토할 수 있는 구조가 되었습니다. 이 전환은 성능만이 아니라 표준 API, 플랫폼 인식, 이식 가능한 도메인 경계를 함께 설계해야 한다는 점을 보여줍니다.
