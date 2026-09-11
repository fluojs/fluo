# FluoBlog: 누적 튜토리얼 체크포인트

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Node.js 24, Fastify, pnpm으로 작은 게시물 API를 만듭니다. 명시적 모듈 등록,
생성자 주입, DTO 검증, 요청 파이프라인 테스트를 배웁니다.
[FluoBlog 튜토리얼](../../apps/docs/content/docs/tutorial/index.ko.mdx)은
`00-start`에서 시작하며 과정 내내 이 앱을 직접 수정합니다.
`01-first-route`, `02-dependency-injection`, `03-validation-errors`는
수정하지 않는 비교·복구용 완성 스냅샷이며 학습 중 편집할 파일이 아닙니다.

게시물은 메모리에 저장하며 앱을 재시작하면 초기화됩니다. 데이터베이스,
인증, 인가, 수정/삭제, 프로덕션 배포는 구현하지 않습니다. 영속성과 인증은
후속 가이드에서 다룹니다.

## 하나의 앱 만들기

모든 단계는 `@fluojs/runtime`의 `HealthModule.forRoot()`로 스타터의
`GET /health`와 `GET /ready`를 유지합니다.

| 수업 | 시작 상태 | 완성 상태 |
| --- | --- | --- |
| 앱 생성 | `00-start` | health/readiness만 있는 `00-start/src/`에서 편집을 시작합니다. |
| 첫 라우트 | 같은 `00-start` 앱 | `GET /posts`와 명시적 컨트롤러 등록을 추가하고 `01-first-route`와 비교합니다. |
| 의존성 주입 | `00-start`에 작성한 첫 라우트 | 목록/조회 서비스, `PostsModule`, 생성자 주입, 리소스 404를 추가하고 `02-dependency-injection`과 비교합니다. |
| 검증과 오류 | `00-start`에 작성한 DI | 검증된 `POST /posts`, 생성 201, 필드별 400 오류를 추가하고 `03-validation-errors`와 비교합니다. |
| 테스트 | 직접 완성한 `00-start` 앱 | 완성 스냅샷의 서비스·모듈·요청 테스트를 작업 앱에 추가하고 기존 health/readiness 테스트를 유지합니다. |

시작 앱과 각 스냅샷에는 독립적이고 완전한 `src/`와 `test/`가 있습니다.
다른 체크포인트의 앱 소스를 import하지 않습니다. 공통 Vite/Vitest 설정은
저장소 실행용 기반 설정일 뿐입니다. 시작 앱의 테스트는 health/readiness만
검증하므로 게시물 기능을 추가해도 유효합니다.

```text
00-start/                    # 과정 내내 이 앱을 편집합니다
  src/
    app.ts
    main.ts
  test/app.e2e.test.ts
01-first-route/
  src/
    app.ts
    main.ts
    post.ts
    posts.controller.ts
  test/app.e2e.test.ts
02-dependency-injection/
  src/
    app.ts
    main.ts
    post.ts
    post-params.dto.ts
    posts.controller.ts
    posts.module.ts
    posts.service.ts
    posts.slice.test.ts
  test/app.e2e.test.ts
03-validation-errors/
  src/
    app.ts
    main.ts
    post.ts
    post-params.dto.ts
    create-post.dto.ts
    posts.controller.ts
    posts.module.ts
    posts.service.ts
    posts.service.test.ts
    posts.slice.test.ts
  test/app.e2e.test.ts
```

모든 단계의 `src/app.ts`는 `AppModule`을 export합니다. 테스트는 이를
import하여 소켓을 열지 않고 앱을 구성합니다. `src/main.ts`는 실행 진입점이고,
`post.ts`는 `Post` 인터페이스를 export합니다. 나머지 클래스는 파일명과
대응하는 named export입니다: `PostsController`, `PostsModule`,
`PostsService`, `PostParamsDto`, `CreatePostDto`.

`00-start/src/`에 먼저 `post.ts`와 `posts.controller.ts`를 작성하고
`app.ts`에 컨트롤러를 등록합니다. 이어서 `posts.module.ts`,
`posts.service.ts`, `post-params.dto.ts`를 추가하고 같은 `app.ts`와
`posts.controller.ts`를 수정합니다. 마지막으로 `create-post.dto.ts`를
추가하고 같은 컨트롤러와 서비스를 확장합니다. 작업 디렉터리를 바꾸지 않고
해당 스냅샷과 완성 상태를 비교하세요. 복구가 필요하면 스냅샷의 전체 소스를
`00-start/src/`로 복사한 뒤 다시 `00-start`에서 작업합니다.

## 저장소 안에서 실행

