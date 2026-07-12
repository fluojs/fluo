<!-- packages: @fluojs/platform-deno, @fluojs/runtime, @fluojs/http -->
<!-- project-state: FluoShop v2.5.0 -->

# Chapter 23. Porting to Deno

이 장은 FluoShop을 Deno 런타임으로 옮기며 보안 권한 모델과 웹 표준 중심 실행 환경을 다루는 방법을 설명합니다. Chapter 22가 Bun의 고성능 런타임 이식을 보여줬다면, 이 장은 표준 우선 철학을 더 엄격한 보안 모델 위에서 검증합니다.

## Learning Objectives
- Deno가 fluo 아키텍처와 잘 맞는 이유를 이해합니다.
- `@fluojs/platform-deno`와 `runDenoApplication`으로 애플리케이션을 실행하는 방법을 배웁니다.
- Deno의 권한 플래그를 FluoShop 운영 요구와 연결해 해석하는 방법을 익힙니다.
- 웹 표준 `Request`와 `Response` 기반 디스패치 흐름을 살펴봅니다.
- `@fluojs/websockets/deno` 바인딩을 설정한 뒤 Deno 네이티브 WebSocket과 fluo 게이트웨이가 통합되는 방식을 확인합니다.
- Deno 이식 시 임포트 규칙, 권한, 드라이버 호환성 점검 항목을 정리합니다.

## Prerequisites
- Chapter 21과 Chapter 22 완료.
- Deno 설치와 `deno run` 기본 사용 경험.
- 환경 변수, 파일 접근, 네트워크 권한을 분리해서 관리하는 운영 감각.

## 23.1 Why Deno for fluo?

- **Security**: 네트워크, 파일, 환경 변수 접근을 명시적 권한으로 제어합니다.
- **Native TypeScript**: 숨겨진 `tsc` 단계 없이 `.ts` 파일을 직접 실행할 수 있습니다.
- **Web Standards**: 브라우저와 같은 `fetch`, `Request`, `Response` API를 서버 런타임의 중심에 둡니다.
- **Single Binary**: 앱을 단일 실행 파일로 묶거나 원격 URL에서 직접 실행할 수 있습니다.
- **Built-in Tooling**: 포맷터, 린터, 테스트 러너를 기본 제공하여 별도 도구 조합을 줄입니다.
- **No node_modules**: URL 기반 임포트나 `deno.json` 임포트 맵으로 의존성 경계를 명확하게 관리합니다.

## 23.2 The Deno Adapter

`@fluojs/platform-deno` 패키지는 fluo 애플리케이션이 `Deno.serve`에서 실행될 수 있도록 필요한 통합 기능을 제공합니다.

### 23.2.1 Installation

Deno는 의존성을 다르게 처리합니다. `deno add` 명령어를 사용하거나 코드에서 `npm:` 지정자를 사용하여 직접 임포트할 수 있습니다.

```bash
deno add npm:@fluojs/platform-deno npm:@fluojs/runtime npm:@fluojs/http
```

또는 더 구조적인 접근을 위해 `deno.json` 파일에서 이를 관리할 수도 있습니다. 중요한 점은 의존성 경계가 설치 폴더보다 import와 설정 파일에 더 분명하게 드러난다는 것입니다.

### 23.2.2 Bootstrapping FluoShop on Deno

Deno의 진입점은 모듈 해석과 권한 모델 때문에 Node.js 진입점과 다르게 보입니다. fluo는 이 차이를 감추기보다 명확한 실행 경계로 다루기 위해 `runDenoApplication` 헬퍼를 제공합니다.

```typescript
// main.ts
import { runDenoApplication } from '@fluojs/platform-deno';
import { AppModule } from './app.module.ts';

await runDenoApplication(AppModule, {
  port: 3000,
});
```

이 애플리케이션을 실행하려면 필요한 권한을 명시적으로 제공해야 합니다. Deno에서는 이 권한 목록이 운영 계약의 일부가 됩니다.

```bash
deno run --allow-net --allow-env main.ts
```

