# konekti

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti는 **TC39 표준 데코레이터**를 전면 사용하는 TypeScript 백엔드 프레임워크로, NestJS의 레거시 데코레이터 경로와 명확히 구분됩니다.

## 왜 표준 데코레이터인가?

Konekti는 TypeScript의 현재 표준 데코레이터 모델을 기준으로 동작하므로, 스타터 앱에서 레거시 컴파일러 동작을 요구하지 않습니다.

- `experimentalDecorators`: 레거시(표준 이전) 데코레이터 동작을 활성화하는 플래그입니다.
- `emitDecoratorMetadata`: 리플렉션 기반 주입에 쓰이는 런타임 타입 메타데이터를 생성하는 플래그입니다.
- NestJS: 암묵적 생성자 주입을 위해 레거시 데코레이터 + 메타데이터 생성이 필요합니다.
- Konekti: 토큰 기반 명시적 주입을 사용하므로 메타데이터 생성에 의존하지 않습니다.

즉, 프로젝트 `tsconfig.json`에서 표준 TypeScript 기본값을 유지하고 레거시 데코레이터 플래그를 피할 수 있습니다.

## TypeScript-first, 검증 가능한 차이

Konekti의 TypeScript-first는 마케팅 문구가 아니라, 레거시 데코레이터 플래그 불필요성과 명시적 DI라는 검증 가능한 동작 차이를 뜻합니다.

### `tsconfig.json` 비교

NestJS식 레거시 데코레이터 설정:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Konekti 표준 데코레이터 설정:

```json
{
  "compilerOptions": {
    "experimentalDecorators": false
  }
}
```

Konekti 앱에서는 `experimentalDecorators`를 아예 생략해도 됩니다.

### DI 스타일 비교

NestJS 암묵적 메타데이터 주입:

```ts
@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}
}
```

Konekti 명시적 토큰 주입:

```ts
const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');

@Inject([USERS_REPOSITORY])
class UsersService {
  constructor(private readonly repo: UsersRepository) {}
}
```

## 빠른 시작

처음 실행하는 표준 경로는 다음과 같습니다: CLI 설치 -> `konekti new` -> 새 앱 디렉터리로 이동 -> `pnpm dev`.

```sh
pnpm add -g @konekti/cli
konekti new starter-app
cd starter-app
pnpm dev
```

생성 직후 바로 얻는 것:

- 런타임 소유 부트스트랩 (`src/main.ts`)
- 기본 상태 확인 엔드포인트 (`/health`, `/ready`)
- 스타터 예제 라우트 (`/health-info/`)
- 즉시 실행 가능한 `dev`, `build`, `typecheck`, `test` 스크립트

생성된 `dev` 스크립트는 코드 변경에 대해 watch 기반 프로세스 재시작을 사용합니다. Konekti의 제한된 in-process reload 경로는 일반 코드 HMR이 아니라, 검증된 config snapshot에만 적용됩니다.

## Konekti가 다른 이유

- **표준 데코레이터 중심**: `"experimentalDecorators": true`와 `emitDecoratorMetadata`에 의존하지 않음
- **리플렉션 매직 없는 DI**: 토큰 기반으로 의존성을 명시해 읽기와 검증이 쉬움
- **패키지 경계가 명확한 확장**: auth, OpenAPI, metrics, queue, microservices, Redis, Prisma, Drizzle 등을 필요한 만큼 조합
- **CLI 우선 온보딩**: 생성 -> 개발 -> 검증 흐름이 일관됨

## 시작 경로

- `docs/getting-started/quick-start.ko.md` - install -> new -> dev 표준 경로
- `docs/README.ko.md` - 첫 실행 후 이어서 읽는 문서 맵
- `docs/concepts/architecture-overview.ko.md` - 아키텍처/패키지 경계
- `docs/concepts/dev-reload-architecture.ko.md` - 개발 중 재시작과 config reload 책임 경계
- `docs/reference/package-surface.ko.md` - 현재 공개 패키지 표면

패키지별 API 상세는 `packages/*/README.ko.md`를 각 패키지의 단일 출처로 참고하세요.

## 릴리스 히스토리

- `CHANGELOG.md`
- `https://github.com/konektijs/konekti/releases`

## 기여 가이드

- 패키지 간 계약이 바뀌면 `docs/`를 업데이트
- 패키지 API가 바뀌면 해당 `packages/*/README*.md`를 업데이트
- 향후 작업은 레포 내 상태 문서 대신 GitHub Issue로 관리