Node.js 24와 저장소 루트에 지정된 pnpm 버전을 사용합니다. 선언된 Node 지원
범위는 `>=24.0.0 <27`입니다. 새로 clone한 저장소 루트에서 실행합니다.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @fluojs/example-fluo-blog typecheck
pnpm --filter @fluojs/example-fluo-blog test 00-start
pnpm --filter @fluojs/example-fluo-blog build:00
pnpm --filter @fluojs/example-fluo-blog start:00
```

루트 빌드는 이 private 예제가 사용할 공개 workspace 패키지를 준비합니다.
각 수업이 끝나면 Ctrl+C로 종료하고 `build:00`으로 다시 빌드한 다음
`start:00`으로 실행합니다. 계속 확장 중인 같은 `00-start` 앱을 실행하는
명령입니다. 수업을 마치기 위해 `start:01`, `start:02`, `start:03`으로
바꾸지 않습니다.

참조 스냅샷을 독립적으로 확인할 때만 학습 앱을 종료한 뒤 실행합니다.

```bash
pnpm --filter @fluojs/example-fluo-blog build:01
pnpm --filter @fluojs/example-fluo-blog start:01
```

```bash
pnpm --filter @fluojs/example-fluo-blog build:02
pnpm --filter @fluojs/example-fluo-blog start:02
```

```bash
pnpm --filter @fluojs/example-fluo-blog build:03
pnpm --filter @fluojs/example-fluo-blog start:03
```

`build`와 `start`는 최종 참조 스냅샷인 03 단계의 별칭입니다. 과정에서는
명시적인 `build:00`/`start:00`을 사용합니다. 빌드는
`@fluojs/vite`의 `fluoDecoratorsPlugin()`, 생성 스타터의 Vite 설정 방식,
`node24` 타깃을 사용합니다. 출력은 `dist/<checkpoint>/main.js`이며,
별도 튜토리얼 실행기가 아닌 Node로 실행합니다.

모든 단계의 기본 주소는 `127.0.0.1:3000`입니다. 다른 포트를 쓰려면:

```bash
PORT=3100 pnpm --filter @fluojs/example-fluo-blog start:00
```

각 `main.ts`는 static Fastify adapter와 명시적인 Node shutdown callback을
`FluoFactory.create(...)`에 전달하고 `app.listen()`을 await합니다. Ctrl+C를 누르면
앱과 리스너가 닫히며, 프로세스 종료 후 포트를 다시 사용할 수 있습니다.
앱 객체를 직접 소유하는 코드에서는 `app.close()`로 명시적으로 정리합니다.

## CLI로 생성한 앱에 소스 사용

저장소의 `workspace:*` manifest와 체크포인트 mode 빌드 설정은 독립 앱의
템플릿이 아닙니다. pnpm으로 일반 Node + Fastify 앱을 생성합니다.

```bash
pnpm dlx @fluojs/cli new fluo-blog \
  --shape application --transport http \
  --runtime node --platform fastify --package-manager pnpm
cd fluo-blog
```

이것은 과정의 작업 디렉터리가 아닌 별도의 애플리케이션입니다.
생성된 패키지·설정 파일, greeting 기능, 테스트를 유지합니다.
과정 이후 posts 기능을 재사용할 때는 기능 파일을 복사하고 기존
`src/app.ts`에 posts 등록을 합칩니다. 생성된 config, greeting, health
import를 보존하며, 두 앱을 같게 만들려고 루트 모듈을 덮어쓰거나
스타터 테스트를 삭제하지 않습니다. 수업의 전체 파일 교체 지시는
저장소의 `00-start` 앱만 대상으로 합니다.

최종 단계는 `@fluojs/validation`을 import합니다. 생성 앱의 의존성에 있는지
확인하고, 없다면 `pnpm add @fluojs/validation`으로 추가합니다. 생성 스타터가
Fluo runtime, Fastify adapter, 표준 데코레이터 빌드/테스트 설정을 제공합니다.

저장소의 단계별 script 대신 생성 앱의 명령으로 합쳐진 앱을 검증합니다.

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

이 앱에서 `pnpm build`와 `pnpm start`는 `fluo build`와 `fluo start`로
위임됩니다. Node의 타입 제거 기능으로 데코레이터 소스를 직접 실행하거나
레거시 `experimentalDecorators`/`emitDecoratorMetadata`를 켜지 않습니다.

## API 호출

학습 앱을 실행한 상태에서 다른 터미널을 사용합니다.

```bash
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/ready
```

health 경로는 각각 200과 `{"status":"ok"}`, `{"status":"ready"}`를
반환합니다. 첫 라우트 수업을 마친 뒤 추가한 경로를 호출합니다.
참조 스냅샷 01/02/03에서도 사용할 수 있습니다.

```bash
curl -i http://127.0.0.1:3000/posts
```

새 게시물 목록 응답은 200입니다.

```json
[{"id":"1","title":"Hello, Fluo!","content":"My first post."}]
```

DI 수업 이후(참조 스냅샷 02/03) `GET /posts/1`은 해당 게시물 객체를 200으로 반환합니다.
`GET /posts/999`는 404를 반환합니다.

```json
{"error":{"code":"NOT_FOUND","message":"Post 999 was not found.","status":404}}
```

프레임워크가 `error.requestId`를 추가할 수 있습니다. 서비스는
`NotFoundException`을 던지며 `undefined`를 성공 응답으로 반환하지 않습니다.

검증과 오류 수업 이후(참조 스냅샷 03)에는:

```bash
curl -i http://127.0.0.1:3000/posts \
  -H 'content-type: application/json' \
  --data '{"title":"Learning Fluo","content":"Explicit modules and DI."}'