플래그를 빠뜨리면 Deno는 실행 시 프롬프트를 띄우거나 명확한 에러와 함께 종료합니다. 권한 누락은 배포 전에 드러나는 설정 문제로 다루는 편이 안전합니다. 따라서 실행 명령 자체가 애플리케이션이 접근할 수 있는 리소스를 설명하는 문서 역할을 합니다. Canonical starter에는 파일 시스템 접근이 필요하지 않으므로 `--allow-read`를 부여하지 않습니다. 애플리케이션 코드가 인증서, 설정 파일, 정적 자산을 실제로 읽을 때만 `--allow-read=./static`처럼 대상 경로를 한정한 권한을 추가하세요.

## 23.3 Web Standards and Request Dispatching

Deno는 웹 표준을 기반으로 구축되었기 때문에 fluo의 내부 디스패처와 자연스럽게 맞물립니다. FluoShop이 커스텀 routing 또는 다른 fetch handler와 host-owned `Deno.serve(...)` process를 공유해야 한다면 `app.listen()` 없이 application을 bootstrap하고 public dispatcher에서 handler를 생성하세요.

```typescript
import { createDenoAdapter, createDenoFetchHandler } from '@fluojs/platform-deno';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module.ts';

const adapter = createDenoAdapter();
const app = await fluoFactory.create(AppModule, { adapter });
const handler = createDenoFetchHandler({
  dispatcher: app.dispatcher,
  rawBody: true,
});

Deno.serve({ port: 3000 }, handler);
```

`createDenoFetchHandler(...)`는 `Deno.serve(...)`를 호출하지 않습니다. Shared cookie/query, raw-body, multipart, SSE 동작을 보존하고 주변 host가 server shutdown, process signal, websocket upgrade를 소유합니다. fluo가 Deno server lifecycle을 소유해야 한다면 `runDenoApplication(...)` 또는 `app.listen()`을 사용하세요.

## 23.4 Native Deno WebSockets

Bun과 마찬가지로 Deno는 `Deno.upgradeWebSocket`을 통한 자체 WebSocket 구현을 제공합니다. fluo는 이를 위한 런타임별 바인딩을 제공하여 게이트웨이 코드가 플랫폼 업그레이드 세부 사항에 묶이지 않도록 합니다. Deno에서 호스팅되는 게이트웨이를 소유한 모듈에 `@fluojs/websockets/deno`의 `DenoWebSocketModule.forRoot()`를 import하세요. Deno HTTP 어댑터는 이 바인딩이 설정된 뒤에만 네이티브 upgrade를 수행합니다.

```typescript
// DenoWebSocketModule을 설정하면 게이트웨이가 Deno의 네이티브 업그레이드를 사용합니다.
import { Module } from '@fluojs/core';
import { DenoWebSocketModule, OnMessage, WebSocketGateway } from '@fluojs/websockets/deno';
import type { DenoServerWebSocket } from '@fluojs/websockets/deno';

@WebSocketGateway({ path: '/ws' })
export class MyGateway {
  @OnMessage('ping')
  handlePing(_payload: unknown, socket: DenoServerWebSocket) {
    socket.send(JSON.stringify({ event: 'pong', data: 'hello from deno' }));
  }
  // Deno 바인딩이 내부적으로 네이티브 업그레이드를 처리합니다.
}

@Module({
  imports: [DenoWebSocketModule.forRoot()],
  providers: [MyGateway],
})
export class RealtimeModule {}
```

Gateway return value는 WebSocket dispatcher가 await한 뒤 무시합니다. 위 예시처럼 handler에 전달되는 runtime socket으로 reply를 명시적으로 보내세요. Deno upgrade guard는 Web-standard `Request` 값을 받으며, `Deno.upgradeWebSocket(...)`이 socket을 accept하기 전에 `false`, structured `WebSocketUpgradeRejection`, 또는 throw된 HTTP exception으로 거절할 수 있습니다.

`DenoWebSocketModule.forRoot()`를 설정하지 않았다면 `Upgrade: websocket`을 포함한 HTTP 요청도 암묵적으로 upgrade되지 않습니다. 해당 요청은 일반 HTTP dispatch 경로를 계속 따르므로, gateway 활성화는 명시적인 opt-in으로 유지되고 애플리케이션이 Deno websocket binding을 선택하기 전에 플랫폼 네이티브 websocket 동작이 나타나지 않습니다.

