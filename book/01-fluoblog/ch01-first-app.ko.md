# FluoBlog의 첫 실행 경로 만들기

<!-- book:volume=01-fluoblog;chapter=01 -->

[이전: 시리즈 안내](../README.ko.md) · [1권 목차](./toc.ko.md) · [다음: 첫 게시글을 HTTP로 보여주기](./ch02-first-http-route.ko.md)

## 글을 쓰기 전에, 실행할 수 있는 애플리케이션

개발하면서 발견한 문제와 해결 과정을 팀 채팅에만 남기다 보면 같은 질문에 여러 번 답하게 된다. FluoBlog의 첫 운영자는 그 기록을 한곳에 모으고 싶다. 처음부터 회원제 출판 플랫폼을 만들려는 것은 아니다. 자신이 쓴 글을 독자가 주소 하나로 열 수 있으면 첫 목표는 달성된다. 그러나 그 주소를 만들기 전에 해결할 문제가 있다. 어제 실행되던 프로그램이 오늘 다른 터미널에서 실행되지 않는다면 글 작성 기능을 추가해도 독자에게 전달할 수 없다.

첫 장에서 만드는 것은 게시글 관리 기능이 아니라 실행 경로다. 프로젝트를 생성하고, 어떤 파일이 시작점인지 확인하고, 실제 HTTP 요청을 보내고, 프로세스를 종료한 뒤 다시 시작한다. 이 짧은 왕복 안에도 도구, 애플리케이션 선언, 의존성 주입, 서버의 책임이 들어 있다. 이들을 구분해 두면 이후 오류가 났을 때 코드를 무작정 옮기거나 패키지를 다시 설치하는 대신 실패한 경계를 찾아갈 수 있다.

책 전체에서 애플리케이션 디렉터리는 `fluo-blog`다. 2권에서 독자들이 티셔츠와 스티커를 사기 시작해도 같은 애플리케이션에 상점 모듈을 추가한다. 지금부터 상품 서버와 블로그 서버를 따로 만들 이유는 없다. 3권에서는 이 제품의 요청이 Fluo 내부를 통과하는 과정을 추적한다. 따라서 첫 파일 몇 개의 이름과 역할은 뒤에서도 유효한 좌표가 된다.

이 책의 코드는 독자가 생성한 프로젝트에 적용하는 구현이다. 저장소의 `examples/fluo-blog`를 복사해서 이미 완성된 72장짜리 앱을 얻는다는 뜻이 아니다. 그 예제는 초기 HTTP와 DI 경로를 확인하는 별도의 실행 근거다. 본문의 명령과 실험은 재현 절차와 기대 결과이며, 이 원고를 집필하는 동안 독자의 새 프로젝트에서 실행해 통과시킨 기록은 아니다.

Docs의 구분으로 이 책의 작업 디렉터리는 registry 의존성과 생성된 `fluo dev`·`fluo build`·`fluo start` 스크립트를 쓰는 `generated-app`이다. 반면 `examples/fluo-blog/00-start`는 workspace 의존성, 저장소 패키지 빌드와 번호별 checkpoint 스크립트가 필요한 `repository-example`이다. 실행 근거를 비교하더라도 예제 파일로 생성 프로젝트 전체를 덮어쓰지는 않는다.

## 실행 환경도 코드의 입력이다

본문의 기준은 Node.js 24와 pnpm 10이다. 현재 Node 지향 Fluo 패키지와 CLI의 지원 범위는 `>=24.0.0 <27`이다. 지원 범위와 책에서 실제로 선택한 기준 버전은 구별해야 한다. “Node를 설치했다”는 사실만으로 버전 조건을 충족하지는 않는다. 먼저 프로젝트를 만들 터미널에서 다음을 확인한다.

```bash
node --version
pnpm --version
```

기대하는 주 버전은 각각 `24`, `10`이다. 에디터의 통합 터미널과 외부 터미널이 서로 다른 Node를 가리킬 수 있다. 한쪽에서만 성공한다면 소스보다 먼저 두 출력부터 비교한다. `package.json`의 엔진 선언은 오래된 런타임에 빠진 기능을 만들어 주지 않는다. 특히 표준 데코레이터를 쓴다는 설명은 Node가 변환 전의 모든 TypeScript 문법을 직접 실행한다는 설명이 아니다.

