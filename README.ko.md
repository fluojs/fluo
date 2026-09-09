<div align="center">
  <img src="./src/fluo.png" alt="fluo framework logo" width="140" />

  <h1>fluo</h1>

  <p>
    <b>표준 우선(Standard-First) TypeScript 백엔드 프레임워크</b>
  </p>

  <p>
    <a href="./README.md">English</a>
    &nbsp;&middot;&nbsp;
    <a href="./README.ko.md">한국어</a>
  </p>

  <p>
    <a href="https://github.com/fluojs/fluo/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/fluojs/fluo?style=social" /></a>
    <a href="https://github.com/fluojs/fluo/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/fluojs/fluo" /></a>
    <a href="https://github.com/fluojs/fluo/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/fluojs/fluo/ci.yml?branch=main&label=ci" /></a>
    <a href="https://github.com/fluojs/fluo/issues"><img alt="Issues" src="https://img.shields.io/github/issues/fluojs/fluo" /></a>
  </p>
</div>

<br/>

**fluo**는 TC39 표준 데코레이터와 명시적인 의존성 주입을 사용하는 TypeScript 백엔드 프레임워크입니다. 컨트롤러, 서비스, 모듈로 애플리케이션을 구성하고, 필요한 데이터베이스·인증·메시징 패키지를 선택해 연결합니다.