### 23.4.1 HTTPS, host alias, shutdown signal

Deno 어댑터는 Deno 네이티브 `hostname`과 이식성 alias인 `host`를 모두 허용합니다. 둘 다 설정하면 `Deno.serve(...)` bind target과 fluo가 보고하는 listen URL에는 `hostname`이 우선합니다. Deno process가 HTTPS startup을 소유해야 한다면 TLS 자료를 `https` option으로 전달하세요.

```typescript
await runDenoApplication(AppModule, {
  hostname: '127.0.0.1',
  https: {
    cert: await Deno.readTextFile('./cert.pem'),
    key: await Deno.readTextFile('./key.pem'),
  },
  port: 3443,
});
```

`runDenoApplication(...)`은 Deno signal API를 사용할 수 있을 때 기본적으로 `SIGINT`와 `SIGTERM` listener를 등록합니다. Host가 process signal을 직접 소유한다면 `shutdownSignals: false`를 사용하고, 배포 profile이 더 좁은 lifecycle contract를 요구한다면 custom signal list를 전달하세요. 한 signal listener를 이미 연결한 뒤 다음 signal 등록이 실패하면 fluo는 실패를 전달하기 전에 앞서 연결한 listener를 제거합니다. Close 중에는 새 유입을 중단하고 active handler가 최대 10초 동안 drain되도록 기다린 다음, shutdown이 아직 끝나지 않았으면 underlying Deno serve signal을 abort합니다.

## 23.5 Handling Deno Permissions in FluoShop

Deno에서 마이크로서비스를 구축할 때는 최소 권한의 원칙을 따라야 합니다. 광범위한 플래그 대신 구체적인 권한을 지정하세요.

- **`--allow-net=0.0.0.0:3000,database.host:5432`**: 리스너 포트와 특정 데이터베이스 서버로 네트워크 접근을 제한합니다.
- **`--allow-read=./config,./static`**: 설정 파일이나 정적 자산이 포함된 특정 디렉터리로 파일 접근을 제한합니다.
- **`--allow-env=PORT,DATABASE_URL`**: 애플리케이션에 필요한 환경 변수 키에 대해서만 접근을 제한합니다.

`@fluojs/config`를 사용할 때는 Deno 환경 읽기를 애플리케이션 entrypoint에 두세요. 필요한 `--allow-env` key를 허용한 뒤에만 `Deno.env.get(...)`을 호출하고, 그 결과를 `processEnv` 또는 `runtimeOverrides`를 통해 명시적인 map으로 `ConfigModule.forRoot(...)`에 전달합니다. 이 패키지의 env-file, 기본 `.env`, watch 경로는 Node.js 20.16.0+ 계약을 따르므로, Deno 배포 명령은 entrypoint가 in-memory config input으로 매핑할 수 있는 host 값만 문서화합니다.

## 23.6 Porting Checklist for Deno

1. **Imports**: 모든 로컬 임포트에 파일 확장자를 포함하세요(예: `./user.service.ts`). Deno는 확장자 없는 임포트를 허용하지 않습니다.
2. **NPM Compatibility**: 대부분의 npm 패키지는 `npm:` 임포트를 통해 작동하지만, Deno의 Node 호환 계층에서 아직 지원되지 않을 수 있는 복잡한 Node 네이티브 C++ API에 의존하는 패키지는 확인이 필요합니다.
3. **Async Initialization**: Deno는 `fluoFactory.create()`와 잘 맞는 최상위 `await`를 선호합니다.
4. **Environment Variables**: `Deno.env.get()`은 Deno entrypoint에서만 사용하고, 선택한 값을 `ConfigModule.forRoot({ processEnv })` 또는 `runtimeOverrides`로 매핑하세요. Package와 service code는 직접 Deno environment에 접근하지 말고 `ConfigService`를 유지합니다.

## 23.7 Conclusion

Deno는 fluo의 아키텍처 목표를 보완하는 보안 중심, 표준 중심 실행 환경을 제공합니다. FluoShop을 Deno로 이식하면 권한 모델과 툴링 경계를 더 명확하게 운영할 수 있습니다.

