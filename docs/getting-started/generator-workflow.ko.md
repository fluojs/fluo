# CLI Generator Reference

<p><strong><kbd>한국어</kbd></strong> <a href="./generator-workflow.md"><kbd>English</kbd></a></p>

`fluo generate`와 `fluo g`는 해석된 소스 디렉터리 아래에 기능 슬라이스 파일을 생성합니다. 현재 포함된 생성기 집합은 모듈, HTTP 진입점, 프로바이더, 미들웨어, DTO 스텁을 다룹니다.

## Available Generators

```bash
fluo generate <generator> <name> [--target-directory <path>] [--force]
fluo g <generator> <name> [--target-directory <path>] [--force]
fluo g request-dto <feature> <name> [--target-directory <path>] [--force]
```

| 생성기 | 허용 토큰 | 예시 문법 | 배선 방식 | 출력 범위 |
| --- | --- | --- | --- | --- |
| Module | `module`, `mo` | `fluo generate module Billing` | 파일만 생성 | 독립 모듈 파일 |
| Controller | `controller`, `co` | `fluo g controller Billing` | 자동 등록 | 컨트롤러 파일, 테스트 파일, 모듈 갱신 |
| Service | `service`, `s` | `fluo g service Billing` | 자동 등록 | 서비스 파일, 테스트 파일, 모듈 갱신 |
| Repository | `repo`, `repository` | `fluo g repo Billing` | 자동 등록 | 레포지토리 파일, 단위 테스트, 슬라이스 테스트, 모듈 갱신 |
| Guard | `guard`, `gu` | `fluo generate guard Billing` | 자동 등록 | 가드 파일, 모듈 갱신 |
| Interceptor | `interceptor`, `in` | `fluo generate interceptor Billing` | 자동 등록 | 인터셉터 파일, 모듈 갱신 |
| Middleware | `middleware`, `mi` | `fluo generate middleware Billing` | 자동 등록 | 미들웨어 파일, 모듈 갱신 |
| Request DTO | `request-dto`, `req` | `fluo generate request-dto billing CreateBilling` | 파일만 생성 | 요청 DTO 파일 |
| Response DTO | `response-dto`, `res` | `fluo generate response-dto Billing` | 파일만 생성 | 응답 DTO 파일 |

자동 등록 생성기는 슬라이스 모듈을 생성하거나 갱신한 뒤 생성된 클래스를 `controllers`, `providers`, `middleware` 배열에 추가합니다. 파일만 생성하는 생성기는 부모 모듈 등록 없이 파일만 산출합니다.

## Generated Artifacts

대부분의 생성 결과는 `<resolved-target>/<plural-resource>/` 아래에 기록됩니다. `fluo g service Post`를 실행하고 해석된 타깃 디렉터리가 `src/`이면 슬라이스 디렉터리는 `src/posts/`입니다. Request DTO는 명시적 feature 타깃도 받을 수 있습니다. `fluo g req posts CreatePost`는 DTO 클래스 이름에서 `create-posts/` 디렉터리를 추론하지 않고 `src/posts/`에 기록합니다.

| 생성기 | 슬라이스 디렉터리에 생성되는 파일 | 모듈 영향 |
| --- | --- | --- |
| Module | `post.module.ts` | 없음. 상위 모듈 import는 별도로 처리합니다. |
| Controller | `post.controller.ts`, `post.controller.test.ts` | `post.module.ts`를 생성하거나 갱신하고 `PostController`를 `controllers`에 추가합니다. |
| Service | `post.service.ts`, `post.service.test.ts` | `post.module.ts`를 생성하거나 갱신하고 `PostService`를 `providers`에 추가합니다. |
| Repository | `post.repo.ts`, `post.repo.test.ts`, `post.repo.slice.test.ts` | `post.module.ts`를 생성하거나 갱신하고 `PostRepo`를 `providers`에 추가합니다. |
| Guard | `post.guard.ts` | `post.module.ts`를 생성하거나 갱신하고 `PostGuard`를 `providers`에 추가합니다. |
| Interceptor | `post.interceptor.ts` | `post.module.ts`를 생성하거나 갱신하고 `PostInterceptor`를 `providers`에 추가합니다. |
| Middleware | `post.middleware.ts` | `post.module.ts`를 생성하거나 갱신하고 `PostMiddleware`를 `middleware`에 추가합니다. |
| Request DTO | `fluo g req posts CreatePost` 사용 시 `posts/` 안의 `create-post.request.dto.ts` | 없음. 컨트롤러에서 수동 import가 필요합니다. |
| Response DTO | `post.response.dto.ts` | 없음. 컨트롤러 반환 타입으로 수동 사용이 필요합니다. |

