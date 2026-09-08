<!-- packages: @fluojs/core, @fluojs/http, @fluojs/cli, @fluojs/di -->
<!-- project-state: FluoBlog v0.0 -->

# Chapter 0. Welcome to fluo: The Standard-First Framework

<!-- fluo:docs-navigation:start -->
> **이전 판 안내 — 기초 개념·애플리케이션 레퍼런스.** 현재 학습은 [제품·패턴 중심 3권 시리즈](../README.ko.md)에서 시작하세요. 이 장은 이전 판의 참고자료입니다. 기존 프로젝트 이야기, 버전·`project-state` 표시, 이전·다음 장 안내는 검증된 누적 실행 스냅샷이나 필수 학습 순서를 뜻하지 않습니다. 현재 API·환경 조건은 [패키지 레퍼런스](../../docs/reference/package-surface.ko.md)와 [toolchain 계약](../../docs/reference/toolchain-contract-matrix.ko.md)에서 확인하세요.
>
> [이 권의 주제별 목차](./toc.ko.md) · [Book 허브](../README.ko.md)

<!-- fluo:docs-navigation:end -->
이 권은 fluo의 기초 개념과 애플리케이션 설계 이유를 찾아 읽는 레퍼런스입니다. 현재 입문 실습은 공식 튜토리얼 한 곳에서 진행하고, 여기서는 필요한 주제를 골라 더 깊이 읽습니다.

## What is fluo?

코드로 들어가기 전에 fluo가 무엇인지, 어떤 점이 다른지 먼저 정리합니다. 오늘날 많은 TypeScript 프레임워크는 수년 전에 제안되었지만 공식 JavaScript 언어의 일부가 되지 못한 실험적 기능에 의존합니다. `tsconfig.json` 파일에서 `experimentalDecorators`나 `emitDecoratorMetadata` 같은 설정을 본 적이 있을 것입니다. 이 기능들은 한때 유용했지만, 지금은 아키텍처에 부담을 남기고 표준과 항상 일치하지 않는 특정 컴파일러 동작을 요구합니다.

fluo는 **표준 우선(Standard-First)** 접근으로 이 의존성을 끊습니다.

fluo는 완전히 **TC39 Stage 3 Decorator** 사양을 기반으로 구축되었습니다. 이것은 단순한 구현 세부 사항이 아니라, 메타데이터와 동작을 코드에 연결하는 방식의 변화입니다. 컴파일러 트릭 대신 실제 JavaScript 런타임의 일부가 될 공식 기능을 사용하기 때문에, fluo는 더 예측 가능한 안정성과 성능을 목표로 합니다.

그 결과, 프레임워크의 성격은 다음처럼 정리됩니다.

- **Lean**: `reflect-metadata`와 같은 무거운 reflection 라이브러리나 숨겨진 메타데이터 부풀리기가 없습니다. 번들 크기를 작게 유지합니다.
- **Fast**: AWS Lambda나 Vercel 같은 서버리스 환경에서 중요한 "Cold Start" 시간을 줄이고, 메모리 사용량도 낮게 유지합니다.
- **Explicit**: 프로젝트 전체를 암묵적으로 스캔하지 않습니다. 모듈 정의만 봐도 의존성이 어떻게 연결되는지 확인할 수 있습니다.
- **Portable**: 동일한 코드가 Node.js, Bun, Deno, 그리고 Cloudflare Workers에서 실행됩니다. fluo는 Platform Adapter Contract로 런타임 간 차이를 처리하므로, 비즈니스 로직은 플랫폼에 덜 묶입니다.

## Why This Book?

[현재 튜토리얼](../../apps/docs/content/docs/tutorial/index.ko.mdx)은 앱 생성, 첫 라우트, 의존성 주입, 검증·오류, 테스트를 하나의 과정으로 연결합니다. 이 Book은 그 과정과 경쟁하지 않고 설계의 **이유**와 개념을 보충합니다. 장 번호대로 모든 기능을 설치하거나 구현할 필요는 없습니다.

## The FluoBlog Project

기존 장의 **FluoBlog**는 모듈, HTTP, 영속성, 인증, 캐싱, 관측 가능성을 설명하는 사례입니다. 기존 장의 버전 표시는 새 튜토리얼의 체크포인트와 대응하지 않습니다. Book 전체를 따라 하면 프로덕션 앱이 완성된다는 보장은 없습니다.

