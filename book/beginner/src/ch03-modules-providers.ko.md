<!-- packages: @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v1.1 -->

# Chapter 3. Understanding Modules, Providers, and Controllers

## Learning Objectives
- 모듈과 `@Module()` 데코레이터의 역할을 정의합니다.
- 프로바이더와 `@Injectable()` 데코레이터를 이해합니다.
- 컨트롤러가 무엇을 하는지와 요청을 어떻게 받는지 배웁니다.
- fluo의 의존성 주입 흐름을 따라갑니다.
- `imports`와 `exports`가 모듈 경계를 어떻게 만드는지 이해합니다.
- FluoBlog를 위한 첫 `PostsModule` 뼈대를 만듭니다.

## Prerequisites
- Chapter 2를 마치고 FluoBlog 프로젝트를 생성한 상태.
- TypeScript 클래스와 생성자에 대한 기본 이해.
- 짧은 코드 예제를 읽는 데 익숙할 것.

## 3.1 What is a Module?

fluo에서 모듈은 `@Module()`이 붙은 클래스입니다. 이 데코레이터는 보기 좋게 장식하는 용도만이 아닙니다. 프레임워크가 애플리케이션이 어떻게 조립되는지 이해하는 데 필요한 구조 정보를 제공합니다.

모든 애플리케이션에는 최소 하나의 모듈이 있으며, 보통 그 이름은 `AppModule`입니다.

초보자 수준에서는 모듈을 “공개 표면과 내부 구현 영역을 가진 경계”라고 생각하면 됩니다.

```typescript
import { Module } from '@fluojs/core';

@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class AppModule {}
```

### Modularity as a First-Class Citizen

모듈은 멋진 이름이 붙은 폴더가 아닙니다. 모듈은 fluo 애플리케이션의 핵심 조직 단위입니다.

모듈은 유용한 제약을 만듭니다.

- 관련 기능을 하나의 일관된 단위로 묶고,
- 어떤 프로바이더가 외부에 보일지 정하여 내부 구현 세부사항을 보호하고,
- 전체 앱이 하나의 거대한 파일 그래프로 무너지는 것을 막아 코드베이스 탐색을 쉽게 만들고,
- 팀이 소유권 경계를 긋는 자연스러운 지점을 제공하여 병렬 개발을 가능하게 합니다.
- 테스트 시 특정 모듈이나 프로바이더를 가짜로 대체하기 쉽게 해줍니다.

초보자에게 중요한 이유는 모든 기능이 명확한 집을 가질 때 아키텍처를 배우기가 훨씬 쉬워지기 때문입니다. 앱이 수백 개의 파일로 커질 때, 이 모듈식 구조는 복잡성에 대항하는 가장 강력한 무기가 될 것입니다.

### The Four Core Module Keys

애플리케이션이 커질수록 우발적 결합(accidental coupling)은 가장 큰 유지보수 문제 중 하나가 됩니다. 이 "스파게티 코드" 느낌의 복잡도는 나중에 코드를 고칠 때 예기치 못한 문제를 일으키곤 합니다. 생산성과 개발자 행복을 해치는 침묵의 살인마와 같죠.

어떤 파일이든 다른 모든 파일에 자유롭게 접근할 수 있다면 코드베이스를 이해하기가 매우 어려워집니다. 모듈은 공유를 기본값이 아니라 의식적인 선택으로 바꾸어 그 혼란을 늦춰 줍니다. 이러한 "옵트인" 공유 모델은 개발자가 내부 API와 외부 API에 대해 신중하게 생각하도록 유도합니다.

이러한 의도적인 설계가 대규모 애플리케이션을 가능하게 하고, 유지보수하기 쉽게 하며, 여러 해 동안 지속 가능하게 만듭니다. 이것이 바로 fluo가 소프트웨어를 만드는 방식이며, 앞으로 수년간 보상으로 돌아올 것입니다.

### Why boundaries matter

다음 장에서 자세히 다루겠지만, fluo가 표준 TC39 Stage 3 데코레이터를 사용한다는 점을 미리 알아두면 좋습니다.

