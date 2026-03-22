# 생성기 워크플로우 (generator workflow)

<p><a href="./generator-workflow.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 파일은 현재 CLI 생성기(generator)의 인터페이스를 설명합니다.

## 명령어 형태

```sh
konekti generate <kind> <name>
konekti g <kind> <name>
```

## 사용 가능한 스키매틱 (Schematics)

| 스키매틱 | 별칭 (Alias) |
| --- | --- |
| `controller` | `co` |
| `guard` | `gu` |
| `interceptor` | `in` |
| `middleware` | `mi` |
| `module` | `mo` |
| `repository` | `repo` |
| `request-dto` | `req` |
| `response-dto` | `res` |
| `service` | `s` |

## 출력 컨벤션

- 파일은 TypeScript로 생성됩니다.
- 파일명은 kebab-case를 사용하고 클래스명은 PascalCase를 사용합니다.
- 생성기는 스타터 앱의 `src/` 디렉토리에 기본적으로 작성합니다.
- 스키매틱이 모듈 등록에 참여하는 경우, 생성기는 대상 모듈을 업데이트합니다.

예시:

- `user.controller.ts`
- `user.service.ts`
- `user.repo.ts`
- `user.request.dto.ts`
- `user.response.dto.ts`

## 현재 생성기 철학

- 개별 생성기가 기본 경로입니다.
- `g resource`는 현재 기본 CLI 모델의 일부가 아닙니다.
- 요청(request) 및 응답(response) DTO는 의도적으로 별도의 스키매틱으로 분리되어 있습니다.
- scaffold와 generator 출력은 package-manager-aware 명령과 lockfile을 제외하면 package-manager-neutral을 유지합니다.

## 관련 문서

- `./quick-start.ko.md`
- `../reference/naming-and-file-conventions.ko.md`
- `../../packages/cli/README.ko.md`
