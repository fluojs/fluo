# NestJS에서 마이그레이션하기

<p><strong><kbd>한국어</kbd></strong> <a href="./migrate-from-nestjs.md"><kbd>English</kbd></a></p>

fluo는 NestJS 개발자에게 익숙한 모듈형 구조를 제공하면서도, 프레임워크의 기반을 **TC39 표준 데코레이터**로 옮겼습니다. 레거시 메타데이터 오버헤드나 실험적 컴파일러 플래그 없이도 동일한 모듈화의 이점을 누릴 수 있습니다.

### 대상 독자
현대적인 TypeScript 표준을 활용하고, 명시적이며 감사(audit) 가능한 의존성 주입 방식을 도입하고 싶은 NestJS 경험자.

### 1. tsconfig 단순화
fluo는 TypeScript의 표준 기본 설정에서 동작합니다. NestJS가 요구하던 레거시 플래그들을 드디어 끌 수 있습니다.

```json
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": false, // fluo는 표준 데코레이터를 사용합니다
    "emitDecoratorMetadata": false   // 더 이상 마법 같은 리플렉션 메타데이터는 필요 없습니다
  }
}
```

### 2. 표준 데코레이터
여러분에게 익숙한 `@Module`, `@Controller`는 모두 존재하지만, 이들은 **네이티브 TC39 데코레이터 표준**을 기반으로 구축되었습니다. fluo에서는 `@Injectable()`이 완전히 제거되었으며, 클래스는 모듈의 `providers` 배열을 통해 프로바이더로 등록됩니다.

- **NestJS**: 레거시 TypeScript 구현체와 `reflect-metadata`에 의존합니다.
- **fluo**: 네이티브 언어 기능을 사용하여, 코드가 미래의 JavaScript 생태계와 완벽히 호환되도록 보장합니다.

### 3. 암묵적 주입에서 명시적 주입으로
가장 큰 변화는 의존성을 선언하는 방식입니다. NestJS는 "마법" 같은 메타데이터를 사용해 생성자 타입을 추측하지만, fluo는 클래스에 `@Inject` 데코레이터를 명시하도록 요구합니다. 이를 통해 의존성 그래프가 코드상에 명확히 드러나며 검증 가능해집니다.

**NestJS (암묵적):**
```ts
@Injectable()
export class UsersService {
  constructor(private repo: UsersRepository) {}
}
```

**fluo (명시적):**
```ts
import { Inject } from '@fluojs/core';

@Inject(UsersRepository)
export class UsersService {
  constructor(private repo: UsersRepository) {}
}
```

### 4. 어댑터 우선 팩토리
부트스트랩 과정은 비슷해 보이지만, fluo는 팩토리 호출 시 플랫폼 선택(Fastify, Express 등)을 명시적인 과정으로 만듭니다.

**NestJS:**
```ts
const app = await NestFactory.create(AppModule);
```

**fluo:**
```ts
import { fluoFactory } from '@fluojs/runtime';
import { createFastifyAdapter } from '@fluojs/platform-fastify';

const app = await fluoFactory.create(AppModule, createFastifyAdapter());
```

### 왜 fluo로 옮겨야 하나요?
- **마법은 이제 그만**: 의존성은 숨겨진 JSON 메타데이터가 아니라 코드 자체에 선언됩니다.
- **현대적 표준**: 실험적 기능에서 벗어나 공식 ECMAScript 사양을 따릅니다.
- **런타임 유연성**: 어댑터만 교체하면 동일한 코드를 Node.js, Bun, Deno, 또는 Cloudflare Workers에 즉시 배포할 수 있습니다.

### 다음 단계
- **새롭게 시작하기**: [퀵 스타트](./quick-start.ko.md)를 통해 깨끗한 fluo 프로젝트를 확인해 보세요.
- **그래프 이해하기**: 명시적 주입에 대해 더 자세히 알고 싶다면 [DI와 모듈](../concepts/di-and-modules.ko.md)을 읽어보세요.