`tsconfig.json`에서 "Experimental Decorators"나 "Emit Decorator Metadata" 설정이 필요한 오래된 프레임워크들과 달리, fluo는 네이티브 자바스크립트 데코레이터 제안을 그대로 따릅니다.

초보자에게 이것이 중요한 이유는 다음과 같습니다.

- 빌드 도구(Vite, SWC, ESBuild)가 레거시 메타데이터 생성 없이 더 빠르게 작동합니다.
- 자바스크립트 언어의 실제 미래를 배우게 됩니다.
- 디버깅을 어렵게 만드는 `reflect-metadata` 같은 라이브러리의 "마법"을 피할 수 있습니다.
- 특정 컴파일러 해킹 없이도 다양한 런타임(Node.js, Bun, Deno)에서 코드가 더 잘 작동합니다.

`@Module()`이나 `@Injectable()`을 볼 때, 여러분은 독자적인 TypeScript 확장이 아닌 표준 언어 기능을 사용하고 있다는 점을 기억하세요. 표준을 따르는 것은 생태계가 진화하더라도 여러분의 기술이 계속 유효함을 보장합니다.

### A Beginner Mental Model

초보자가 흔히 하는 실수 중 하나는 모듈을 네임스페이스나 단순한 폴더로 혼동하는 것입니다.

폴더가 파일을 찾는 데 도움을 준다면, fluo 모듈은 프레임워크가 의존성을 찾는 데 도움을 줍니다. `users` 폴더에 파일이 아무리 많아도, 이를 등록하는 `UsersModule`이 없다면 fluo는 이들을 앱에 연결하는 방법을 알지 못합니다.

또한 모든 파일마다 모듈이 필요한 것은 아닙니다. 관련된 파일들을 하나의 논리적 기능을 나타내는 모듈로 묶어야 합니다. 예를 들어, `PostsController`, `PostsService`, `PostsRepository`는 모두 하나의 `PostsModule`에 속합니다.

마지막으로, 모듈은 코드 실행을 위한 것이 아니라 구성을 위한 것임을 기억하세요. 모듈의 주된 임무는 DI 컨테이너에 클래스를 어떻게 인스턴스화하고 연결할지 알려주는 것입니다. 실제 로직은 프로바이더와 컨트롤러 안에 남습니다.

### Standard vs Legacy Decorators (Preview)

애플리케이션을 구축하면서 모듈 경계를 어떻게 정할지는 가장 중요한 설계 결정 중 하나가 될 것입니다.

좋은 모듈은 다음과 같아야 합니다.

- **응집도(Cohesive)**: 모듈 내부의 모든 클래스는 하나의 기능이나 책임에 밀접하게 관련되어야 합니다.
- **느슨한 결합(Loosely Coupled)**: 모듈은 작고 잘 정의된 공개 API(`exports`)를 가져야 하며, 다른 모듈의 내부 세부사항에 의존해서는 안 됩니다.
- **캡슐화(Encapsulated)**: 내부 헬퍼 클래스나 비공개 서비스는 내보내지(export) 않아야 합니다.

이 원칙들을 따르면 시스템을 이해하고 변경하기가 쉬워집니다. 모듈 내부를 리팩토링하더라도 공개된 API만 유지한다면 안전하게 작업할 수 있습니다. 이것이 바로 유지보수 가능한 대규모 fluo 앱을 만드는 핵심입니다.

### Common Misconceptions about Modules

프로바이더는 fluo가 대신 관리해 주는 재사용 가능한 의존성입니다. 가장 흔한 예는 서비스지만, 설계에 따라 팩토리, 리포지토리, 헬퍼, 어댑터도 프로바이더가 될 수 있습니다.

`@Injectable()`은 클래스를 DI 시스템이 관리 가능한 의존성으로 취급하도록 표시합니다.

```typescript
import { Injectable } from '@fluojs/di';

@Injectable()
export class PostsService {
  private readonly posts = [];

  create(post: { title: string }) {
    this.posts.push(post);
  }

  findAll() {
    return this.posts;
  }
}
```

