# auth-jwt-passport 예제

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

`@fluojs/jwt`와 `@fluojs/passport`를 가장 단순한 공식 bearer-token 흐름으로 묶어 보여주는 runnable fluo 인증 예제입니다.

## 이 예제가 보여주는 것

- `DefaultJwtSigner`를 통한 access token 발급
- `@UseAuth('jwt')`, `@RequireScopes(...)`를 사용한 보호 라우트
- custom `AuthStrategy`를 통한 bearer token 검증
- reflection 기반 주입 대신 명시적 DI token metadata
- auth 라우트와 함께 동작하는 runtime-owned `/health`, `/ready`
- `@fluojs/testing`을 사용한 unit / integration / e2e 스타일 테스트

## 라우트

- `POST /auth/token` — username 기준 demo access token 발급
- `GET /profile/` — bearer auth와 `profile:read`가 필요한 보호 라우트
- `GET /health`
- `GET /ready`

## 실행 방법

저장소 루트에서:

```sh
pnpm install
pnpm vitest run examples/auth-jwt-passport
```

## 프로젝트 구조

```text
examples/auth-jwt-passport/
├── src/
│   ├── app.ts
│   ├── main.ts
│   ├── app.test.ts
│   └── auth/
│       ├── auth.module.ts
│       ├── auth.controller.ts
│       ├── auth.service.ts
│       ├── bearer.strategy.ts
│       └── login.dto.ts
└── README.md
```

## 권장 읽기 순서

1. `src/auth/login.dto.ts` — 명시적 request boundary
2. `src/auth/auth.service.ts` — JWT 발급
3. `src/auth/bearer.strategy.ts` — passport core를 통한 bearer token 검증
4. `src/auth/auth.controller.ts` — 토큰 발급 라우트 + 보호된 profile 라우트
5. `src/auth/auth.module.ts` — JWT + passport provider 등록
6. `src/app.test.ts` — integration 및 e2e 스타일 검증

## 관련 문서

- `../README.ko.md` — 공식 examples 인덱스
- `../../docs/getting-started/first-feature-path.ko.md`
- `../../docs/concepts/auth-and-jwt.ko.md`
- `../../packages/jwt/README.ko.md`
- `../../packages/passport/README.ko.md`