다음으로, **Cloudflare Workers**를 통해 같은 이식성 원칙을 엣지 실행 환경으로 확장해 보겠습니다.

---

*이후 섹션은 Deno 이식 과정에서 운영자가 함께 검토해야 할 보안, 데이터, 테스트 경계를 보강합니다.*

Deno의 보안 방식은 Node.js의 기본 허용 모델과 다릅니다. 모든 리소스 접근에 명시적인 플래그를 요구하므로, 개발과 배포 초기부터 최소 권한 원칙을 설계에 포함하게 됩니다. FluoShop에서는 데이터베이스 접속 정보, 네트워크 엔드포인트, 파일 접근 범위를 런타임 권한으로 다시 확인할 수 있습니다. 이 기본 보안 모델은 멀티 테넌트나 민감한 데이터를 다루는 환경에서 특히 가치가 있습니다.

`node_modules` 폴더 대신 URL 기반 임포트나 `npm:` 지정자를 포함한 `deno.json`을 사용하면 배포 파이프라인의 형태가 달라집니다. 컨테이너 빌드에서 큰 의존성 트리를 복사하는 대신, Deno의 캐시와 잠금 파일을 기준으로 재현성을 관리합니다. 이 방식은 단순해질 수 있지만, 캐시 전략과 외부 레지스트리 접근 정책을 함께 정해야 합니다.

또한 Deno의 웹 API 지원은 fluo 코드가 다른 표준 준수 런타임으로 옮겨갈 때도 개념적 마찰을 줄입니다. `Streams`, `TextEncoder`, `Headers` 같은 API를 사용하면 서버와 브라우저 사이의 모델 차이가 작아지고, 어댑터가 담당해야 할 변환도 더 명확해집니다.

## 23.8 Advanced: Deno and FluoShop Databases

Deno를 실행할 때는 보안 모델과 네이티브 런타임 특성을 고려한 데이터베이스 드라이버 선택이 필요합니다.

### 23.8.1 Using Deno KV

Deno 네이티브한 저장소가 필요하다면 Deno의 내장 KV 저장소를 검토할 수 있습니다. Deno KV는 런타임에 포함된 키 값 저장소이며, 작은 상태나 캐시성 데이터에 적합한 선택지가 될 수 있습니다. 다만 핵심 주문 데이터처럼 관계와 트랜잭션 정책이 중요한 정보는 기존 데이터베이스 선택과 비교해 판단해야 합니다.

```typescript
import { OnModuleInit } from '@fluojs/runtime';

declare const Deno: {
  openKv(): Promise<{
    set(key: string[], value: unknown): Promise<void>;
    get(key: string[]): Promise<{ value: unknown }>;
  }>;
};

export class CacheService implements OnModuleInit {
  private kv!: Awaited<ReturnType<typeof Deno.openKv>>;

  async onModuleInit() {
    this.kv = await Deno.openKv();
  }

  async set(key: string, value: unknown) {
    await this.kv.set([key], value);
  }

  async get(key: string) {
    const entry = await this.kv.get([key]);
    return entry.value;
  }
}
```

### 23.8.2 Postgres on Deno

전통적인 데이터베이스가 필요하다면 `npm:pg`를 통한 Node 호환 드라이버나 `deno_postgres` 같은 Deno 전용 드라이버를 검토할 수 있습니다. fluo의 영속성 모듈은 드라이버 선택을 서비스 로직에서 분리하도록 설계하는 편이 좋습니다. 이렇게 하면 런타임별 드라이버 차이를 provider 경계에서 흡수하고, 도메인 서비스는 저장소 계약에 집중할 수 있습니다.

```typescript
// Deno 네이티브 드라이버를 사용한 fluo 프로바이더 내 통합
import { Client } from "https://deno.land/x/postgres/mod.ts";
```

## 23.9 Testing in Deno

Deno의 내장 테스트 러너는 별도 Jest나 Vitest 의존성 없이 사용할 수 있습니다. 배포된 `@fluojs/testing` 패키지는 `engines.node >=20.0.0`을 선언하므로 Deno 테스트 경로에서 import하지 마세요. 대신 `Deno.test`, Deno 표준 assertion 라이브러리, public Deno fetch handler를 조합하면 서버를 시작하지 않고 실제 Web `Request`에서 `Response`까지의 경계를 검증할 수 있습니다.