### Designing Good Module Boundaries

대부분의 입문 예제에서 프로바이더는 애플리케이션 컨테이너 안에서 싱글톤처럼 동작합니다.

즉, 여러 소비자가 각자 새 인스턴스를 만드는 대신 같은 관리 인스턴스를 받는 경우가 많습니다.

이 방식은 다음 이유로 유용합니다.

- 공유 자원이 중앙화되고,
- 상태를 더 쉽게 이해할 수 있으며,
- 객체 생성 규칙이 일관되게 유지됩니다.

## 3.2 What is a Provider?

프로바이더는 전송 계층 연결보다 애플리케이션 계층 로직을 담당해야 합니다.

예를 들면 다음과 같습니다.

- 데이터를 조회하거나 저장하기,
- 도메인 규칙 검증하기,
- 관련 작업을 조율하기,
- 외부 API를 감싸기.

클래스가 주로 “무엇이 일어나야 하는가”에 답한다면 프로바이더 후보일 가능성이 큽니다.

### The Singleton Nature

초보자는 종종 컨트롤러에 너무 많은 것을 넣고 서비스에는 너무 적게 넣습니다.

다음은 가능하면 컨트롤러보다 프로바이더에 두는 편이 좋습니다.

- 단순하지 않은 비즈니스 규칙,
- 재사용 가능한 데이터 변환,
- 여러 라우트에서 공통으로 쓰는 도메인 로직,
- 인프라 조율 코드.

이렇게 해야 컨트롤러는 얇고 프로바이더는 의미 있게 유지됩니다.

### Providers Are About Responsibility

같은 로직을 두 컨트롤러에 복사하게 된다면, 그 로직이 프로바이더가 되기를 원한다는 신호인 경우가 많습니다.

### What a Provider Should Not Do

싱글톤이 기본이지만, fluo가 프로바이더를 위한 다양한 "스코프(scope)"를 지원한다는 점을 알면 도움이 됩니다. 아직 마스터할 필요는 없지만, 이런 것이 있다는 것을 알면 더 복잡한 코드를 이해하는 데 도움이 될 것입니다.

- **DEFAULT (Singleton)**: 애플리케이션 전체에서 하나의 인스턴스만 생성됩니다. 초보자로서 99%의 경우 이 스코프를 사용하게 될 것입니다.
- **REQUEST**: 들어오는 요청마다 새로운 인스턴스가 생성됩니다. 요청별 로깅이나 멀티테넌트 데이터베이스 전환 등에 유용합니다.
- **TRANSIENT**: 주입될 때마다 매번 새로운 인스턴스가 생성됩니다. 상태가 없는 가벼운 헬퍼 클래스에 적합합니다.

대부분의 초보자 로직은 `DEFAULT` 스코프에 머무는 것이 좋습니다. 성능 면에서 가장 유리하고 추론하기도 쉽습니다.

### A Tiny Refactoring Clue

프로바이더는 단순한 정적 객체가 아니라 fluo 컨테이너에 의해 관리되는 생명주기(lifecycle)를 가집니다.

애플리케이션이 시작될 때 fluo는 다음과 같은 일을 합니다.

1. 모듈을 스캔하여 등록된 모든 프로바이더를 찾습니다.
2. 의존 관계에 따라 프로바이더가 생성되어야 하는 순서를 결정합니다.
3. 인스턴스를 생성합니다(기본적으로 싱글톤).
4. 필요한 클래스에 주입합니다.

중수편에서는 `OnModuleInit`이나 `OnApplicationBootstrap` 같은 특수한 인터페이스를 사용하여 이 생명주기에 개입하는 방법도 배울 것입니다. 지금은 프레임워크가 객체의 "탄생"부터 "죽음"까지를 책임지고 관리해 준다는 점만 기억하세요.

### Provider Scopes: A Sneak Peek