빈 작업 디렉터리에서 다음 명령을 실행한다. 옵션을 명시하는 이유는 책의 실행 경로를 대화형 선택 결과에 맡기지 않기 위해서다.

```bash
pnpm dlx @fluojs/cli new fluo-blog \
  --shape application \
  --transport http \
  --runtime node \
  --platform fastify \
  --package-manager pnpm
cd fluo-blog
pnpm dev
```

CLI는 기본적으로 의존성 설치까지 수행한다. 설치를 건너뛰는 `--no-install`을 선택했다면 `pnpm dev` 전에 프로젝트 안에서 `pnpm install`을 실행해야 한다. 이미 파일이 있는 `fluo-blog`에 같은 생성 명령을 다시 쓰지 않는다. CLI의 기본 충돌 거부는 기존 코드를 보호하기 위한 것이다. 설치가 실패했는데 강제 덮어쓰기로 처음부터 다시 만드는 것은 설치 문제를 해결하지 못하고 변경한 소스만 잃게 할 수 있다.

생성된 `package.json`과 lockfile을 함께 보관한다. 최초 생성에 사용하는 배포 버전과 실제 설치된 의존성은 시간이 지나면 달라질 수 있다. 특히 모든 `@fluojs/*` 패키지를 CLI와 같은 버전 번호로 맞추지 않는다. 생성기는 각 패키지의 릴리스 정보를 바탕으로 의존성 범위를 구성한다. 여기서 중요한 재현 단위는 기억해 둔 명령 한 줄이 아니라 프로젝트의 설정과 해석된 의존성 묶음이다.

서버가 listening 상태를 알리면 별도 터미널에서 starter가 제공하는 경로를 확인한다.

```bash
curl -i http://127.0.0.1:3000/greeting
```

예상 결과는 `200`과 greeting JSON이다. 아직 `/posts`를 구현하지 않았으므로 게시글 목록을 기대해서는 안 된다. 포트가 `.env`의 `PORT` 설정으로 바뀌었다면 실제 시작 로그의 주소를 사용한다. 브라우저의 오래된 탭만 새로 고치는 것보다 `curl -i`로 상태와 본문을 함께 보는 편이 어느 서버에 도달했는지 구분하기 쉽다.

## 생성된 파일을 실행 순서로 읽기

생성 직후 모든 파일을 이해하려고 할 필요는 없다. 먼저 `package.json`의 `dev`, `build`, `start` 스크립트가 각각 `fluo dev`, `fluo build`, `fluo start`로 이어지는지 확인한다. 이 명령들은 서로 같은 작업이 아니다. 개발 명령은 편집 후 재시작을 관리하고, 빌드는 실행할 산출물을 만들며, 시작 명령은 그 산출물을 실행한다. 소스를 바꾼 뒤 이전 빌드 결과를 시작하면 옛 응답이 나오는 것은 자연스럽다.

그다음 `src/main.ts`를 연다. 이 파일은 실행 환경을 읽고 Fastify 서버를 시작하는 경계다. `src/app.ts`는 `AppModule`을 선언하는 파일이다. 현재 Node HTTP starter의 루트 모듈에는 생성된 `GreetingModule`, 설정 모듈, 기본 상태 확인 모듈이 연결되어 있다. 지금은 이 등록을 보존한다. 설정과 운영 상태의 의미는 뒤에서 필요해질 때 확장하고, starter가 제공한 테스트를 깨뜨리면서 먼저 제거하지 않는다.

`src/greeting/` 안에는 컨트롤러, 서비스, 저장소와 테스트가 나뉘어 있다. 여기서는 구조의 예로 읽으면 된다. 다음 장의 게시글 조회는 더 작은 구현에서 시작한다. 모든 기능을 처음부터 같은 개수의 파일로 나눠야 한다는 규칙은 아니다. 독자가 이해해야 할 것은 디렉터리 이름이 아니라 “모듈에 무엇을 등록했고 누가 그것을 사용하는가”다.