curl -i http://127.0.0.1:3000/posts/2
curl -i http://127.0.0.1:3000/posts
```

첫 생성 요청은 201을 반환합니다.

```json
{"id":"2","title":"Learning Fluo","content":"Explicit modules and DI."}
```

이후 단건 조회와 목록에 새 게시물이 포함됩니다. ID는 실행 중인 앱 인스턴스
안에서 순서대로 부여되는 문자열입니다.

`CreatePostDto`는 `@FromBody()`로 본문 필드를 바인딩하고, 핸들러는
`@RequestDto(CreatePostDto)`로 해당 DTO를 선택합니다. 필수 문자열 규칙이
서비스 실행 전에 누락, null, 문자열이 아닌 값, 길이 범위를 벗어난 값을
거절합니다.

| 필드 | 규칙 |
| --- | --- |
| `title` | 필수 문자열, 3~120자 |
| `content` | 필수 문자열, 1~5000자 |

문자열의 공백을 자동으로 제거하지 않습니다. HTTP binder는 DTO 바인딩에
선언되지 않은 본문 필드를 400과 `UNKNOWN_FIELD` detail로 거절합니다.
클라이언트가 직접 `id`나 `admin` 필드를 지정할 수 없습니다. 이는 HTTP 요청
바인딩 계약이며, 독립 validator의 기본 미등록 속성 정책과는 다릅니다.

```bash
curl -i http://127.0.0.1:3000/posts \
  -H 'content-type: application/json' \
  --data '{"title":"ab","content":"Valid content"}'
```

잘못된 입력은 표준 `error` 구조의 400 응답으로 반환되며,
`code: "BAD_REQUEST"`, `status: 400`, 메시지, 필드별 `details`를 포함합니다.
각 detail에는 안정적인 `code`, `field`, `source: "body"`, 메시지가 있습니다.
거절된 요청은 게시물을 추가하지 않습니다. 테스트는 자연어 문구 대신 상태와
구조화된 필드를 검증합니다.

## 최종 체크포인트 테스트

기존 health/readiness 검증을 유지하면서 `00-start/test/app.e2e.test.ts`에
최종 스냅샷의 요청 테스트를 추가합니다. 작성한 소스 옆에 서비스와 모듈
테스트도 추가합니다. 작업 앱의 소스 구조가 같으므로 상대 import는 그대로
사용할 수 있습니다. 직접 작성한 앱을 테스트합니다.

```bash
pnpm --filter @fluojs/example-fluo-blog test 00-start
```

설치된 패키지로 수정하지 않은 최종 참조 스냅샷을 검증하려면:

```bash
pnpm --filter @fluojs/example-fluo-blog test 03-validation-errors
```

저장소의 examples 프로젝트로 모든 체크포인트를 검증할 수도 있습니다.

```bash
pnpm exec vitest run --project examples examples/fluo-blog
```

`posts.service.test.ts`는 메모리 저장 동작을 확인합니다.
`posts.slice.test.ts`는 `Test.createTestingModule`로 실제 모듈 그래프를 구성하고
등록된 provider를 resolve한 뒤 `finally`에서 컨테이너를 정리합니다.
`test/app.e2e.test.ts`는 `Test.createApp({ rootModule: AppModule })`과
`app.request(...).body(...).send()`로 실제 요청 파이프라인을 통과하고,
모든 앱을 `finally`에서 닫습니다.

요청 테스트는 health/readiness 유지, 목록/생성/단건 조회, 입력 경계값,
누락/null/잘못된 타입/길이 초과, 리소스 404, 거절된 쓰기, 클라이언트의 추가
필드, 앱 인스턴스 간 격리를 검증합니다. 네트워크 소켓과 고정 sleep을
사용하지 않으며 서비스를 mock으로 바꾸지 않습니다. 실제 Fastify 리스너는
빌드된 `main.ts` 진입점과 위 curl 순서로 확인합니다.