fluo를 배우는 것은 종종 "프로바이더 단위로 생각하는 법"을 배우는 과정이기도 합니다.

모든 것을 다 하는 하나의 함수를 작성하는 대신, "여기서 핵심 책임은 무엇인가? 이것이 서비스여야 하나? 리포지토리인가? 아니면 설정을 돕는 헬퍼인가?"라고 스스로 묻게 됩니다.

로직을 작고 주입 가능한 프로바이더로 나누면 자연스럽게 **단일 책임 원칙(Single Responsibility Principle)**을 따르게 됩니다. 각 클래스는 한 가지 일을 잘 수행하고, DI 시스템은 이들을 하나로 묶는 복잡한 작업을 처리합니다. 이는 코드를 더 읽기 쉽고, 테스트하기 좋고, 작성하기 즐겁게 만듭니다.

### The Lifecycle of a Provider

DI 시스템이 주는 가장 큰 선물 중 하나는 "가시성"입니다. 여러분이 작성한 클래스가 어떤 협력자를 필요로 하는지 생성자만 봐도 명확히 알 수 있습니다.

예를 들어 `PostsController`가 `PostsService`를 필요로 한다는 사실은 단순히 코드를 읽는 것만으로도 알 수 있으며, 이는 복잡한 설정 파일이나 배후의 마법 같은 검색 시스템에 의존하지 않습니다. 초보자에게 이러한 명시성은 프레임워크의 동작을 예측 가능하게 만들고, 코드의 흐름을 추적하는 데 큰 도움을 줍니다. 

또한, 이러한 구조는 자연스럽게 테스트 가능한 코드로 이어집니다. 테스트 환경에서 실제 `PostsService` 대신 가짜(Mock) 객체를 생성자에 넣어줌으로써, 컨트롤러의 로직만을 독립적으로 검증할 수 있기 때문입니다. 

결과적으로, fluo의 명시적 DI는 여러분이 더 건강한 설계 습관을 갖도록 안내하며, 애플리케이션이 성장하더라도 유지보수의 어려움을 최소화해 줍니다. 

### Thinking in Providers

컨트롤러는 들어오는 요청을 받고 응답을 반환합니다. 즉, 기능의 전송 계층과 맞닿은 가장자리입니다.

HTTP 중심 코드에서 컨트롤러는 라우트 경로가 메서드에 매핑되는 곳입니다.

```typescript
import { Controller, Get } from '@fluojs/http';
import { PostsService } from './posts.service';

@Controller('/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get('/')
  findAll() {
    return this.postsService.findAll();
  }
}
```

## 3.3 What is a Controller?

fluo에서 모든 프로바이더는 모듈에 등록되어야 합니다. 이는 의존성 그래프가 항상 감사 가능하고 추적하기 쉬운 상태를 유지하도록 보장합니다.

```typescript
@Module({
  providers: [
    PostsService,
    { provide: 'API_KEY', useValue: 'secret-key-123' } // 클래스가 아닌 프로바이더 예시
  ],
})
export class PostsModule {}
```

### The Importance of Explicit Registration

컨트롤러는 지배자가 아니라 조율자여야 합니다.

건강한 컨트롤러는 보통 네 가지를 합니다.

1. 전송 계층으로부터 입력을 받습니다.
2. 프로바이더를 호출합니다.
3. 기대한 응답 형태로 결과를 반환합니다.
4. 라우트 동작이 명확할 정도로 작게 유지됩니다.

이 규율 덕분에 테스트가 쉬워지고 기능 변경도 안전해집니다.

### Separation of Concerns

컨트롤러에 어울리는 것은 다음과 같습니다.

- 라우트 데코레이터,
- 경로 구조,
- 고수준 요청 처리,
- 어떤 프로바이더 메서드를 호출할지 선택하는 일.

반대로 컨트롤러에 어울리지 않는 것은 다음과 같습니다.

- 여러 라우트가 재사용하는 비즈니스 정책,
- 영속성 세부사항,
- 복잡한 도메인 분기,
- 저수준 인프라 로직.

### What Belongs in a Controller?

