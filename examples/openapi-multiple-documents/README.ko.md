# OpenAPI multiple documents 예제

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

하나의 애플리케이션에서 여러 OpenAPI 문서를 제공하는 실행 가능한 fluo 예제입니다. 서로 다른 JSON 및 Swagger UI 경로로 `OpenApiModule`을 두 번 등록하여 각 API surface에 독립적으로 접근할 수 있게 합니다.

## 이 예제가 보여주는 것

- 하나의 root module 안에 두 개의 `OpenApiModule.forRoot(...)` 등록
- public 및 admin 문서에 서로 다른 `documentPath`와 `uiPath` 사용
- 두 JSON 문서와 두 Swagger UI 페이지에 대한 request-level 검증
- 현재 공식 예제 관례를 따르는 adapter-first Fastify bootstrap

## 라우트

- `GET /openapi/public.json` — Public API 문서
- `GET /docs/public` — Public API Swagger UI
- `GET /openapi/admin.json` — Admin API 문서
- `GET /docs/admin` — Admin API Swagger UI

## 실행 방법

레포 루트에서 다음을 실행합니다.

```sh
pnpm install
pnpm --filter @fluojs/example-openapi-multiple-documents typecheck
pnpm vitest run examples/openapi-multiple-documents
```

Request-level 테스트는 adapter-first `src/main.ts` entry point와 같은 `AppModule`을 bootstrap합니다.

## 프로젝트 구조

```text
examples/openapi-multiple-documents/
├── src/
│   ├── app.ts
│   ├── app.test.ts
│   └── main.ts
├── package.json
├── README.md
├── README.ko.md
└── tsconfig.json
```

## 관련 문서

- `../README.ko.md` — 공식 예제 인덱스
- `../../packages/openapi/README.ko.md` — `@fluojs/openapi` 계약과 옵션
- `../../docs/architecture/openapi.ko.md` — OpenAPI runtime architecture와 collision 동작
- `../../book/beginner/ch10-openapi.ko.md` — 초급 OpenAPI 안내