실행할 입문 예제는 [`examples/fluo-blog`](../../examples/fluo-blog)와 현재 튜토리얼에서 확인하세요. Prisma, JWT, Redis 같은 확장은 각 장의 개념 설명과 현재 패키지 계약을 확인한 뒤 앱 요구에 맞게 선택합니다.

## Prerequisites

이 책을 따라가려면 다음이 필요합니다.

- **기초적인 JavaScript/TypeScript 지식**: 클래스, `async/await`, 기본적인 타입 선언에 익숙해야 합니다.
- **Node.js 설치**: fluo는 많은 런타임을 지원하지만, 우리는 Node.js `>=24.0.0 <27`과 `pnpm`을 기본 개발 환경으로 사용합니다. 입문 Node.js 경로는 RFC `QUERY`가 listener에 도달하도록 이 정확한 `engines.node` 범위를 선언한 Fastify adapter package를 사용합니다. Node 24 미만과 Node 27 이상은 제외됩니다.
- **터미널과 코드 에디터**: TypeScript 확장이 설치된 VS Code를 권장합니다.

NestJS, Express 또는 다른 백엔드 프레임워크에 대한 사전 경험은 **필요하지 않습니다**. 다른 프레임워크를 경험했다면 fluo의 명시성이 더 뚜렷하게 보일 수 있습니다. 이 책은 웹이 어떻게 동작하는지에 대한 기초 지식 외에는 별도 백엔드 경험이 없다고 보고 개념을 설명합니다.

### The Philosophy of "No Magic"

fluo를 사용할 때 가장 먼저 드러나는 특징 중 하나는 "마법"이 없다는 점입니다. 많은 인기 프레임워크에서는 개발자가 명시적으로 지시하지 않아도 배후에서 많은 일이 일어납니다. 처음에는 편리해 보일 수 있지만, 문제가 생기면 원인을 추적하기 어려워집니다.

fluo는 애플리케이션 아키텍처를 개발자가 직접 제어해야 한다는 관점에서 출발합니다. 서비스에 데이터베이스가 필요하다면 fluo에 이를 제공하라고 명시적으로 지시합니다. 컨트롤러가 특정 경로를 처리해야 한다면 그 경로를 명시적으로 정의합니다. 이 명시성은 코드를 읽기 쉽게 만들고, 테스트하기 쉽게 하며, 프로젝트가 커져도 유지보수 비용을 낮춥니다.

마법을 줄이면 코드를 논리적으로 추론할 수 있습니다. 의존성이 왜 주입되지 않았는지, 경로가 왜 동작하지 않는지 추측하는 시간이 줄어듭니다. 답은 소스 코드 안에 명확하고 감사 가능한 형태로 남습니다.

### A Framework for Every Environment

현대의 웹은 전통적인 서버에만 머물지 않습니다. 서버리스 함수, 엣지 런타임, 심지어 IoT 기기와 같은 특수한 환경에도 코드를 배포합니다. fluo는 이런 배포 환경의 다양성을 전제로 설계되었습니다.

"런타임 중립적(Runtime-Neutral)" 접근 방식은 애플리케이션의 핵심인 비즈니스 로직, 서비스, 컨트롤러가 실행 위치에 덜 의존한다는 뜻입니다. 고성능 Node.js 클러스터에 배포하든, 가벼운 Cloudflare Worker에 배포하든, fluo 코드는 동일한 구조를 유지합니다.

이식성은 Platform Adapter Contract를 통해 달성됩니다. fluo가 런타임 간 차이를 추상화하므로, 애플리케이션 코드는 플랫폼별 API보다 기능 구현에 집중할 수 있습니다.

### The Value of Standard-First

"표준 우선" 프레임워크를 선택한다는 것은 장기적으로 유효한 언어 기능 위에 기술을 쌓겠다는 결정입니다. fluo를 배울 때는 독자적인 도구만 배우는 것이 아니라, 공식 JavaScript 표준으로 향하는 데코레이터 모델을 함께 익히게 됩니다.

TC39 Stage 3 데코레이터 사양은 프레임워크의 근간입니다. fluo를 익히면 향후 JavaScript 개발에서 중요해질 네이티브 언어 기능에 대한 실무 감각도 함께 얻게 됩니다. 이 지식은 fluo 밖에서도 재사용할 수 있습니다.