처음 요청을 직접 받는 파일에 모든 것을 넣고 싶어지는 것은 자연스러운 반응입니다.

하지만 엔드포인트 수가 늘어나면 그 선택이 빠르게 고통으로 돌아옵니다. 처음부터 컨트롤러를 얇게 유지하면 나중의 정리 작업을 줄일 수 있습니다.

### Why beginners overload controllers

fluo의 DI 흐름은 마법으로 이해하는 것보다 순서로 이해하는 편이 쉽습니다.

1. 클래스를 주입 가능하도록 정의합니다.
2. 모듈의 `providers` 배열에 등록합니다.
3. 다른 클래스에서, 보통 생성자를 통해 요청합니다.
4. 프레임워크가 관리 인스턴스를 제공합니다.

이 순서는 fluo의 핵심 정신 모델 중 하나입니다.

## 3.4 Dependency Injection (DI) Flow

`PostsController`가 `PostsService`에 의존한다고 상상해 봅시다.

- `PostsService`는 `@Injectable()`로 표시됩니다.
- `PostsModule`은 `providers`에 `PostsService`를 등록합니다.
- `PostsController`는 생성자에서 `PostsService`를 요청합니다.
- fluo는 컨트롤러를 만들 때 이 요소들을 연결합니다.

과정이 명시적이기 때문에, 컨테이너가 무엇을 추론했는지 guessing 하지 않고 코드만 읽어도 문제를 추적할 수 있습니다.

### Step-by-Step Flow

프레임워크 내부에서 작업할 때는 보통 컨트롤러나 프로바이더를 `new`로 직접 만들지 않습니다.

이 절제가 중요한 이유는 수동 생성이 컨테이너 관리 동작을 우회하고, 일관된 의존성 그래프의 장점을 약화시키기 때문입니다.

### No more casual `new`

DI 친화적인 클래스는 협력자가 외부에서 들어오기 때문에 테스트하기 쉽습니다.

즉, 테스트에서 다음을 쉽게 대체할 수 있습니다.

- 가짜 리포지토리,
- 스텁 처리된 API,
- 메모리 기반 데이터 저장소,
- 결정적인 동작을 하는 헬퍼.

객체 생성이 비즈니스 메서드 안에 숨겨져 있지 않을수록 좋은 테스트를 작성하기 쉬워집니다.

### Why DI Helps Testing

의존성을 해결하지 못할 때 문제는 보통 몇 군데 중 하나에 있습니다.

1. 프로바이더를 등록하지 않았다.
2. 잘못된 모듈이 그 프로바이더를 소유하고 있다.
3. 다른 모듈에서 export해야 하는데 하지 않았다.
4. 소비 클래스가 컨테이너가 매칭할 수 없는 토큰을 요청했다.

이 점검표를 알고 있으면 나중에 시간을 많이 아낄 수 있습니다.

### A Common Failure Pattern

기본적으로 프로바이더는 자신을 선언한 모듈에 속합니다. 이 기본값은 건강합니다. 공유 로직이 정말로 다른 모듈의 공개 표면이 되어야 하는지를 의식적으로 선택하게 만들기 때문입니다.

프로바이더를 다른 모듈과 공유하려면 두 가지가 필요합니다.

1. 소유 모듈이 그 프로바이더를 `exports`에 넣습니다.
2. 사용하는 모듈이 그 소유 모듈을 `imports`에 넣습니다.

## 3.5 Sharing Providers across Modules

`exports`가 중요한 이유는 모든 내부 클래스가 자동으로 공개되지 않도록 막아 주기 때문입니다.

이 덕분에 모듈 API는 더 작고 더 명확해집니다.

`exports`는 “다른 모듈이 이것에 의존해도 된다”라는 문장이라고 생각하면 쉽습니다.

### Why `exports` exists

`DatabaseModule`이 `DatabaseService`를 소유한다고 가정해 봅시다.

`PostsModule`과 `UsersModule`이 모두 데이터베이스 연결이 필요하다면 깔끔한 패턴은 다음과 같습니다.

