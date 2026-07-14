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

## trust boundary

- `@fluojs/jwt`는 Node-runtime auth 패키지입니다. 루트 import surface는 lazy load되지만, 서명, 검증, JWKS key parsing, refresh-token id 생성은 모두 Node.js 호환 `node:crypto` 구현을 필요로 합니다. Bun은 Node 호환성 레이어로 이를 만족하지만, Deno와 Cloudflare Workers는 지원되는 JWT 서명/검증 runtime이 아닙니다.
- `JwtService.decode(token)`는 서명이나 클레임을 검증하지 않고 payload를 읽습니다. 반환된 객체는 검증되지 않은 입력(unverified input)이며 권한 결정에 사용해서는 안 됩니다. 먼저 `JwtService.verify(token, options)` 또는 `DefaultJwtVerifier.verifyAccessToken(token)`을 호출하고, 검증이 반환하는 정규화된 `JwtPrincipal`에서 신원을 읽으세요. `decode()`는 진단 및 비권위적 검사에만 사용됩니다.

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
5. `src/auth/auth.module.ts` — `JwtModule.forRoot(...)` + `PassportModule.forRoot(...)` 기반 module-first 등록
6. `src/app.test.ts` — service/strategy coverage와 `createTestApp(...).request(...).send()` 기반 e2e 스타일 HTTP 점검

## 관련 문서

- `../README.ko.md` — 공식 examples 인덱스
- `../../docs/getting-started/first-feature-path.ko.md`
- `../../docs/architecture/auth-and-jwt.ko.md`
- `../../packages/jwt/README.ko.md`
- `../../packages/passport/README.ko.md`