fluo는 독자적인 문법을 발명하는 프레임워크에서 생기는 "락인(lock-in)" 효과를 피합니다. fluo에서는 언어의 의도에 가까운 방식으로 코드를 작성합니다. 표준과의 정렬은 생태계가 변해도 기술 판단의 기준을 유지하게 해 줍니다.

### Your Journey Starts Here

첫 실행은 [프로젝트 생성](../../apps/docs/content/docs/tutorial/create-app.ko.mdx)에서 시작하세요. 개념을 더 알고 싶을 때 아래 주제별 구성을 참고합니다.

## How to Read This Book

기존 여섯 파트와 장 URL은 유지하며, 필수 순서 대신 기초 개념과 선택 레퍼런스로 구분합니다. [전체 목차](./toc.ko.md)에서 필요한 장으로 바로 갈 수 있습니다.

### Part 0. Getting Started

**기초 개념**: 1–4장의 설계 철학, CLI 구조, 모듈·프로바이더, 표준 데코레이터를 참고합니다. 최신 생성 절차는 튜토리얼의 [프로젝트 생성](../../apps/docs/content/docs/tutorial/create-app.ko.mdx)을 따릅니다.

### Part 1. Building the HTTP API

**HTTP 레퍼런스**: 5–10장은 라우팅, 검증, 직렬화, 예외, 가드·인터셉터, OpenAPI를 다룹니다. 먼저 [첫 라우트](../../apps/docs/content/docs/tutorial/first-route.ko.mdx)와 [검증·오류](../../apps/docs/content/docs/tutorial/validation-errors.ko.mdx)를 실습한 뒤 필요한 설명을 찾아보세요.

### Part 2. Configuration and Data

**선택 기능**: 11–13장에서 설정, Prisma, 트랜잭션을 찾아봅니다. 데이터베이스 도입은 새 튜토리얼의 필수 단계가 아닙니다.

### Part 3. Authentication and Security

**선택 기능**: 14–16장은 JWT, Passport, 스로틀링을 다룹니다. 앱의 인증·접근 정책에 맞게 적용 범위를 정합니다.

### Part 4. Caching and Operations

**운영 레퍼런스**: 17–19장은 캐시, 헬스 체크, 메트릭을 다룹니다. 읽기 완료만으로 배포 준비가 검증되지는 않습니다.

### Part 5. Testing and Completion

**테스트·배포 레퍼런스**: 20–21장은 테스트와 운영 점검을 보충합니다. 테스트를 마지막까지 미루지 말고 현재 튜토리얼의 [테스트](../../apps/docs/content/docs/tutorial/testing.ko.mdx)에서 체크포인트를 확인하세요.

## Using the Code Examples

Book 스니펫은 주제를 설명하기 위한 발췌입니다. 서로 다른 장의 코드가 하나의 앱으로 누적 검증되었다고 가정하지 마세요.

- **입문 실습**: 현재 튜토리얼과 [`examples/fluo-blog`](../../examples/fluo-blog)의 체크포인트를 사용합니다.
- **다른 예제**: [예제 목록](../../examples/README.ko.md)에서 각 예제의 실행 범위를 확인합니다. `examples/`는 모든 Book 장의 단계별 완성 코드 모음이 아닙니다.
- **기능 적용**: 해당 패키지 README와 행동 계약을 읽고 자신의 앱에서 테스트합니다. 장의 `packages`·`project-state` 메타데이터는 유지하지만 실행 검증 인증으로 해석하지 않습니다.

## Community and Support

fluo 커뮤니티는 표준, 성능, 깨끗한 코드를 중시하는 개발자들의 모임입니다. 질문이나 개선 제안이 있다면 아래 채널을 사용할 수 있습니다.

- **GitHub Discussions**: 일반적인 질문, 아키텍처 조언, 만든 결과를 공유하기에 적합한 장소입니다.
- **Issue Tracker**: 프레임워크의 버그나 책의 예제에서 오류를 발견하면 보고해 주세요. 문서의 버그도 코드의 버그만큼 중요하게 다룹니다.
- **Discord**: 다른 개발자 및 핵심 유지관리자들과 실시간으로 소통할 수 있는 채널입니다. 어려운 개념에 대해 빠르게 확인하고 싶을 때 좋습니다.

## Orientation: The fluo Package Ecosystem