- `DatabaseModule`에 `DatabaseService`를 등록하고,
- `DatabaseModule`에서 `DatabaseService`를 export하고,
- 필요한 기능 모듈이 `DatabaseModule`을 import합니다.

이렇게 하면 소유권은 중앙에 두면서도 재사용은 명시적으로 유지할 수 있습니다.

### A DatabaseService Example

초보자는 하나의 import 문제가 생기면 모든 것을 export해 버리는 방식으로 대응하기도 합니다.

단기적으로는 동작하지만, 모듈 경계를 빠르게 약하게 만듭니다. 정말 필요한 것만 공유하세요.

### Avoiding the “everything is shared” trap

프로바이더를 export해야 하는지 애매할 때는 이렇게 물어보세요.

“이것은 기능의 공개 능력인가, 아니면 내부 구현 세부사항인가?”

이 질문은 아키텍처가 과하게 새지 않도록 도와줍니다.

### A useful review question

이제 이 아이디어를 FluoBlog에 적용해 봅시다. 우리는 게시물 전용 기능 모듈을 만들고 싶습니다.

최소한 이 기능에는 다음이 필요합니다.

1. 게시물 관련 로직을 소유하는 프로바이더,
2. 라우트를 노출하는 컨트롤러,
3. 둘을 묶는 모듈.

```typescript
// src/posts/posts.module.ts
import { Module } from '@fluojs/core';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
```

그다음 이 모듈을 루트 앱 모듈에 등록합니다.

```typescript
// src/app.module.ts
import { Module } from '@fluojs/core';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [PostsModule],
})
export class AppModule {}
```

## 3.6 FluoBlog: Creating the PostModule Skeleton

데이터베이스 영속성이나 검증을 추가하기 전이라도, 이 작은 구조는 이미 많은 것을 전달합니다.

- posts는 독립된 도메인 기능이고,
- 이 기능은 라우트 처리와 재사용 로직을 함께 소유하며,
- 루트 앱이 그 기능을 명시적으로 조합합니다.

### What this skeleton gives you

처음에는 컨트롤러 파일 하나로 시작하고 모듈은 나중에 고민하고 싶을 수 있습니다.

하지만 이 책이 모듈을 초반에 소개하는 이유는 기능 경계 중심으로 구조를 잡는 습관을 먼저 만들기 위해서입니다. 파일이 우연히 커진 뒤에 나누는 것보다 훨씬 낫습니다.

### Why the module comes early

이 시점에서 다음 질문에 추측 없이 답할 수 있어야 합니다.

1. 게시물 관련 재사용 로직은 어떤 파일이 소유하는가?
2. 게시물 관련 라우트는 어떤 파일이 소유하는가?
3. 이 기능을 묶는 파일은 무엇인가?
4. 이 기능을 전체 앱 일부로 만드는 파일은 무엇인가?

이 질문에 답할 수 있다면 이 장은 제 역할을 한 것입니다.

### A beginner checkpoint
- 모듈은 애플리케이션 경계와 구성을 정의합니다.
- 프로바이더는 컨테이너가 관리하는 재사용 로직을 담습니다.
- 컨트롤러는 요청을 받고 작업을 위임합니다.
- fluo의 DI는 명시적이고 읽기 쉬운 흐름을 따릅니다.
- `imports`와 `exports`는 모듈 간 안전한 공유를 제어합니다.
- FluoBlog는 이제 첫 번째 실제 도메인 기능인 posts로 나아갈 준비가 되었습니다.

## Summary
다음 장에서는 모듈, 프로바이더, 컨트롤러를 가능하게 하는 더 깊은 층, 즉 데코레이터 모델을 살펴봅니다. TC39 Stage 3 데코레이터를 이해하면 fluo 문법이 왜 현대적으로 보이는지, 그리고 왜 오래된 TypeScript 스택의 레거시 데코레이터 가정을 피하는지 분명하게 보일 것입니다.


## Next Chapter Preview
... (Content added for parity)