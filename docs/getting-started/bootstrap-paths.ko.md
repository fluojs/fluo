# 부트스트랩 경로

<p><strong><kbd>한국어</kbd></strong> <a href="./bootstrap-paths.md"><kbd>English</kbd></a></p>

fluo는 **런타임에 구애받지 않는 코어(Runtime-agnostic core)**를 기반으로 설계되었습니다. 즉, 비즈니스 로직을 한 번만 작성하면 전용 플랫폼 어댑터를 통해 TypeScript가 실행 가능한 거의 모든 환경에 배포할 수 있습니다.

> 이 페이지는 부트스트랩 이후의 더 넓은 어댑터 생태계를 설명합니다. 현재 `fluo new`가 정확히 어떤 스타터를 스캐폴딩하는지는 [fluo new 지원 매트릭스](../reference/fluo-new-support-matrix.ko.md)를 확인하세요.

### 대상 독자
로컬 Fastify 스타터를 넘어 Bun, Deno, 또는 Edge 함수와 같은 특정 환경을 타겟팅해야 하는 개발자.

### 1. 어댑터 패턴
모든 fluo 앱은 `fluoFactory.create()`로 시작합니다. 두 번째 인자인 **플랫폼 어댑터(Platform Adapter)**는 프레임워크와 기반 런타임의 HTTP 서버를 연결하는 다리 역할을 합니다.

```ts
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';
import { createFastifyAdapter } from '@fluojs/platform-fastify'; // 또는 다른 어댑터

const app = await fluoFactory.create(AppModule, createFastifyAdapter());
await app.listen(3000);
```

### 2. 표준 Node.js 경로
- **Fastify (`@fluojs/platform-fastify`)**: Node.js를 위한 기본 권장 경로입니다. 높은 성능을 제공하며 방대한 Fastify 플러그인 생태계를 활용할 수 있습니다.
- **Express (`@fluojs/platform-express`)**: 기존의 레거시 Express 미들웨어에 크게 의존하는 프로젝트에 가장 적합합니다.
- **Raw Node (`@fluojs/platform-nodejs`)**: Node.js의 네이티브 `http.createServer`를 사용하여 오버헤드를 최소화하고 싶을 때 사용합니다.

### 3. 현대적인 런타임
Node.js 이외의 환경을 타겟팅하시나요? 어댑터만 교체하고 코드는 그대로 유지하세요.

- **Bun (`@fluojs/platform-bun`)**: Bun의 고속 네이티브 HTTP 서버를 사용합니다.
- **Deno (`@fluojs/platform-deno`)**: Deno의 표준 라이브러리 및 보안 모델과 완벽하게 호환됩니다.

### 4. 엣지 및 서버리스
"콜드 스타트 제로(Zero cold-start)" 환경을 위해, fluo는 엣지 런타임 특유의 fetch-event 라이프사이클을 처리하는 전용 어댑터를 제공합니다.

- **Cloudflare Workers (`@fluojs/platform-cloudflare-workers`)**: Workers 환경 및 KV/Durable Objects와 통합됩니다.

### 런타임 선택 가이드
아래 표는 어댑터 생태계 가이드이며, 현재 `fluo new` 스타터 프리셋 목록이 아닙니다.

| 어댑터 | 패키지 | 최적의 용도 |
| :--- | :--- | :--- |
| **Fastify** | `@fluojs/platform-fastify` | 프로덕션급 Node.js 앱 (기본 선택). |
| **Express** | `@fluojs/platform-express` | 레거시 마이그레이션, 미들웨어 호환성 최대화. |
| **Bun** | `@fluojs/platform-bun` | 로컬 성능 및 개발 속도 극대화. |
| **Deno** | `@fluojs/platform-deno` | 기본 보안 강화, node_modules 없는 환경. |
| **Cloudflare** | `@fluojs/platform-cloudflare-workers` | 글로벌 엣지 배포, 콜드 스타트 제로. |

### 다음 단계
- **CLI 마스터하기**: [제너레이터 워크플로우](./generator-workflow.ko.md)가 모든 런타임에서 어떻게 동작하는지 확인해 보세요.
- **현재 스타터 현실 먼저 확인하기**: 어떤 어댑터가 이미 스타터 프리셋인지 추정하기 전에 [fluo new 지원 매트릭스](../reference/fluo-new-support-matrix.ko.md)를 검토하세요.
- **심화 탐구**: 사용 가능한 어댑터와 그 기능을 한눈에 보려면 [패키지 목록](../reference/package-surface.ko.md)을 참조하세요.