실행 경로를 문장으로 따라가 보자. CLI가 개발 프로세스를 준비한다. 그 프로세스가 `src/main.ts`를 실행한다. `main.ts`가 `AppModule`을 넘기면 런타임은 모듈 선언을 읽고 필요한 provider와 컨트롤러를 조립한다. Fastify 어댑터는 실제 네트워크 요청을 프레임워크의 요청 표현으로 연결한다. 컨트롤러의 반환값은 HTTP 응답으로 작성된다. 이 중 어느 한 단계라도 빠지면 클래스 파일이 존재하는 것만으로 URL이 생기지 않는다.

`@fluojs/core`는 `@Module`, `@Inject` 같은 선언을 제공하지만 그 import만으로 서버를 열지는 않는다. `@fluojs/runtime`은 선언과 의존성을 실행 가능한 앱으로 조립한다. `@fluojs/platform-fastify`는 Node의 서버 경계를 맡는다. CLI는 그 애플리케이션을 생성하고 실행할 도구다. 이 구분 덕분에 테스트는 같은 모듈을 사용하면서 포트를 열지 않을 수 있고, 작은 관리 명령은 HTTP 없이 provider만 사용할 수 있다.

## 잘못된 포트는 시작 전에 거부하기

첫 운영 사고를 작게 만들어 보자. 운영자가 `PORT=3000oops`를 잘못 입력했다. 문자열 앞부분만 정수로 읽으면 잘못된 설정이 `3000`으로 조용히 바뀔 수 있다. 프로그램이 성공한 것처럼 보이는 쪽이 오히려 문제다. 기대한 설정으로 실행되지 않았다는 사실을 시작 경계에서 알려야 한다.

다음은 생성 프로젝트의 `src/main.ts`를 교체하는 **완전한 파일**이다. `AppModule`은 생성된 `src/app.ts`의 것을 그대로 사용한다.

```ts
import { FluoFactory } from '@fluojs/runtime';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { AppModule } from './app';

function readPort(value: string | undefined): number {
  const raw = value ?? '3000';

  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error('PORT must be a decimal integer between 1 and 65535.');
  }

  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error('PORT must be a decimal integer between 1 and 65535.');
  }

  return port;
}

const app = await FluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({
    host: '127.0.0.1',
    port: readPort(process.env.PORT),
    retryLimit: 0,
  }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
```

이 검사는 외부 문자열을 옵션으로 바꾸는 애플리케이션 경계에 있다. 숫자로 바꾼 뒤 유한한지만 확인하면 빈 문자열이나 지수 표기 같은 입력까지 의도치 않게 받아들일 수 있다. 정규식으로 허용할 표기를 정하고 정수 범위를 다시 검사하면 입력 정책이 명확하다. 포트 `0`을 거부하는 것은 책의 로컬 실행 정책이다. 어댑터 자체는 운영체제가 빈 포트를 정하도록 `0`을 허용한다. 프레임워크가 금지하는 값과 애플리케이션이 선택하지 않은 값을 혼동하지 않는다.

이 파일은 CLI의 포트 파서를 설명한 것이 아니라 FluoBlog의 입력 정책을 더 엄격하게 만든 것이다. 생성 starter는 `Number.parseInt(..., 10)`의 결과가 유한하지 않으면 `3000`으로 돌아가며, `3000oops`는 `3000`으로 읽는다. 저장소의 초기 checkpoint는 fallback 없이 `Number(...)`를 사용하므로 같은 입력이 `NaN`이 된다. Fastify는 전달받은 숫자 옵션을 검사할 뿐 `PORT`를 직접 읽지 않는다. 아래 실패 실험은 이 장의 `readPort`를 적용한 앱을 대상으로 한다.

`host: '127.0.0.1'`은 실습 서버를 자신의 컴퓨터에서만 접근하는 주소에 바인딩한다. 다른 기기나 컨테이너에서 접근하려면 해당 실행 환경의 호스트 정책을 별도로 정해야 한다. 여기서 무조건 `0.0.0.0`으로 바꾸는 것은 “주소 오류 수정”이 아니라 접근 범위를 바꾸는 선택이다.

