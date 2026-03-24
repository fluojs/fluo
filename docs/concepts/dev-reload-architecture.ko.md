# dev reload architecture

<p><strong><kbd>한국어</kbd></strong> <a href="./dev-reload-architecture.md"><kbd>English</kbd></a></p>

Konekti의 개발 중 갱신 경로는 두 가지이며, 서로 같은 것으로 보면 안 됩니다.

## 관련 문서

- `./architecture-overview.ko.md`
- `./config-and-environments.ko.md`
- `./lifecycle-and-shutdown.ko.md`
- `../../packages/cli/README.ko.md`
- `../../packages/runtime/README.ko.md`

## 현재 지원하는 두 가지 경로

### 1. 소스 코드 변경은 프로세스 재시작을 사용한다

`@konekti/cli`가 생성하는 starter 앱의 `dev` 스크립트는 Node watch mode와 `tsx`를 기반으로 합니다.

즉 기본 starter 개발 경험에서 소스 파일이 바뀌면:

- Node가 변경을 감지하고
- 프로세스를 다시 시작하며
- runtime이 처음부터 다시 bootstrap 됩니다

이것은 watch 기반 재시작 모델이며, in-process HMR이 아닙니다.

### 2. 설정 변경은 제한된 in-process reload를 사용할 수 있다

`@konekti/config`는 env 파일 기반 설정을 명시적으로 다시 읽기 위한 `createConfigReloader()`를 제공합니다.

`@konekti/runtime`은 호출자가 `watch: true`를 주고 `mode: 'dev'`로 실행할 때 이 reloader를 받아들여 사용할 수 있습니다.

이 경로는 의도적으로 좁게 유지됩니다.

- 검증된 config snapshot에만 한정됩니다
- 애플리케이션 전체를 다시 만들지 않고 기존 `ConfigService` 참조를 유지합니다
- 새 snapshot이 적용된 뒤 runtime이 관리하는 reload participant를 호출합니다
- runtime 쪽 reload 처리에 실패하면 이전 snapshot으로 되돌립니다

이것은 범용 코드 hot reload API가 아닙니다.

## 책임 경계

### `@konekti/cli`

starter workflow 기준 개발용 runner orchestration을 담당합니다.

- starter `pnpm dev` 동작
- 소스 변경 시 프로세스 재시작
- 향후 builder 선택 같은 runner 레벨 결정

### `@konekti/config`

config snapshot 생성을 담당합니다.

- env 파일 경로 결정
- config merge와 validation
- config source 감시
- 명시적인 reload subscription과 error 전달

### `@konekti/runtime`

승인된 config reload를 runtime에 적용하는 책임을 집니다.

- `ConfigService` 참조 안정성 유지
- dev mode에서 검증된 config snapshot 적용
- runtime이 관리하는 reload participant 호출
- runtime 쪽 reload 처리 실패 시 이전 snapshot 복구

## 현재 보장하는 것

- Konekti는 공개 `@konekti/hot-reload` 패키지를 제공하지 않습니다.
- 생성된 starter 앱은 코드 변경에 대해 계속 프로세스 재시작을 사용합니다.
- runtime config reload는 opt-in이며 dev 전용입니다.
- 잘못된 watched config는 마지막 정상 runtime snapshot을 덮어쓰지 않습니다.
- 애플리케이션을 닫으면 runtime이 소유한 config watch 경로도 함께 닫힙니다.

## 왜 아직 `@konekti/hot-reload` 패키지가 없는가

지금의 Konekti에는 공개 패키지 경계로 승격할 만큼 넓고 안정적인 reload 추상화가 아직 없습니다.

현재 안정적인 분리는 다음과 같습니다.

- CLI는 restart orchestration을 맡고
- config는 snapshot production을 맡고
- runtime은 reload application semantics를 맡습니다

나중에 더 넓은 공유 계약이 실제로 생기면, 그때 검증된 경계에서 패키지를 뽑아내는 편이 더 안전합니다.