컨트롤러와 서비스 템플릿은 렌더링 전에 같은 슬라이스의 형제 파일 존재 여부를 확인합니다. 컨트롤러 스텁은 같은 슬라이스에 서비스 파일이 있을 때만 `post.service.ts` import를 추가합니다. 서비스 스텁은 같은 슬라이스에 레포지토리 파일이 있을 때만 `post.repo.ts` import를 추가합니다.

## Options

| 옵션 | 별칭 | 적용 범위 | 동작 |
| --- | --- | --- | --- |
| `--target-directory <path>` | `-o` | 모든 생성기 | 지정한 소스 디렉터리 아래에 슬라이스를 기록합니다. |
| `--force` | `-f` | 모든 생성기 | 기존 생성 파일을 건너뛰지 않고 덮어씁니다. |
| `--help` | `-h` | `fluo generate`, `fluo g` | generate 명령 사용법과 생성기 메타데이터를 출력합니다. |

| 해석 규칙 | 결정되는 기본 디렉터리 |
| --- | --- |
| 현재 디렉터리에 `package.json`과 `src/`가 모두 존재 | `<cwd>/src` |
| 현재 디렉터리에 `apps/`가 있고, 그 아래에 `package.json`과 `src/`를 가진 앱이 정확히 하나 존재 | `<cwd>/apps/<app>/src` |
| 어느 조건에도 해당하지 않음 | `<cwd>` |

## Constraints

- 리소스 이름은 비어 있으면 안 됩니다.
- 리소스 이름은 `-`로 시작할 수 없습니다.
- 리소스 이름에는 경로 구분자나 `..` 탐색 세그먼트가 포함될 수 없습니다.
- 허용되는 이름 문자는 영문자, 숫자, 공백, 밑줄, 하이픈입니다. 생성되는 파일 스템은 kebab case로 정규화됩니다.
- Request DTO feature 타깃도 같은 검증을 거치며 kebab-case 디렉터리 이름으로 정규화됩니다. PascalCase feature 이름은 일반 리소스 plural 규칙을 따르므로 `fluo g req Post CreatePost`는 `posts/`에 기록하고, `posts` 같은 lower-case 디렉터리 토큰은 입력한 그대로 사용합니다. 1-인자 형식(`fluo g req CreatePost`)은 호환성을 위해 계속 지원하지만, 명시적 feature 형식을 사용하면 여러 DTO를 하나의 슬라이스에 모을 수 있습니다.
- 유효한 `apps/*/src` 타깃이 둘 이상인 멀티 앱 워크스페이스 루트에서는 `--target-directory`가 필요합니다.
- 기존 파일은 기본적으로 건너뜁니다. 덮어쓰기는 `--force`가 필요합니다.
- 자동 등록 메타데이터가 해석되더라도 변경되지 않은 파일 내용은 다시 쓰지 않습니다.
- 모듈 자동 등록은 controller, service, repository, guard, interceptor, middleware 생성기에만 적용됩니다.
- DTO 생성기와 module 생성기는 상위 모듈 import를 자동으로 연결하지 않습니다.
- generate 명령이 문서화하는 옵션은 `--target-directory`, `--force`, `--help`입니다. `fluo generate`와 `fluo g`에는 `--dry-run` 파서가 없습니다.