`retryLimit: 0`은 포트 충돌을 즉시 드러내기 위한 실습 설정이다. 개발자가 오래된 프로세스를 남겼을 때 재시도 동안 멈춘 것처럼 보이지 않게 한다. 재시도는 순간적인 충돌을 완화할 수 있지만 이미 점유된 포트의 소유권 문제를 해결하지는 않는다. 문제를 재현하는 초기 단계에서는 빠른 실패가 더 유용하다.

`FluoFactory.create()`는 앱을 초기화하고 `app.listen()`은 adapter 활성화와 선택적 Node signal 등록까지 기다린다. 생성과 수신을 구분하고 두 호출을 모두 await한다. 새 Node/Fastify CLI starter도 같은 경로를 사용한다.

`FluoFactory.create()`에 `createFastifyAdapter()`를 전달하는 것이 공통 HTTP recipe다. Factory가 CORS, prefix, 기본 security headers, 호출자 middleware 순서를 소유하며 생성·시작 실패를 정리한다. CORS/prefix는 기본 off, security headers는 `false`로 끌 수 있는 기본 on이다. Node logger와 signal callback만 host가 명시적으로 선택한다.

여기서는 Node/Fastify가 socket listener를 소유한다. Workers나 Next.js에 붙이는 앱은 호스트가 요청 전달과 종료를 소유하며, 그 경로의 활성화가 새 socket을 연다는 뜻은 아니다. 같은 `listen`이라는 이름을 모든 환경의 포트·signal 요구사항으로 확대하지 않는다. 아래 컨텍스트 실험은 같은 class의 별도 context-only 메서드를 사용한다.

## HTTP를 열지 않고 조립만 확인하는 실험

서버가 실행되지 않을 때 “DI가 실패했는가, 포트가 실패했는가”를 분리할 수 있으면 진단이 빨라진다. 이를 위해 HTTP 없는 애플리케이션 컨텍스트를 한 번 사용해 보자. 아래는 실험용 `src/boot-probe.ts`의 **완전한 파일**이다. 게시글 기능의 일부도, 별도 서비스도 아니다.

```ts
import { Inject, Module } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';

const BLOG_NAME = Symbol('BLOG_NAME');

@Inject(BLOG_NAME)
class BlogIdentity {
  constructor(private readonly name: string) { }

  describe(): string {
    return `${this.name}: context-ready`;
  }
}

@Module({
  providers: [
    { provide: BLOG_NAME, useValue: 'FluoBlog' },
    BlogIdentity,
  ],
})
class ProbeModule { }

const context = await FluoFactory.createApplicationContext(ProbeModule);
try {
  const identity = await context.get(BlogIdentity);
  console.log(identity.describe());
} finally {
  await context.close();
}
```

`string`이라는 TypeScript 타입은 런타임에서 주입 대상을 지정하지 못한다. `BLOG_NAME`이 실제 토큰이고 `useValue`가 그 토큰의 값이다. 클래스 위의 `@Inject(BLOG_NAME)`은 생성자의 첫 인수에 무엇을 넣을지 명시한다. 마지막으로 `providers`에 클래스까지 등록해야 런타임이 이 조립을 수행한다. 이 세 부분을 함께 봐야 “DI를 썼다”는 말에 실제 의미가 생긴다.

실험은 개발 서버를 종료한 뒤 생성된 Vite 변환 경로로 실행한다.

```bash
pnpm exec vite build --ssr src/boot-probe.ts --outDir dist-probe
node dist-probe/main.js
```

아래에서 보여 주는 Vite 설정의 출력 파일명이 `main.js`이므로 이 경로로 실행한다. 기대하는 애플리케이션 출력은 `FluoBlog: context-ready`이고, 정리를 마친 뒤 프로세스가 종료되어야 한다. 이 실험에는 HTTP 어댑터가 없으므로 `/greeting`을 받을 listener도 없다. 성공은 모듈과 provider 조립의 근거이지 네트워크 시작의 근거가 아니다.

`BLOG_NAME` provider 등록만 제거하고 다시 빌드하면 의존성 해석이 실패해야 한다. 같은 설명 문자열을 가진 새로운 `Symbol('BLOG_NAME')`을 등록하는 것도 다른 토큰이므로 해결책이 아니다. 정상 등록을 복구하면 다시 조립할 수 있다. 출력 문자열만 직접 반환하는 함수로 고치면 실험은 통과하겠지만 이제 DI 경계를 검사하지 않으므로 원래 문제를 숨긴다.

