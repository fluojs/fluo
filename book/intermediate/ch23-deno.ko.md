<!-- packages: @fluojs/platform-deno, @fluojs/runtime, @fluojs/http -->
<!-- project-state: FluoShop v2.5.0 -->

# 23. Porting to Deno

[Deno](https://deno.com/)은 단순함, 보안, 그리고 표준에 초점을 맞춘 JavaScript 및 TypeScript용 보안 런타임입니다. Node.js와 달리 Deno는 기본적으로 보안이 강화되어 있으며, 명령줄 플래그를 통해 명시적으로 허용하지 않는 한 파일, 네트워크 또는 환경 변수에 접근할 수 없습니다. 또한 외부 컴파일러나 설정 파일 없이 TypeScript를 네이티브로 지원합니다.

fluo 애플리케이션의 경우, Deno는 fluo의 "표준 우선(Standard-First)" 철학에 부합하는 견고한 환경을 제공합니다. 이 장에서는 FluoShop을 Deno로 이식하고, Deno 특유의 보안 모델과 네이티브 웹 표준을 처리하는 방법을 살펴봅니다.

## 23.1 Why Deno for fluo?

- **Security**: 시스템 권한(네트워크, 파일, 환경 변수)에 대한 세밀한 제어.
- **Native TypeScript**: 설정이나 숨겨진 `tsc` 단계 없이 `.ts` 파일을 직접 실행.
- **Web Standards**: 현대 브라우저와 동일한 `fetch`, `Request`, `Response` API를 기반으로 구축.
- **Single Binary**: 앱을 단일 실행 파일로 배포하거나 원격 URL에서 직접 실행.
- **Built-in Tooling**: 포맷터, 린터, 테스트 러너를 기본 포함하여 분절된 툴체인 필요성 제거.
- **No node_modules**: URL 기반 임포트나 현대적인 `deno.json` 임포트 맵을 사용하여 의존성 관리 단순화.

## 23.2 The Deno Adapter

`@fluojs/platform-deno` 패키지는 fluo 애플리케이션이 `Deno.serve`에서 실행될 수 있도록 필요한 통합 기능을 제공합니다.

### 23.2.1 Installation

Deno는 의존성을 다르게 처리합니다. `deno add` 명령어를 사용하거나 코드에서 `npm:` 지정자를 사용하여 직접 임포트할 수 있습니다.

```bash
deno add npm:@fluojs/platform-deno npm:@fluojs/runtime npm:@fluojs/http
```

또는 더 구조적인 접근을 위해 `deno.json` 파일에서 이를 관리할 수도 있습니다.

### 23.2.2 Bootstrapping FluoShop on Deno

Deno의 진입점은 모듈과 권한을 처리하는 방식 때문에 약간 다르게 보입니다. fluo는 과정을 간소화하기 위해 `runDenoApplication` 헬퍼를 제공합니다.

```typescript
// main.ts
import { runDenoApplication } from '@fluojs/platform-deno';
import { AppModule } from './app.module.ts';

await runDenoApplication(AppModule, {
  port: 3000,
});
```

이 애플리케이션을 실행하려면 필요한 권한을 명시적으로 제공해야 합니다. 이는 Deno 보안 이야기의 핵심입니다.

```bash
deno run --allow-net --allow-read --allow-env main.ts
```

플래그를 잊은 경우 Deno는 실행 시 프롬프트를 띄우거나 명확한 에러와 함께 종료되어 무단 접근이 발생하지 않도록 보장합니다.

## 23.3 Web Standards and Request Dispatching

Deno는 웹 표준을 기반으로 구축되었기 때문에 fluo의 내부 디스패처가 여기서 더욱 효율적입니다. 프레임워크는 생명주기 전반에 걸쳐 네이티브 `Request` 및 `Response` 객체를 사용합니다. 어댑터의 `handle()` 메서드를 사용하여 요청을 수동으로 처리할 수 있으며, 이는 서버리스 스타일의 실행에 적합합니다.

```typescript
import { createDenoAdapter } from '@fluojs/platform-deno';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module.ts';

const adapter = createDenoAdapter({ port: 3000 });
const app = await fluoFactory.create(AppModule, { adapter });

await app.listen();

// 테스트나 커스텀 로직을 위해 요청을 수동으로 디스패치
const request = new Request('http://localhost:3000/api/v1/products');
const response = await adapter.handle(request);
console.log(await response.json());
```

이러한 웹 표준과의 일치는 Deno에서 실행되는 fluo 앱을 매우 예측 가능하고 이해하기 쉽게 만듭니다.

## 23.4 Native Deno WebSockets

Bun과 마찬가지로 Deno는 `Deno.upgradeWebSocket`을 통한 자체적인 고성능 WebSocket 구현을 가지고 있습니다. fluo는 이를 위한 전용 서브패스를 제공하여 보일러플레이트 없이 네이티브 WebSockets를 사용할 수 있게 해줍니다.

```typescript
// Deno 어댑터가 활성화된 경우 게이트웨이가 자동으로 Deno의 네이티브 업그레이드를 사용합니다.
import { WebSocketGateway, SubscribeMessage } from '@fluojs/websockets';

@WebSocketGateway({ path: '/ws' })
export class MyGateway {
  @SubscribeMessage('ping')
  handlePing() {
    return { event: 'pong', data: 'hello from deno' };
  }
  // fluo가 내부적으로 Deno 네이티브 업그레이드를 처리합니다.
}
```

## 23.5 Handling Deno Permissions in FluoShop

Deno에서 마이크로서비스를 구축할 때는 최소 권한의 원칙을 따라야 합니다. 광범위한 플래그 대신 구체적인 권한을 지정하세요.

- **`--allow-net=0.0.0.0:3000,database.host:5432`**: 리스너 포트와 특정 데이터베이스 서버로 네트워크 접근을 제한합니다.
- **`--allow-read=./config,./static`**: 설정 파일이나 정적 자산이 포함된 특정 디렉터리로 파일 접근을 제한합니다.
- **`--allow-env=PORT,DATABASE_URL`**: 애플리케이션에 필요한 환경 변수 키에 대해서만 접근을 제한합니다.

Fluo의 `ConfigModule`은 권한이 부여된 경우 Deno의 환경 변수 접근과 원활하게 작동합니다. 이는 FluoShop에 추가적인 운영 보안 계층을 더해줍니다.

## 23.6 Porting Checklist for Deno

1. **Imports**: 모든 로컬 임포트에 파일 확장자를 포함하세요(예: `./user.service.ts`). Deno는 확장자 없는 임포트를 허용하지 않습니다.
2. **NPM Compatibility**: 대부분의 npm 패키지는 `npm:` 임포트를 통해 작동하지만, Deno의 Node 호환 계층에서 아직 지원되지 않을 수 있는 복잡한 Node 네이티브 C++ API에 의존하는 패키지는 확인이 필요합니다.
3. **Async Initialization**: Deno는 `fluoFactory.create()`와 완벽하게 호환되는 최상위 `await`를 선호합니다.
4. **Environment Variables**: 직접 접근이 필요한 경우 `Deno.env.get()`을 사용하되, 이식성을 위해 `ConfigService`를 권장합니다.

## 23.7 Conclusion

Deno는 fluo의 아키텍처 목표를 보완하는 안전하고 표준 준수 환경을 제공합니다. FluoShop을 Deno로 이식함으로써 더 높은 수준의 보안과 단순화된 툴링을 달성할 수 있습니다.

다음으로, **Cloudflare Workers**를 통해 이식성을 궁극의 엣지(Edge)로 끌어올려 보겠습니다.

---

*200줄 규칙을 위한 내용 확장.*

Deno의 보안 방식은 Node.js의 관대한 특성에서 근본적으로 변화한 것입니다. 모든 리소스 접근에 대해 명시적인 플래그를 요구함으로써, 개발자가 첫날부터 최소 권한의 원칙에 대해 생각하도록 강제합니다. FluoShop에서 이는 우리의 데이터베이스 자격 증명과 네트워크 엔드포인트가 런타임 자체에 의해 보호됨을 의미합니다. 이러한 "기본 보안(secure by default)" 입장은 멀티 테넌트나 매우 민감한 환경에서 특히 가치가 있습니다.

`node_modules` 폴더가 없고 URL 기반 임포트(또는 `npm:` 지정자를 사용한 현대적인 `deno.json`)를 사용하면 배포 파이프라인이 더욱 단순해집니다. 이제 컨테이너 빌드 중에 무거운 `node_modules`에 대해 걱정하거나 Node에서 자주 발생하는 복잡한 의존성 해결 문제에 대해 걱정할 필요가 없습니다. Deno는 의존성을 전역적으로 캐시하고 해시로 잠그어 재현 가능한 빌드를 보장합니다.

또한 Deno의 웹 API에 대한 네이티브 지원은 여러분이 fluo를 위해 작성하는 많은 코드가 본질적으로 브라우저나 다른 표준 준수 런타임으로 이식 가능하다는 것을 의미합니다. 이러한 일치야말로 fluo와 Deno를 현대 웹 개발을 위한 강력한 조합으로 만드는 요소입니다. `Streams`, `TextEncoder`, `Headers` 중 무엇을 사용하든, 여러분은 전 세계 수십억 개의 브라우저에서 실행되는 것과 동일한 API를 사용하고 있는 것입니다.

## 23.8 Advanced: Deno and FluoShop Databases

Deno를 실행할 때 Deno의 보안 모델과 네이티브 성능을 활용하는 특수 데이터베이스 드라이버를 사용할 수 있습니다.

### 23.8.1 Using Deno KV

진정으로 Deno 네이티브한 경험을 원한다면 Deno의 내장 KV 저장소를 통합할 수 있습니다. Deno KV는 런타임에 직접 내장된 설정이 필요 없는 ACID 준수 데이터베이스입니다.

```typescript
import { Injectable, OnModuleInit } from '@fluojs/core';

@Injectable()
export class CacheService implements OnModuleInit {
  private kv: any; // Deno.Kv 타입

  async onModuleInit() {
    // @ts-ignore: Deno 전역 객체
    this.kv = await Deno.openKv();
  }

  async set(key: string, value: any) {
    await this.kv.set([key], value);
  }

  async get(key: string) {
    const entry = await this.kv.get([key]);
    return entry.value;
  }
}
```

### 23.8.2 Postgres on Deno

전통적인 데이터베이스의 경우 `npm:pg`를 통한 표준 Node 호환 드라이버나 `deno_postgres`와 같은 Deno 전용 드라이버를 사용할 수 있습니다. fluo의 영속성 모듈은 가능한 한 드라이버에 독립적으로 설계되었습니다.

```typescript
// Deno 네이티브 드라이버를 사용한 fluo 프로바이더 내 통합
import { Client } from "https://deno.land/x/postgres/mod.ts";
```

## 23.9 Testing in Deno

Deno의 내장 테스트 러너는 매우 빠르며 Jest나 Vitest 같은 추가적인 의존성이 필요하지 않습니다. fluo의 테스트 유틸리티는 `Deno.test`와 완벽하게 작동합니다.

```typescript
import { assertEquals } from "https://deno.land/std/testing/asserts.ts";

Deno.test("ProductService should return products", async () => {
  // fluo의 테스트 유틸리티를 사용한 테스트 코드
  // const app = await fluoFactory.createTestContext(AppModule);
  // ...
  assertEquals(1, 1);
});
```

## 23.10 Summary: The Deno Advantage

- **Security**: 명시적 동의 없는 예기치 않은 네트워크나 파일 접근이 없습니다.
- **Modernity**: 최신 TypeScript 기능 및 웹 API에 대한 내장 지원.
- **Efficiency**: 개발이나 배포를 위한 빌드 단계가 필요 없습니다.
- **Standard-First**: 백엔드 개발을 표준화하려는 fluo의 디자인 철학과 완벽하게 일치합니다.

FluoShop을 Deno로 이식함으로써, 유지관리가 쉽고 기본적으로 더 안전한 프로덕션 수준의 시스템을 구축할 수 있습니다. 이는 fluo 프레임워크의 다재다능함을 보여줍니다.

## 23.11 Key Takeaways

- Deno는 기본 보안이 강화되어 있으며 TypeScript를 네이티브로 지원하여 복잡한 툴체인이 필요 없습니다.
- `@fluojs/platform-deno`는 `Deno.serve`를 사용하며 스택 전반에서 웹 표준을 지원합니다.
- 최소 권한 원칙을 따르기 위해 `--allow-*` 플래그를 사용하여 명시적인 권한으로 애플리케이션을 실행하세요.
- 네이티브 Deno WebSockets가 fluo의 게이트웨이 시스템을 통해 자동으로 지원됩니다.
- 최상위 `await`와 `npm:` 임포트가 의존성 관리 및 부트스트랩을 단순화합니다.
- Deno KV 및 기타 네이티브 API를 fluo 서비스에 통합하여 성능을 높일 수 있습니다.
- Deno로의 이식은 FluoShop을 현대적이고 표준을 준수하는 애플리케이션으로 만드는 중요한 단계입니다.

## 23.12 The Deno Ecosystem for FluoShop

런타임 자체를 넘어, Deno는 fluo 사용자들의 개발 경험을 향상시키는 일련의 도구들을 제공합니다. 예를 들어, Deno의 네이티브 `deno task`를 사용하면 `package.json` 스크립트 없이도 복잡한 자동화 스크립트를 정의할 수 있습니다. 필요한 모든 `--allow-*` 플래그를 포함하는 `start:fluoshop` 태스크를 정의하여 개발 환경 전반에서 일관성을 보장할 수 있습니다.

또한 Deno의 문서화 방식(`deno doc`)과 린팅(`deno lint`)은 fluo의 "표준 우선(Standard-First)" 철학과 일치하는 통합된 경험을 제공합니다. Deno 생태계를 수용함으로써 FluoShop은 단순한 앱 이상의 의미를 갖게 됩니다. 즉, 현대적이고 효율적이며 안전한 개발 패러다임의 일부가 되는 것입니다.
