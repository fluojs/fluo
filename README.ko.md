# Konekti

<p align="center">
  <strong>표준 우선(Standard-First) TypeScript 백엔드 프레임워크</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> | <strong>한국어</strong>
</p>

Konekti는 **TC39 표준 데코레이터**를 기반으로 처음부터 다시 설계된 현대적인 TypeScript 백엔드 프레임워크입니다. 레거시 데코레이터 기반 프레임워크에 대한 고성능, 명시적, 그리고 메타데이터가 필요 없는 대안을 제공합니다.

## 왜 Konekti인가요?

NestJS와 같은 대부분의 TypeScript 프레임워크는 JavaScript 언어의 발전 방향과 동떨어진 `experimentalDecorators` 및 `emitDecoratorMetadata` 플래그에 의존하는 과거에 머물러 있습니다. Konekti는 기술 생태계를 미래로 이끕니다.

- **🚀 마법 없는 고성능**: 무거운 리플렉션 라이브러리나 숨겨진 메타데이터 생성이 없습니다. Konekti는 가볍고 빠르며, 하드웨어에 가까운 성능을 유지합니다.
- **🛡️ 암묵적 대신 명시적**: 의존성 주입(DI)이 투명하고 감사 가능합니다. 컴파일러가 생성한 불투명한 블롭이 아니라, 코드에서 직접 의존성 그래프를 확인할 수 있습니다.
- **🌍 어디서나 실행**: 통합된 런타임 파사드(Facade)를 기반으로 구축되었습니다. 로직 변경 없이 Node.js의 Fastify에서 Bun, Deno, 또는 Cloudflare Workers로 전환하세요.
- **✨ 미래 지향적**: 현대적인 TypeScript 시대를 위해 설계되었습니다. 레거시 컴파일러 동작과 싸우지 않고 가장 강력한 타입 안정성 기능을 활용하세요.

## 개발자 경험

조직화 능력은 NestJS처럼 강력하면서도, 명시성은 Go 언어처럼 느껴지는 프레임워크를 상상해 보세요.

```ts
import { Module, Inject } from '@konekti/core';
import { UsersRepository } from './users.repository';

@Inject([UsersRepository])
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}
}

@Module({
  providers: [UsersService, UsersRepository],
})
export class UsersModule {}
```

*레거시 플래그가 필요 없습니다. 오직 표준 TypeScript만 사용합니다.*

## 빠른 시작

CLI를 사용하는 것이 Konekti를 경험하는 가장 빠른 방법입니다.

```bash
# CLI 설치
pnpm add -g @konekti/cli

# 프로젝트 생성
konekti new my-backend
cd my-backend

# 엔진 가동
pnpm dev
```

생성된 스타터 템플릿에는 바로 프로덕션에 투입 가능한 Fastify 설정, 내장된 헬스 체크, 그리고 확장이 용이한 디렉터리 구조가 포함되어 있습니다.

## 모듈형 생태계

Konekti는 거대한 단일체(Monolith)가 아닙니다. 정교하게 설계된 모듈들의 집합입니다.

| 카테고리 | 패키지 |
| :--- | :--- |
| **런타임** | [Fastify](./packages/platform-fastify), [Node.js](./packages/platform-nodejs), [Bun](./packages/platform-bun), [Deno](./packages/platform-deno), [Workers](./packages/platform-cloudflare-workers) |
| **데이터베이스** | [Prisma](./packages/prisma), [Drizzle](./packages/drizzle), [Mongoose](./packages/mongoose) |
| **API/통신** | [HTTP](./packages/http), [GraphQL](./packages/graphql), [OpenAPI](./packages/openapi), [WebSockets](./packages/websockets), [Socket.IO](./packages/socket.io) |
| **로직** | [DI](./packages/di), [CQRS](./packages/cqrs), [Validation](./packages/validation), [Serialization](./packages/serialization), [Config](./packages/config) |
| **운영** | [Metrics](./packages/metrics), [Health (Terminus)](./packages/terminus), [Redis](./packages/redis), [Queue](./packages/queue) |

## 이어서 읽기

- 📖 **[문서 포털](./docs/README.ko.md)**: 아키텍처, DI, 패턴에 대한 심층 문서.
- 🚀 **[시작하기](./docs/getting-started/quick-start.ko.md)**: Konekti와 함께하는 첫 15분.
- 💡 **[예제 앱](./examples/README.ko.md)**: 최소 설정부터 복잡한 RealWorld API까지.
- 🛠️ **[CLI 가이드](./packages/cli/README.ko.md)**: 신속한 개발을 위한 `konekti` 명령어 마스터하기.

## 우리의 철학

우리는 **동작 계약(Behavioral Contracts)**의 힘을 믿습니다. 이 저장소의 모든 패키지는 엄격한 안정성 규칙을 따르며, 사용 중인 런타임에 관계없이 백엔드가 예상한 대로 정확하게 동작하도록 보장합니다.

- [릴리스 거버넌스](./docs/operations/release-governance.ko.md)
- [동작 계약 정책](./docs/operations/behavioral-contract-policy.ko.md)
- [기여하기](./CONTRIBUTING.md)

---
<p align="center">
  TypeScript 커뮤니티를 위해 ❤️로 만들었습니다.
</p>