```typescript
import { assertEquals } from "jsr:@std/assert";
import { createDenoAdapter, createDenoFetchHandler } from "npm:@fluojs/platform-deno";
import { fluoFactory } from "npm:@fluojs/runtime";
import { AppModule } from "./app.module.ts";

Deno.test("ProductService should return products", async () => {
  const adapter = createDenoAdapter();
  const app = await fluoFactory.create(AppModule, { adapter });
  const handler = createDenoFetchHandler({ dispatcher: app.dispatcher });

  try {
    const response = await handler(new Request("http://localhost/api/v1/products"));
    assertEquals(response.status, 200);
  } finally {
    await app.close();
  }
});
```

이 테스트는 process 내부에서 dispatch하므로 파일 시스템 권한이 필요하지 않습니다. `--allow-read` 없이 실행하세요. Import된 애플리케이션 그래프가 환경 변수를 읽거나 외부 서비스에 연결한다면 `deno test --allow-env=DATABASE_URL --allow-net=database.host:5432`처럼 필요한 key나 destination만 허용하세요. Fixture를 의도적으로 읽는 테스트라면 `--allow-read=./test/fixtures`처럼 fixture 경로에만 한정된 권한을 추가할 수 있습니다.

## 23.10 Summary: The Deno Advantage

- **Security**: 명시적 동의 없는 예기치 않은 네트워크나 파일 접근이 없습니다.
- **Modernity**: 최신 TypeScript 기능과 웹 API에 대한 내장 지원.
- **Efficiency**: 개발이나 배포를 위한 빌드 단계가 필요 없습니다.
- **Standard-First**: 백엔드 개발을 표준 API 중심으로 정리하려는 fluo의 디자인 철학과 잘 맞습니다.

FluoShop을 Deno로 이식하면 권한, 임포트, 테스트 경계를 더 명시적으로 관리하는 운영 모델을 얻을 수 있습니다. 이는 fluo의 이식성이 단순한 어댑터 교체가 아니라 런타임 계약 검증이라는 점을 보여줍니다. Deno에서 정리한 권한과 표준 API 기준은 이후 엣지 런타임을 검토할 때도 중요한 비교 기준이 됩니다.

## 23.11 Key Takeaways

- Deno는 기본 보안이 강화되어 있으며 TypeScript를 네이티브로 지원하여 복잡한 툴체인이 필요 없습니다.
- `@fluojs/platform-deno`는 `Deno.serve`를 사용하며 스택 전반에서 웹 표준을 지원합니다.
- 최소 권한 원칙을 따르기 위해 `--allow-*` 플래그를 사용하여 명시적인 권한으로 애플리케이션을 실행하세요.
- 네이티브 Deno WebSockets는 명시적인 `@fluojs/websockets/deno` 바인딩이 필요하며, 이 바인딩이 없으면 upgrade 요청은 일반 HTTP dispatch에 남습니다.
- 최상위 `await`와 `npm:` 임포트가 의존성 관리 및 부트스트랩을 단순화합니다.
- Deno KV 및 기타 네이티브 API는 fluo 서비스의 프로바이더 경계 뒤에서 통합하는 편이 안전합니다.
- Deno로의 이식은 FluoShop을 현대적이고 표준을 준수하는 애플리케이션으로 만드는 중요한 단계입니다.

## 23.12 The Deno Ecosystem for FluoShop

Deno는 런타임 외에도 개발과 운영을 묶는 도구를 제공합니다. 예를 들어 `deno task`를 사용하면 `package.json` 스크립트 없이 자동화 명령을 정의할 수 있습니다. 필요한 `--allow-*` 플래그를 포함한 `start:fluoshop` 태스크를 두면 개발 환경과 배포 환경의 실행 조건을 맞추기 쉽습니다.

Deno의 문서화(`deno doc`)와 린팅(`deno lint`)도 같은 도구 체계 안에서 동작합니다. FluoShop이 Deno를 채택한다는 것은 런타임만 바꾸는 일이 아니라, 권한과 문서화와 검증을 하나의 운영 모델로 정리하는 일입니다.
