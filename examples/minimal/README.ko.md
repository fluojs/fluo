# 최소 예제

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

가장 작은 실행 가능한 Konekti 애플리케이션입니다. 이 예제는 `konekti new`가 생성하는 것과 동일한 시작 경로를 따르되, 필수 요소만 남겼습니다.

## 이 예제가 보여주는 것

- `KonektiFactory.create`를 통한 런타임 소유 부트스트랩
- `@Module`, `@Inject`, `@Controller`, `@Get`을 사용한 표준 데코레이터 DI
- `createHealthModule()`의 내장 `/health` 및 `/ready` 엔드포인트
- `/hello` 경로의 단일 스타터 컨트롤러
- `@konekti/testing`을 사용한 단위 및 e2e 스타일 테스트

## 실행 방법

이 예제는 Konekti 모노레포 내부에 있으며 워크스페이스 링크 패키지를 사용합니다. 저장소 루트에서:

```sh
pnpm install
```

이 예제는 기본적으로 네트워크 리스너를 시작하지 않으며, 테스트를 통해 검증합니다:

```sh
pnpm vitest run examples/minimal
```

## 프로젝트 구조

```
examples/minimal/
├── src/
│   ├── app.ts              # AppModule — 루트 모듈
│   ├── main.ts             # 진입점: KonektiFactory.create → listen
│   ├── hello.controller.ts # GET /hello
│   ├── hello.service.ts    # 비즈니스 로직
│   └── app.test.ts         # 런타임 디스패치 + e2e 스타일 테스트
└── README.md
```

## 스타터 스캐폴드와의 관계

이 예제는 `konekti new` 출력의 의도적인 부분 집합입니다. config, health 모듈, 생성된 테스트, 빌드 도구가 포함된 전체 스타터 경험을 원한다면:

```sh
pnpm add -g @konekti/cli
konekti new my-app
```

## 관련 문서

- `../../docs/getting-started/quick-start.ko.md` — 표준 시작 가이드
- `../../docs/reference/package-chooser.ko.md` — 작업별 패키지 선택
- `../../docs/operations/testing-guide.ko.md` — 테스트 패턴 및 레시피