[빠른 시작](#빠른-시작) · [Book](./book/README.ko.md) · [문서 지도](./docs/README.ko.md) · [예제](./examples/README.ko.md)

## 왜 fluo인가요?

- **표준 데코레이터**: `experimentalDecorators`, `emitDecoratorMetadata`, `reflect-metadata`에 의존하지 않습니다. fluo 자체 메타데이터 저장소와 표준 데코레이터 메타데이터 연동을 사용합니다.
- **명시적인 의존성**: 클래스의 `@Inject(...)`에 생성자 토큰을 선언하고, `@Module(...)`에 provider와 컨트롤러를 등록합니다.
- **테스트 가능한 기능 구성**: HTTP 라우팅, 요청 검증, 응답 직렬화를 조합하고, 테스트 도구로 DI 구성과 요청 처리를 확인합니다.
- **호스트를 선택하는 구조**: 공통 모듈·DI 모델에 런타임별 어댑터를 연결합니다. 호스트 수명주기와 패키지 지원 범위는 각 어댑터의 계약을 따릅니다.
- **생성부터 진단까지**: CLI로 프로젝트와 기능을 생성하고 개발·빌드·실행을 관리합니다. `fluo inspect`와 Studio는 애플리케이션 구조와 진단 정보를 확인하는 경로를 제공합니다.

## 개발자 경험

다음은 HTTP 라우트, 서비스 주입, 모듈 등록, Fastify 시작을 한 파일에 모은 최소 예시입니다. 데코레이터 변환과 빌드 설정은 아래 CLI 스타터가 제공합니다.

```ts
import { Inject, Module } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { runFastifyApplication } from '@fluojs/platform-fastify';

class GreetingService {
  greet() {
    return { message: 'Hello from fluo' };
  }
}

@Inject(GreetingService)
@Controller('/greeting')
class GreetingController {
  constructor(private readonly service: GreetingService) {}

  @Get('/')
  getGreeting() {
    return this.service.greet();
  }
}

@Module({
  controllers: [GreetingController],
  providers: [GreetingService],
})
class AppModule {}

await runFastifyApplication(AppModule, { port: 3000 });
```

이 예시의 `GET /greeting`은 `{"message":"Hello from fluo"}`를 반환합니다. 생성된 프로젝트는 이 구성을 여러 파일로 나누고 repository, 헬스 체크, 테스트를 추가합니다. 예시를 따로 실행하려면 생성된 프로젝트의 `src/main.ts`를 위 코드로 교체하세요. 아래 빠른 시작은 교체하지 않은 스타터를 기준으로 합니다.

## 빠른 시작

**준비:** Node.js 24.x와 pnpm 10을 설치하세요. CLI와 Node.js 경로의 지원 범위는 `>=24.0.0 <27`입니다. 다른 런타임을 대상으로 생성하더라도 CLI 자체는 Node.js에서 실행됩니다.

저장소를 clone하지 않고 npm에 공개된 CLI로 시작할 수 있습니다.

```bash
pnpm --allow-build=esbuild dlx @fluojs/cli new my-backend --package-manager pnpm
cd my-backend
pnpm dev
```

`--allow-build=esbuild`는 CLI 의존성의 설치 스크립트를 승인하는 pnpm 옵션입니다. 선택 화면이 나타나면 기본 `standard` / HTTP application / Node.js / Fastify 구성을 사용하고 의존성을 설치하세요. 전역 CLI 설치는 필요하지 않습니다.

서버가 시작되면 다른 터미널에서 요청하세요. 기본 포트는 `3000`이며, 생성된 `.env`의 `PORT`로 변경할 수 있습니다.

```bash
curl http://localhost:3000/greeting
```

```json
{"message":"Hello from fluo","framework":"fluo","project":"my-backend"}
```

`GET /health`도 `200`과 `{"status":"ok"}`를 반환합니다. 첫 응답을 바꾸려면 `src/greeting/greeting.repo.ts`를 수정하세요. 요청 처리와 의존성 연결은 같은 디렉터리의 `greeting.controller.ts`, `greeting.service.ts`, `greeting.module.ts`에서 확인할 수 있습니다.

생성된 프로젝트 디렉터리에서 테스트와 빌드도 실행하세요.

```bash
pnpm test
pnpm build
```

스타터에는 Fastify 앱, `/greeting`, `/health`, `/ready`, 테스트와 빌드 설정이 포함됩니다. 인증, 영속 저장소, 배포 설정은 애플리케이션에서 추가해야 합니다. 다른 스타터와 실행 옵션은 [CLI 가이드](./packages/cli/README.ko.md), 지원하는 변환 도구는 [도구 체인 계약](./docs/reference/toolchain-contract-matrix.ko.md)을 참고하세요.

**기존 프로젝트를 업그레이드한다면:** [Node 24 마이그레이션 가이드](./docs/getting-started/migrate-node24.ko.md)의 Node → 패키지 → import 순서를 확인하세요. CLI를 업그레이드해도 기존 앱의 설정 파일은 자동으로 변경되지 않습니다. [Node.js 지원 정책](./docs/reference/node-support.ko.md)과 [HTTP 의존성 보안 업데이트](./docs/reference/dependency-security-update.ko.md)도 함께 확인하세요.

## 모듈형 생태계

필요한 기능만 선택해 연결합니다. 아래는 대표 패키지이며, 전체 목록과 선택 기준은 [패키지 선택 가이드](./docs/reference/package-chooser.ko.md)에 있습니다.

| 카테고리 | 패키지 |
| :--- | :--- |
| **기반** | [Core](./packages/core/README.ko.md), [DI](./packages/di/README.ko.md), [Runtime](./packages/runtime/README.ko.md), [Config](./packages/config/README.ko.md), [I18n](./packages/i18n/README.ko.md) |
| **HTTP/API** | [HTTP](./packages/http/README.ko.md), [Validation](./packages/validation/README.ko.md), [Serialization](./packages/serialization/README.ko.md), [OpenAPI](./packages/openapi/README.ko.md), [GraphQL](./packages/graphql/README.ko.md) |
| **호스트 어댑터** | [Fastify](./packages/platform-fastify/README.ko.md), [Express](./packages/platform-express/README.ko.md), [Node.js](./packages/platform-nodejs/README.ko.md), [Next.js](./packages/platform-nextjs/README.ko.md), [Bun](./packages/platform-bun/README.ko.md), [Deno](./packages/platform-deno/README.ko.md), [Workers](./packages/platform-cloudflare-workers/README.ko.md) |
| **인증** | [JWT](./packages/jwt/README.ko.md), [Passport](./packages/passport/README.ko.md) |
| **데이터·캐시** | [Prisma](./packages/prisma/README.ko.md), [Drizzle](./packages/drizzle/README.ko.md), [Mongoose](./packages/mongoose/README.ko.md), [Redis](./packages/redis/README.ko.md), [Cache Manager](./packages/cache-manager/README.ko.md) |
| **메시징·작업 처리** | [Microservices](./packages/microservices/README.ko.md), [CQRS](./packages/cqrs/README.ko.md), [Event Bus](./packages/event-bus/README.ko.md), [Queue](./packages/queue/README.ko.md), [Cron](./packages/cron/README.ko.md) |
| **실시간 통신·알림** | [WebSockets](./packages/websockets/README.ko.md), [Socket.IO](./packages/socket.io/README.ko.md), [Notifications](./packages/notifications/README.ko.md), [Email](./packages/email/README.ko.md), [Slack](./packages/slack/README.ko.md), [Discord](./packages/discord/README.ko.md) |
| **운영** | [Health (Terminus)](./packages/terminus/README.ko.md), [Metrics](./packages/metrics/README.ko.md), [Throttler](./packages/throttler/README.ko.md) |
| **React·개발 도구** | [React](./packages/react/README.ko.md), [CLI](./packages/cli/README.ko.md), [Testing](./packages/testing/README.ko.md), [Vite](./packages/vite/README.ko.md), [Studio](./packages/studio/README.ko.md) |

**런타임 지원은 패키지별입니다.** 어댑터가 있다고 모든 패키지가 해당 호스트에서 실행되는 것은 아닙니다. 예를 들어 Drizzle 통합은 Node.js 전용이고, Socket.IO 어댑터는 Node.js와 Bun을 지원하지만 Deno·Workers는 지원하지 않습니다. Next.js 통합은 Node.js 호스트용이며 Edge Runtime을 지원하지 않습니다. 호스트를 바꿀 때는 시작·종료 방식과 의존성을 [Canonical Runtime Package Matrix](./docs/reference/package-surface.ko.md) 및 해당 패키지 README에서 확인하세요.

## 이어서 읽기

| 목적 | 시작할 문서 |
| --- | --- |
| 제품을 만들며 백엔드 설계 배우기 | [Book 3권 과정](./book/README.ko.md): FluoBlog → FluoShop → Fluo 내부 구조. [1권 목차](./book/01-fluoblog/toc.ko.md)부터 시작하세요. |
| 첫 HTTP 기능을 짧게 실습하기 | [FluoBlog 실습](./apps/docs/content/docs/tutorial/index.ko.mdx): 라우트, DI, 요청 검증, 테스트를 저장소 체크포인트로 학습합니다. |
| 기존 앱에 기능 추가하기 | [작업별 가이드](./apps/docs/content/docs/guides/index.ko.mdx)와 [패키지 선택 가이드](./docs/reference/package-chooser.ko.md). |
| API·기본값·지원 범위 확인하기 | [문서 지도](./docs/README.ko.md)에서 계약 소유 문서와 패키지 README를 찾으세요. |
| AI와 구현하거나 검토하기 | [AI Context](./docs/CONTEXT.ko.md) → 문서 지도·패키지 선택 가이드 → 소유 계약 → 구현·테스트·실행 근거 순서로 읽으세요. |
| 실행 가능한 코드 비교하기 | [예제 앱](./examples/README.ko.md)에서 각 예제의 환경과 검증 범위를 확인하세요. |

Book은 중심 학습 과정이고 짧은 HTTP 실습은 보조 과정입니다. 실습은 CLI로 생성한 앱을 그대로 이어 쓰는 대신 별도의 저장소 체크포인트에서 시작합니다. 모든 Book 장의 완성 앱을 제공하는 것은 아닙니다.

## 커뮤니티

- [Discussions](https://github.com/fluojs/fluo/discussions): 질문, 아이디어, RFC, 사용 사례 공유.
- [Issues](https://github.com/fluojs/fluo/issues): 버그 제보, 문서 개선 제안, 기능 요청.
- [기여 가이드](./CONTRIBUTING.ko.md): 로컬 개발 환경, 검증 절차, PR 흐름.
- [지원 안내](./SUPPORT.ko.md): 용도에 맞는 지원 채널.
- [보안 정책](./SECURITY.ko.md): 비공개 취약점 제보.
- [MIT 라이선스](./LICENSE).

## 우리의 철학

명시적인 구성에는 명시적인 경계가 따라야 합니다. 패키지의 기본값, 실패 동작, 자원 소유권과 지원 제한은 [동작 계약](./docs/contracts/behavioral-contract-policy.ko.md) 및 해당 패키지 README를 기준으로 설명합니다. 애플리케이션의 인증 정책, 데이터 정합성, 외부 시스템의 전달 보장은 패키지를 설치하는 것만으로 완성되지 않습니다.

이 README는 프로젝트의 입구입니다. 상세 계약의 소유 관계는 [문서 권한 정책](./docs/contracts/documentation-authority.ko.md), 버전과 변경 이력의 관리 방식은 [릴리스 거버넌스](./docs/contracts/release-governance.ko.md)를 따릅니다.