## 표준 데코레이터와 빌드의 계약

Fluo의 표준 데코레이터를 쓰기 위해 `experimentalDecorators`나 `emitDecoratorMetadata`를 켜지 않는다. 오래된 TypeScript 예제에서 복사한 이 두 옵션은 이 책의 실행 모델이 아니다. 런타임의 의존성 정보는 클래스 위의 토큰 선언으로 제공한다. TypeScript가 생성자 타입을 자동으로 리플렉션 정보로 바꿔 주리라고 기대하지 않는다.

생성된 `tsconfig.json`의 기존 `compilerOptions`에는 다음 `lib`를 추가한다. 아래는 **병합할 설정 조각**이며, 다른 생성 옵션과 `include`를 지우는 전체 교체 파일이 아니다. 뒤의 트랜잭션·취소 실험은 Node.js 24가 제공하는 `Promise.withResolvers()`를 사용한다. CLI의 기본 `target: "ES2022"`만 두면 TypeScript가 그 API의 타입 선언을 읽지 못하므로 실행 환경과 타입 라이브러리를 따로 맞춘다.

```json
{
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "ESNext.Decorators"]
  }
}
```

`lib`는 런타임에 기능을 설치하거나 polyfill을 넣지 않는다. 이 설정은 TypeScript가 알고 있는 표준 API와 데코레이터 메타데이터의 범위를 정하며, 실행 환경은 여전히 Node.js 24여야 한다. `target`, 모듈 해석, strict 설정은 생성된 값을 유지한다. 뒤에서 TSX 설정을 추가할 때도 이 `lib`를 보존한다.

