# 명명 및 파일 규칙

<p><a href="./naming-and-file-conventions.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


## 생성기 명명 규칙

기본 생성기 명명은 현재 CLI 접미사 규칙을 따릅니다.

- `user.controller.ts`
- `user.service.ts`
- `user.repo.ts`
- `user.request.dto.ts`
- `user.response.dto.ts`

## 생성기 철학

- 개별 생성기가 기본 경로임
- `g resource`는 기본 생성기 인터페이스에 포함되지 않음
- 요청 DTO와 응답 DTO는 별개의 스키마틱임

## 스캐폴드 규칙

- 기본 모드: `dev`, `prod`, `test`
- 기본 환경 파일:
  - `.env.dev`
  - `.env.prod`
  - `.env.test`

## 패키지 매니저 규칙

- 스캐폴드는 기본적으로 패키지 매니저를 자동 감지함
- `--package-manager`로 명시적 오버라이드 가능함
- 정식 동작은 `../getting-started/bootstrap-paths.md`에 문서화되어 있음
