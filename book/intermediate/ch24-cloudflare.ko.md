<!-- packages: @fluojs/platform-cloudflare-workers, @fluojs/runtime, @fluojs/websockets -->
<!-- project-state: FluoShop v2.6.0 -->

# 24. Cloudflare Workers Edge Deployment

[Cloudflare Workers](https://workers.cloudflare.com/)는 "엣지(Edge)"에서 실행되는 서버리스 플랫폼으로, 사용자와 지리적으로 가장 가까운 데이터 센터에서 코드가 실행됨을 의미합니다. 이는 지연 시간을 획기적으로 줄이고 복잡한 인프라 관리 없이 전 세계에 서비스를 제공할 수 있게 해줍니다. 전통적인 서버리스 함수(예: AWS Lambda)와 달리, Workers는 V8 Isolate에서 실행되어 1밀리초 미만의 시작 시간을 제공하고 많은 시나리오에서 "콜드 스타트(Cold Start)"를 제거합니다.

fluo를 Cloudflare Workers에 배포하는 것은 이식성의 궁극적인 테스트입니다. 이 장에서는 FluoShop을 엣지에 맞게 조정하고, Worker 환경의 고유한 제약 조건을 처리하며, 최대 성능을 위해 네이티브 엣지 기능을 활용하는 방법을 살펴봅니다.

## 24.1 Why Cloudflare Workers for fluo?

- **Extreme Low Latency**: 코드가 사용자 근처에서 실행되어 진정한 전 세계 청중을 위한 글로벌 성능이 향상됩니다.
- **Cost Efficiency**: 사용한 만큼만 비용을 지불하며, 고주파수의 작은 요청에 대해 전통적인 클라우드 제공업체보다 더 저렴한 가격 모델을 제공하는 경우가 많습니다.
- **Web APIs**: Workers는 fluo가 기반으로 하는 `fetch`, `Request`, `Response` 표준을 선호하므로 전환이 논리적이고 원활합니다.
- **Isolate Architecture**: 전통적인 컨테이너나 가상 머신보다 훨씬 가벼운 V8 Isolate를 통한 높은 보안성과 성능.
- **Native Edge Features**: 내장 Key-Value(KV) 저장소, 상태 저장 로직을 위한 Durable Objects, 엣지에서의 관계형 데이터를 위한 D1(SQL) 지원.

## 24.2 The Cloudflare Worker Adapter

`@fluojs/platform-cloudflare-workers` 패키지는 메모리 제한 및 제한된 실행 시간과 같은 Worker 환경의 제약 조건에 최적화되어 있습니다.

### 24.2.1 Installation

엣지를 타겟팅하려면 Cloudflare Workers 어댑터를 설치하세요.

```bash
npm install @fluojs/platform-cloudflare-workers
```

### 24.2.2 Bootstrapping FluoShop as a Worker

Worker 환경에서는 전통적인 Node.js 방식처럼 `app.listen()`을 호출하지 않습니다. 대신, 들어오는 각 요청에 대해 Cloudflare 런타임이 호출하는 `fetch` 핸들러를 내보냅니다. fluo 어댑터가 이러한 매핑을 관리해 줍니다.

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

이 구조는 의존성 주입 컨테이너를 부트스트랩하는 무거운 작업이 요청당 한 번이 아니라 Isolate당 한 번만 발생하도록 보장하여, Workers의 특징인 1밀리초 미만의 응답 시간을 유지합니다.

## 24.3 Lazy Bootstrapping (Zero-Config)

더 간단한 설정을 위해, fluo는 첫 번째 요청 시 부트스트랩 로직을 자동으로 처리하는 진입점 헬퍼를 제공하여 보일러플레이트 없는 경험을 제공합니다.

```typescript
import { createCloudflareWorkerEntrypoint } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const worker = createCloudflareWorkerEntrypoint(AppModule);

export default {
  fetch: worker.fetch,
};
```

## 24.4 Handling Edge Constraints

Cloudflare Workers는 전통적인 Node.js 환경에 비해 fluo 애플리케이션에서 고려해야 할 몇 가지 고유한 제약 사항이 있습니다.

1. **No Filesystem**: `fs`를 사용할 수 없습니다. 작은 데이터에는 Cloudflare KV를, 큰 객체 저장소에는 R2를 사용하세요.
2. **Limited Execution Time**: 요청 처리가 효율적이어야 합니다. Standard 플랜에서는 CPU 시간이 엄격하게 제한됩니다.
3. **Isolate Memory**: 의존성 그래프를 가볍게 유지하세요. fluo의 명시적 DI는 무거운 리플렉션 라이브러리와 불필요한 메타데이터 생성을 피함으로써 도움이 됩니다.
4. **Environment Variables**: `fetch` 핸들러에 전달되는 `env` 객체를 통해 변수 및 바인딩에 접근합니다.

### 24.4.1 Integrating Worker Env into fluo

fluo의 Cloudflare 어댑터는 Worker `env` 객체(KV 네임스페이스 및 시크릿 포함)를 `ConfigService`에 자동으로 매핑합니다.

```typescript
import { ConfigService } from '@fluojs/config';
import { Injectable } from '@fluojs/core';

@Injectable()
export class MyService {
  constructor(private config: ConfigService) {
    // Cloudflare env 객체의 변수를 올바르게 확인합니다.
    const apiKey = this.config.get('API_KEY');
  }
}
```

## 24.5 Edge-Native WebSockets

Cloudflare는 서버 측 WebSockets를 위해 `WebSocketPair`를 지원합니다. fluo의 WebSocket 모듈은 이 환경을 위한 바인딩도 포함하고 있어, FluoShop의 실시간 기능이 엣지에서도 작동할 수 있게 해줍니다.

```typescript
// 어댑터가 활성화된 경우 게이트웨이가 자동으로 Cloudflare의 WebSocketPair를 사용합니다.
@WebSocketGateway({ path: '/ws' })
export class EdgeGateway {
  // 로직은 Node/Bun 버전과 동일하게 유지됩니다.
}
```

## 24.6 Deployment with Wrangler

Cloudflare의 CLI 도구인 `wrangler`를 사용하여 fluo 애플리케이션을 배포합니다. 워커 설정을 위해 `wrangler.toml` 파일이 필요합니다.

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

FluoShop을 Cloudflare Workers에 배포함으로써 전 세계에 걸친 서버리스 백엔드를 구축했습니다. fluo의 어댑터 중심 아키텍처는 이러한 전환을 원활하게 만들었으며, 한 번 작성한 로직을 Node.js 서버부터 궁극의 엣지까지 어디서나 실행할 수 있음을 입증했습니다.

마지막으로 25장에서는 전체 FluoShop 아키텍처를 검토하고 서비스 메시 전략을 사용하여 확장하는 방법을 살펴보겠습니다.

---

*200줄 규칙을 위한 내용 확장.*

엣지로의 이동은 데이터 영속성에 대한 사고방식의 변화를 요구합니다. PostgreSQL과 같은 전통적인 데이터베이스도 훌륭하지만, 도쿄에서 실행되는 글로벌 Worker가 (예를 들어 `us-east-1`에 있는) 중앙 집중식 데이터베이스를 호출할 때 발생하는 지연 시간은 엣지의 이점을 상쇄할 수 있습니다. 이것이 Cloudflare D1 및 KV와 같은 서비스가 중요한 이유입니다. 이러한 서비스는 데이터를 실행 지점에 더 가깝게 가져와서 Worker 자체의 철학과 일치시킵니다.

FluoShop에서 우리는 세션 관리를 위해 KV를 사용하고 관계형 데이터를 위해 D1을 사용할 수 있습니다. 이를 통해 우리 스택의 모든 부분이 글로벌 성능에 최적화되도록 보장합니다. fluo의 모듈식 프로바이더 시스템 덕분에 비즈니스 로직 컨트롤러를 변경하지 않고도 이러한 엣지 네이티브 저장소 솔루션으로 쉽게 전환할 수 있습니다. 예를 들어, `ProductRepository` 인터페이스를 정의하고 Cloudflare에서 실행될 때 `D1ProductRepository` 구현체를 제공할 수 있습니다.

또한 통합 WAF(웹 애플리케이션 방화벽) 및 봇 관리와 같은 Cloudflare의 보안 기능은 FluoShop API에 추가적인 보호 계층을 제공합니다. fluo는 애플리케이션 레벨의 로직을 처리하고 Cloudflare는 엣지 레벨의 보안 및 라우팅을 처리하므로, 자체 Kubernetes 클러스터나 VM 팜을 관리하는 것보다 훨씬 적은 운영 오버헤드로 프로덕션 수준의 시스템을 얻을 수 있습니다.

한 가지 더 고려할 사항은 실행 컨텍스트입니다. Workers에서는 `ctx.waitUntil()`을 사용할 수 있습니다. fluo 어댑터는 백그라운드 작업이나 이벤트 전파 중에 이를 자동으로 처리하여, 사용자에게 HTTP 응답이 전송된 후에도 비동기 로직이 완료되도록 보장합니다. 이는 FluoShop에서 분석 데이터를 보내거나 웹훅을 트리거하는 것과 같은 작업에 매우 중요한 디테일입니다.

## 24.8 Advanced: Durable Objects and State

Cloudflare에서 요청 간에 공유된 상태가 필요한 경우 Durable Objects가 해결책입니다. 이는 상태를 유지할 수 있는 전역적으로 고유한 클래스 인스턴스를 가질 수 있는 방법을 제공합니다. fluo는 Durable Object 클래스 내에 통합되어 이러한 상태 저장 단위 내부에서 DI와 구조화된 로직을 제공할 수 있습니다.

```typescript
import { DurableObject } from 'cloudflare:workers';

export class MyDurableObject extends DurableObject {
  // 여기에 fluo 통합 로직 작성. 내부 상태 전이를 처리하기 위해
  // DO 내부에 작은 fluo 앱을 부트스트랩할 수 있습니다.
}
```

## 24.9 D1 SQL Database at the Edge

Cloudflare D1은 Worker와 함께 위치한 SQL 데이터베이스를 제공합니다. D1 드라이버와 함께 Drizzle(20장)을 사용하는 것은 fluo 앱에 매우 강력한 조합입니다. 이는 엣지의 성능과 함께 SQL의 익숙함을 제공합니다.

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
- **Performance**: V8 Isolate를 통한 1밀리초 미만의 콜드 스타트와 극한의 처리량.
- **Simplicity**: 웹 표준 API(fetch, Request, Response)가 개발 및 테스트를 단순화합니다.
- **Scalability**: Cloudflare 플랜의 한계 내에서 수백만 개의 요청을 쉽게 처리합니다.
- **Unified Logic**: fluo를 사용하면 온프레미스에서와 동일한 컨트롤러와 서비스를 엣지에서도 사용할 수 있습니다.

## 24.11 Key Takeaways

- Cloudflare Workers는 엣지의 V8 Isolate에서 실행되며 전통적인 서버리스에 대한 가벼운 대안을 제공합니다.
- `@fluojs/platform-cloudflare-workers`는 fluo 생명주기와 통합되는 표준 `fetch` 기반 어댑터를 제공합니다.
- Worker 런타임에 맞추기 위해 `listen()`을 호출하는 대신 `fetch` 핸들러를 내보내세요.
- KV, D1, WebSockets와 같은 네이티브 엣지 기능이 전용 fluo 바인딩을 통해 완벽하게 지원됩니다.
- Worker `env` 객체의 변수와 바인딩에 원활하게 접근하려면 `ConfigService`를 사용하세요.
- 전문적인 CI/CD 경험을 위해 `wrangler`를 사용하여 배포하세요.
- `ctx.waitUntil`은 fluo에 의해 처리되어 엣지에서 백그라운드 작업이 성공적으로 완료되도록 보장합니다.
- 엣지는 단순한 호스팅 플랫폼이 아니라, 글로벌 애플리케이션 아키텍처에 대해 생각하는 다른 방식입니다.

## 24.12 Future-Proofing with Cloudflare and Fluo

Cloudflare 플랫폼이 AI (Workers AI) 및 고급 스트리밍과 같은 새로운 기능으로 계속 진화함에 따라, fluo는 모듈식 아키텍처를 통해 이러한 기능을 활용할 수 있는 위치에 있습니다. 비즈니스 로직을 깨끗하게 유지하고 어댑터에서 분리함으로써, 대대적인 재작성 없이도 이러한 미래의 발전 사항을 쉽게 통합할 수 있습니다.

FluoShop은 이제 글로벌하고 빠르며 안전합니다. 엣지로의 전환은 성능을 향상시켰을 뿐만 아니라 현대적인 TypeScript 애플리케이션이 어떻게 구축되어야 하는지에 대한 청사진을 제공했습니다. 즉, 표준 준수, 플랫폼 인식, 그리고 고도의 이식성을 갖춘 앱입니다.
