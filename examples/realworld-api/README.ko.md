# realworld-api 예제

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

최소 스타터를 넘어 표준 앱 경로를 보여주는 보다 현실적인 fluo 애플리케이션입니다. 동일한 스타터 정렬 adapter-first 부트스트랩 위에 모듈 조합, DTO 검증, config 로딩, 도메인 CRUD 슬라이스를 추가합니다.

## 이 예제가 보여주는 것

- `imports` / `exports`를 사용한 다중 모듈 조합
- `ConfigModule.forRoot`을 통한 타입 안전 설정
- `@fluojs/validation` 데코레이터를 사용한 Request DTO 검증
- 명시적 DI 토큰을 사용한 Repository 패턴
- 런타임 소유 `/health`, `/ready` + 도메인 `/users` CRUD 표면
- `@fluojs/testing`의 단위 및 e2e 스타일 테스트 패턴

## 실행 방법

이 예제는 fluo 모노레포 내부에 있으며 워크스페이스 링크 패키지를 사용합니다. 저장소 루트에서:

```sh
pnpm install
```

테스트를 통해 검증합니다:

```sh
pnpm vitest run examples/realworld-api
```

## 프로젝트 구조

```
examples/realworld-api/
├── src/
│   ├── app.ts                     # AppModule — config와 도메인 import를 포함하는 루트 모듈
│   ├── main.ts                    # 진입점: adapter-first Fastify startup
│   ├── users/
│   │   ├── users.module.ts        # UsersModule — 도메인 모듈
│   │   ├── users.controller.ts    # GET/POST /users
│   │   ├── users.service.ts       # 비즈니스 로직
│   │   ├── users.repo.ts          # 인메모리 리포지토리
│   │   ├── create-user.dto.ts     # 검증 포함 Request DTO
│   │   └── user-response.dto.ts   # 응답 형태
│   └── app.test.ts                # 통합 + e2e 테스트
└── README.md
```

## 스타터 스캐폴드와의 관계

이 예제는 `fluo new` 패턴에 실제 도메인 모듈을 추가하여 확장합니다. 스타터에 포함된 동일한 패키지(core, runtime, http, config, validation, testing, platform-fastify)와 표준 모듈 조합 패턴을 사용합니다. 스타터 스캐폴드 이상의 추가 패키지는 필요하지 않습니다.

## 권장 읽기 순서

1. `src/users/create-user.dto.ts` — DTO 검증 데코레이터
2. `src/users/users.repo.ts` — 클래스 토큰을 사용한 명시적 DI
3. `src/users/users.service.ts` — `@Inject`와 명시적 토큰
4. `src/users/users.controller.ts` — `@RequestDto`를 사용한 라우트 핸들러
5. `src/users/users.module.ts` — `exports`가 있는 모듈 경계
6. `src/app.ts` — 루트 모듈 조합
7. `src/app.test.ts` — 단위, 통합, e2e 수준의 테스트

## 관련 문서

- `../README.ko.md` — 공식 examples 인덱스
- `../../docs/getting-started/quick-start.ko.md` — 표준 시작 가이드
- `../../docs/getting-started/first-feature-path.ko.md` — 스타터 앱에서 첫 기능까지 가는 경로
- `../../docs/reference/package-chooser.ko.md` — 작업별 패키지 선택
- `../../docs/operations/testing-guide.ko.md` — 테스트 패턴 및 레시피
- `../../docs/concepts/di-and-modules.ko.md` — DI 및 모듈 시스템