다음은 현재 Node starter의 `vite.config.ts`와 같은 실행 경계를 가진 **완전한 설정 파일**이다. 이미 생성된 설정이 이와 같다면 다시 작성할 필요는 없다.

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rolldownOptions: {
      output: {
        entryFileNames: 'main.js',
      },
    },
    ssr: 'src/main.ts',
    target: 'node24',
  },
  server: {
    port: 5173,
  },
});
```

`fluoDecoratorsPlugin()`은 애플리케이션의 데코레이터를 Babel로 먼저 변환한다. 현재 생성 도구의 Vite 8 파이프라인에서 Rolldown/Oxc가 처리하기 전에 이 단계가 필요하다. `target: 'node24'`는 빌드 대상이지 실행 중인 Node 버전을 바꾸는 명령이 아니다. `server.port: 5173` 역시 Vite 설정이며 `src/main.ts`에서 선택한 Fastify의 `3000`과 같은 포트를 두 번 설정하는 것이 아니다.

변환 설정과 metadata 준비 시점도 구별한다. 데코레이터가 붙은 선언을 평가하기 전에 `Symbol.metadata`가 준비되어 있어야 한다. 호스트나 변환 경로가 이를 제공하지 않는 custom bootstrap에서는 `@fluojs/core`의 `ensureMetadataSymbol()`로 먼저 준비한 뒤 decorated module을 로드한다. static import는 진입점 본문보다 먼저 평가되므로 그 import 아래에 준비 호출만 추가해서는 순서가 바뀌지 않는다. 생성된 변환 경로를 유지하고, 9장에서 설정과 앱 그래프를 직접 조립할 때는 준비 이후의 dynamic import로 이 경계를 명시한다.

테스트 파일은 별도 경계다. 애플리케이션용 플러그인이 `*.test.ts`를 처리할 것이라고 가정하지 않는다. starter의 `vitest.config.ts`는 `@fluojs/testing/vitest`의 플러그인을 사용한다. 4장에서 테스트를 추가할 때 이 분리를 그대로 유지한다. 개발은 성공하는데 테스트의 데코레이터에서 구문 오류가 나면 비즈니스 코드를 고치기 전에 어느 변환 경로가 그 파일을 처리했는지 확인한다.

## 성공한 시작만큼 중요한 종료

이제 개발 서버를 종료하고 배포 산출물 경로를 확인한다.

```bash
pnpm build
pnpm start
```

정상 시작을 확인한 뒤 `/greeting`을 다시 요청한다. 그다음 서버 터미널에서 `Ctrl+C`를 누르고 명령 프롬프트가 돌아온 것을 확인한 뒤 같은 포트로 다시 시작한다. 임의로 몇 초를 기다리는 대신 시작 로그와 종료 상태라는 실제 사건을 기준으로 다음 작업을 한다. 이번 실습에는 데이터베이스나 외부 작업이 없지만, 종료 책임을 놓치면 이후 테스트와 개발 재시작에서 연결이나 포트가 남는 문제가 생긴다.

잘못된 포트 실험은 빌드된 파일을 사용하면 개발 감시 프로세스와 앱 실패를 구분하기 쉽다.

```bash
PORT=3000oops node dist/main.js
PORT=70000 node dist/main.js
```

두 실행 모두 listening 성공 전에 `readPort`의 오류로 종료되어야 한다. 정상 서버가 이미 실행 중일 때 두 번째 터미널에서 `PORT=3000 node dist/main.js`를 실행하면 포트 점유 실패가 나야 한다. 이때 기존 서버의 `/greeting`이 계속 응답한다고 해서 두 번째 프로세스가 성공한 것은 아니다. 요청 성공과 방금 시작한 프로세스의 성공은 서로 다른 관찰이다.

Node `shutdownRegistration`은 signal 기반 종료를 연결하지만 실패를 성공으로 바꾸지는 않는다. Timeout과 실패는 로그와 `process.exitCode`로 보고하고 최종 프로세스 종료는 host가 소유한다. 직접 수명을 관리하는 실험은 `finally`에서 `app.close()`를 기다린다.

첫 실행을 마친 상태는 작다. `src/main.ts`에는 실행 환경과 서버 시작만 있고, `src/app.ts`에는 starter의 모듈 구성이 있으며, `/greeting`이 응답한다. 이 정도 목적에는 프레임워크 없이 Node의 HTTP 서버 하나를 쓰는 선택도 가능하다. Fluo의 조립 비용이 의미를 갖는 시점은 요청 처리와 테스트, 데이터 접근처럼 서로 다른 책임을 같은 규칙으로 연결해야 할 때다. 다음 장에서는 그 첫 제품 요구로 `/posts`와 `/posts/1`을 만들고, 실행 성공을 독자가 볼 수 있는 게시글로 바꾼다.

## 기준 Docs

이 장의 실행·실패 설명은 다음 Docs를 FluoBlog에 적용한 것이다. 엄격한 포트와 loopback 주소는 앱의 선택이며, 아래 소스·테스트는 계약을 대조하는 추가 근거다.

- [문서 권위와 Book의 역할](../../docs/contracts/documentation-authority.ko.md)
- [기본 실행, 명시적 조립과 호스트별 시작 경로](../../docs/getting-started/bootstrap-paths.ko.md)
- [초기화 완료와 signal·종료 소유권](../../docs/architecture/lifecycle-and-shutdown.ko.md)
- [표준 데코레이터와 metadata 준비](../../docs/architecture/decorators-and-metadata.ko.md)

## 근거와 더 읽기

- [CLI 생성·개발·빌드 계약](../../packages/cli/README.ko.md), [실제 starter 생성 소스](../../packages/cli/src/new/scaffold.ts), [생성 코드 회귀 테스트](../../packages/cli/src/new/scaffold.test.ts)
- [core의 표준 데코레이터와 명시적 주입](../../packages/core/README.ko.md), [공개 export](../../packages/core/src/index.ts)
- [runtime의 앱과 독립 컨텍스트](../../packages/runtime/README.ko.md), [부트스트랩 소스](../../packages/runtime/src/bootstrap.ts)
- [Fastify 시작·종료와 옵션](../../packages/platform-fastify/README.ko.md), [어댑터 구현](../../packages/platform-fastify/src/adapter.ts), [어댑터 테스트](../../packages/platform-fastify/src/adapter.test.ts)
- [Vite 변환 경계](../../packages/vite/README.ko.md), [공개 플러그인 export](../../packages/vite/src/index.ts)

[이전: 시리즈 안내](../README.ko.md) · [1권 목차](./toc.ko.md) · [다음: 첫 게시글을 HTTP로 보여주기](./ch02-first-http-route.ko.md)