fluo는 하나의 거대한 "블랙박스"가 아닙니다. fluo는 39개 이상의 전문화되고 상호 운용 가능한 패키지들의 모음입니다. 이 모듈성은 의도된 설계입니다. 실제로 사용하는 코드만 포함하도록 하여 애플리케이션을 가볍게 유지합니다. 이 입문 시리즈에서는 주로 "핵심 4인방(Core Four)"에 집중합니다.

- `@fluojs/core`: 모듈 시스템과 의존성 주입을 제공하는 기반.
- `@fluojs/http`: 웹 서버 구축 및 HTTP 트래픽 처리와 관련된 모든 것.
- `@fluojs/cli`: 새 프로젝트 스캐폴딩 및 컴포넌트 생성을 위한 명령줄 도구.
- `@fluojs/di`: 클래스들을 명시적으로 연결하는 강력한 엔진.

이 책을 마칠 때쯤이면 이 조각들이 어떻게 조합되는지, 프로젝트에 필요할 때만 추가 패키지(예: `@fluojs/prisma` 또는 `@fluojs/redis`)를 어떻게 가져오는지 이해하게 됩니다.

## Setting Expectations

Book의 세 권은 숙련도별 필수 이수 과정이 아니라 읽기 목적별 자료입니다.

- **Beginner**: 기초 개념과 애플리케이션 레퍼런스.
- **Intermediate**: 필요할 때 선택하는 기능·아키텍처 자료.
- **Advanced**: 프레임워크 내부 구조와 기여자 자료.

### Ready to Start?

튜토리얼의 환경 조건을 먼저 확인합니다. Node.js 경로의 지원 범위는 `>=24.0.0 <27`이며 입문 과정은 Node.js 24를 기준으로 합니다.

```bash
# Verify your Node.js version
node --version
```

## Let's Begin

실습은 [현재 튜토리얼](../../apps/docs/content/docs/tutorial/index.ko.mdx)로, 개념 탐색은 [주제별 목차](./toc.ko.md)로 이동하세요.

### A Note on the "Standard-First" Approach
우리가 "표준 우선"이라고 말할 때, 그것은 장기적인 기술 선택에 대한 기준이기도 합니다. fluo를 배우면서 공식 JavaScript Decorator API를 함께 익히게 됩니다. 나중에 다른 도구나 다른 언어로 옮겨가더라도, 여기서 배우는 의존성 주입, 모듈화, 명시적 설정 패턴은 보편적으로 적용됩니다.

독자적인 DSL(Domain Specific Language)을 사용하는 프레임워크는 장기적으로 전환 비용을 만들 수 있습니다. fluo는 반대 방향을 택합니다. fluo는 이미 알고 있는 언어의 확장에 가깝습니다.

### Why Explicitness Matters
웹 개발 초기에는 "마법"이 기능으로 여겨졌습니다. 개발자가 무엇을 원하는지 추측하는 프레임워크가 인기를 끌었습니다. 하지만 애플리케이션이 큰 마이크로서비스로 성장하면서 그 마법은 비용이 되었습니다. 디버깅은 어려워지고, 리팩토링은 예측하기 힘든 작업이 됩니다.

fluo는 다른 길을 선택합니다. **명시적인 것이 암시적인 것보다 낫다**는 원칙을 따릅니다. fluo 컨트롤러를 보면 데이터가 어디서 오는지 알 수 있습니다. 모듈을 보면 그 모듈이 무엇을 제공하는지 확인할 수 있습니다. 처음에는 몇 줄의 코드가 더 필요할 수 있지만, 나중에 디버깅 시간을 크게 줄여 줍니다.

### Preparing Your Workspace

[프로젝트 생성](../../apps/docs/content/docs/tutorial/create-app.ko.mdx)의 Node.js 24·Fastify·pnpm 절차를 따르세요. Book을 위해 별도의 두 번째 FluoBlog 프로젝트를 만들 필요는 없습니다.

### Roadmap for the First 5 Chapters

1–5장은 설계 철학, CLI, 모듈, 데코레이터, 컨트롤러를 찾아보는 기초 자료입니다. 현재 실습의 [의존성 주입](../../apps/docs/content/docs/tutorial/dependency-injection.ko.mdx)이나 [첫 라우트](../../apps/docs/content/docs/tutorial/first-route.ko.mdx)를 진행하며 필요한 장을 선택하세요.
